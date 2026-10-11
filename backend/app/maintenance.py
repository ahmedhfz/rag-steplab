"""Recovery paths that do not depend on a healthy worker or a returning user.

* Storage cleanup outbox: bounded retries with backoff, owner-scoped drains
  on mutations and an owner-independent sweeper (Modal schedule).
* Durable worker reconciliation: hard worker deaths (OOM, timeout,
  preemption) and dispatch reservations orphaned by a dying API container
  are turned into visible failed runs instead of blocking admission until the
  lease budget runs out.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from .config import get_settings
from .errors import ApiProblem
from .modal_dispatch import call_terminal_failure
from .storage import get_storage

logger = logging.getLogger(__name__)

RESERVATION_PREFIX = "dispatching-"
TERMINAL_CHECK_INTERVAL_SECONDS = 30.0
COMPLETED_CLEANUP_RETENTION = timedelta(days=30)

_terminal_checks: dict[str, float] = {}
_terminal_checks_lock = threading.Lock()


# --- storage cleanup outbox ---------------------------------------------------------


def process_storage_cleanup(repository, cleanup: dict[str, Any]) -> str:
    """Try one cleanup; record success or a backed-off failure."""

    try:
        get_storage().remove(cleanup["storage_path"], bucket=cleanup.get("storage_bucket"))
    except ApiProblem as exc:
        code = exc.code
    except Exception:
        code = "storage_delete_failed"
    else:
        repository.complete_storage_cleanup(cleanup["id"])
        return "completed"
    logger.warning("storage_cleanup_failed cleanup_id=%s error_code=%s", cleanup["id"], code)
    updated = repository.fail_storage_cleanup(cleanup["id"], code)
    if updated and updated.get("status") == "dead":
        logger.error("storage_cleanup_dead cleanup_id=%s attempts=%s", cleanup["id"], updated.get("attempt_count"))
        return "dead"
    return "failed"


def retry_storage_cleanups(repository, *, limit: int = 3, first: dict[str, Any] | None = None) -> dict[str, int]:
    """Best-effort, owner-scoped drain after a committed mutation.

    The mutation itself already succeeded; a cleanup or database hiccup here
    is logged and never turns the user's request into a 500.
    """

    counts = {"attempted": 0, "completed": 0, "failed": 0}
    try:
        # A fresh deletion is tried first so older failing rows cannot block it.
        cleanups = [first] if first is not None else []
        seen = {row["id"] for row in cleanups}
        cleanups.extend(row for row in repository.list_pending_storage_cleanups(limit=limit) if row["id"] not in seen)
        for cleanup in cleanups:
            counts["attempted"] += 1
            outcome = process_storage_cleanup(repository, cleanup)
            counts["completed" if outcome == "completed" else "failed"] += 1
    except Exception:
        logger.warning("storage_cleanup_retry_skipped", exc_info=True)
    return counts


def sweep_storage_cleanups(repository, *, limit: int = 50) -> dict[str, int]:
    counts = {"attempted": 0, "completed": 0, "failed": 0, "dead": 0, "purged": 0}
    for cleanup in repository.claim_due_storage_cleanups(limit=limit):
        counts["attempted"] += 1
        counts[process_storage_cleanup(repository, cleanup)] += 1
    counts["purged"] = repository.purge_completed_storage_cleanups(older_than=COMPLETED_CLEANUP_RETENTION)
    return counts


# --- durable worker reconciliation --------------------------------------------------


def new_reservation_id() -> str:
    return f"{RESERVATION_PREFIX}{int(time.time() * 1000)}-{uuid.uuid4()}"


def is_reservation(dispatch_id: str | None) -> bool:
    return bool(dispatch_id) and str(dispatch_id).startswith(RESERVATION_PREFIX)


def reservation_is_stale(dispatch_id: str | None, started_at: datetime | None, *, now: datetime | None = None) -> bool:
    """A reservation older than the TTL was never replaced by a real call id."""

    if not is_reservation(dispatch_id):
        return False
    current = now or datetime.now(timezone.utc)
    ttl = get_settings().dispatch_reservation_ttl_seconds
    stamp = str(dispatch_id)[len(RESERVATION_PREFIX):].split("-", 1)[0]
    if stamp.isdigit() and len(stamp) >= 12:
        reserved_at = datetime.fromtimestamp(int(stamp) / 1000, tz=timezone.utc)
    elif isinstance(started_at, datetime):
        # Legacy reservation ids carry no timestamp; the queue time bounds them.
        reserved_at = started_at
    else:
        return False
    return reserved_at + timedelta(seconds=ttl) <= current


def _is_modal_call(dispatch_id: str | None) -> bool:
    return bool(dispatch_id) and not is_reservation(dispatch_id) and not str(dispatch_id).startswith("local")


def _due_for_terminal_check(dispatch_id: str) -> bool:
    now = time.monotonic()
    with _terminal_checks_lock:
        last = _terminal_checks.get(dispatch_id)
        if last is not None and now - last < TERMINAL_CHECK_INTERVAL_SECONDS:
            return False
        _terminal_checks[dispatch_id] = now
        if len(_terminal_checks) > 4096:
            _terminal_checks.clear()
        return True


def reconcile_active_run(repository, kind: str, row: dict[str, Any] | None, *, check_modal: bool) -> dict[str, Any] | None:
    """Terminalize one active run whose worker is provably gone."""

    if row is None or row.get("status") not in {"queued", "running"}:
        return row
    dispatch_id = row.get("dispatch_id")
    if reservation_is_stale(dispatch_id, row.get("started_at")) and row.get("worker_started_at") is None:
        # Spawn may have succeeded before the API died without recording the
        # call id. The repository re-checks "not started" under the row lock,
        # so a worker that started meanwhile keeps running under its lease
        # (lease reconciliation still bounds it).
        logger.warning("pipeline_dispatch_lost kind=%s run_id=%s", kind, row["id"])
        return repository.interrupt_pipeline_run(
            kind, row["id"], dispatch_id, "pipeline_dispatch_lost", "The worker was never started for this run.",
            only_if_unstarted=True,
        ) or row
    if check_modal and _is_modal_call(dispatch_id) and _due_for_terminal_check(str(dispatch_id)):
        if call_terminal_failure(str(dispatch_id)):
            logger.warning("pipeline_worker_terminated kind=%s run_id=%s", kind, row["id"])
            return repository.interrupt_pipeline_run(
                kind, row["id"], dispatch_id, "worker_terminated",
                "The worker stopped before completion (timeout, memory limit or restart).",
            ) or row
    return row


def hosted() -> bool:
    return get_settings().app_env in {"production", "staging"}


def reconcile_user_runs(repository) -> None:
    """Admission pre-check: free capacity held by runs whose worker is gone."""

    if not hosted():
        return
    try:
        for active in repository.list_active_dispatches(limit=20):
            reconcile_active_run(repository, active["kind"], active, check_modal=True)
    except Exception:
        logger.warning("pipeline_reconcile_skipped", exc_info=True)


def sweep_pipeline_runs(repository, *, limit: int = 100) -> dict[str, int]:
    counts = {"checked": 0, "interrupted": 0}
    # Never-dispatched runs (the API died between claim and dispatch) have no
    # call to check; their lease alone decides, so they must be listed too.
    for active in repository.list_active_dispatches(limit=limit, include_undispatched=True):
        counts["checked"] += 1
        result = reconcile_active_run(repository, active["kind"], active, check_modal=True)
        if result is None or result.get("status") not in {"queued", "running"}:
            counts["interrupted"] += 1
            continue
        reconciled = repository.reconcile_pipeline_lease(active["kind"], active["id"])
        if reconciled is not None and reconciled.get("status") not in {"queued", "running"}:
            counts["interrupted"] += 1
    return counts


def run_maintenance(*, cleanup_limit: int = 50, pipeline_limit: int = 100) -> dict[str, Any]:
    """Entry point of the scheduled Modal function (unscoped, trusted)."""

    from .repository import get_repository

    repository = get_repository()
    if not repository.persistent:
        return {"skipped": "no_persistent_repository"}
    return {
        "storageCleanups": sweep_storage_cleanups(repository, limit=cleanup_limit),
        "pipelineRuns": sweep_pipeline_runs(repository, limit=pipeline_limit),
    }
