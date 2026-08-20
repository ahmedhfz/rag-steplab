from __future__ import annotations

from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app.errors import ApiProblem
from app.main import app
from app.config import Settings
from app.modal_dispatch import parse_call_terminal_failure
from app.pipeline import run_parse_worker
from app.repository import InMemoryRepository, get_repository, reset_repository
from app.schemas import (
    DocumentMetadata,
    ParseResponse,
    ParseSummary,
    ParsedElement,
    ParsedPage,
    StructuredContent,
)
from app.storage import reset_storage


client = TestClient(app)


def setup_function():
    reset_repository()
    reset_storage()


def _parsed() -> ParseResponse:
    element = ParsedElement(
        id="element-1",
        type="paragraph",
        text="Persisted parser output.",
        page_numbers=[1],
    )
    return ParseResponse(
        document=DocumentMetadata(
            file_name="lesson.pdf",
            media_type="application/pdf",
            size_bytes=8,
            page_count=1,
        ),
        structured=StructuredContent(
            pages=[ParsedPage(page_number=1, elements=[element])],
            elements=[element],
        ),
        markdown="Persisted parser output.",
        summary=ParseSummary(
            page_count=1,
            heading_count=0,
            paragraph_count=1,
            list_count=0,
            table_count=0,
        ),
    )


def _document(repository: InMemoryRepository) -> dict:
    return repository.create_document(
        {
            "file_name": "lesson.pdf",
            "media_type": "application/pdf",
            "size_bytes": 8,
            "page_count": 0,
        },
        "rag-documents",
        "lesson.pdf",
        "digest",
    )


def test_repository_lifecycle_has_duplicate_guard_and_terminal_idempotency():
    repository = InMemoryRepository()
    document = _document(repository)
    queued = repository.create_parse_run(document["id"], parser_version="docling-2.117.0")

    assert queued["status"] == "queued"
    assert repository.get_document_row(document["id"])["active_parse_run_id"] is None
    with pytest.raises(ApiProblem) as duplicate:
        repository.create_parse_run(document["id"])
    assert duplicate.value.status_code == 409
    assert duplicate.value.code == "parse_already_in_progress"

    assert repository.mark_parse_running(queued["id"])["status"] == "running"
    completed = repository.complete_parse(
        queued["id"],
        _parsed(),
        parser_version="docling-2.117.0",
        execution_metadata={"worker": "modal"},
        duration_ms=12,
    )
    assert completed["status"] == "completed"
    assert repository.get_document_row(document["id"])["active_parse_run_id"] == queued["id"]
    assert completed["execution_metadata"]["worker"] == "modal"
    assert repository.fail_parse(queued["id"], "late_error", "must not overwrite") ["status"] == "completed"


def test_internal_interrupted_state_is_publicly_failed_with_parse_interrupted():
    repository = get_repository()
    document = _document(repository)
    queued = repository.create_parse_run(document["id"])
    repository.fail_parse(
        queued["id"],
        "worker_stopped",
        "The worker stopped before completion.",
        status="interrupted",
    )

    response = client.get(f"/parse-runs/{queued['id']}")

    assert response.status_code == 200
    assert response.json()["status"] == "failed"
    assert response.json()["error"]["code"] == "parse_interrupted"
    assert "structured" not in response.json()


def test_failed_reparse_preserves_existing_active_lineage():
    repository = InMemoryRepository()
    document = _document(repository)
    first = repository.create_parse_run(document["id"])
    repository.mark_parse_running(first["id"])
    repository.complete_parse(first["id"], _parsed())
    repository.documents[document["id"]]["active_chunk_run_id"] = "chunk-existing"
    repository.documents[document["id"]]["active_embedding_run_id"] = "embedding-existing"

    reparse = repository.create_parse_run(document["id"])
    repository.mark_parse_running(reparse["id"])
    repository.fail_parse(reparse["id"], "docling_error", "The full parser failed.")

    current = repository.get_document_row(document["id"])
    assert current["active_parse_run_id"] == first["id"]
    assert current["active_chunk_run_id"] == "chunk-existing"
    assert current["active_embedding_run_id"] == "embedding-existing"


def test_hard_modal_failure_is_reconciled_as_public_parse_interrupted(monkeypatch):
    repository = get_repository()
    document = _document(repository)
    queued = repository.create_parse_run(document["id"])
    repository.set_parse_dispatch(queued["id"], "fc-terminal")
    monkeypatch.setattr("app.main.get_settings", lambda: Settings(app_env="production"))
    monkeypatch.setattr("app.main.parse_call_terminal_failure", lambda _dispatch_id: True)

    response = client.get(f"/parse-runs/{queued['id']}")

    assert response.status_code == 200
    assert response.json()["status"] == "failed"
    assert response.json()["error"]["code"] == "parse_interrupted"
    assert repository.get_parse_row(queued["id"])["status"] == "interrupted"


def test_modal_poll_timeout_is_not_a_terminal_failure(monkeypatch):
    class PendingCall:
        def get(self, *, timeout):
            assert timeout == 0
            raise TimeoutError

    class FunctionCall:
        @staticmethod
        def from_id(_dispatch_id):
            return PendingCall()

    import modal

    monkeypatch.setattr(modal, "FunctionCall", FunctionCall)
    assert parse_call_terminal_failure("fc-pending") is False


def test_modal_dispatch_failure_is_durable_and_never_runs_local_parser(monkeypatch):
    def fail_dispatch(*_args, **_kwargs):
        from app.modal_dispatch import ModalDispatchError

        raise ModalDispatchError("offline")

    def fail_local_parser(*_args, **_kwargs):
        raise AssertionError("API must not run a local parser fallback")

    monkeypatch.setattr("app.main.dispatch_parse_run", fail_dispatch)
    monkeypatch.setattr("app.parser.parse_pdf_file", fail_local_parser)

    accepted = client.post(
        "/documents/parse",
        files={"file": ("lesson.pdf", b"%PDF-1.7", "application/pdf")},
    )

    assert accepted.status_code == 202
    payload = accepted.json()
    assert payload["status"] == "failed"
    assert payload["error"]["code"] == "modal_dispatch_failed"
    assert client.get(f"/parse-runs/{payload['parseRunId']}").json()["status"] == "failed"


def test_worker_persists_measurement_and_cleans_temporary_pdf(monkeypatch):
    monkeypatch.setattr("app.main.dispatch_parse_run", lambda *_args: "dispatch-test")
    monkeypatch.setattr("app.parser.parse_pdf_file", lambda path, *_args: (_assert_pdf_exists(path), _parsed())[1])

    accepted = client.post(
        "/documents/parse",
        files={"file": ("lesson.pdf", b"%PDF-1.7", "application/pdf")},
    )
    parse_run_id = accepted.json()["parseRunId"]
    result = run_parse_worker(parse_run_id)

    assert result is not None
    assert result["status"] == "completed"
    assert result["execution_metadata"]["worker"] == "modal"
    measurement = result["execution_metadata"]["measurement"]
    assert {"elapsedMs", "peakRssMb", "cpuUserMs", "cpuSystemMs"} <= measurement.keys()


def test_worker_marks_missing_semantic_tables_as_failed(monkeypatch):
    monkeypatch.setattr("app.main.dispatch_parse_run", lambda *_args: "dispatch-test")

    def reject_without_tables(*_args):
        raise ApiProblem(422, "docling_tables_missing", "Docling produced no semantic tables.")

    monkeypatch.setattr("app.parser.parse_pdf_file", reject_without_tables)
    accepted = client.post(
        "/documents/parse",
        files={"file": ("lesson.pdf", b"%PDF-1.7", "application/pdf")},
    )
    parse_run_id = accepted.json()["parseRunId"]

    result = run_parse_worker(parse_run_id)
    public = client.get(f"/parse-runs/{parse_run_id}").json()

    assert result is not None
    assert result["status"] == "failed"
    assert result["error_code"] == "docling_tables_missing"
    assert public["status"] == "failed"
    assert public["error"]["code"] == "docling_tables_missing"


def _assert_pdf_exists(path: Path) -> None:
    assert path.exists()
    assert path.suffix == ".pdf"
