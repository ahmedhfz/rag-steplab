from fastapi.testclient import TestClient

from app.errors import ApiProblem
from app.main import app
from app.pipeline import run_parse_worker
from app.repository import reset_repository
from app.schemas import DocumentMetadata, ParseResponse, ParseSummary, ParsedPage, StructuredContent
from app.storage import reset_storage


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


def test_returns_normalized_parse_contract(monkeypatch):
    parsed = ParseResponse(
        document=DocumentMetadata(file_name="lesson.pdf", media_type="application/pdf", size_bytes=8, page_count=1),
        structured=StructuredContent(pages=[ParsedPage(page_number=1, elements=[])]),
        markdown="# Lesson",
        summary=ParseSummary(page_count=1, heading_count=1, paragraph_count=0, list_count=0, table_count=0),
    )

    def fake_parse(path, file_name, size_bytes):
        assert path.suffix == ".pdf"
        assert file_name == "lesson.pdf"
        assert size_bytes == 8
        return parsed

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
