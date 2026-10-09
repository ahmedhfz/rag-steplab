"""Upload hardening (SEC-02/03/04, D7) and the workspace projection."""

from __future__ import annotations

import gzip
import io
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.config import Settings
from app.main import _pdf_signature_ok, app
from app.repository import reset_repository
from app.storage import get_storage, reset_storage
from tests.test_pipeline import _queue_and_run

client = TestClient(app)


def setup_function():
    reset_repository()
    reset_storage()


@pytest.mark.parametrize(
    ("content", "accepted"),
    [
        (b"%PDF-1.7\n...", True),
        (b"\xef\xbb\xbf%PDF-1.4", True),
        (b"\r\n%PDF-1.4", True),
        (b"junkjunk%PDF-1.4", False),
        (b" " * 9 + b"%PDF-1.4", False),
        (b"x" * 200 + b"%PDF-1.7", False),
        (gzip.compress(b"%PDF-1.7 inside a gzip member"), False),
        (b"\x1f\x8b\x08\x08%PDF-1.7", False),
    ],
)
def test_pdf_signature_must_be_at_the_start(content, accepted):
    assert _pdf_signature_ok(content) is accepted


def test_zip_and_gzip_polyglots_are_rejected_on_upload():
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as handle:
        handle.writestr("x.pdf", "%PDF-1.7")
    for payload in (archive.getvalue(), gzip.compress(b"%PDF-1.7"), b"PK\x03\x04%PDF-"):
        response = client.post("/documents", files={"file": ("x.pdf", payload, "application/pdf")})
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "invalid_file_type"
    assert get_storage().objects == {}


def test_overlong_file_name_is_a_422_not_a_500():
    response = client.post("/documents", files={"file": ("a" * 300 + ".pdf", b"%PDF-1.7", "application/pdf")})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "file_name_too_long"


def test_unauthenticated_upload_is_rejected_before_the_body_is_read():
    import asyncio

    from app.errors import ApiProblem
    from app.upload_guard import UploadGuardMiddleware

    received, sent = [], []

    async def downstream(_scope, _receive, _send):
        raise AssertionError("the route must not run")

    def authenticate(_authorization):
        raise ApiProblem(401, "authentication_required", "Authentication is required.", headers={"WWW-Authenticate": "Bearer"})

    async def receive():
        received.append(True)
        return {"type": "http.request", "body": b"x" * 1024, "more_body": True}

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "method": "POST", "path": "/documents", "headers": [(b"content-length", b"4096")]}
    asyncio.run(UploadGuardMiddleware(downstream, authenticate)(scope, receive, send))

    assert received == []
    assert sent[0]["status"] == 401
    assert (b"www-authenticate", b"Bearer") in sent[0]["headers"]

    app.dependency_overrides.pop(get_current_user, None)
    response = client.post("/documents", files={"file": ("x.pdf", b"%PDF-1.7", "application/pdf")})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_required"


def test_declared_oversized_upload_is_413_before_auth_or_parsing(monkeypatch):
    monkeypatch.setattr("app.upload_guard.get_settings", lambda: Settings(max_file_size_bytes=1024))
    app.dependency_overrides.pop(get_current_user, None)
    response = client.post(
        "/documents",
        content=b"x" * 10,
        headers={"Content-Length": str(5 * 1024 * 1024), "Content-Type": "multipart/form-data; boundary=x"},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "file_too_large"


def test_streamed_body_over_the_limit_is_413(monkeypatch):
    monkeypatch.setattr("app.upload_guard.get_settings", lambda: Settings(max_file_size_bytes=1024))
    monkeypatch.setattr("app.upload_guard.MULTIPART_OVERHEAD_BYTES", 0)

    def chunks():
        for _ in range(64):
            yield b"0" * 1024

    response = client.post(
        "/documents",
        content=chunks(),
        headers={"Content-Type": "multipart/form-data; boundary=x"},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "file_too_large"


def test_per_user_document_and_storage_quotas(monkeypatch):
    monkeypatch.setattr("app.pipeline.get_settings", lambda: Settings(max_documents_per_user=1, max_storage_bytes_per_user=10_000))
    first = client.post("/documents", files={"file": ("a.pdf", b"%PDF-1.7 a", "application/pdf")})
    assert first.status_code == 201
    # Re-uploading the same bytes reuses the document and does not count.
    assert client.post("/documents", files={"file": ("a.pdf", b"%PDF-1.7 a", "application/pdf")}).status_code == 200
    second = client.post("/documents", files={"file": ("b.pdf", b"%PDF-1.7 b", "application/pdf")})
    assert second.status_code == 403
    assert second.json()["error"]["code"] == "document_quota_exceeded"

    monkeypatch.setattr("app.pipeline.get_settings", lambda: Settings(max_documents_per_user=0, max_storage_bytes_per_user=12))
    big = client.post("/documents", files={"file": ("c.pdf", b"%PDF-1.7 ccccc", "application/pdf")})
    assert big.status_code == 403
    assert big.json()["error"]["code"] == "storage_quota_exceeded"


def test_workspace_returns_summary_pipelines_and_in_use_parse_in_one_call(monkeypatch):
    parsed = _queue_and_run(monkeypatch)
    workspace = client.get(f"/documents/{parsed['documentId']}/workspace")
    assert workspace.status_code == 200
    body = workspace.json()
    assert body["activeLineage"]["parseRunId"] == parsed["parseRunId"]
    assert body["pipelines"] and body["parseRuns"]
    assert body["inUseParseRun"]["parseRunId"] == parsed["parseRunId"]
    assert body["inUseParseRun"]["structured"]["elements"]


def test_evaluation_run_listing_carries_lineage_without_dataset_reads(monkeypatch):
    from app.repository import get_repository

    parsed = _queue_and_run(monkeypatch)
    dataset = client.post(
        "/evaluation/datasets",
        json={"documentId": parsed["documentId"], "parseRunId": parsed["parseRunId"], "name": "d", "cases": [{"question": "q"}]},
    ).json()
    repository = get_repository()
    repository.save_evaluation({"dataset_id": dataset["id"], "status": "completed", "config": {"chunk_run_id": "c-1"}})

    def no_dataset_reads(*_args, **_kwargs):
        raise AssertionError("listing must not load datasets per row")

    monkeypatch.setattr(repository, "get_dataset_row", no_dataset_reads)
    items = client.get(f"/evaluation/runs?datasetId={dataset['id']}").json()["items"]
    assert items[0]["parseRunId"] == parsed["parseRunId"]
    assert items[0]["chunkRunId"] == "c-1"
