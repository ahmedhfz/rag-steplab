import uuid
from contextlib import contextmanager
from types import SimpleNamespace

from fastapi.testclient import TestClient
import pytest
from sqlalchemy.dialects import postgresql

from app.auth import CurrentUser, get_current_user
from app.config import get_settings
from app.gemini import EMBEDDING_FORMAT_VERSION
from app.main import app
from app.errors import ApiProblem
from app.repository import InMemoryRepository, SqlAlchemyRepository, get_repository, reset_repository
from app.schemas import DocumentMetadata, ParseResponse, ParseSummary, ParsedPage, StructuredContent


client = TestClient(app)
OWNER_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")


def setup_function():
    reset_repository()


def _parsed(name: str = "pipeline.pdf") -> ParseResponse:
    return ParseResponse(
        document=DocumentMetadata(file_name=name, media_type="application/pdf", size_bytes=32, page_count=1),
        structured=StructuredContent(pages=[ParsedPage(page_number=1, elements=[])]),
        markdown="# Pipeline",
        summary=ParseSummary(page_count=1, heading_count=0, paragraph_count=0, list_count=0, table_count=0),
    )


def _lineage(repository: InMemoryRepository):
    document = repository.create_document(
        {"file_name": "pipeline.pdf", "media_type": "application/pdf", "size_bytes": 32, "page_count": 1, "owner_user_id": OWNER_ID},
        "documents",
        "pipeline.pdf",
        "sha-pipeline",
    )
    historical_parse = repository.save_parse(document["id"], _parsed())
    active_parse = repository.save_parse(document["id"], _parsed())
    assert historical_parse and active_parse
    settings = get_settings()
    repository.chunk_runs["chunk-historical"] = {
        "id": "chunk-historical", "document_id": document["id"], "parse_run_id": historical_parse["id"],
        "status": "completed", "strategy": "fixed_token", "config": {}, "chunk_count": 0,
    }
    repository.embedding_runs["embedding-historical"] = {
        "id": "embedding-historical", "document_id": document["id"], "chunk_run_id": "chunk-historical",
        "status": "completed", "model": settings.gemini_embedding_model,
        "dimensions": settings.gemini_embedding_dimensions,
        "embedding_format_version": EMBEDDING_FORMAT_VERSION, "embedding_count": 0,
    }
    return document, historical_parse, active_parse


def test_pipeline_crud_keeps_compatible_historical_lineage_and_revisions():
    repository = get_repository()
    assert isinstance(repository, InMemoryRepository)
    document, historical_parse, active_parse = _lineage(repository)

    created = client.post(f"/documents/{document['id']}/pipelines", json={
        "name": "  Historical  ",
        "parseRunId": historical_parse["id"],
        "chunkRunId": "chunk-historical",
        "embeddingRunId": "embedding-historical",
    })
    assert created.status_code == 201
    pipeline = created.json()
    assert pipeline["name"] == "Historical"
    assert pipeline["parseRunId"] == historical_parse["id"]
    assert pipeline["parseRunId"] != active_parse["id"]
    assert pipeline["revision"] == 1

    listed = client.get(f"/documents/{document['id']}/pipelines")
    assert listed.status_code == 200
    assert [row["id"] for row in listed.json()] == [pipeline["id"]]

    updated = client.patch(f"/document-pipelines/{pipeline['id']}", json={
        "expectedRevision": 1,
        "parseRunId": active_parse["id"],
    })
    assert updated.status_code == 200
    assert updated.json()["revision"] == 2
    assert updated.json()["chunkRunId"] is None
    assert updated.json()["embeddingRunId"] is None

    conflict = client.patch(f"/document-pipelines/{pipeline['id']}", json={
        "expectedRevision": 1,
        "name": "Stale writer",
    })
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "pipeline_conflict"

    assert client.delete(f"/document-pipelines/{pipeline['id']}").status_code == 204
    assert client.get(f"/documents/{document['id']}/pipelines").json() == []


def test_pipeline_name_is_case_insensitively_unique_per_document():
    repository = get_repository()
    assert isinstance(repository, InMemoryRepository)
    document, _, _ = _lineage(repository)
    assert client.post(f"/documents/{document['id']}/pipelines", json={"name": "Baseline"}).status_code == 201
    duplicate = client.post(f"/documents/{document['id']}/pipelines", json={"name": " baseline "})
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "pipeline_name_conflict"


def test_pipeline_owner_boundary_hides_other_users_rows():
    repository = get_repository()
    assert isinstance(repository, InMemoryRepository)
    document, _, _ = _lineage(repository)
    created = client.post(f"/documents/{document['id']}/pipelines", json={"name": "Private"}).json()

    other = CurrentUser(id=uuid.UUID("22222222-2222-4222-8222-222222222222"), role="authenticated")
    app.dependency_overrides[get_current_user] = lambda: other
    try:
        assert client.get(f"/documents/{document['id']}/pipelines").status_code == 404
        assert client.patch(f"/document-pipelines/{created['id']}", json={"expectedRevision": 1, "name": "Nope"}).status_code == 404
        assert client.delete(f"/document-pipelines/{created['id']}").status_code == 404
    finally:
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(id=OWNER_ID, role="authenticated")


def test_sql_repository_revision_update_is_atomic(monkeypatch):
    class EmptyResult:
        def first(self):
            return None

    class Session:
        statement = None

        def scalars(self, statement):
            self.statement = statement
            return EmptyResult()

        def get(self, _model, _identifier):
            return SimpleNamespace(id="pipeline-1")

    session = Session()

    @contextmanager
    def fake_scope():
        yield session

    monkeypatch.setattr("app.repository.session_scope", fake_scope)
    with pytest.raises(ApiProblem) as raised:
        SqlAlchemyRepository().update_document_pipeline("pipeline-1", 4, {"name": "Updated"})

    assert raised.value.code == "pipeline_conflict"
    sql = str(session.statement.compile(dialect=postgresql.dialect()))
    assert "document_pipelines.id =" in sql
    assert "document_pipelines.revision =" in sql
