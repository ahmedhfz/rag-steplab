"""Durable dispatch, DB-clock leases and the cleanup outbox on real PostgreSQL."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import uuid

from app.config import chunk_lease_duration_seconds, embedding_claim_lease_seconds, get_settings
from app.maintenance import new_reservation_id
# The admin_engine/pg fixtures are registered in conftest.py.
from tests.postgres_support import (
    OWNER_A,
    OWNER_B,
    admin_execute,
    admin_scalar,
    claim_chunk,
    completed_chunk,
    completed_parse,
    new_document,
    requires_postgres,
)

pytestmark = requires_postgres


def test_leases_are_computed_from_the_database_clock(pg, admin_engine):
    document = new_document(pg)
    parse = completed_parse(pg, document["id"])
    (claim, claimed), _config = claim_chunk(pg, document["id"], parse["id"])
    assert claimed
    window = admin_scalar(
        admin_engine,
        "select extract(epoch from lease_expires_at - started_at) from rag_lab.chunk_runs where id = :id",
        id=claim["id"],
    )
    assert int(window) == chunk_lease_duration_seconds(get_settings())
    assert admin_scalar(
        admin_engine, "select abs(extract(epoch from started_at - now())) < 60 from rag_lab.chunk_runs where id = :id",
        id=claim["id"],
    )


def test_embedding_dispatch_reservation_rotation_and_worker_fencing(pg):
    document = new_document(pg)
    parse = completed_parse(pg, document["id"])
    chunk = completed_chunk(pg, document["id"], parse["id"])
    claim, claimed = pg.scoped(OWNER_A).claim_embedding_run(document["id"], chunk["id"], "gemini-embedding-2", 768, "format-v1")
    assert claimed and claim["attempt_count"] == 1
    assert int((claim["lease_expires_at"] - claim["started_at"]).total_seconds()) == embedding_claim_lease_seconds(get_settings())

    stale = f"dispatching-1-{uuid.uuid4()}"
    assert pg.claim_pipeline_dispatch("embedding", claim["id"], stale, claim["lease_token"])["dispatch_id"] == stale
    # Second reservation without the stale marker keeps the first.
    assert pg.claim_pipeline_dispatch("embedding", claim["id"], new_reservation_id(), claim["lease_token"])["dispatch_id"] == stale
    rotated = str(uuid.uuid4())
    fresh = new_reservation_id()
    replaced = pg.claim_pipeline_dispatch(
        "embedding", claim["id"], fresh, claim["lease_token"], stale_reservation=stale, new_lease_token=rotated
    )
    assert replaced["dispatch_id"] == fresh and replaced["lease_token"] == rotated and replaced["attempt_count"] == 2

    assert pg.start_pipeline_worker("embedding", claim["id"], claim["lease_token"], 60) is None
    started = pg.start_pipeline_worker("embedding", claim["id"], rotated, 60)
    assert started["worker_started_at"] is not None
    assert pg.renew_pipeline_lease("embedding", claim["id"], rotated, 60) is not None
    assert pg.set_pipeline_dispatch("embedding", claim["id"], "fc-1", rotated, fresh)["dispatch_id"] == "fc-1"


def test_interrupt_is_compare_and_set_on_dispatch_and_owner_scoped_listing(pg):
    document = new_document(pg)
    parse = completed_parse(pg, document["id"])
    chunk = completed_chunk(pg, document["id"], parse["id"])
    claim, _ = pg.claim_embedding_run(document["id"], chunk["id"], "gemini-embedding-2", 768, "format-v1")
    pg.claim_pipeline_dispatch("embedding", claim["id"], "fc-new", claim["lease_token"])

    assert [row["id"] for row in pg.scoped(OWNER_A).list_active_dispatches()] == [claim["id"]]
    assert pg.scoped(OWNER_B).list_active_dispatches() == []

    untouched = pg.interrupt_pipeline_run("embedding", claim["id"], "fc-old", "worker_terminated", "x")
    assert untouched["status"] == "running"
    interrupted = pg.interrupt_pipeline_run("embedding", claim["id"], "fc-new", "worker_terminated", "x")
    assert interrupted["status"] == "interrupted" and interrupted["lease_token"] is None
    # Capacity is released: the identity is free for a new attempt.
    retry, claimed = pg.claim_embedding_run(document["id"], chunk["id"], "gemini-embedding-2", 768, "format-v1")
    assert claimed and retry["id"] != claim["id"]


def _cleanup(pg, owner, name):
    document = new_document(pg, owner, name=name)
    return pg.scoped(owner).delete_document_with_cleanup(document["id"])


def test_cleanup_outbox_backoff_dead_state_and_owner_scope(pg, admin_engine):
    first = _cleanup(pg, OWNER_A, "a.pdf")
    assert pg.scoped(OWNER_B).fail_storage_cleanup(first["id"], "storage_delete_failed") is None

    failed = pg.scoped(OWNER_A).fail_storage_cleanup(first["id"], "storage_delete_failed")
    assert failed["attempt_count"] == 1 and failed["status"] == "pending"
    delay = admin_scalar(
        admin_engine,
        "select round(extract(epoch from next_attempt_at - now())) from rag_lab.storage_cleanups where id = :id",
        id=first["id"],
    )
    assert int(delay) == get_settings().storage_cleanup_backoff_base_seconds
    assert pg.list_pending_storage_cleanups(limit=10) == []  # not due yet

    admin_execute(admin_engine, "update rag_lab.storage_cleanups set attempt_count = :n, next_attempt_at = now() where id = :id",
                  n=get_settings().storage_cleanup_max_attempts - 1, id=first["id"])
    dead = pg.fail_storage_cleanup(first["id"], "storage_delete_failed")
    assert dead["status"] == "dead"


def test_concurrent_sweepers_never_claim_the_same_cleanup(pg):
    for index in range(6):
        _cleanup(pg, OWNER_A if index % 2 else OWNER_B, f"{index}.pdf")

    with ThreadPoolExecutor(max_workers=3) as pool:
        batches = list(pool.map(lambda _: pg.claim_due_storage_cleanups(limit=6), range(3)))
    claimed = [row["id"] for batch in batches for row in batch]
    assert len(claimed) == 6 and len(set(claimed)) == 6

    for row_id in claimed:
        pg.complete_storage_cleanup(row_id)
    assert pg.purge_completed_storage_cleanups(older_than=timedelta(days=30)) == 0
    assert pg.purge_completed_storage_cleanups(older_than=timedelta(seconds=-1)) == 6
