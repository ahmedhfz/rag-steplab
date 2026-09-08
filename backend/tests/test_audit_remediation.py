from contextlib import contextmanager
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session

from app.auth import CurrentUser
from app.config import Settings
from app.main import app, list_documents
from app.models import Document
from app.repository import ScopedRepository, SqlAlchemyRepository


@pytest.mark.parametrize("method,path", [
    ("DELETE", "/documents/document-1"),
    ("POST", "/documents/document-1/pipelines"),
    ("PATCH", "/document-pipelines/pipeline-1"),
    ("DELETE", "/document-pipelines/pipeline-1"),
    ("POST", "/experiments"),
    ("POST", "/evaluation/runs"),
])
def test_maintenance_blocks_mutations_before_repository_access(monkeypatch, method, path):
    monkeypatch.setattr("app.main.get_settings", lambda: Settings(write_enabled=False))
    def forbidden(*args, **kwargs):
        raise AssertionError("Mutation reached repository")
    monkeypatch.setattr("app.main._user_repository", forbidden)
    response = TestClient(app).request(method, path, json={})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "writes_disabled"


@pytest.mark.parametrize("count", [1, 10, 100])
def test_document_list_has_bounded_real_sql_queries(monkeypatch, count):
    owner = uuid.UUID("aaaaaaaa-1111-4111-8111-111111111111")
    stranger = uuid.UUID("bbbbbbbb-2222-4222-8222-222222222222")
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("ATTACH DATABASE ':memory:' AS rag_lab"))
        Document.__table__.create(connection)
        # Intentionally omit heavy body columns: the production query must not read them.
        connection.execute(text("CREATE TABLE rag_lab.parse_runs (id TEXT, document_id TEXT, status TEXT, error_code TEXT, error_message TEXT, created_at DATETIME)"))
        for i in range(count + 2):
            connection.execute(Document.__table__.insert().values(
                id=f"doc-{i}", file_name=f"doc-{i}.pdf", media_type="application/pdf",
                size_bytes=1, sha256=str(i), owner_user_id=stranger if i == count + 1 else owner,
                storage_bucket="documents", storage_path=f"doc-{i}.pdf",
            ))
            if i == count:
                continue  # Owned document without any parse.
            for suffix, status in [("a", "completed"), ("z", "interrupted")]:
                connection.execute(text("INSERT INTO rag_lab.parse_runs VALUES (:id, :document, :status, 'expired', 'Lease expired', '2026-01-01 00:00:00')"),
                                   {"id": f"parse-{i}-{suffix}", "document": f"doc-{i}", "status": status})

    statements = []
    event.listen(engine, "before_cursor_execute", lambda conn, cursor, statement, parameters, context, many: statements.append(statement))
    @contextmanager
    def scope():
        with Session(engine) as session:
            yield session
    monkeypatch.setattr("app.repository.session_scope", scope)
    monkeypatch.setattr("app.main._user_repository", lambda user: ScopedRepository(SqlAlchemyRepository(), user.id))
    result = list_documents(CurrentUser(id=owner, role="authenticated"))
    assert len(result["items"]) == count + 1
    assert len(statements) == 2
    assert all("markdown" not in sql and "structured" not in sql for sql in statements)
    parsed = next(row for row in result["items"] if row["id"] == "doc-0")
    assert parsed["latestParseStatus"] == "failed"
    assert parsed["latestParseError"]["code"] == "expired"
    assert not any(row["id"] == f"doc-{count + 1}" for row in result["items"])
    engine.dispose()
