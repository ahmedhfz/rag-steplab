"""Durable embedding dispatch, worker death recovery and the cleanup outbox."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import main, maintenance
from app.auth import CurrentUser
from app.errors import ApiProblem
from app.main import app
from app.pipeline import run_embedding_worker, run_pipeline_worker
from app.repository import get_repository, now_utc, reset_repository
from app.storage import get_storage, reset_storage
from tests.test_lineage_contract import FakeGemini, _chunk
from tests.test_pipeline import _queue_and_run


client = TestClient(app)


def setup_function():
    reset_repository()
    reset_storage()
    maintenance._terminal_checks.clear()


@pytest.fixture
def hosted(monkeypatch):
    """Exercise the hosted (durable) code paths on the in-memory repository."""

    monkeypatch.setattr("app.pipeline.GeminiService", FakeGemini)
    monkeypatch.setattr(main, "_hosted", lambda: True)
    monkeypatch.setattr(maintenance, "hosted", lambda: True)
    dispatched: list[tuple[str, str, str]] = []

    def fake_dispatch(kind, run_id, lease_token, **_kwargs):
        dispatched.append((kind, run_id, lease_token))
        return f"fc-{len(dispatched)}"

    monkeypatch.setattr(main, "dispatch_pipeline_run", fake_dispatch)
    return dispatched


def _document_with_chunk(monkeypatch):
    parsed = _queue_and_run(monkeypatch)
    chunk = _chunk(parsed["documentId"], parsed["parseRunId"], "fixed_token")
    return parsed["documentId"], chunk["id"]


# --- durable embedding ---------------------------------------------------------------


def test_hosted_embedding_runs_on_worker_and_keeps_sync_contract(monkeypatch, hosted):
    document_id, chunk_id = _document_with_chunk(monkeypatch)

    def dispatch_and_run(kind, run_id, lease_token, **_kwargs):
        hosted.append((kind, run_id, lease_token))
        run_pipeline_worker(kind, run_id, lease_token)
        return "fc-inline"

    monkeypatch.setattr(main, "dispatch_pipeline_run", dispatch_and_run)
    response = client.post(f"/documents/{document_id}/embeddings", json={"chunkRunId": chunk_id})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "completed"
    assert body["embeddingCount"] > 0
    assert body["reusedArtifact"] is False
    assert "leaseToken" not in body
    assert body["queueDurationMs"] is not None
    assert [kind for kind, *_ in hosted] == ["embedding"]

    again = client.post(f"/documents/{document_id}/embeddings", json={"chunkRunId": chunk_id})
    assert again.status_code == 200
    assert again.json()["reusedArtifact"] is True
    assert len(hosted) == 1


def test_hosted_async_embedding_returns_202_and_retry_attaches(monkeypatch, hosted):
    document_id, chunk_id = _document_with_chunk(monkeypatch)

    queued = client.post(f"/documents/{document_id}/embeddings?async=true", json={"chunkRunId": chunk_id})
    assert queued.status_code == 202
    run = queued.json()
    assert run["status"] == "running" and run["dispatchId"] == "fc-1"

    retry = client.post(f"/documents/{document_id}/embeddings?async=true", json={"chunkRunId": chunk_id})
    assert retry.status_code == 202 and retry.json()["id"] == run["id"]
    assert len(hosted) == 1  # dispatched exactly once

    _kind, run_id, token = hosted[0]
    assert run_embedding_worker(run_id, str(uuid.uuid4())) is None  # wrong token is fenced out
    assert run_embedding_worker(run_id, token)["status"] == "completed"
    polled = client.get(f"/embedding-runs/{run_id}").json()
    assert polled["status"] == "completed"


def test_stale_embedding_worker_cannot_complete_after_reclaim(monkeypatch, hosted):
    document_id, chunk_id = _document_with_chunk(monkeypatch)
    run = client.post(f"/documents/{document_id}/embeddings?async=true", json={"chunkRunId": chunk_id}).json()
    _kind, run_id, stale_token = hosted[0]
    repository = get_repository()
    # The worker started and then died: its lease expires.
    repository.embedding_runs[run_id]["worker_started_at"] = now_utc() - timedelta(seconds=60)
    repository.embedding_runs[run_id]["lease_expires_at"] = now_utc() - timedelta(seconds=1)

    reclaimed = client.post(f"/documents/{document_id}/embeddings?async=true", json={"chunkRunId": chunk_id})
    assert reclaimed.status_code == 202 and reclaimed.json()["id"] == run["id"]
    assert len(hosted) == 2 and hosted[1][2] != stale_token
    assert run_embedding_worker(run_id, stale_token) is None
    assert repository.embedding_runs[run_id]["status"] == "running"


# --- hard worker death and orphaned reservations -------------------------------------


def _queued_experiment(document_id: str, chunk_id: str, **values) -> dict:
    row = {
        "id": values.pop("id", str(uuid.uuid4())),
        "document_id": document_id,
        "chunk_run_id": chunk_id,
        "query": "q",
        "target_stage": "retrieval",
        "experiment_fingerprint": values.pop("fingerprint", "fp"),
        "config": {"document_id": document_id, "chunk_run_id": chunk_id, "query": "q", "target_stage": "retrieval",
                   "retrieval": {"mode": "keyword", "top_k": 1}},
        "status": "queued",
        "identity_claimed": True,
        "lease_token": str(uuid.uuid4()),
        "lease_expires_at": now_utc() + timedelta(minutes=30),
        "started_at": now_utc() - timedelta(seconds=5),
        **values,
    }
    return get_repository().save_experiment(row)


def test_hard_worker_death_is_reported_as_failed_on_poll(monkeypatch, hosted):
    document_id, chunk_id = _document_with_chunk(monkeypatch)
    experiment = _queued_experiment(document_id, chunk_id, dispatch_id="fc-dead", status="running")
    calls = []

    def terminal(dispatch_id):
        calls.append(dispatch_id)
        return True

    monkeypatch.setattr(maintenance, "call_terminal_failure", terminal)
    detail = client.get(f"/experiments/{experiment['id']}").json()
    assert detail["status"] == "failed"
    assert detail["errorCode"] == "worker_terminated"
    assert calls == ["fc-dead"]


def test_terminal_failure_check_is_throttled_and_unknown_is_not_failure(monkeypatch, hosted):
    document_id, chunk_id = _document_with_chunk(monkeypatch)
    experiment = _queued_experiment(document_id, chunk_id, dispatch_id="fc-alive", status="running")
    calls = []
    monkeypatch.setattr(maintenance, "call_terminal_failure", lambda dispatch_id: calls.append(dispatch_id) or False)

    assert client.get(f"/experiments/{experiment['id']}/status").json()["status"] == "running"
    assert client.get(f"/experiments/{experiment['id']}/status").json()["status"] == "running"
    assert calls == ["fc-alive"]


def test_orphaned_dispatch_reservation_is_redispatched_with_rotated_token(monkeypatch, hosted):
    document_id, chunk_id = _document_with_chunk(monkeypatch)
    old_ms = int((datetime.now(timezone.utc) - timedelta(minutes=5)).timestamp() * 1000)
    experiment = _queued_experiment(document_id, chunk_id, dispatch_id=f"dispatching-{old_ms}-{uuid.uuid4()}")
    old_token = experiment["lease_token"]

    response = main._durable_pipeline_response("experiment", experiment, get_repository().scoped(main_user()))

    assert response.status_code == 202
    assert len(hosted) == 1
    kind, run_id, new_token = hosted[0]
    assert (kind, run_id) == ("experiment", experiment["id"]) and new_token != old_token
    stored = get_repository().get_experiment_row(experiment["id"])
    assert stored["dispatch_id"] == "fc-1" and stored["lease_token"] == new_token
    assert get_repository().start_pipeline_worker("experiment", run_id, old_token, 60) is None


def test_fresh_reservation_is_not_redispatched(monkeypatch, hosted):
    document_id, chunk_id = _document_with_chunk(monkeypatch)
    fresh = maintenance.new_reservation_id()
    experiment = _queued_experiment(document_id, chunk_id, dispatch_id=fresh)
    response = main._durable_pipeline_response("experiment", experiment, get_repository().scoped(main_user()))
    assert response.status_code == 202 and hosted == []


def test_admission_frees_capacity_held_by_an_orphaned_reservation(monkeypatch, hosted):
    document_id, chunk_id = _document_with_chunk(monkeypatch)
    _queued_experiment(document_id, chunk_id, dispatch_id="dispatching-legacy-without-timestamp",
                       started_at=now_utc() - timedelta(minutes=10), fingerprint="other")

    response = client.post(
        f"/documents/{document_id}/embeddings?async=true", json={"chunkRunId": chunk_id}
    )
    assert response.status_code == 202, response.text
    lost = [row for row in get_repository().experiments.values() if row.get("error_code") == "pipeline_dispatch_lost"]
    assert len(lost) == 1 and lost[0]["status"] == "interrupted"


def test_queue_duration_is_exposed_separately(monkeypatch, hosted):
    document_id, chunk_id = _document_with_chunk(monkeypatch)
    started = now_utc() - timedelta(seconds=12)
    experiment = _queued_experiment(
        document_id, chunk_id, dispatch_id="fc-1", status="completed", identity_claimed=None,
        lease_token=None, lease_expires_at=None, started_at=started, worker_started_at=started + timedelta(seconds=10),
        completed_at=started + timedelta(seconds=12), duration_ms=12000,
    )
    monkeypatch.setattr(maintenance, "call_terminal_failure", lambda _id: False)
    status = client.get(f"/experiments/{experiment['id']}/status").json()
    assert status["timing"]["queueDurationMs"] == 10000
    assert client.get(f"/experiments/{experiment['id']}").json()["queueDurationMs"] == 10000
    summary = client.get(f"/documents/{document_id}/summary").json()
    listed = next(row for row in summary["experiments"] if row["id"] == experiment["id"])
    assert listed["timing"]["queueDurationMs"] == 10000


def test_lease_clock_inside_repository_sessions_is_the_database_clock(monkeypatch):
    import contextlib

    import app.repository as repository_module

    database_now = datetime(2000, 1, 1, tzinfo=timezone.utc)

    class Session:
        def execute(self, *_args, **_kwargs):
            return type("Result", (), {"scalar": lambda _self: database_now})()

    @contextlib.contextmanager
    def scope():
        yield Session()

    monkeypatch.setattr(repository_module, "session_scope", scope)
    with repository_module._clocked_session():
        assert repository_module.now_utc() == database_now
    assert repository_module.now_utc() != database_now


# --- process-local guard ----------------------------------------------------------------


def test_one_users_inflight_run_never_blocks_another_user():
    alice = CurrentUser(id=uuid.UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), role="authenticated")
    bob = CurrentUser(id=uuid.UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), role="authenticated")
    slot = main._acquire_user_slot(alice)
    try:
        assert main._guarded(bob, lambda: "ok") == "ok"
        with pytest.raises(ApiProblem) as busy:
            main._guarded(alice, lambda: "never")
        assert busy.value.code == "pipeline_busy"
    finally:
        slot.release()


# --- storage cleanup outbox -------------------------------------------------------------


def _deleted_document_cleanup(repository, owner: uuid.UUID, name: str) -> dict:
    document = repository.scoped(owner).create_document(
        {"file_name": name, "media_type": "application/pdf", "size_bytes": 1, "page_count": 0},
        "legacy-bucket", f"{uuid.uuid4()}/{name}", uuid.uuid4().hex,
    )
    return repository.scoped(owner).delete_document_with_cleanup(document["id"])


def test_cleanup_backoff_reaches_dead_state_and_frees_the_queue(monkeypatch):
    monkeypatch.setattr(
        "app.repository.get_settings",
        lambda: main.get_settings().__class__(storage_cleanup_max_attempts=3, storage_cleanup_backoff_base_seconds=10),
    )
    repository = get_repository()
    owner = uuid.UUID("11111111-1111-4111-8111-111111111111")
    cleanup = _deleted_document_cleanup(repository, owner, "a.pdf")
    delays = []
    for _ in range(3):
        before = now_utc()
        failed = repository.fail_storage_cleanup(cleanup["id"], "storage_delete_failed")
        delays.append(round((failed["next_attempt_at"] - before).total_seconds()))
        repository.storage_cleanups[cleanup["id"]]["next_attempt_at"] = now_utc()
    assert delays[:2] == [10, 20]
    assert failed["status"] == "dead"
    assert repository.list_pending_storage_cleanups(limit=10) == []


def test_delete_tries_its_own_cleanup_first_and_uses_recorded_bucket(monkeypatch):
    repository = get_repository()
    owner = uuid.UUID("11111111-1111-4111-8111-111111111111")
    # Three older permanently failing rows must not block the new deletion.
    for index in range(3):
        _deleted_document_cleanup(repository, owner, f"old-{index}.pdf")
    removed = []

    def remove(path, bucket=None):
        if path.endswith("old-0.pdf") or path.endswith("old-1.pdf") or path.endswith("old-2.pdf"):
            raise ApiProblem(503, "storage_delete_failed", "down")
        removed.append((path, bucket))

    monkeypatch.setattr(get_storage(), "remove", remove)
    uploaded = client.post("/documents", files={"file": ("new.pdf", b"%PDF-1.7 new", "application/pdf")})
    assert client.delete(f"/documents/{uploaded.json()['document']['id']}").status_code == 204
    assert len(removed) == 1 and removed[0][1] == "rag-documents"


def test_sweeper_drains_every_owner_and_purges_old_completed(monkeypatch):
    repository = get_repository()
    first = _deleted_document_cleanup(repository, uuid.UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), "a.pdf")
    second = _deleted_document_cleanup(repository, uuid.UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), "b.pdf")
    buckets = []
    monkeypatch.setattr(get_storage(), "remove", lambda path, bucket=None: buckets.append(bucket))

    counts = maintenance.sweep_storage_cleanups(repository)
    assert counts["completed"] == 2 and buckets == ["legacy-bucket", "legacy-bucket"]
    repository.storage_cleanups[first["id"]]["completed_at"] = now_utc() - timedelta(days=31)
    assert maintenance.sweep_storage_cleanups(repository)["purged"] == 1
    assert second["id"] in repository.storage_cleanups


def test_post_commit_cleanup_failure_never_fails_the_mutation(monkeypatch):
    def broken(*_args, **_kwargs):
        raise RuntimeError("database hiccup")

    monkeypatch.setattr(get_repository(), "list_pending_storage_cleanups", broken)
    response = client.post("/documents", files={"file": ("ok.pdf", b"%PDF-1.7 ok", "application/pdf")})
    assert response.status_code == 201


def main_user():
    from tests.conftest import TEST_USER_ID

    return TEST_USER_ID


# --- Codex review regressions (#130) ------------------------------------------------------


def test_started_worker_with_unrecorded_call_id_is_neither_interrupted_nor_redispatched(monkeypatch, hosted):
    """Spawn succeeded, the API died before recording the call id, the worker is running."""

    document_id, chunk_id = _document_with_chunk(monkeypatch)
    old_ms = int((datetime.now(timezone.utc) - timedelta(minutes=5)).timestamp() * 1000)
    reservation = f"dispatching-{old_ms}-{uuid.uuid4()}"
    experiment = _queued_experiment(
        document_id, chunk_id, dispatch_id=reservation, status="running", worker_started_at=now_utc(),
    )
    token = experiment["lease_token"]
    repository = get_repository()

    reconciled = maintenance.reconcile_active_run(repository, "experiment", repository.get_experiment_row(experiment["id"]), check_modal=True)
    assert reconciled["status"] == "running"
    main._durable_pipeline_response("experiment", experiment, repository.scoped(main_user()))
    assert hosted == []
    stored = repository.get_experiment_row(experiment["id"])
    assert stored["status"] == "running" and stored["lease_token"] == token and stored["dispatch_id"] == reservation
    # The running worker keeps its fencing token.
    assert repository.renew_pipeline_lease("experiment", experiment["id"], token, 60) is not None


def test_dispatched_run_waits_in_the_worker_queue_beyond_its_execution_lease(monkeypatch, hosted):
    """Codex #130-3: several jobs ahead in the single worker must not expire a queued run."""

    from app.config import embedding_batch_lease_seconds, get_settings

    settings = get_settings()
    document_id, chunk_id = _document_with_chunk(monkeypatch)
    run = client.post(f"/documents/{document_id}/embeddings?async=true", json={"chunkRunId": chunk_id}).json()
    stored = get_repository().embedding_runs[run["id"]]
    # Two hours queued behind other users' evaluations: far beyond any lease.
    stored["started_at"] -= timedelta(hours=2)
    stored["lease_expires_at"] = now_utc() - timedelta(hours=1)
    assert client.get(f"/embedding-runs/{run['id']}").json()["status"] == "running"
    _kind, run_id, token = hosted[0]
    started = get_repository().start_pipeline_worker("embedding", run_id, token, embedding_batch_lease_seconds(settings))
    assert started is not None
    # From now on the short execution lease applies.
    assert (started["lease_expires_at"] - now_utc()).total_seconds() <= embedding_batch_lease_seconds(settings) + 1


def test_queue_wait_is_bounded_by_the_queue_timeout(monkeypatch, hosted):
    from app.config import get_settings

    document_id, chunk_id = _document_with_chunk(monkeypatch)
    run = client.post(f"/documents/{document_id}/embeddings?async=true", json={"chunkRunId": chunk_id}).json()
    stored = get_repository().embedding_runs[run["id"]]
    stored["started_at"] -= timedelta(seconds=get_settings().pipeline_queue_timeout_seconds + 1)
    polled = client.get(f"/embedding-runs/{run['id']}").json()
    assert polled["status"] == "failed" and polled["errorCode"] == "worker_queue_timeout"


def test_sweeper_reconciles_runs_that_were_never_dispatched(monkeypatch, hosted):
    """Codex #130-5: claim committed, API died before the dispatch reservation."""

    document_id, chunk_id = _document_with_chunk(monkeypatch)
    repository = get_repository()
    claim, claimed = repository.scoped(main_user()).claim_embedding_run(
        document_id, chunk_id, "gemini-embedding-2", 768, "format-v1"
    )
    assert claimed and claim["dispatch_id"] is None
    repository.embedding_runs[claim["id"]]["lease_expires_at"] = now_utc() - timedelta(seconds=1)

    counts = maintenance.sweep_pipeline_runs(repository)

    assert counts == {"checked": 1, "interrupted": 1}
    assert repository.embedding_runs[claim["id"]]["status"] == "interrupted"
    assert repository.embedding_runs[claim["id"]]["error_code"] == "worker_lease_expired"


def test_batch_lease_covers_the_full_provider_retry_envelope():
    from app.config import Settings, embedding_batch_lease_seconds, pipeline_lease_duration_seconds
    from app.gemini import EMBEDDING_MAX_RETRY_DELAY_SECONDS

    for max_retries in (0, 2):
        settings = Settings(gemini_timeout_seconds=60, gemini_max_retries=max_retries, pipeline_lease_grace_seconds=120)
        attempts = settings.gemini_max_retries + 1
        # An embedding call may wait out a provider quota window between attempts.
        worst_case = attempts * settings.gemini_timeout_seconds + (attempts - 1) * EMBEDDING_MAX_RETRY_DELAY_SECONDS
        assert embedding_batch_lease_seconds(settings) >= worst_case + settings.pipeline_lease_grace_seconds
        # An experiment's query embedding runs under the experiment lease.
        assert pipeline_lease_duration_seconds(settings) >= worst_case + settings.pipeline_lease_grace_seconds


def test_queued_claims_take_their_lease_expiry_from_the_repository_clock(monkeypatch):
    """Codex #130-4: queue_experiment/queue_evaluation must not fix expiry with the container clock."""

    from app import pipeline
    from app.config import get_settings, pipeline_lease_duration_seconds
    from app.schemas import EvaluationRunRequest, ExperimentCreateRequest

    document_id, chunk_id = _document_with_chunk(monkeypatch)
    dataset = client.post(
        "/evaluation/datasets", json={"documentId": document_id, "name": "d", "cases": [{"question": "retrieval"}]},
    ).json()
    skewed = now_utc() + timedelta(days=1)
    monkeypatch.setattr(pipeline, "now_utc", lambda: skewed)  # API container clock far ahead
    repository = get_repository().scoped(main_user())
    duration = pipeline_lease_duration_seconds(get_settings())

    experiment = pipeline.queue_experiment(
        ExperimentCreateRequest(document_id=document_id, chunk_run_id=chunk_id, query="retrieval",
                                target_stage="retrieval", retrieval={"mode": "keyword", "topK": 1}),
        repository=repository,
    )
    experiment_expiry = get_repository().experiments[experiment["id"]]["lease_expires_at"]
    assert abs((experiment_expiry - (now_utc() + timedelta(seconds=duration))).total_seconds()) < 5
    get_repository().experiments[experiment["id"]]["status"] = "completed"  # free the user's admission slot

    evaluation = pipeline.queue_evaluation(
        EvaluationRunRequest(dataset_id=dataset["id"], retrieval={"mode": "keyword", "topK": 1}), repository=repository,
    )
    evaluation_expiry = get_repository().evaluations[evaluation["id"]]["lease_expires_at"]
    assert abs((evaluation_expiry - (now_utc() + timedelta(seconds=duration))).total_seconds()) < 5
