from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import uuid

from fastapi.testclient import TestClient

from app.chunking import CHUNKER_VERSION, TOKENIZER_VERSION, chunk_structured, config_hash, effective_config
from app.errors import ApiProblem
from app.main import app
from app.config import Settings
from app.pipeline import parse_upload, queue_parse_upload, run_parse_worker
from app.repository import InMemoryRepository, get_repository, reset_repository
from app.schemas import (
    ChunkRunRequest,
    DocumentMetadata,
    ParseResponse,
    ParseSummary,
    ParsedElement,
    ParsedPage,
    StructuredContent,
)
from app.storage import get_storage, reset_storage


client = TestClient(app)


def setup_function():
    reset_repository()
    reset_storage()


def _parsed() -> ParseResponse:
    elements = [
        ParsedElement(id="element-1", type="heading", text="RAG Basics", level=1, page_numbers=[1]),
        ParsedElement(
            id="element-2",
            type="paragraph",
            text="Retrieval finds relevant chunks. Generation answers only from grounded context.",
            page_numbers=[1],
        ),
    ]
    return ParseResponse(
        document=DocumentMetadata(file_name="lesson.pdf", media_type="application/pdf", size_bytes=8, page_count=1),
        structured=StructuredContent(pages=[ParsedPage(page_number=1, elements=elements)], elements=elements),
        markdown="# RAG Basics\n\nRetrieval finds relevant chunks.",
        summary=ParseSummary(page_count=1, heading_count=1, paragraph_count=1, list_count=0, table_count=0),
    )


def _queue_and_run(monkeypatch, *, file_name: str = "lesson.pdf"):
    from app.config import Settings

    monkeypatch.setattr("app.main.get_settings", lambda: Settings(app_env="development", local_parse_worker_enabled=False))
    monkeypatch.setattr("app.main.dispatch_parse_run", lambda *_args: "dispatch-test")
    monkeypatch.setattr("app.parser.parse_pdf_file", lambda *_args, **_kwargs: _parsed())
    response = client.post(
        "/documents/parse",
        files={"file": (file_name, b"%PDF-1.7", "application/pdf")},
    )
    assert response.status_code == 202
    queued = response.json()
    assert queued["status"] == "queued"
    run = run_parse_worker(queued["parseRunId"])
    assert run is not None and run["status"] == "completed"
    return queued


def _phase5_settings() -> Settings:
    """Use immutable model identifiers so the reuse assertions are cache-safe."""
    return Settings(
        app_env="development",
        local_parse_worker_enabled=False,
        gemini_embedding_model="gemini-embedding-2",
        gemini_generation_model="gemini-generation-v1",
        gemini_rerank_model="gemini-rerank-v1",
        gemini_judge_model="gemini-judge-v1",
        gemini_max_retries=0,
    )


class Phase5FakeGemini:
    calls = {"embed_query": 0, "rerank": 0, "generate": 0, "judge": 0}

    def __init__(self, settings):
        self.settings = settings

    @classmethod
    def reset(cls):
        cls.calls = {"embed_query": 0, "rerank": 0, "generate": 0, "judge": 0}

    def embed_query(self, _query):
        type(self).calls["embed_query"] += 1
        return [1.0, 0.0, 0.0], type("Metadata", (), {
            "configured_model": self.settings.gemini_embedding_model,
            "effective_model": "gemini-embedding-2-001",
        })()

    def rerank(self, prompt):
        type(self).calls["rerank"] += 1
        identifiers = [line.split(":", 1)[0] for line in prompt.splitlines()[1:] if ":" in line]
        return identifiers, type("Metadata", (), {
            "configured_model": self.settings.gemini_rerank_model,
            "effective_model": "gemini-rerank-v1-001",
        })()

    def generate_json(self, _prompt, _config):
        type(self).calls["generate"] += 1
        return {
            "insufficientContext": False,
            "answer": "Retrieval is grounded in the selected context.",
            "claims": [{"text": "Retrieval is grounded in the selected context.", "citationIds": ["C1"]}],
        }, type("Metadata", (), {
            "configured_model": self.settings.gemini_generation_model,
            "effective_model": "gemini-generation-v1-001",
        })()

    def judge(self, _prompt):
        type(self).calls["judge"] += 1
        return {"groundedness": 0.9, "claimResults": [{"supported": True}]}, type("Metadata", (), {
            "configured_model": self.settings.gemini_judge_model,
            "effective_model": "gemini-judge-v1-001",
        })()


def _phase5_document(monkeypatch):
    monkeypatch.setattr("app.pipeline.get_settings", _phase5_settings)
    monkeypatch.setattr("app.pipeline.GeminiService", Phase5FakeGemini)
    Phase5FakeGemini.reset()
    parsed = _queue_and_run(monkeypatch)
    document_id = parsed["documentId"]
    chunk = client.post(
        f"/documents/{document_id}/chunks",
        json={"strategy": "fixed_token", "config": {"chunkSizeTokens": 64, "overlapTokens": 8}},
    ).json()
    return document_id, chunk["id"]


def _phase5_generation_request(document_id: str, chunk_run_id: str, **overrides):
    payload = {
        "documentId": document_id,
        "chunkRunId": chunk_run_id,
        "query": "retrieval",
        "targetStage": "generation",
        "retrieval": {"mode": "keyword", "topK": 1},
        "reranking": {"enabled": True, "candidateCount": 1},
        "context": {"tokenBudget": 3000},
        "generation": {"temperature": 0.1, "maxOutputTokens": 1024},
    }
    for key, value in overrides.items():
        payload[key] = value
    return payload


def test_document_chunk_and_keyword_experiment_are_persisted(monkeypatch):
    payload = _queue_and_run(monkeypatch)
    document_id = payload["documentId"]
    assert payload["parseRunId"]

    chunk_response = client.post(
        f"/documents/{document_id}/chunks",
        json={"strategy": "structure_aware", "config": {"chunkSizeTokens": 64, "overlapTokens": 8}},
    )
    assert chunk_response.status_code == 200
    chunk_run_id = chunk_response.json()["id"]
    assert chunk_response.json()["chunks"][0]["sourceElementIds"]

    experiment = client.post(
        "/experiments",
        json={
            "documentId": document_id,
            "chunkRunId": chunk_run_id,
            "query": "retrieval",
            "targetStage": "retrieval",
            "retrieval": {"mode": "keyword", "topK": 5},
        },
    )
    assert experiment.status_code == 200
    result = experiment.json()
    assert result["stageResults"]["retrieval"]["config"]["ftsConfig"] == "simple"
    assert result["stageResults"]["retrieval"]["results"][0]["keywordScore"] > 0

    detail = client.get(f"/documents/{document_id}")
    assert detail.status_code == 200
    assert detail.json()["activeParseRun"]["parseRunId"] == payload["parseRunId"]
    assert detail.json()["activeParseRun"]["structured"]["elements"][0]["text"] == "RAG Basics"
    assert detail.json()["activeParseRun"]["markdown"].startswith("# RAG Basics")
    assert detail.json()["activeChunkRun"]["chunks"]
    assert client.get(f"/chunk-runs/{chunk_run_id}").json()["chunks"]


def test_phase5_exact_experiment_reuses_without_provider_calls(monkeypatch):
    document_id, chunk_run_id = _phase5_document(monkeypatch)
    from app import pipeline

    retrieval_calls = 0
    original_retrieval = pipeline._retrieval_stage

    def counted_retrieval(*args, **kwargs):
        nonlocal retrieval_calls
        retrieval_calls += 1
        return original_retrieval(*args, **kwargs)

    monkeypatch.setattr(pipeline, "_retrieval_stage", counted_retrieval)
    request = _phase5_generation_request(document_id, chunk_run_id)
    first = client.post("/experiments", json=request)
    second = client.post("/experiments", json=request)

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["reusedExperiment"] is True
    assert retrieval_calls == 1
    assert Phase5FakeGemini.calls["rerank"] == 1
    assert Phase5FakeGemini.calls["generate"] == 1
    assert second.json()["stageResults"]["retrieval"]["reuse"]["executed"] is True


def test_phase5_invalidation_matrix_reuses_only_compatible_upstream_stages(monkeypatch):
    document_id, chunk_run_id = _phase5_document(monkeypatch)
    from app import pipeline

    retrieval_calls = 0
    original_retrieval = pipeline._retrieval_stage

    def counted_retrieval(*args, **kwargs):
        nonlocal retrieval_calls
        retrieval_calls += 1
        return original_retrieval(*args, **kwargs)

    monkeypatch.setattr(pipeline, "_retrieval_stage", counted_retrieval)
    first = client.post("/experiments", json=_phase5_generation_request(document_id, chunk_run_id)).json()
    assert retrieval_calls == 1
    assert Phase5FakeGemini.calls["rerank"] == 1
    assert Phase5FakeGemini.calls["generate"] == 1

    query_changed = client.post(
        "/experiments",
        json=_phase5_generation_request(document_id, chunk_run_id, query="grounded"),
    )
    assert query_changed.status_code == 200
    assert query_changed.json()["stageResults"]["retrieval"]["reuse"]["executed"] is True
    assert retrieval_calls == 2
    assert Phase5FakeGemini.calls["rerank"] == 2
    assert Phase5FakeGemini.calls["generate"] == 2

    reranker_changed = client.post(
        "/experiments",
        json=_phase5_generation_request(
            document_id,
            chunk_run_id,
            reranking={"enabled": True, "candidateCount": 2},
        ),
    )
    assert reranker_changed.status_code == 200
    reranker_results = reranker_changed.json()["stageResults"]
    assert reranker_results["retrieval"]["reuse"]["reused"] is True
    assert reranker_results["reranking"]["reuse"]["executed"] is True
    assert retrieval_calls == 2
    assert Phase5FakeGemini.calls["rerank"] == 3
    assert Phase5FakeGemini.calls["generate"] == 3

    context_changed = client.post(
        "/experiments",
        json=_phase5_generation_request(document_id, chunk_run_id, context={"tokenBudget": 256}),
    )
    assert context_changed.status_code == 200
    context_results = context_changed.json()["stageResults"]
    assert context_results["retrieval"]["reuse"]["reused"] is True
    assert context_results["reranking"]["reuse"]["reused"] is True
    assert context_results["context"]["reuse"]["executed"] is True
    assert Phase5FakeGemini.calls["rerank"] == 3
    assert Phase5FakeGemini.calls["generate"] == 4

    generation_changed = client.post(
        "/experiments",
        json=_phase5_generation_request(document_id, chunk_run_id, generation={"temperature": 0.7, "maxOutputTokens": 1024}),
    )
    assert generation_changed.status_code == 200
    generation_results = generation_changed.json()["stageResults"]
    assert generation_results["retrieval"]["reuse"]["reused"] is True
    assert generation_results["reranking"]["reuse"]["reused"] is True
    assert generation_results["context"]["reuse"]["reused"] is True
    assert generation_results["generation"]["reuse"]["executed"] is True
    assert retrieval_calls == 2
    assert Phase5FakeGemini.calls["rerank"] == 3
    assert Phase5FakeGemini.calls["generate"] == 5
    assert first["stageResults"]["retrieval"]["fingerprint"] != generation_changed.json()["stageResults"]["retrieval"]["fingerprint"] or first["stageResults"]["generation"]["fingerprint"] != generation_results["generation"]["fingerprint"]


def test_phase5_continue_uses_persisted_prefix_and_generation_rerun_creates_new_run(monkeypatch):
    document_id, chunk_run_id = _phase5_document(monkeypatch)
    retrieval = {
        "mode": "keyword",
        "topK": 1,
    }
    partial = client.post(
        "/experiments",
        json={
            "documentId": document_id,
            "chunkRunId": chunk_run_id,
            "query": "retrieval",
            "targetStage": "retrieval",
            "retrieval": retrieval,
            "reranking": {"enabled": True, "candidateCount": 1},
        },
    )
    assert partial.status_code == 200
    partial_id = partial.json()["id"]
    assert Phase5FakeGemini.calls["rerank"] == 0

    continued = client.post(f"/experiments/{partial_id}/continue")
    assert continued.status_code == 200
    continued_payload = continued.json()
    assert continued_payload["id"] != partial_id
    assert continued_payload["continuedFromExperimentId"] == partial_id
    assert continued_payload["stageResults"]["retrieval"]["reuse"]["reused"] is True
    assert continued_payload["stageResults"]["reranking"]["reuse"]["executed"] is True
    assert Phase5FakeGemini.calls["rerank"] == 1
    assert Phase5FakeGemini.calls["generate"] == 0

    full = client.post(
        "/experiments",
        json=_phase5_generation_request(document_id, chunk_run_id),
    )
    assert full.status_code == 200
    rerun = client.post(f"/experiments/{full.json()['id']}/rerun-generation")
    assert rerun.status_code == 200
    rerun_payload = rerun.json()
    assert rerun_payload["id"] != full.json()["id"]
    assert rerun_payload["generationRerun"] is True
    assert rerun_payload["stageResults"]["retrieval"]["reuse"]["reused"] is True
    assert rerun_payload["stageResults"]["reranking"]["reuse"]["reused"] is True
    assert rerun_payload["stageResults"]["context"]["reuse"]["reused"] is True
    assert rerun_payload["stageResults"]["generation"]["reuse"]["executed"] is True
    assert Phase5FakeGemini.calls["rerank"] == 1
    assert Phase5FakeGemini.calls["generate"] == 2


def test_phase5_corrupt_or_unversioned_stage_provenance_fails_closed(monkeypatch):
    document_id, chunk_run_id = _phase5_document(monkeypatch)
    request = _phase5_generation_request(document_id, chunk_run_id)
    first = client.post("/experiments", json=request)
    assert first.status_code == 200
    repository = get_repository()
    repository.experiments[first.json()["id"]]["stage_results"]["generation"]["resultHash"] = "corrupt"
    second = client.post("/experiments", json=request)
    assert second.status_code == 200
    assert second.json()["id"] != first.json()["id"]
    assert Phase5FakeGemini.calls["generate"] == 2


def test_phase5_partial_stage_results_are_durable_when_downstream_fails(monkeypatch):
    document_id, chunk_run_id = _phase5_document(monkeypatch)

    class FailingGeneration(Phase5FakeGemini):
        def generate_json(self, _prompt, _config):
            raise ApiProblem(503, "generation_failed", "simulated generation failure")

    monkeypatch.setattr("app.pipeline.GeminiService", FailingGeneration)
    response = client.post("/experiments", json=_phase5_generation_request(document_id, chunk_run_id))
    assert response.status_code == 503
    failed = [row for row in get_repository().list_experiment_rows(document_id) if row.get("status") == "failed"]
    assert len(failed) == 1
    assert set(failed[0]["stage_results"]) == {"retrieval", "reranking", "context"}


def test_phase5_missing_model_provenance_is_not_reused(monkeypatch):
    document_id, chunk_run_id = _phase5_document(monkeypatch)
    request = _phase5_generation_request(document_id, chunk_run_id)
    first = client.post("/experiments", json=request)
    assert first.status_code == 200
    repository = get_repository()
    generation = repository.experiments[first.json()["id"]]["stage_results"]["generation"]
    generation["provenance"]["model"]["effectiveModel"] = None
    generation["provenance"]["model"]["cacheable"] = True
    from app.pipeline import _stage_result_hash

    generation["resultHash"] = _stage_result_hash(generation)
    second = client.post("/experiments", json=request)
    assert second.status_code == 200
    assert second.json()["id"] != first.json()["id"]
    assert Phase5FakeGemini.calls["generate"] == 2


def test_phase5_exact_claim_race_has_one_owner(monkeypatch):
    document_id, chunk_run_id = _phase5_document(monkeypatch)
    repository = get_repository()
    rows = [
        {
            "id": str(uuid.uuid4()),
            "document_id": document_id,
            "chunk_run_id": chunk_run_id,
            "embedding_run_id": None,
            "query": "retrieval",
            "target_stage": "retrieval",
            "experiment_fingerprint": "race-fingerprint",
            "config": {},
            "stage_results": {},
            "status": "running",
        }
        for _ in range(8)
    ]
    with ThreadPoolExecutor(max_workers=8) as pool:
        claims = list(pool.map(repository.claim_experiment, rows))
    assert sum(owner for _, owner in claims) == 1
    assert len({row["id"] for row, _ in claims}) == 1
    repository.fail_experiment(claims[0][0]["id"], "test_cleanup", "test")


def test_phase5_evaluation_reuses_child_experiments(monkeypatch):
    document_id, chunk_run_id = _phase5_document(monkeypatch)
    dataset = client.post(
        "/evaluation/datasets",
        json={"documentId": document_id, "name": "reuse", "cases": [{"question": "retrieval"}]},
    )
    assert dataset.status_code == 200
    request = {
        "datasetId": dataset.json()["id"],
        "chunkRunId": chunk_run_id,
        "retrieval": {"mode": "keyword", "topK": 1},
        "reranking": {"enabled": False, "candidateCount": 1},
        "context": {"tokenBudget": 3000},
        "generation": {"temperature": 0.1, "maxOutputTokens": 1024},
        "judge": False,
    }
    first = client.post("/evaluation/runs", json=request)
    second = client.post("/evaluation/runs", json=request)
    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["childExperimentIds"] == first.json()["childExperimentIds"]
    assert Phase5FakeGemini.calls["generate"] == 1


def test_chunk_identity_reuses_completed_artifact_and_hashes_effective_config(monkeypatch):
    parsed = _queue_and_run(monkeypatch)
    document_id = parsed["documentId"]
    parse_run_id = parsed["parseRunId"]
    from app import pipeline

    original_chunk_structured = pipeline.chunk_structured
    calls = 0

    def counted_chunk_structured(*args, **kwargs):
        nonlocal calls
        calls += 1
        return original_chunk_structured(*args, **kwargs)

    monkeypatch.setattr(pipeline, "chunk_structured", counted_chunk_structured)
    first = client.post(
        f"/documents/{document_id}/chunks",
        json={"parseRunId": parse_run_id, "strategy": "fixed_token", "config": {"chunkSizeTokens": 512}},
    )
    second = client.post(
        f"/documents/{document_id}/chunks",
        json={
            "parseRunId": parse_run_id,
            "strategy": "fixed_token",
            "config": {"chunkSizeTokens": 512, "overlapTokens": 64},
        },
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert first.json()["reusedArtifact"] is False
    assert second.json()["reusedArtifact"] is True
    assert calls == 1
    assert config_hash({"chunk_size_tokens": 512}) == config_hash({"chunk_size_tokens": 512, "overlap_tokens": 64})
    assert config_hash(effective_config(ChunkRunRequest().config)) == config_hash({"chunk_size_tokens": 512, "overlap_tokens": 64})

    monkeypatch.setattr(pipeline, "CHUNKER_VERSION", "rag-steplab-chunker-test-v2")
    versioned = client.post(
        f"/documents/{document_id}/chunks",
        json={"parseRunId": parse_run_id, "strategy": "fixed_token", "config": {"chunkSizeTokens": 512, "overlapTokens": 64}},
    )
    assert versioned.status_code == 200
    assert versioned.json()["id"] != first.json()["id"]
    assert versioned.json()["reusedArtifact"] is False
    assert calls == 2


def test_embedding_identity_reuses_completed_artifact_without_gemini_call(monkeypatch):
    class FakeMetadata:
        effective_model = "gemini-embedding-2-001"

    class FakeGemini:
        calls = 0
        settings = type("Settings", (), {"gemini_embedding_model": "gemini-embedding-2", "gemini_embedding_dimensions": 768})()

        def __init__(self, *_args, **_kwargs):
            pass

        def embed_documents(self, texts):
            type(self).calls += 1
            return [[1.0] + [0.0] * 767 for _ in texts], FakeMetadata()

    monkeypatch.setattr("app.pipeline.GeminiService", FakeGemini)
    parsed = _queue_and_run(monkeypatch)
    document_id = parsed["documentId"]
    chunk = client.post(
        f"/documents/{document_id}/chunks",
        json={"strategy": "fixed_token", "config": {"chunkSizeTokens": 64, "overlapTokens": 8}},
    ).json()

    first = client.post(f"/documents/{document_id}/embeddings", json={"chunkRunId": chunk["id"]})
    second = client.post(f"/documents/{document_id}/embeddings", json={"chunkRunId": chunk["id"]})

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert first.json()["reusedArtifact"] is False
    assert second.json()["reusedArtifact"] is True
    assert first.json()["effectiveModel"] == "gemini-embedding-2-001"
    assert second.json()["effectiveModel"] == "gemini-embedding-2-001"
    assert FakeGemini.calls == 1


def test_failed_embedding_artifact_is_released_and_recomputed(monkeypatch):
    class FakeMetadata:
        effective_model = "gemini-embedding-2-001"

    class FlakyGemini:
        calls = 0

        def __init__(self, *_args, **_kwargs):
            pass

        def embed_documents(self, texts):
            type(self).calls += 1
            if type(self).calls == 1:
                raise ApiProblem(503, "gemini_embedding_failed", "simulated")
            return [[1.0] + [0.0] * 767 for _ in texts], FakeMetadata()

    monkeypatch.setattr("app.pipeline.GeminiService", FlakyGemini)
    parsed = _queue_and_run(monkeypatch)
    document_id = parsed["documentId"]
    chunk = client.post(
        f"/documents/{document_id}/chunks",
        json={"strategy": "fixed_token", "config": {"chunkSizeTokens": 64, "overlapTokens": 8}},
    ).json()

    first = client.post(f"/documents/{document_id}/embeddings", json={"chunkRunId": chunk["id"]})
    assert first.status_code == 503

    rows = get_repository().list_embedding_rows(document_id)
    assert len(rows) == 1
    assert rows[0]["status"] == "failed"
    assert rows[0]["identity_claimed"] is None

    second = client.post(f"/documents/{document_id}/embeddings", json={"chunkRunId": chunk["id"]})
    assert second.status_code == 200
    assert second.json()["reusedArtifact"] is False
    assert second.json()["id"] != rows[0]["id"]
    assert FlakyGemini.calls == 2


def test_completed_incomplete_chunk_artifact_is_not_reused(monkeypatch):
    parsed = _queue_and_run(monkeypatch)
    document_id = parsed["documentId"]
    request = {"strategy": "fixed_token", "config": {"chunkSizeTokens": 64, "overlapTokens": 8}}
    first = client.post(f"/documents/{document_id}/chunks", json=request)
    assert first.status_code == 200
    run_id = first.json()["id"]
    repository = get_repository()
    repository.chunks[run_id].clear()

    incomplete = client.post(f"/documents/{document_id}/chunks", json=request)
    assert incomplete.status_code == 409
    assert incomplete.json()["error"]["code"] == "artifact_incomplete"

    retry = client.post(f"/documents/{document_id}/chunks", json=request)
    assert retry.status_code == 200
    assert retry.json()["id"] != run_id
    assert retry.json()["reusedArtifact"] is False


def test_completed_incomplete_embedding_artifact_is_not_reused(monkeypatch):
    class FakeMetadata:
        effective_model = "gemini-embedding-2-001"

    class CountingGemini:
        calls = 0

        def __init__(self, *_args, **_kwargs):
            pass

        def embed_documents(self, texts):
            type(self).calls += 1
            return [[1.0] + [0.0] * 767 for _ in texts], FakeMetadata()

    monkeypatch.setattr("app.pipeline.GeminiService", CountingGemini)
    parsed = _queue_and_run(monkeypatch)
    document_id = parsed["documentId"]
    chunk = client.post(
        f"/documents/{document_id}/chunks",
        json={"strategy": "fixed_token", "config": {"chunkSizeTokens": 64, "overlapTokens": 8}},
    ).json()
    first = client.post(f"/documents/{document_id}/embeddings", json={"chunkRunId": chunk["id"]})
    assert first.status_code == 200
    embedding_id = first.json()["id"]
    get_repository().embeddings[embedding_id].clear()

    incomplete = client.post(f"/documents/{document_id}/embeddings", json={"chunkRunId": chunk["id"]})
    assert incomplete.status_code == 409
    assert incomplete.json()["error"]["code"] == "artifact_incomplete"

    retry = client.post(f"/documents/{document_id}/embeddings", json={"chunkRunId": chunk["id"]})
    assert retry.status_code == 200
    assert retry.json()["id"] != embedding_id
    assert retry.json()["reusedArtifact"] is False
    assert CountingGemini.calls == 2


def test_artifact_claim_is_fail_closed_for_running_and_failed_rows(monkeypatch):
    parsed = _queue_and_run(monkeypatch)
    document_id = parsed["documentId"]
    parse_run_id = parsed["parseRunId"]
    repository = get_repository()
    config = effective_config({"chunk_size_tokens": 512, "overlap_tokens": 64})
    claim, claimed = repository.claim_chunk_run(
        document_id,
        parse_run_id,
        "fixed_token",
        config,
        config_hash(config),
        TOKENIZER_VERSION,
        CHUNKER_VERSION,
    )
    assert claimed is True

    in_progress = client.post(
        f"/documents/{document_id}/chunks",
        json={"parseRunId": parse_run_id, "strategy": "fixed_token", "config": config},
    )
    assert in_progress.status_code == 409
    assert in_progress.json()["error"]["code"] == "artifact_in_progress"

    repository.fail_chunk_run(claim["id"], "chunk_run_failed", "simulated")
    retry = client.post(
        f"/documents/{document_id}/chunks",
        json={"parseRunId": parse_run_id, "strategy": "fixed_token", "config": config},
    )
    assert retry.status_code == 200
    assert retry.json()["id"] != claim["id"]
    assert retry.json()["reusedArtifact"] is False


def test_chunk_claim_race_has_one_owner_and_completed_retry_reuses_it(monkeypatch):
    parsed = _queue_and_run(monkeypatch)
    document_id = parsed["documentId"]
    parse_run_id = parsed["parseRunId"]
    repository = get_repository()
    config = effective_config({"chunk_size_tokens": 512, "overlap_tokens": 64})

    def claim_once(_index):
        return repository.claim_chunk_run(
            document_id,
            parse_run_id,
            "fixed_token",
            config,
            config_hash(config),
            TOKENIZER_VERSION,
            CHUNKER_VERSION,
        )

    with ThreadPoolExecutor(max_workers=8) as pool:
        claims = list(pool.map(claim_once, range(8)))
    assert sum(owner for _, owner in claims) == 1
    assert len({row["id"] for row, _ in claims}) == 1

    owner_row = next(row for row, owner in claims if owner)
    parse = repository.get_parse_row(parse_run_id)
    repository.complete_chunk_run(owner_row["id"], chunk_structured(parse["structured"], "fixed_token", config))
    reused, owner = repository.claim_chunk_run(
        document_id,
        parse_run_id,
        "fixed_token",
        config,
        config_hash(config),
        TOKENIZER_VERSION,
        CHUNKER_VERSION,
    )
    assert owner is False
    assert reused["id"] == owner_row["id"]
    assert reused["status"] == "completed"


def test_all_ten_database_tables_are_declared():
    from app.models import Base

    assert len(Base.metadata.tables) == 10
    assert {table.name for table in Base.metadata.tables.values()} == {
        "documents",
        "parse_runs",
        "chunk_runs",
        "chunks",
        "embedding_runs",
        "chunk_embeddings",
        "experiment_runs",
        "evaluation_datasets",
        "evaluation_runs",
        "document_pipelines",
    }


def test_sqlalchemy_metadata_does_not_require_supabase_auth_table():
    from app.models import Base

    # Supabase auth.users SQLAlchemy metadata'sında yer almadığı için model
    # metadata'sı external auth tablosuna çözülmeden sıralanabilmeli.
    assert {table.fullname for table in Base.metadata.sorted_tables} >= {
        "rag_lab.documents",
        "rag_lab.chunk_runs",
    }


def test_parse_compensates_document_and_storage_when_parse_persistence_fails():
    class FailingRepository(InMemoryRepository):
        def save_parse(self, document_id, parsed, *, run_id=None):
            raise RuntimeError("simulated persistence failure")

    repository = FailingRepository()
    try:
        parse_upload(b"%PDF-1.7", "lesson.pdf", _parsed(), repository=repository)
    except RuntimeError as exc:
        assert str(exc) == "simulated persistence failure"
    else:  # pragma: no cover - protects the failure-path assertion itself
        raise AssertionError("parse_upload unexpectedly succeeded")

    assert repository.documents == {}
    assert get_storage().objects == {}


def test_generation_citations_and_evaluation_use_real_stage_metadata(monkeypatch):
    class FakeMetadata:
        configured_model = "gemini-flash-lite-latest"
        effective_model = "gemini-2.5-flash-lite"

    class FakeGemini:
        settings = type("Settings", (), {"gemini_generation_model": "gemini-flash-lite-latest", "gemini_max_retries": 0})()

        def __init__(self, *_args, **_kwargs):
            pass

        def embed_documents(self, texts):
            return [[1.0, 0.0, 0.0] for _ in texts], FakeMetadata()

        def embed_query(self, query):
            return [1.0, 0.0, 0.0], FakeMetadata()

        def rerank(self, prompt):
            return [prompt.splitlines()[1].split(":", 1)[0]], FakeMetadata()

        def generate_json(self, prompt, config):
            return {
                "insufficientContext": False,
                "answer": "Retrieval finds chunks.",
                "claims": [{"text": "Retrieval finds chunks.", "citationIds": ["C1"]}],
            }, FakeMetadata()

        def judge(self, prompt):
            return {"groundedness": 0.9, "claimResults": [{"supported": True}]}, FakeMetadata()

    monkeypatch.setattr("app.pipeline.GeminiService", FakeGemini)
    parsed = _queue_and_run(monkeypatch)
    document_id = parsed["documentId"]
    chunk = client.post(
        f"/documents/{document_id}/chunks",
        json={"strategy": "fixed_token", "config": {"chunkSizeTokens": 64, "overlapTokens": 8}},
    ).json()
    embedding = client.post(
        f"/documents/{document_id}/embeddings",
        json={"chunkRunId": chunk["id"]},
    )
    assert embedding.status_code == 200
    embedding_id = embedding.json()["id"]
    experiment = client.post(
        "/experiments",
        json={
            "documentId": document_id,
            "chunkRunId": chunk["id"],
            "embeddingRunId": embedding_id,
            "query": "retrieval",
            "targetStage": "generation",
            "retrieval": {"mode": "dense", "topK": 1},
            "reranking": {"enabled": True, "candidateCount": 1},
        },
    )
    assert experiment.status_code == 200
    generation = experiment.json()["stageResults"]["generation"]
    assert generation["citations"][0]["valid"] is True
    assert generation["effectiveModel"] == "gemini-2.5-flash-lite"

    dataset = client.post(
        "/evaluation/datasets",
        json={"documentId": document_id, "name": "basic", "cases": [{"question": "retrieval", "relevantElementIds": ["element-2"]}]},
    ).json()
    evaluation = client.post("/evaluation/runs", json={"datasetId": dataset["id"], "judge": True, "embeddingRunId": embedding_id, "retrieval": {"mode": "dense", "topK": 1}})
    assert evaluation.status_code == 200
    assert evaluation.json()["results"]["aggregate"]["groundedness"] == 0.9


def test_historical_completed_lineage_remains_usable_after_rechunk_and_reparse(monkeypatch):
    class FakeMetadata:
        configured_model = "gemini-flash-lite-latest"
        effective_model = "gemini-2.5-flash-lite"

    class FakeGemini:
        settings = type("Settings", (), {"gemini_generation_model": "gemini-flash-lite-latest", "gemini_max_retries": 0})()

        def __init__(self, *_args, **_kwargs):
            pass

        def embed_documents(self, texts):
            return [[1.0, 0.0, 0.0] for _ in texts], FakeMetadata()

        def embed_query(self, _query):
            return [1.0, 0.0, 0.0], FakeMetadata()

        def generate_json(self, _prompt, _config):
            return {
                "insufficientContext": False,
                "answer": "Retrieval finds chunks.",
                "claims": [{"text": "Retrieval finds chunks.", "citationIds": ["C1"]}],
            }, FakeMetadata()

    monkeypatch.setattr("app.pipeline.GeminiService", FakeGemini)
    parsed = _queue_and_run(monkeypatch)
    document_id = parsed["documentId"]
    parse_run_id = parsed["parseRunId"]

    first_chunk = client.post(
        f"/documents/{document_id}/chunks",
        json={"parseRunId": parse_run_id, "strategy": "fixed_token", "config": {"chunkSizeTokens": 64, "overlapTokens": 8}},
    ).json()
    second_chunk = client.post(
        f"/documents/{document_id}/chunks",
        json={"parseRunId": parse_run_id, "strategy": "structure_aware", "config": {"chunkSizeTokens": 64, "overlapTokens": 8}},
    ).json()

    detail = client.get(f"/documents/{document_id}").json()
    assert detail["activeChunkRunId"] == second_chunk["id"]
    first_summary = next(run for run in detail["chunkRuns"] if run["id"] == first_chunk["id"])
    assert first_summary["isCompatible"] is True
    assert first_summary["isStale"] is False
    assert first_summary["historicalLineage"] is True

    historical_embedding = client.post(
        f"/documents/{document_id}/embeddings",
        json={"chunkRunId": first_chunk["id"]},
    )
    assert historical_embedding.status_code == 200
    historical_embedding_id = historical_embedding.json()["id"]

    historical_experiment = client.post(
        "/experiments",
        json={
            "documentId": document_id,
            "chunkRunId": first_chunk["id"],
            "query": "retrieval",
            "targetStage": "retrieval",
            "retrieval": {"mode": "keyword", "topK": 1},
        },
    )
    assert historical_experiment.status_code == 200

    dataset = client.post(
        "/evaluation/datasets",
        json={"documentId": document_id, "parseRunId": parse_run_id, "name": "before-reparse", "cases": [{"question": "retrieval"}]},
    ).json()
    reparsed = client.post(f"/documents/{document_id}/parse")
    assert reparsed.status_code == 202
    assert reparsed.json()["parseRunId"] != parse_run_id
    run_parse_worker(reparsed.json()["parseRunId"])

    historical_chunk = client.post(
        f"/documents/{document_id}/chunks",
        json={"parseRunId": parse_run_id, "strategy": "fixed_token", "config": {"chunkSizeTokens": 64, "overlapTokens": 8}},
    )
    assert historical_chunk.status_code == 200

    historical_evaluation = client.post(
        "/evaluation/runs",
        json={
            "datasetId": dataset["id"],
            "chunkRunId": first_chunk["id"],
            "embeddingRunId": historical_embedding_id,
            "retrieval": {"mode": "keyword", "topK": 1},
        },
    )
    assert historical_evaluation.status_code == 200

    after_reparse = client.get(f"/documents/{document_id}").json()
    old_parse_summary = next(run for run in after_reparse["parseRuns"] if run["id"] == parse_run_id)
    assert old_parse_summary["isCompatible"] is True
    assert old_parse_summary["isStale"] is False


def test_same_user_sha256_identity_is_race_safe_and_cross_user_isolated():
    repository = InMemoryRepository()
    settings = Settings(app_env="development", docling_parser_version="test")

    def upload_once(_index):
        return queue_parse_upload(b"%PDF-1.7", "lesson.pdf", repository=repository, settings=settings)

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(upload_once, range(8)))
    assert len({item[0]["id"] for item in results}) == 1
    assert len({item[1]["id"] for item in results}) == 1
    assert len(repository.documents) == 1
    assert len(repository.parses) == 1

    owner_a = uuid.UUID("11111111-1111-4111-8111-111111111111")
    owner_b = uuid.UUID("22222222-2222-4222-8222-222222222222")
    first = repository.create_document(
        {"file_name": "a.pdf", "media_type": "application/pdf", "size_bytes": 1, "owner_user_id": owner_a},
        "rag-documents",
        "a.pdf",
        "same-sha",
    )
    second = repository.create_document(
        {"file_name": "b.pdf", "media_type": "application/pdf", "size_bytes": 1, "owner_user_id": owner_b},
        "rag-documents",
        "b.pdf",
        "same-sha",
    )
    assert first["id"] != second["id"]
    assert repository.get_document_by_sha256("same-sha", owner_user_id=owner_a)["id"] == first["id"]
    assert repository.get_document_by_sha256("same-sha", owner_user_id=owner_b)["id"] == second["id"]


def test_duplicate_failed_parse_creates_new_parse_on_same_document():
    repository = InMemoryRepository()
    settings = Settings(app_env="development", docling_parser_version="test")
    first_document, first_parse, _, first_dispatch = queue_parse_upload(
        b"%PDF-1.7", "lesson.pdf", repository=repository, settings=settings
    )
    assert first_dispatch is True
    repository.fail_parse(first_parse["id"], "docling_error", "failed")

    second_document, second_parse, reused_document, dispatch_required = queue_parse_upload(
        b"%PDF-1.7", "lesson.pdf", repository=repository, settings=settings
    )
    assert reused_document is True
    assert dispatch_required is True
    assert second_document["id"] == first_document["id"]
    assert second_parse["id"] != first_parse["id"]
