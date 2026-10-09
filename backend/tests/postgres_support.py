"""Shared fixtures for tests that run against the migrated local Supabase DB.

``RAG_TEST_DATABASE_URL`` must be an admin URL of a database built only from
``supabase/migrations`` (``supabase db reset --local --no-seed``). Tests then
connect as the least-privilege runtime role ``rag_steplab_app`` so grants are
exercised too. Every test truncates ``rag_lab``; never point this at a shared
or hosted database.
"""

from __future__ import annotations

import os
import secrets
import uuid
from typing import Any

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.chunking import TOKENIZER_VERSION, chunk_structured, chunker_version_for_strategy, config_hash, effective_config
from app.config import clear_settings_cache
from app.db import dispose_engine
from app.repository import SqlAlchemyRepository, reset_repository

ADMIN_URL = os.getenv("RAG_TEST_DATABASE_URL")
OWNER_A = uuid.UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
OWNER_B = uuid.UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}

requires_postgres = [
    pytest.mark.postgres,
    pytest.mark.skipif(not ADMIN_URL, reason="RAG_TEST_DATABASE_URL is not set"),
]


def _admin_engine():
    url = make_url(ADMIN_URL.replace("postgresql://", "postgresql+psycopg://", 1))
    if url.host not in LOCAL_HOSTS:
        raise RuntimeError("Postgres repository tests only run against a local database.")
    return create_engine(url, future=True)


@pytest.fixture(scope="session")
def admin_engine():
    engine = _admin_engine()
    yield engine
    engine.dispose()


@pytest.fixture(scope="session")
def app_database_url(admin_engine) -> str:
    password = secrets.token_hex(16)
    with admin_engine.begin() as connection:
        # ALTER ROLE cannot take bind parameters; the value is a local hex token.
        connection.execute(text(f"alter role rag_steplab_app password '{password}'"))
        for owner in (OWNER_A, OWNER_B):
            connection.execute(
                text(
                    "insert into auth.users (id, aud, role, email) "
                    "values (:id, 'authenticated', 'authenticated', :email) on conflict (id) do nothing"
                ),
                {"id": owner, "email": f"{owner}@example.test"},
            )
    url = make_url(ADMIN_URL).set(username="rag_steplab_app", password=password)
    return url.render_as_string(hide_password=False)


@pytest.fixture
def pg(monkeypatch, admin_engine, app_database_url) -> SqlAlchemyRepository:
    with admin_engine.begin() as connection:
        connection.execute(text("truncate rag_lab.documents, rag_lab.storage_cleanups cascade"))
    monkeypatch.setenv("DATABASE_URL", app_database_url)
    monkeypatch.setenv("APP_ENV", "development")
    clear_settings_cache()
    dispose_engine()
    reset_repository()
    yield SqlAlchemyRepository()
    dispose_engine()
    clear_settings_cache()
    reset_repository()


def admin_scalar(admin_engine, sql: str, **params: Any) -> Any:
    with admin_engine.begin() as connection:
        return connection.execute(text(sql), params).scalar()


def admin_execute(admin_engine, sql: str, **params: Any) -> None:
    with admin_engine.begin() as connection:
        connection.execute(text(sql), params)


def new_document(repository: SqlAlchemyRepository, owner: uuid.UUID = OWNER_A, name: str = "lesson.pdf") -> dict[str, Any]:
    digest = secrets.token_hex(32)
    return repository.scoped(owner).create_document(
        {"file_name": name, "media_type": "application/pdf", "size_bytes": 8, "page_count": 0},
        "rag-documents",
        f"{uuid.uuid4()}/{digest}.pdf",
        digest,
    )


def completed_parse(repository: SqlAlchemyRepository, document_id: str) -> dict[str, Any]:
    from tests.test_pipeline import _parsed

    parse = repository.create_parse_run(document_id, parser_version="test")
    repository.mark_parse_running(parse["id"])
    return repository.complete_parse(parse["id"], _parsed(), parser_version="test")


def claim_chunk(repository, document_id: str, parse_id: str, strategy: str = "fixed_token", size: int = 64):
    config = effective_config({"chunk_size_tokens": size, "overlap_tokens": 8})
    return repository.claim_chunk_run(
        document_id, parse_id, strategy, config, config_hash(config), TOKENIZER_VERSION,
        chunker_version_for_strategy(strategy),
    ), config


def completed_chunk(repository, document_id: str, parse_id: str, strategy: str = "fixed_token", size: int = 64):
    (claim, claimed), config = claim_chunk(repository, document_id, parse_id, strategy, size)
    assert claimed
    parse = repository.get_parse_row(parse_id)
    drafts = chunk_structured(parse["structured"], strategy, config)
    return repository.complete_chunk_run(claim["id"], drafts, claim["lease_token"])


def completed_embedding(repository, document_id: str, chunk_run_id: str, dimensions: int = 768):
    claim, claimed = repository.claim_embedding_run(document_id, chunk_run_id, "gemini-embedding-2", dimensions, "format-v1")
    assert claimed
    chunks = repository.get_chunks_for_embedding(chunk_run_id)
    vector = [1.0] + [0.0] * (dimensions - 1)
    return repository.complete_embedding_run(
        claim["id"], [(chunk["id"], vector) for chunk in chunks], None, "gemini-embedding-2", claim["lease_token"]
    )
