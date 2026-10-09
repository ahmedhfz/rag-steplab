"""Runtime-role limits, least privilege and lightweight queries on PostgreSQL."""

from __future__ import annotations

from datetime import datetime, timezone
import uuid

import pytest
from sqlalchemy import text

from app.db import session_scope
from app.errors import ApiProblem
from tests.postgres_support import (  # noqa: F401 - pytest fixtures
    OWNER_A,
    OWNER_B,
    admin_engine,
    admin_execute,
    app_database_url,
    completed_chunk,
    completed_embedding,
    completed_parse,
    new_document,
    pg,
    requires_postgres,
)

pytestmark = requires_postgres


def test_runtime_role_sessions_are_time_bounded(pg):
    with session_scope() as session:
        assert session.execute(text("show statement_timeout")).scalar() == "30s"
        assert session.execute(text("show lock_timeout")).scalar() == "5s"
        assert session.execute(text("show idle_in_transaction_session_timeout")).scalar() == "1min"


def test_dense_retrieval_works_after_extension_execute_revoke(pg):
    document = new_document(pg)
    parse = completed_parse(pg, document["id"])
    chunk = completed_chunk(pg, document["id"], parse["id"])
    embedding = completed_embedding(pg, document["id"], chunk["id"])
    query_vector = [1.0] + [0.0] * 767

    dense, keyword = pg.scoped(OWNER_A).retrieve_candidates(chunk["id"], embedding["id"], "retrieval", query_vector, "hybrid", 5)

    assert dense and dense[0]["denseScore"] == pytest.approx(1.0)
    assert keyword
    with session_scope() as session:
        assert session.execute(
            text("select has_function_privilege(current_user, 'extensions.pg_stat_statements_reset(oid,oid,bigint,boolean)', 'EXECUTE')")
        ).scalar() is False


def test_find_stage_result_matches_in_sql_and_ownership_probes_are_cheap(pg):
    document = new_document(pg)
    parse = completed_parse(pg, document["id"])
    chunk = completed_chunk(pg, document["id"], parse["id"])
    for index, fingerprint in enumerate(("fp-old", "fp-target", "fp-other")):
        pg.save_experiment({
            "id": f"experiment-{index}", "document_id": document["id"], "chunk_run_id": chunk["id"], "query": "q",
            "target_stage": "retrieval", "experiment_fingerprint": f"x-{index}", "config": {},
            "stage_results": {"retrieval": {"fingerprint": fingerprint, "status": "completed", "n": index}},
            "status": "completed", "started_at": datetime.now(timezone.utc),
        })
    found = pg.find_stage_result(document["id"], "retrieval", "fp-target")
    assert found == ({"fingerprint": "fp-target", "status": "completed", "n": 1}, "experiment-1")
    assert pg.find_stage_result(document["id"], "retrieval", "missing") is None
    assert pg.find_stage_result(document["id"], "generation", "fp-target") is None

    assert pg.owns_run("chunk", chunk["id"], OWNER_A) is True
    assert pg.owns_run("chunk", chunk["id"], OWNER_B) is False
    assert pg.owns_run("experiment", "experiment-1", OWNER_A) is True
    assert pg.owner_document_usage(OWNER_A) == (1, 8)
    assert pg.owner_document_usage(OWNER_B) == (0, 0)


def test_parse_integrity_errors_are_not_masked_as_in_progress(pg, admin_engine):
    document = new_document(pg)
    pg.create_parse_run(document["id"], parser_version="test")
    with pytest.raises(ApiProblem) as in_progress:
        pg.create_parse_run(document["id"], parser_version="test")
    assert in_progress.value.code == "parse_already_in_progress"

    # A run-number collision is a real data error, never "already in progress".
    admin_execute(admin_engine, "update rag_lab.parse_runs set status = 'failed' where document_id = :d", d=document["id"])
    admin_execute(admin_engine, "update rag_lab.documents set parse_run_counter = 0 where id = :d", d=document["id"])
    with pytest.raises(Exception) as error:
        pg.create_parse_run(document["id"], parser_version="test")
    assert not isinstance(error.value, ApiProblem)


def test_dataset_case_count_comes_from_sql(pg):
    from app.schemas import EvaluationDatasetRequest

    document = new_document(pg)
    parse = completed_parse(pg, document["id"])
    request = EvaluationDatasetRequest(document_id=document["id"], name="d", cases=[{"question": "a"}, {"question": "b"}])
    dataset = pg.save_dataset(request, parse["id"])
    second = pg.save_dataset(request.model_copy(update={"base_dataset_id": dataset["id"]}), parse["id"])
    assert second["version"] == 2 and second["series_id"] == dataset["series_id"]
    assert pg.get_dataset_case_count(dataset["id"]) == 2
    assert pg.scoped(OWNER_B).get_dataset_case_count(dataset["id"]) == 0
    assert uuid.UUID(dataset["id"])
