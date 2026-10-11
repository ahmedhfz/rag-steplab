"""Canonical lineage (saved pipeline) and public API contract regressions."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app import main
from app.lineage import is_historical, resolve_from_rows, select_pipeline
from app.main import app
from app.pipeline import run_queued_experiment
from app.repository import InMemoryRepository, get_repository, reset_repository
from app.storage import reset_storage
from tests.conftest import TEST_USER_ID
from tests.test_pipeline import _queue_and_run


client = TestClient(app)


class FakeMetadata:
    configured_model = "gemini-embedding-2"
    effective_model = "gemini-embedding-2-001"


class FakeGemini:
    def __init__(self, *_args, **_kwargs):
        pass

    def embed_documents(self, texts):
        return [[1.0] + [0.0] * 767 for _ in texts], FakeMetadata()

    def embed_query(self, _query):
        return [1.0] + [0.0] * 767, FakeMetadata()


def setup_function():
    reset_repository()
    reset_storage()


def _chunk(document_id: str, parse_run_id: str, strategy: str) -> dict:
    response = client.post(
        f"/documents/{document_id}/chunks",
        json={"parseRunId": parse_run_id, "strategy": strategy, "config": {"chunkSizeTokens": 64, "overlapTokens": 8}},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _default_pipeline(document_id: str) -> dict:
    return next(row for row in client.get(f"/documents/{document_id}/pipelines").json() if row["isDefault"])


def _use(pipeline: dict, **pointers) -> dict:
    response = client.patch(
        f"/document-pipelines/{pipeline['id']}",
        json={"expectedRevision": pipeline["revision"], **pointers},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _by_id(rows: list[dict], identifier: str) -> dict:
    return next(row for row in rows if row["id"] == identifier)


# --- pure resolver -----------------------------------------------------------------


def test_resolver_prefers_pipeline_and_accepts_defaults_only_along_the_resolved_parent():
    document = {"id": "d", "active_parse_run_id": "p2", "active_chunk_run_id": "c2", "active_embedding_run_id": "e2"}
    parses = [{"id": "p1", "document_id": "d", "status": "completed"}, {"id": "p2", "document_id": "d", "status": "completed"}]
    chunks = [
        {"id": "c1", "document_id": "d", "parse_run_id": "p1", "status": "completed"},
        {"id": "c2", "document_id": "d", "parse_run_id": "p2", "status": "completed"},
    ]
    embeddings = [{"id": "e2", "document_id": "d", "chunk_run_id": "c2", "status": "completed"}]

    # The pipeline selects only the older parse: the default chunk of the newer
    # parse must not be mixed in.
    lineage = resolve_from_rows(
        document, {"id": "pl", "parse_run_id": "p1"}, parses=parses, chunks=chunks, embeddings=embeddings
    )
    assert (lineage["parse_run_id"], lineage["chunk_run_id"], lineage["embedding_run_id"]) == ("p1", None, None)

    # Without pipeline pointers the document defaults are the in-use lineage.
    lineage = resolve_from_rows(document, {"id": "pl"}, parses=parses, chunks=chunks, embeddings=embeddings)
    assert (lineage["parse_run_id"], lineage["chunk_run_id"], lineage["embedding_run_id"]) == ("p2", "c2", "e2")
    assert lineage["sources"] == {"parse": "document_default", "chunk": "document_default", "embedding": "document_default"}

    # A pipeline pointer to a non-completed artifact falls back, never forward-mixes.
    failed = [{**chunks[0], "status": "failed"}, chunks[1]]
    lineage = resolve_from_rows(
        document, {"id": "pl", "parse_run_id": "p1", "chunk_run_id": "c1"}, parses=parses, chunks=failed, embeddings=embeddings
    )
    assert lineage["chunk_run_id"] is None

    assert is_historical("chunk", chunks[1], {"chunk_run_id": "c1"}) is True
    assert is_historical("chunk", {**chunks[1], "status": "running"}, {"chunk_run_id": "c1"}) is False
    assert is_historical("experiment", {"status": "completed", "chunk_run_id": "c2", "embedding_run_id": None}, {"chunk_run_id": "c2"}) is False


def test_select_pipeline_requires_known_explicit_id():
    rows = [{"id": "a", "name": "Other"}, {"id": "b", "name": "Default Pipeline"}]
    assert select_pipeline(rows, None)["id"] == "b"
    assert select_pipeline(rows, "a")["id"] == "a"
    assert select_pipeline(rows, "missing") is None


# --- canonical in-use lineage over the API -----------------------------------------


def test_in_use_embedding_is_not_historical_when_document_default_moved(monkeypatch):
    """Live L2: the saved pipeline's embedding was reported both In use and Historical."""

    monkeypatch.setattr("app.pipeline.GeminiService", FakeGemini)
    parsed = _queue_and_run(monkeypatch)
    document_id, parse_id = parsed["documentId"], parsed["parseRunId"]
    first = _chunk(document_id, parse_id, "fixed_token")
    embedding = client.post(f"/documents/{document_id}/embeddings", json={"chunkRunId": first["id"]}).json()
    pipeline = _use(_default_pipeline(document_id), parseRunId=parse_id, chunkRunId=first["id"], embeddingRunId=embedding["id"])
    # A later rechunk moves only the document default.
    second = _chunk(document_id, parse_id, "structure_aware")

    summary = client.get(f"/documents/{document_id}/summary").json()
    assert summary["activeChunkRunId"] == second["id"]
    assert summary["activeLineage"] == {
        "pipelineId": pipeline["id"],
        "parseRunId": parse_id,
        "chunkRunId": first["id"],
        "embeddingRunId": embedding["id"],
        "sources": {"parse": "pipeline", "chunk": "pipeline", "embedding": "pipeline"},
    }
    assert _by_id(summary["embeddingRuns"], embedding["id"])["historicalLineage"] is False
    assert _by_id(summary["chunkRuns"], first["id"])["historicalLineage"] is False
    assert _by_id(summary["chunkRuns"], second["id"])["historicalLineage"] is True
    assert [row["id"] for row in summary["pipelines"]] == [pipeline["id"]]

    # Another saved pipeline is a different reference lineage.
    other = client.post(f"/documents/{document_id}/pipelines", json={"name": "Structure", "chunkRunId": second["id"], "parseRunId": parse_id}).json()
    other_summary = client.get(f"/documents/{document_id}/summary?pipelineId={other['id']}").json()
    assert _by_id(other_summary["chunkRuns"], second["id"])["historicalLineage"] is False
    assert _by_id(other_summary["chunkRuns"], first["id"])["historicalLineage"] is True
    assert _by_id(other_summary["embeddingRuns"], embedding["id"])["historicalLineage"] is True

    missing = client.get(f"/documents/{document_id}/summary?pipelineId=missing")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "document_pipeline_not_found"

    legacy = client.get(f"/documents/{document_id}").json()
    assert legacy["activeChunkRun"]["id"] == first["id"]
    assert "leaseToken" not in legacy["activeChunkRun"]
    assert _by_id(legacy["chunkRuns"], second["id"])["historicalLineage"] is True


def test_experiment_and_evaluation_use_pipeline_lineage_not_document_default(monkeypatch):
    monkeypatch.setattr("app.pipeline.GeminiService", FakeGemini)
    parsed = _queue_and_run(monkeypatch)
    document_id, parse_id = parsed["documentId"], parsed["parseRunId"]
    first = _chunk(document_id, parse_id, "fixed_token")
    _use(_default_pipeline(document_id), parseRunId=parse_id, chunkRunId=first["id"])
    _chunk(document_id, parse_id, "structure_aware")

    experiment = client.post(
        "/experiments",
        json={"documentId": document_id, "query": "retrieval", "targetStage": "retrieval", "retrieval": {"mode": "keyword", "topK": 1}},
    )
    assert experiment.status_code == 200, experiment.text
    assert experiment.json()["chunkRunId"] == first["id"]

    dataset = client.post(
        "/evaluation/datasets",
        json={"documentId": document_id, "name": "golden", "cases": [{"question": "retrieval", "relevantElementIds": ["element-2"]}]},
    )
    assert dataset.status_code == 200, dataset.text
    assert dataset.json()["parseRunId"] == parse_id

    from app.pipeline import queue_evaluation
    from app.schemas import EvaluationRunRequest

    queued = queue_evaluation(
        EvaluationRunRequest(dataset_id=dataset.json()["id"], retrieval={"mode": "keyword", "topK": 1}),
        repository=get_repository().scoped(TEST_USER_ID),
    )
    # The queued run snapshots the pipeline's chunks into its config/fingerprint.
    assert queued["config"]["chunk_run_id"] == first["id"]


def test_dataset_rejects_relevant_elements_outside_the_selected_parse(monkeypatch):
    parsed = _queue_and_run(monkeypatch)
    response = client.post(
        "/evaluation/datasets",
        json={
            "documentId": parsed["documentId"],
            "parseRunId": parsed["parseRunId"],
            "name": "wrong golden",
            "cases": [{"question": "q", "relevantElementIds": ["element-2", "element-from-other-parse"]}],
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "evaluation_elements_unknown"


def test_late_chunk_of_older_parse_does_not_roll_back_document_default():
    repository = InMemoryRepository()
    document = repository.create_document(
        {"file_name": "d.pdf", "media_type": "application/pdf", "size_bytes": 1, "page_count": 1, "owner_user_id": None},
        "bucket", "d.pdf", "sha-d",
    )
    from tests.test_pipeline import _parsed

    old = repository.save_parse(document["id"], _parsed())
    claim, _ = repository.claim_chunk_run(document["id"], old["id"], "fixed_token", {}, "hash", "tok", "chunker")
    new = repository.save_parse(document["id"], _parsed())
    repository.complete_chunk_run(claim["id"], [], claim["lease_token"])

    stored = repository.get_document_row(document["id"])
    assert stored["active_parse_run_id"] == new["id"]
    assert stored["active_chunk_run_id"] is None


def test_artifact_incomplete_detaches_failed_chunk_from_defaults_and_pipelines(monkeypatch):
    parsed = _queue_and_run(monkeypatch)
    document_id, parse_id = parsed["documentId"], parsed["parseRunId"]
    chunk = _chunk(document_id, parse_id, "fixed_token")
    pipeline = _use(_default_pipeline(document_id), parseRunId=parse_id, chunkRunId=chunk["id"])

    repository = get_repository()
    repository.fail_chunk_run(chunk["id"], "artifact_incomplete", "broken", unfenced=True)

    assert repository.get_document_row(document_id)["active_chunk_run_id"] is None
    refreshed = _default_pipeline(document_id)
    assert refreshed["chunkRunId"] is None
    assert refreshed["parseRunId"] == parse_id
    assert refreshed["revision"] == pipeline["revision"] + 1


# --- error envelope and lifecycle contract -------------------------------------------


def test_validation_and_framework_errors_use_the_error_envelope():
    invalid = client.post("/experiments", json={"documentId": "d", "query": "x" * 4001})
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "request_invalid"
    assert "query" in invalid.json()["error"]["message"]
    assert "x" * 50 not in invalid.json()["error"]["message"]

    missing = client.get("/no-such-route")
    assert missing.status_code == 404
    assert missing.json() == {"error": {"code": "not_found", "message": "Not Found"}}

    wrong_method = client.put("/documents")
    assert wrong_method.status_code == 405
    assert wrong_method.json()["error"]["code"] == "method_not_allowed"


def _seed_experiment(repository: InMemoryRepository, document_id: str, chunk_id: str, **values) -> dict:
    row = {
        "id": values.pop("id", "experiment-1"),
        "document_id": document_id,
        "chunk_run_id": chunk_id,
        "embedding_run_id": None,
        "query": "q",
        "target_stage": "retrieval",
        "experiment_fingerprint": "fp",
        "config": {"query": "q", "_execution": {"seedStageResults": {"retrieval": {"big": "x" * 100}}, "continuedFromExperimentId": "experiment-0", "forceGeneration": True}},
        "stage_results": {},
        "status": "completed",
        "created_at": datetime.now(timezone.utc),
        **values,
    }
    return repository.save_experiment(row)


def test_interrupted_runs_are_failed_with_their_own_code_and_execution_never_leaks(monkeypatch):
    parsed = _queue_and_run(monkeypatch)
    document_id, parse_id = parsed["documentId"], parsed["parseRunId"]
    chunk = _chunk(document_id, parse_id, "fixed_token")
    repository = get_repository()
    expired = datetime.now(timezone.utc) - timedelta(seconds=5)
    _seed_experiment(
        repository, document_id, chunk["id"],
        status="running", lease_token="token", lease_expires_at=expired,
    )

    detail = client.get("/experiments/experiment-1").json()
    assert detail["status"] == "failed"
    assert detail["errorCode"] == "worker_lease_expired"
    assert "leaseToken" not in detail
    assert "Execution" not in detail["config"] and "_execution" not in detail["config"]
    assert detail["continuedFromExperimentId"] == "experiment-0"
    assert detail["generationRerun"] is True
    assert detail["reusedExperiment"] is False

    summary = client.get(f"/documents/{document_id}/summary").json()
    experiment = _by_id(summary["experiments"], "experiment-1")
    assert experiment["status"] == "failed"
    assert experiment["error"]["code"] == "worker_lease_expired"
    assert "Execution" not in experiment["config"] and "_execution" not in experiment["config"]
    listed = client.get(f"/experiments?documentId={document_id}").json()["items"]
    assert "Execution" not in listed[0]["config"]

    # Without a documentId the compatibility is still evaluated per document.
    unscoped = client.get("/experiments").json()["items"]
    assert unscoped and unscoped[0]["compatibilityReason"] != "chunk_lineage_missing"


def test_durable_response_keeps_request_level_reuse_provenance(monkeypatch):
    parsed = _queue_and_run(monkeypatch)
    document_id, parse_id = parsed["documentId"], parsed["parseRunId"]
    chunk = _chunk(document_id, parse_id, "fixed_token")
    repository = get_repository()
    stored = _seed_experiment(repository, document_id, chunk["id"], id="experiment-reused")

    response = main._durable_pipeline_response(
        "experiment",
        {**stored, "reused_experiment": True, "continued_from_experiment_id": "experiment-source"},
        repository,
    )
    import json

    body = json.loads(response.body)
    assert response.status_code == 200
    assert body["reusedExperiment"] is True
    assert body["continuedFromExperimentId"] == "experiment-source"
    assert "leaseToken" not in body


def test_continuation_reads_seed_stages_by_reference(monkeypatch):
    parsed = _queue_and_run(monkeypatch)
    document_id, parse_id = parsed["documentId"], parsed["parseRunId"]
    chunk = _chunk(document_id, parse_id, "fixed_token")
    first = client.post(
        "/experiments",
        json={"documentId": document_id, "chunkRunId": chunk["id"], "query": "retrieval", "targetStage": "retrieval", "retrieval": {"mode": "keyword", "topK": 1}},
    ).json()

    from app.pipeline import queue_continue_experiment

    repository = get_repository()
    queued = queue_continue_experiment(first["id"], repository=repository)
    persisted = repository.get_experiment_row(queued["id"])
    execution = persisted["config"]["_execution"]
    assert execution["seedExperimentId"] == first["id"]
    assert execution["seedStageResults"] == {}

    captured = {}

    def capture(*_args, **kwargs):
        captured.update(kwargs)

    monkeypatch.setattr("app.pipeline._run_experiment_stages", capture)
    run_queued_experiment(None, queued["id"], repository=repository)
    assert captured["seed_stage_results"]["retrieval"]["status"] == "completed"


def _queued_snapshot_evaluation(monkeypatch):
    from app.pipeline import queue_evaluation
    from app.schemas import EvaluationRunRequest
    from tests.test_pipeline import _phase5_document

    document_id, default_chunk_id = _phase5_document(monkeypatch)
    parse_id = client.get(f"/documents/{document_id}/summary").json()["activeLineage"]["parseRunId"]
    snapshot_chunk = _chunk(document_id, parse_id, "structure_aware")
    created = client.post(
        f"/documents/{document_id}/pipelines",
        json={"name": "Snapshot", "parseRunId": parse_id, "chunkRunId": snapshot_chunk["id"]},
    )
    assert created.status_code == 201, created.text
    dataset = client.post(
        "/evaluation/datasets",
        json={"documentId": document_id, "name": "snapshot", "cases": [{"question": "retrieval"}]},
    ).json()
    repository = get_repository().scoped(TEST_USER_ID)
    queued = queue_evaluation(
        EvaluationRunRequest(
            dataset_id=dataset["id"],
            pipeline_id=created.json()["id"],
            retrieval={"mode": "keyword", "topK": 1},
            reranking={"enabled": False, "candidateCount": 1},
        ),
        repository=repository,
    )
    assert queued["config"]["chunk_run_id"] == snapshot_chunk["id"] != default_chunk_id
    return repository, queued, created.json(), snapshot_chunk


def test_queued_evaluation_runs_its_snapshot_after_the_pipeline_is_deleted(monkeypatch):
    from app.pipeline import run_queued_evaluation

    repository, queued, pipeline, snapshot_chunk = _queued_snapshot_evaluation(monkeypatch)
    assert client.delete(f"/document-pipelines/{pipeline['id']}").status_code == 204

    result = run_queued_evaluation(None, queued["id"], repository=repository)

    assert result is not None and result["status"] == "completed", result
    children = [repository.get_experiment_row(child) for child in result["child_experiment_ids"]]
    assert children and all(child["chunk_run_id"] == snapshot_chunk["id"] for child in children)


def test_queued_evaluation_fails_visibly_when_its_snapshot_artifact_is_no_longer_usable(monkeypatch):
    from app.pipeline import run_queued_evaluation

    repository, queued, _pipeline, snapshot_chunk = _queued_snapshot_evaluation(monkeypatch)
    get_repository().fail_chunk_run(snapshot_chunk["id"], "artifact_incomplete", "broken", unfenced=True)

    assert run_queued_evaluation(None, queued["id"], repository=repository) is None
    failed = repository.get_evaluation_row(queued["id"])
    assert failed["status"] == "failed"
    assert failed["child_experiment_ids"] == []
    assert failed["error_code"] not in {None, "document_pipeline_not_found"}


def test_keyword_evaluation_keeps_its_null_embedding_snapshot_in_child_experiments(monkeypatch):
    """Codex #129-2: an embedding created after queueing must not leak into children."""

    from app.pipeline import run_queued_evaluation

    repository, queued, pipeline, snapshot_chunk = _queued_snapshot_evaluation(monkeypatch)
    assert queued["config"]["embedding_run_id"] is None
    store = get_repository()
    store.embedding_runs["embedding-late"] = {
        "id": "embedding-late", "document_id": snapshot_chunk["documentId"], "chunk_run_id": snapshot_chunk["id"],
        "status": "completed", "model": "gemini-embedding-2", "dimensions": 768,
        "embedding_format_version": main.EMBEDDING_FORMAT_VERSION, "embedding_count": 0,
    }
    store.document_pipelines[pipeline["id"]]["embedding_run_id"] = "embedding-late"

    result = run_queued_evaluation(None, queued["id"], repository=repository)

    assert result is not None and result["status"] == "completed", result
    assert result["config"]["embedding_run_id"] is None
    children = [repository.get_experiment_row(child) for child in result["child_experiment_ids"]]
    assert children and all(child["embedding_run_id"] is None for child in children)


def test_experiment_whose_embedding_was_failed_is_not_compatible(monkeypatch):
    """Codex #129-1: summary-based compatibility must check the embedding parent status."""

    parsed = _queue_and_run(monkeypatch)
    document_id, parse_id = parsed["documentId"], parsed["parseRunId"]
    chunk = _chunk(document_id, parse_id, "fixed_token")
    repository = get_repository()
    repository.embedding_runs["embedding-broken"] = {
        "id": "embedding-broken", "document_id": document_id, "chunk_run_id": chunk["id"], "status": "completed",
        "model": "gemini-embedding-2", "dimensions": 768, "embedding_format_version": main.EMBEDDING_FORMAT_VERSION,
        "embedding_count": 0, "identity_claimed": True,
    }
    _seed_experiment(repository, document_id, chunk["id"], id="experiment-dense", embedding_run_id="embedding-broken")
    compatible = _by_id(client.get(f"/documents/{document_id}/summary").json()["experiments"], "experiment-dense")
    assert compatible["isCompatible"] is True

    repository.fail_embedding_run("embedding-broken", "artifact_incomplete", "broken", unfenced=True)

    for payload in (client.get(f"/documents/{document_id}/summary").json(), client.get(f"/documents/{document_id}").json()):
        experiment = _by_id(payload["experiments"], "experiment-dense")
        assert experiment["isCompatible"] is False
        assert experiment["compatibilityReason"] == "lineage_incompatible"
