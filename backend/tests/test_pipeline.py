from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.pipeline import parse_upload, run_parse_worker
from app.repository import InMemoryRepository, reset_repository
from app.schemas import (
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
    monkeypatch.setattr("app.main.dispatch_parse_run", lambda *_args: "dispatch-test")
    monkeypatch.setattr("app.parser.parse_pdf_file", lambda *_args: _parsed())
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


def test_all_nine_database_tables_are_declared():
    from app.models import Base

    assert len(Base.metadata.tables) == 9
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


def test_rechunk_and_reparse_reject_stale_downstream_lineage(monkeypatch):
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
    assert next(run for run in detail["chunkRuns"] if run["id"] == first_chunk["id"])["isStale"] is True

    stale_embedding = client.post(
        f"/documents/{document_id}/embeddings",
        json={"chunkRunId": first_chunk["id"]},
    )
    assert stale_embedding.status_code == 409
    assert stale_embedding.json()["error"]["code"] == "stale_lineage"

    stale_experiment = client.post(
        "/experiments",
        json={
            "documentId": document_id,
            "chunkRunId": first_chunk["id"],
            "query": "retrieval",
            "targetStage": "retrieval",
            "retrieval": {"mode": "keyword", "topK": 1},
        },
    )
    assert stale_experiment.status_code == 409
    assert stale_experiment.json()["error"]["code"] == "stale_lineage"

    dataset = client.post(
        "/evaluation/datasets",
        json={"documentId": document_id, "parseRunId": parse_run_id, "name": "before-reparse", "cases": [{"question": "retrieval"}]},
    ).json()
    reparsed = client.post(f"/documents/{document_id}/parse")
    assert reparsed.status_code == 202
    assert reparsed.json()["parseRunId"] != parse_run_id
    run_parse_worker(reparsed.json()["parseRunId"])

    stale_chunk = client.post(
        f"/documents/{document_id}/chunks",
        json={"parseRunId": parse_run_id, "strategy": "fixed_token", "config": {"chunkSizeTokens": 64, "overlapTokens": 8}},
    )
    assert stale_chunk.status_code == 409
    assert stale_chunk.json()["error"]["code"] == "stale_lineage"

    stale_evaluation = client.post("/evaluation/runs", json={"datasetId": dataset["id"]})
    assert stale_evaluation.status_code == 409
    assert stale_evaluation.json()["error"]["code"] == "stale_lineage"
