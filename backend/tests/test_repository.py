from datetime import timedelta
from types import SimpleNamespace
import uuid

import pytest

from app.chunking import CHUNKER_VERSION, TOKENIZER_VERSION, config_hash, effective_config
from app.errors import ApiProblem
from app.repository import InMemoryRepository, now_utc


def _chunk_draft():
    return SimpleNamespace(
        ordinal=0,
        text="Grounded source text",
        page_numbers=[1],
        source_element_ids=["element-1"],
        heading_path=[],
        token_count=3,
        character_count=20,
    )


def _claim_chunk(repository: InMemoryRepository, document_id: str, parse_run_id: str, config: dict):
    return repository.claim_chunk_run(
        document_id,
        parse_run_id,
        "fixed_token",
        config,
        config_hash(config),
        TOKENIZER_VERSION,
        CHUNKER_VERSION,
    )


def test_inmemory_artifact_terminal_timing_is_server_observed():
    repository = InMemoryRepository()
    document = repository.create_document(
        {"file_name": "lesson.pdf", "media_type": "application/pdf", "size_bytes": 1},
        "rag-documents",
        "lesson.pdf",
        "timing-sha",
    )
    parse = repository.create_parse_run(document["id"], parser_version="test")
    config = effective_config({"chunk_size_tokens": 64, "overlap_tokens": 8})

    chunk_claim, claimed = _claim_chunk(repository, document["id"], parse["id"], config)
    assert claimed is True
    repository.chunk_runs[chunk_claim["id"]]["started_at"] = now_utc() - timedelta(seconds=1)
    chunk = repository.complete_chunk_run(chunk_claim["id"], [_chunk_draft()], chunk_claim["lease_token"])
    assert chunk["duration_ms"] >= 1000

    embedding_claim, claimed = repository.claim_embedding_run(document["id"], chunk["id"], "gemini-embedding-2", 768, "format-v1")
    assert claimed is True
    repository.embedding_runs[embedding_claim["id"]]["started_at"] = now_utc() - timedelta(seconds=1)
    embedding = repository.complete_embedding_run(embedding_claim["id"], [], effective_model="gemini-embedding-2", lease_token=embedding_claim["lease_token"])
    assert embedding["duration_ms"] >= 1000

    failed_chunk_claim, claimed = _claim_chunk(repository, document["id"], parse["id"], {**config, "chunk_size_tokens": 65})
    assert claimed is True
    repository.chunk_runs[failed_chunk_claim["id"]]["started_at"] = now_utc() - timedelta(seconds=1)
    failed_chunk = repository.fail_chunk_run(failed_chunk_claim["id"], "chunk_failed", "test", failed_chunk_claim["lease_token"])
    assert failed_chunk["duration_ms"] >= 1000

    failed_embedding_claim, claimed = repository.claim_embedding_run(document["id"], failed_chunk_claim["id"], "gemini-embedding-2", 768, "format-v1")
    assert claimed is True
    repository.embedding_runs[failed_embedding_claim["id"]]["started_at"] = now_utc() - timedelta(seconds=1)
    failed_embedding = repository.fail_embedding_run(failed_embedding_claim["id"], "embedding_failed", "test", failed_embedding_claim["lease_token"])
    assert failed_embedding["duration_ms"] >= 1000


def test_pipeline_run_numbers_are_monotonic_after_history_deletion():
    repository = InMemoryRepository()
    document = repository.create_document(
        {"file_name": "numbers.pdf", "media_type": "application/pdf", "size_bytes": 1},
        "rag-documents", "numbers.pdf", "numbers-sha",
    )
    first = repository.create_parse_run(document["id"], parser_version="test")
    repository.fail_parse(first["id"], "test", "test")
    second = repository.create_parse_run(document["id"], parser_version="test")
    repository.fail_parse(second["id"], "test", "test")
    del repository.parses[second["id"]]
    third = repository.create_parse_run(document["id"], parser_version="test")

    assert [first["run_number"], second["run_number"], third["run_number"]] == [1, 2, 3]
def test_scoped_heavy_run_admission_is_durable_per_user_and_owner_isolated():
    repository = InMemoryRepository()
    first_owner = uuid.UUID("11111111-1111-4111-8111-111111111111")
    second_owner = uuid.UUID("22222222-2222-4222-8222-222222222222")
    first = repository.scoped(first_owner)
    second = repository.scoped(second_owner)
    first_document = first.create_document(
        {"file_name": "first.pdf", "media_type": "application/pdf", "size_bytes": 8, "page_count": 0},
        "rag-documents",
        "first/source.pdf",
        "a" * 64,
    )
    second_document = second.create_document(
        {"file_name": "second.pdf", "media_type": "application/pdf", "size_bytes": 8, "page_count": 0},
        "rag-documents",
        "second/source.pdf",
        "b" * 64,
    )

    active = first.create_parse_run(first_document["id"])
    assert active["status"] == "queued"
    with pytest.raises(ApiProblem) as blocked:
        first.claim_experiment(
            {
                "document_id": first_document["id"],
                "chunk_run_id": "chunk-1",
                "query": "question",
                "target_stage": "generation",
                "experiment_fingerprint": "fingerprint-1",
                "status": "queued",
                "lease_token": str(uuid.uuid4()),
                "lease_expires_at": now_utc() + timedelta(minutes=5),
            }
        )
    assert blocked.value.status_code == 429
    assert blocked.value.code == "user_run_limit_reached"

    isolated = second.create_parse_run(second_document["id"])
    assert isolated["status"] == "queued"


@pytest.mark.parametrize("kind", ["parse", "embedding", "experiment", "evaluation"])
@pytest.mark.parametrize("expired", [False, True])
def test_admission_reconciles_abandoned_runs_but_preserves_live_work(kind, expired):
    repository = InMemoryRepository()
    owner = uuid.uuid4()
    document = repository.scoped(owner).create_document(
        {"file_name": "timeout.pdf", "media_type": "application/pdf", "size_bytes": 1},
        "documents", "timeout.pdf", "timeout-sha",
    )
    current = now_utc()
    row = {
        "id": "old-run", "document_id": document["id"], "dataset_id": "dataset",
        "status": "queued" if kind == "parse" else "running",
        "started_at": None, "created_at": current - timedelta(days=29) if expired else current,
        "lease_expires_at": None, "identity_claimed": True,
    }
    repository.datasets["dataset"] = {"id": "dataset", "document_id": document["id"]}
    store = {"parse": repository.parses, "embedding": repository.embedding_runs,
             "experiment": repository.experiments, "evaluation": repository.evaluations}[kind]
    store[row["id"]] = row
    foreign = {**row, "id": "foreign", "document_id": "other-document", "dataset_id": "other-dataset"}
    store[foreign["id"]] = foreign
    if expired:
        repository._assert_user_heavy_run_available(owner)
        assert row["status"] == "interrupted"
        assert row["completed_at"] >= current
        assert row["duration_ms"] is None
        if kind != "parse":
            assert row["identity_claimed"] is None
        # Legacy workers without tokens must not resurrect abandoned runs.
        if kind == "experiment":
            assert repository.complete_experiment(row["id"]) is None
            assert repository.update_experiment_stage(row["id"], "generation", {}) is None
        if kind == "evaluation":
            assert repository.update_evaluation(row["id"], {"status": "completed"}) is None
    else:
        with pytest.raises(ApiProblem, match="Another expensive operation"):
            repository._assert_user_heavy_run_available(owner)
        assert row["status"] in {"queued", "running"}
    assert foreign["status"] in {"queued", "running"}


def test_explicit_lease_takes_precedence_over_old_creation_time():
    from app.repository import _expired_run_update

    current = now_utc()
    row = {"status": "running", "created_at": current - timedelta(days=29),
           "lease_expires_at": current + timedelta(seconds=1)}
    assert _expired_run_update(row, now=current) == {}
    assert _expired_run_update(row, now=row["lease_expires_at"])["status"] == "interrupted"


def test_expired_parse_can_be_restarted_on_the_same_document():
    repository = InMemoryRepository()
    scoped = repository.scoped(uuid.uuid4())
    document = scoped.create_document(
        {"file_name": "parse.pdf", "media_type": "application/pdf", "size_bytes": 1},
        "documents", "parse.pdf", "parse-sha",
    )
    first = scoped.create_parse_run(document["id"])
    repository.parses[first["id"]]["created_at"] = now_utc() - timedelta(days=29)
    assert scoped.find_inflight_parse(document["id"]) is None
    second = scoped.create_parse_run(document["id"])
    assert second["id"] != first["id"]
    assert repository.parses[first["id"]]["status"] == "interrupted"
    assert second["status"] == "queued"


@pytest.mark.parametrize("live", [False, True])
def test_sql_admission_uses_shared_expiry_rule_and_owner_scoped_row_locks(live):
    from sqlalchemy.dialects import postgresql
    from app.models import ParseRun, EmbeddingRun, ExperimentRun, EvaluationRun
    from app.repository import SqlAlchemyRepository

    owner = uuid.uuid4()
    current = now_utc()
    models = (ParseRun, EmbeddingRun, ExperimentRun, EvaluationRun)
    rows = {model: SimpleNamespace(status="running", started_at=None,
            created_at=current - timedelta(days=29), lease_expires_at=None) for model in models}
    if live:
        rows[ExperimentRun].lease_expires_at = current + timedelta(minutes=5)

    class Session:
        def execute(self, statement, params):
            assert "pg_advisory_xact_lock" in str(statement)
            assert params["owner_user_id"] == str(owner)

        def scalars(self, statement):
            model = statement.column_descriptions[0]["entity"]
            compiled = statement.compile(dialect=postgresql.dialect())
            sql = str(compiled)
            assert "documents.owner_user_id =" in sql
            assert owner in compiled.params.values()
            assert f"FOR UPDATE OF {model.__tablename__}" in sql
            if model is EvaluationRun:
                assert "evaluation_datasets.document_id" in sql
            return [rows[model]]

        def flush(self):
            pass

    if live:
        with pytest.raises(ApiProblem) as blocked:
            SqlAlchemyRepository._assert_user_heavy_run_available(Session(), owner)
        assert blocked.value.code == "user_run_limit_reached"
        assert rows[ExperimentRun].status == "running"
    else:
        SqlAlchemyRepository._assert_user_heavy_run_available(Session(), owner)
        assert all(row.status == "interrupted" for row in rows.values())
        assert all(row.duration_ms is None for row in rows.values())


def test_expired_retry_cannot_bypass_another_live_run():
    repository = InMemoryRepository()
    owner = uuid.uuid4()
    scoped = repository.scoped(owner)
    document = scoped.create_document(
        {"file_name": "retry.pdf", "media_type": "application/pdf", "size_bytes": 1},
        "documents", "retry.pdf", "retry-sha",
    )
    request = {"document_id": document["id"], "chunk_run_id": "chunk", "query": "question",
               "target_stage": "generation", "experiment_fingerprint": "retry",
               "status": "queued", "lease_token": str(uuid.uuid4()),
               "lease_expires_at": now_utc() + timedelta(minutes=5)}
    old, _ = scoped.claim_experiment(request)
    repository.experiments[old["id"]]["lease_expires_at"] = now_utc() - timedelta(seconds=1)
    # Simulate another live job already present when the old identity is retried.
    live = {**repository.experiments[old["id"]], "id": "live", "experiment_fingerprint": "live",
            "lease_expires_at": now_utc() + timedelta(minutes=5)}
    repository.experiments["live"] = live
    with pytest.raises(ApiProblem) as blocked:
        scoped.claim_experiment(request)
    assert blocked.value.code == "user_run_limit_reached"
    assert live["status"] == "queued"
    repository.fail_experiment("live", "test", "finished")
    retried, claimed = scoped.claim_experiment(request)
    assert claimed and retried["status"] == "queued"
    assert retried["identity_claimed"] is True


def test_parse_polling_expires_abandoned_queue_without_modal(monkeypatch):
    from app.main import _reconcile_terminal_worker_failure
    from app.config import PARSE_RUN_TIMEOUT_SECONDS

    repository = InMemoryRepository()
    document = repository.create_document(
        {"file_name": "poll.pdf", "media_type": "application/pdf", "size_bytes": 1},
        "documents", "poll.pdf", "poll-sha",
    )
    run = repository.create_parse_run(document["id"])
    repository.parses[run["id"]]["created_at"] = now_utc() - timedelta(seconds=PARSE_RUN_TIMEOUT_SECONDS + 1)
    monkeypatch.setattr("app.main.get_repository", lambda: repository)
    result = _reconcile_terminal_worker_failure(repository.get_parse_row(run["id"]))
    assert result["status"] == "interrupted"
    assert result["error_code"] == "parse_timeout"
    assert result["duration_ms"] is None


def test_parse_timeout_rechecks_state_after_worker_starts():
    repository = InMemoryRepository()
    document = repository.create_document(
        {"file_name": "race.pdf", "media_type": "application/pdf", "size_bytes": 1},
        "documents", "race.pdf", "race-sha",
    )
    run = repository.create_parse_run(document["id"])
    repository.parses[run["id"]]["created_at"] = now_utc() - timedelta(days=29)
    repository.mark_parse_running(run["id"])
    result = repository.fail_parse(run["id"], "parse_timeout", "expired snapshot", status="interrupted")
    assert result["status"] == "running"
    assert result["error_code"] is None
