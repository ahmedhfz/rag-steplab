from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.errors import ApiProblem
from app.config import Settings
from app.main import app
from app.pipeline import run_parse_worker
from app.repository import reset_repository
from app.schemas import DocumentMetadata, ParseResponse, ParseSummary, ParsedPage, StructuredContent
from app.storage import get_storage, reset_storage


client = TestClient(app)


def setup_function():
    reset_repository()
    reset_storage()


def test_rejects_non_pdf_upload():
    response = client.post("/documents/parse", files={"file": ("notes.txt", b"plain text", "text/plain")})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_file_type"


def test_rejects_empty_pdf_upload():
    response = client.post("/documents/parse", files={"file": ("empty.pdf", b"", "application/pdf")})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "empty_file"


def test_upload_only_persists_document_without_parse_and_reuses_same_owner_sha():
    first = client.post("/documents", files={"file": ("lesson.pdf", b"%PDF-1.7", "application/pdf")})

    assert first.status_code == 201
    first_payload = first.json()
    assert first_payload["reusedDocument"] is False
    assert first_payload["document"]["fileName"] == "lesson.pdf"
    assert first_payload["document"]["activeParseRunId"] is None

    listed = client.get("/documents")
    assert listed.status_code == 200
    assert len(listed.json()["items"]) == 1

    duplicate = client.post("/documents", files={"file": ("renamed.pdf", b"%PDF-1.7", "application/pdf")})
    assert duplicate.status_code == 200
    assert duplicate.json()["reusedDocument"] is True
    assert duplicate.json()["document"]["id"] == first_payload["document"]["id"]

    summary = client.get(f"/documents/{first_payload['document']['id']}/summary")
    assert summary.status_code == 200
    assert summary.json()["parseRuns"] == []


def test_private_source_preview_uses_authenticated_proxy_without_storage_metadata():
    uploaded = client.post("/documents", files={"file": ("lesson.pdf", b"%PDF-1.7", "application/pdf")})
    assert uploaded.status_code == 201
    document_id = uploaded.json()["document"]["id"]

    descriptor = client.get(f"/documents/{document_id}/source-url")
    assert descriptor.status_code == 200
    assert descriptor.json() == {
        "sourceUrl": f"/documents/{document_id}/source",
        "expiresIn": 60,
        "mode": "proxy",
    }
    source = client.get(descriptor.json()["sourceUrl"])
    assert source.status_code == 200
    assert source.headers["cache-control"] == "private, no-store"
    assert source.content == b"%PDF-1.7"


def test_delete_document_removes_owned_lineage_and_private_source():
    uploaded = client.post("/documents", files={"file": ("e2e-cleanup.pdf", b"%PDF-1.7", "application/pdf")})
    document_id = uploaded.json()["document"]["id"]
    storage_path = next(iter(get_storage().objects))

    deleted = client.delete(f"/documents/{document_id}")

    assert deleted.status_code == 204
    assert client.get(f"/documents/{document_id}").status_code == 404
    assert client.get("/documents").json()["items"] == []
    assert storage_path not in get_storage().objects


def test_explicit_parse_after_upload_creates_one_parse_run(monkeypatch):
    monkeypatch.setattr("app.main._dispatch_queued_parse", lambda parse: parse)

    uploaded = client.post("/documents", files={"file": ("lesson.pdf", b"%PDF-1.7", "application/pdf")})
    assert uploaded.status_code == 201
    document_id = uploaded.json()["document"]["id"]

    parsed = client.post(f"/documents/{document_id}/parse")

    assert parsed.status_code == 202
    payload = parsed.json()
    assert payload["documentId"] == document_id
    assert payload["parseRunId"]
    summary = client.get(f"/documents/{document_id}/summary")
    assert summary.status_code == 200
    assert [run["id"] for run in summary.json()["parseRuns"]] == [payload["parseRunId"]]


def test_returns_normalized_parse_contract(monkeypatch):
    parsed = ParseResponse(
        document=DocumentMetadata(file_name="lesson.pdf", media_type="application/pdf", size_bytes=8, page_count=1),
        structured=StructuredContent(pages=[ParsedPage(page_number=1, elements=[])]),
        markdown="# Lesson",
        summary=ParseSummary(page_count=1, heading_count=1, paragraph_count=0, list_count=0, table_count=0),
    )

    def fake_parse(path, file_name, size_bytes, **_kwargs):
        assert path.suffix == ".pdf"
        assert file_name == "lesson.pdf"
        assert size_bytes == 8
        return parsed

    monkeypatch.setattr("app.main.get_settings", lambda: Settings(app_env="development", local_parse_worker_enabled=False))
    monkeypatch.setattr("app.main.dispatch_parse_run", lambda *_args: "dispatch-test")
    monkeypatch.setattr("app.parser.parse_pdf_file", fake_parse)
    response = client.post("/documents/parse", files={"file": ("lesson.pdf", b"%PDF-1.7", "application/pdf")})

    assert response.status_code == 202
    queued = response.json()
    assert queued["status"] == "queued"
    assert queued["document"]["fileName"] == "lesson.pdf"
    assert queued["parseRunId"]

    run_parse_worker(queued["parseRunId"])
    completed = client.get(f"/parse-runs/{queued['parseRunId']}")
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"
    assert completed.json()["structured"]["pages"][0]["pageNumber"] == 1
    assert completed.json()["markdown"] == "# Lesson"


def test_returns_safe_error_when_docling_cannot_parse(monkeypatch):
    def failing_parse(*_args, **_kwargs):
        raise ApiProblem(422, "docling_error", "Docling could not parse this PDF.")

    monkeypatch.setattr("app.main.get_settings", lambda: Settings(app_env="development", local_parse_worker_enabled=False))
    monkeypatch.setattr("app.main.dispatch_parse_run", lambda *_args: "dispatch-test")
    monkeypatch.setattr("app.parser.parse_pdf_file", failing_parse)
    response = client.post(
        "/documents/parse",
        files={"file": ("broken.pdf", b"%PDF-1.7\nnot a complete document", "application/pdf")},
    )

    assert response.status_code == 202
    parse_run_id = response.json()["parseRunId"]
    run_parse_worker(parse_run_id)
    failed = client.get(f"/parse-runs/{parse_run_id}")
    assert failed.status_code == 200
    assert failed.json()["status"] == "failed"
    assert failed.json()["error"] == {
        "code": "docling_error",
        "message": "Docling could not parse this PDF.",
    }


def test_async_experiment_queues_json_serializable_lifecycle(monkeypatch):
    import importlib

    main_module = importlib.import_module("app.main")
    started_at = datetime(2026, 8, 23, 20, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(
        "app.main.queue_experiment",
        lambda *_args, **_kwargs: {
            "id": "experiment-1",
            "document_id": "document-1",
            "chunk_run_id": "chunk-1",
            "embedding_run_id": "embedding-1",
            "query": "retrieval",
            "target_stage": "retrieval",
            "status": "running",
            "stage_results": {},
            "started_at": started_at,
            "completed_at": None,
            "duration_ms": None,
        },
    )
    monkeypatch.setattr(
        "app.main._run_queued_experiment_and_release",
        lambda *_args: main_module._pipeline_semaphore.release(),
    )

    response = client.post(
        "/experiments?async=true",
        json={
            "documentId": "document-1",
            "chunkRunId": "chunk-1",
            "embeddingRunId": "embedding-1",
            "query": "retrieval",
            "targetStage": "retrieval",
            "retrieval": {"mode": "dense", "topK": 3},
        },
    )

    assert response.status_code == 202
    assert response.json()["startedAt"] == "2026-08-23T20:00:00+00:00"


def test_async_evaluation_returns_real_queued_case_lifecycle(monkeypatch):
    import importlib

    main_module = importlib.import_module("app.main")
    monkeypatch.setattr(
        "app.main.queue_evaluation",
        lambda *_args, **_kwargs: {
            "id": "evaluation-1",
            "dataset_id": "dataset-1",
            "config": {},
            "child_experiment_ids": [],
            "results": {"aggregate": {"caseCount": 0}, "caseResults": []},
            "status": "queued",
            "started_at": None,
            "completed_at": None,
            "duration_ms": None,
        },
    )
    monkeypatch.setattr(
        "app.main._run_queued_evaluation_and_release",
        lambda *_args: main_module._pipeline_semaphore.release(),
    )

    response = client.post(
        "/evaluation/runs?async=true",
        json={
            "datasetId": "dataset-1",
            "chunkRunId": "chunk-1",
            "retrieval": {"mode": "keyword", "topK": 3},
        },
    )

    assert response.status_code == 202
    assert response.json()["status"] == "queued"
    assert response.json()["results"]["caseResults"] == []
