from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.config import Settings
from app.pipeline import parse_upload, queue_parse_upload, run_parse_worker
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
