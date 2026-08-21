"""SQLAlchemy 2 models for the nine persisted RAG StepLab tables."""

from __future__ import annotations

from datetime import datetime
import uuid
from typing import Any

from sqlalchemy import Boolean, CheckConstraint, Computed, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import JSON

try:  # pgvector is available in production; keeping import optional helps unit tests.
    from pgvector.sqlalchemy import Vector
except ImportError:  # pragma: no cover - exercised only before dependency install
    Vector = None  # type: ignore[assignment,misc]


SCHEMA = "rag_lab"


class Base(DeclarativeBase):
    pass


def _schema_args(*indexes: str) -> dict[str, Any]:
    return {"schema": SCHEMA}


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        CheckConstraint("size_bytes >= 0", name="ck_documents_size_nonnegative"),
        CheckConstraint("page_count >= 0", name="ck_documents_page_nonnegative"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    file_name: Mapped[str] = mapped_column(String(512), nullable=False)
    media_type: Mapped[str] = mapped_column(String(128), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    page_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        # Supabase auth.users SQLAlchemy metadata'sında tanımlı değil; gerçek FK
        # Supabase migration'ında korunuyor, burada yalnızca UUID kolonu eşleniyor.
        UUID(as_uuid=True), nullable=True, index=True
    )
    is_canonical: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    storage_bucket: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False, unique=True)
    active_parse_run_id: Mapped[str | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.parse_runs.id", ondelete="SET NULL"), nullable=True
    )
    active_chunk_run_id: Mapped[str | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.chunk_runs.id", ondelete="SET NULL"), nullable=True
    )
    active_embedding_run_id: Mapped[str | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.embedding_runs.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class ParseRun(Base):
    __tablename__ = "parse_runs"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    document_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    parser_name: Mapped[str] = mapped_column(String(128), nullable=False, default="docling")
    parser_version: Mapped[str] = mapped_column(String(128), nullable=False, default="unknown")
    normalized_schema_version: Mapped[str] = mapped_column(
        String(64), nullable=False, default="normalized-v1"
    )
    # Queue kaydı parse tamamlanmadan önce semantic payload taşımaz.
    structured: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    markdown: Mapped[str] = mapped_column(Text, nullable=False, default="")
    summary: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued")
    error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    execution_metadata: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    dispatch_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class ChunkRun(Base):
    __tablename__ = "chunk_runs"
    __table_args__ = (
        CheckConstraint("strategy IN ('fixed_token', 'recursive_token', 'structure_aware')", name="ck_chunk_runs_strategy"),
        CheckConstraint("chunk_count >= 0", name="ck_chunk_runs_count_nonnegative"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    document_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    parse_run_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.parse_runs.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    strategy: Mapped[str] = mapped_column(String(64), nullable=False)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    config_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    tokenizer_version: Mapped[str] = mapped_column(String(64), nullable=False)
    chunker_version: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="completed")
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Chunk(Base):
    __tablename__ = "chunks"
    __table_args__ = (
        UniqueConstraint("chunk_run_id", "ordinal", name="uq_chunks_run_ordinal"),
        CheckConstraint("ordinal >= 0", name="ck_chunks_ordinal_nonnegative"),
        CheckConstraint("token_count >= 0", name="ck_chunks_tokens_nonnegative"),
        CheckConstraint("character_count >= 0", name="ck_chunks_chars_nonnegative"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    document_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    chunk_run_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.chunk_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    page_numbers: Mapped[list[int]] = mapped_column(JSONB, nullable=False, default=list)
    source_element_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    heading_path: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    token_count: Mapped[int] = mapped_column(Integer, nullable=False)
    character_count: Mapped[int] = mapped_column(Integer, nullable=False)
    search_vector: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed("to_tsvector('simple', coalesce(text, ''))", persisted=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class EmbeddingRun(Base):
    __tablename__ = "embedding_runs"
    __table_args__ = (
        CheckConstraint("dimensions > 0", name="ck_embedding_runs_dimensions_positive"),
        CheckConstraint("embedding_count >= 0", name="ck_embedding_runs_count_nonnegative"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    document_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    chunk_run_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.chunk_runs.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    model: Mapped[str] = mapped_column(String(255), nullable=False)
    dimensions: Mapped[int] = mapped_column(Integer, nullable=False)
    embedding_format_version: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="completed")
    embedding_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ChunkEmbedding(Base):
    __tablename__ = "chunk_embeddings"
    __table_args__ = (
        UniqueConstraint("embedding_run_id", "chunk_id", name="uq_chunk_embeddings_run_chunk"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    embedding_run_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.embedding_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    chunk_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.chunks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # The Supabase baseline uses vector(768); JSONB keeps model import/testing portable.
    embedding: Mapped[list[float]] = mapped_column(
        Vector(768) if Vector is not None else JSONB, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ExperimentRun(Base):
    __tablename__ = "experiment_runs"
    __table_args__ = (
        CheckConstraint("target_stage IN ('retrieval', 'reranking', 'context', 'generation')", name="ck_experiment_runs_target_stage"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    document_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    chunk_run_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.chunk_runs.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    embedding_run_id: Mapped[str | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.embedding_runs.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    query: Mapped[str] = mapped_column(Text, nullable=False)
    target_stage: Mapped[str] = mapped_column(String(32), nullable=False)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    stage_results: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="completed")
    error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class EvaluationDataset(Base):
    __tablename__ = "evaluation_datasets"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    document_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    parse_run_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.parse_runs.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    cases: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class EvaluationRun(Base):
    __tablename__ = "evaluation_runs"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    dataset_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.evaluation_datasets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    child_experiment_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    results: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="completed")
    error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
