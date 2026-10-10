"""SqlAlchemyRepository against the real migrated schema (run with -m postgres)."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.db import session_scope
from app.errors import ApiProblem
from tests.postgres_support import (  # noqa: F401 - pytest fixtures
    OWNER_A,
    OWNER_B,
    admin_engine,
    admin_execute,
    admin_scalar,
    app_database_url,
    claim_chunk,
    completed_chunk,
    completed_embedding,
    completed_parse,
    new_document,
    pg,
    requires_postgres,
)

pytestmark = requires_postgres


def test_runtime_role_builds_full_lineage_and_summary_projection(pg, admin_engine):
    document = new_document(pg)
    parse = completed_parse(pg, document["id"])
    chunk = completed_chunk(pg, document["id"], parse["id"])
    embedding = completed_embedding(pg, document["id"], chunk["id"])

    with session_scope() as session:
        assert session.execute(text("select current_user")).scalar() == "rag_steplab_app"
    stored = pg.get_document_row(document["id"])
    assert (stored["active_parse_run_id"], stored["active_chunk_run_id"], stored["active_embedding_run_id"]) == (
        parse["id"], chunk["id"], embedding["id"],
    )
    bundle = pg.get_document_summary_bundle(document["id"], owner_user_id=OWNER_A)
    assert [row["name"] for row in bundle["pipelines"]] == ["Default Pipeline"]
    assert [row["id"] for row in bundle["chunks"]] == [chunk["id"]]
    assert bundle["chunks"][0]["parse_run_id"] == parse["id"]
    assert pg.get_document_summary_bundle(document["id"], owner_user_id=OWNER_B) is None


def test_owner_scope_hides_run_ids_of_other_users(pg):
    document = new_document(pg)
    parse = completed_parse(pg, document["id"])
    chunk = completed_chunk(pg, document["id"], parse["id"])
    other = pg.scoped(OWNER_B)

    assert other.get_document_row(document["id"]) is None
    assert other.get_parse_row(parse["id"]) is None
    assert other.get_chunk_row(chunk["id"]) is None
    assert other.list_document_pipeline_rows(document["id"]) is None
    assert other.delete_document_with_cleanup(document["id"]) is None
    assert pg.scoped(OWNER_A).get_chunk_row(chunk["id"])["id"] == chunk["id"]


def test_chunk_identity_claim_race_has_one_owner(pg):
    document = new_document(pg)
    parse = completed_parse(pg, document["id"])

    def claim(_):
        (row, owner), _config = claim_chunk(pg, document["id"], parse["id"])
        return row["id"], owner

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(claim, range(6)))
    assert sum(owner for _, owner in results) == 1
    assert len({identifier for identifier, _ in results}) == 1


def test_late_chunk_of_older_parse_keeps_newer_default_and_fk_rejects_mixed_pointers(pg, admin_engine):
    document = new_document(pg)
    old_parse = completed_parse(pg, document["id"])
    (claim, claimed), _config = claim_chunk(pg, document["id"], old_parse["id"])
    assert claimed
    new_parse = completed_parse(pg, document["id"])
    pg.complete_chunk_run(claim["id"], [], claim["lease_token"])

    stored = pg.get_document_row(document["id"])
    assert stored["active_parse_run_id"] == new_parse["id"]
    assert stored["active_chunk_run_id"] is None

    # The schema itself now refuses a default chunk of another parse.
    with pytest.raises(IntegrityError):
        admin_execute(
            admin_engine,
            "update rag_lab.documents set active_chunk_run_id = :chunk where id = :document",
            chunk=claim["id"], document=document["id"],
        )


def test_cross_document_child_artifacts_are_rejected(pg, admin_engine):
    first = new_document(pg, name="a.pdf")
    second = new_document(pg, name="b.pdf")
    parse = completed_parse(pg, first["id"])
    with pytest.raises(IntegrityError):
        admin_execute(
            admin_engine,
            """
            insert into rag_lab.chunk_runs (id, document_id, parse_run_id, strategy, config, status, chunk_count,
                                             config_hash, tokenizer_version, chunker_version)
            values (:id, :document, :parse, 'fixed_token', '{}'::jsonb, 'completed', 0, 'h', 't', 'c')
            """,
            id=str(uuid.uuid4()), document=second["id"], parse=parse["id"],
        )


def test_artifact_incomplete_detaches_saved_pipeline_through_lineage_trigger(pg):
    document = new_document(pg)
    parse = completed_parse(pg, document["id"])
    chunk = completed_chunk(pg, document["id"], parse["id"])
    embedding = completed_embedding(pg, document["id"], chunk["id"])
    scoped = pg.scoped(OWNER_A)
    pipeline = scoped.list_document_pipeline_rows(document["id"])[0]
    pipeline = scoped.update_document_pipeline(
        pipeline["id"], pipeline["revision"],
        {"parse_run_id": parse["id"], "chunk_run_id": chunk["id"], "embedding_run_id": embedding["id"]},
    )

    failed = pg.fail_chunk_run(chunk["id"], "artifact_incomplete", "broken", unfenced=True)

    assert failed["status"] == "failed"
    refreshed = scoped.get_document_pipeline_row(pipeline["id"])
    assert (refreshed["parse_run_id"], refreshed["chunk_run_id"], refreshed["embedding_run_id"]) == (parse["id"], None, None)
    assert refreshed["revision"] == pipeline["revision"] + 1
    stored = pg.get_document_row(document["id"])
    assert stored["active_chunk_run_id"] is None and stored["active_embedding_run_id"] is None


def test_unfenced_or_stale_artifact_writes_are_rejected(pg, admin_engine):
    document = new_document(pg)
    parse = completed_parse(pg, document["id"])
    (claim, claimed), _config = claim_chunk(pg, document["id"], parse["id"])
    assert claimed

    assert pg.complete_chunk_run(claim["id"], []) is None
    assert pg.complete_chunk_run(claim["id"], [], str(uuid.uuid4())) is None
    admin_execute(
        admin_engine,
        "update rag_lab.chunk_runs set lease_expires_at = now() - interval '1 second' where id = :id",
        id=claim["id"],
    )
    assert pg.complete_chunk_run(claim["id"], [], claim["lease_token"]) is None
    assert pg.get_chunk_row(claim["id"])["status"] == "running"


def test_document_delete_cascades_through_composite_lineage(pg, admin_engine):
    document = new_document(pg)
    parse = completed_parse(pg, document["id"])
    chunk = completed_chunk(pg, document["id"], parse["id"])
    completed_embedding(pg, document["id"], chunk["id"])
    pg.scoped(OWNER_A).create_document_pipeline(
        {"document_id": document["id"], "name": "Second", "parse_run_id": parse["id"], "chunk_run_id": chunk["id"]}
    )

    cleanup = pg.scoped(OWNER_A).delete_document_with_cleanup(document["id"])

    assert cleanup["status"] == "pending"
    for table in ("documents", "parse_runs", "chunk_runs", "chunks", "embedding_runs", "chunk_embeddings", "document_pipelines"):
        assert admin_scalar(admin_engine, f"select count(*) from rag_lab.{table}") == 0


def test_concurrent_pipeline_deletes_keep_one_pipeline(pg):
    document = new_document(pg)
    scoped = pg.scoped(OWNER_A)
    second = scoped.create_document_pipeline({"document_id": document["id"], "name": "Second"})
    first = scoped.list_document_pipeline_rows(document["id"])[0]

    def delete(pipeline_id):
        try:
            return scoped.delete_document_pipeline(pipeline_id)
        except ApiProblem as exc:
            return exc.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(delete, [first["id"], second["id"]]))
    assert sorted(map(str, results)) == ["True", "default_pipeline_required"]
    assert len(scoped.list_document_pipeline_rows(document["id"])) == 1


def test_experiment_lease_reclaim_fences_the_stale_worker(pg, admin_engine):
    document = new_document(pg)
    parse = completed_parse(pg, document["id"])
    chunk = completed_chunk(pg, document["id"], parse["id"])
    now = datetime.now(timezone.utc)
    row = {
        "id": str(uuid.uuid4()), "document_id": document["id"], "chunk_run_id": chunk["id"], "query": "q",
        "target_stage": "retrieval", "experiment_fingerprint": "fp-1", "config": {}, "status": "queued",
        "lease_token": str(uuid.uuid4()), "lease_expires_at": now + timedelta(minutes=5),
    }
    first, owner = pg.claim_experiment(row, admission_owner_user_id=OWNER_A)
    assert owner
    # A second request for the same user is rejected by the advisory-locked admission.
    with pytest.raises(ApiProblem) as rejected:
        pg.claim_experiment({**row, "id": str(uuid.uuid4()), "experiment_fingerprint": "fp-2"}, admission_owner_user_id=OWNER_A)
    assert rejected.value.code == "user_run_limit_reached"

    reserved = pg.claim_pipeline_dispatch("experiment", first["id"], "dispatching-a", first["lease_token"])
    again = pg.claim_pipeline_dispatch("experiment", first["id"], "dispatching-b", first["lease_token"])
    assert reserved["dispatch_id"] == again["dispatch_id"] == "dispatching-a"

    admin_execute(
        admin_engine,
        "update rag_lab.experiment_runs set lease_expires_at = now() - interval '1 second' where id = :id",
        id=first["id"],
    )
    new_token = str(uuid.uuid4())
    reclaimed, owner = pg.claim_experiment(
        {**row, "lease_token": new_token, "lease_expires_at": now + timedelta(minutes=5)},
        admission_owner_user_id=OWNER_A,
    )
    assert owner and reclaimed["id"] == first["id"] and reclaimed["dispatch_id"] is None
    assert pg.update_experiment_stage(first["id"], "retrieval", {"status": "completed"}, first["lease_token"]) is None
    assert pg.update_experiment_stage(first["id"], "retrieval", {"status": "completed"}, new_token) is not None


def test_pointer_lock_serializes_writers_but_not_child_inserts(pg, admin_engine):
    from sqlalchemy.exc import OperationalError

    from app.models import ChunkRun

    document = new_document(pg)
    parse = completed_parse(pg, document["id"])
    chunk = completed_chunk(pg, document["id"], parse["id"])
    with session_scope() as session:
        locked_document, run = pg._lock_run_document(session, ChunkRun, chunk["id"])
        assert locked_document is not None and run is not None
        # A child row (KEY SHARE on documents) is not blocked by a completion's
        # pointer lock, even for the length of a large artifact write ...
        with admin_engine.begin() as other:
            other.execute(text("set local lock_timeout = '1s'"))
            other.execute(
                text(
                    "insert into rag_lab.document_pipelines (id, owner_user_id, document_id, name) "
                    "values (:id, :owner, :document_id, 'Concurrent')"
                ),
                {"id": str(uuid.uuid4()), "owner": OWNER_A, "document_id": document["id"]},
            )
        # ... while a second pointer writer still serializes on the document.
        with pytest.raises(OperationalError):
            with admin_engine.begin() as other:
                other.execute(text("set local lock_timeout = '200ms'"))
                other.execute(
                    text("select id from rag_lab.documents where id = :id for no key update"),
                    {"id": document["id"]},
                )
