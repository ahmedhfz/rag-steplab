from fastapi.testclient import TestClient

from app.errors import ApiProblem
from app.main import app
from app.parser import parse_pdf_file
from app.schemas import DocumentMetadata, ParseResponse, ParseSummary, ParsedPage, StructuredContent


client = TestClient(app)


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

    monkeypatch.setattr("app.main.parse_pdf_file", fake_parse)
    response = client.post("/documents/parse", files={"file": ("lesson.pdf", b"%PDF-1.7", "application/pdf")})

    assert response.status_code == 200
    assert response.json()["document"]["fileName"] == "lesson.pdf"
    assert response.json()["structured"]["pages"][0]["pageNumber"] == 1
    assert response.json()["markdown"] == "# Lesson"


def test_returns_safe_error_when_docling_cannot_parse(monkeypatch):
    def failing_parse(*_args, **_kwargs):
        raise ApiProblem(422, "docling_error", "Docling could not parse this PDF.")

    monkeypatch.setattr("app.main.parse_pdf_file", failing_parse)
    response = client.post(
        "/documents/parse",
        files={"file": ("broken.pdf", b"%PDF-1.7\nnot a complete document", "application/pdf")},
    )

    assert response.status_code == 422
    assert response.json() == {
        "error": {
            "code": "docling_error",
            "message": "Docling could not parse this PDF.",
        }
    }
