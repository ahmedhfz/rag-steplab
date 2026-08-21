"""Persistence boundary for the synchronous RAG pipeline.

The in-memory implementation is intentionally limited to development/tests. A
production configuration with a missing database is rejected by ``/ready`` and
write endpoints rather than silently losing data.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import re
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Iterable

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from .chunking import CHUNKER_VERSION, TOKENIZER_VERSION
from .config import get_settings
from .db import session_scope
from .errors import ApiProblem
from .models import (
    Base,
    Chunk,
    ChunkEmbedding,
    ChunkRun,
    Document,
    EmbeddingRun,
    EvaluationDataset,
    EvaluationRun,
    ExperimentRun,
    ParseRun,
)
from .schemas import (
    ChunkItem,
    ChunkRunRequest,
    ApiError,
    DocumentDetail,
    DocumentListItem,
    EvaluationCase,
    EvaluationDatasetRequest,
    EvaluationDatasetResponse,
    EvaluationRunRequest,
    EvaluationRunResponse,
    ExperimentCreateRequest,
    ExperimentResponse,
    ParseResponse,
    RunSummary,
    RunTiming,
)


def new_id() -> str:
    return str(uuid.uuid4())


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _dump(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", by_alias=False)
    if isinstance(value, dict):
        return {key: _dump(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_dump(item) for item in value]
    return value


def _record_timing(row: dict[str, Any]) -> RunTiming:
    return RunTiming(
        started_at=row.get("started_at"),
        completed_at=row.get("completed_at"),
        duration_ms=row.get("duration_ms"),
    )


def _run_summary(row: dict[str, Any], *, stale: bool = False) -> RunSummary:
    status = row.get("status", "completed")
    error_code = row.get("error_code")
    error_message = row.get("error_message")
    if status == "interrupted":
        status = "failed"
        error_code = "parse_interrupted"
        error_message = error_message or "The run was interrupted before completion."
    return RunSummary(
        id=row["id"],
        status=status,
        progress=(100 if status == "completed" else (row.get("execution_metadata") or {}).get("progress")),
        is_stale=stale,
        historical_lineage=bool(row.get("historical_lineage", False)),
        upstream={
            "documentId": row.get("document_id"),
            "parseRunId": row.get("parse_run_id"),
            "chunkRunId": row.get("chunk_run_id"),
            "embeddingRunId": row.get("embedding_run_id"),
        },
        config=copy.deepcopy(row.get("config", {})),
        timing=_record_timing(row),
        error=ApiError(code=error_code, message=error_message) if error_code and error_message else None,
    )


class Repository:
    """Small interface shared by hosted SQL and test/local memory storage."""

    persistent = False

    def scoped(self, owner_user_id: uuid.UUID) -> "ScopedRepository":
        return ScopedRepository(self, owner_user_id)

    def create_document(self, metadata: dict[str, Any], storage_bucket: str, storage_path: str, sha256: str) -> dict[str, Any]:
        raise NotImplementedError

    def save_parse(self, document_id: str, parsed: ParseResponse, *, run_id: str | None = None) -> dict[str, Any]:
        raise NotImplementedError

    def create_parse_run(
        self,
        document_id: str,
        *,
        parser_version: str = "unknown",
        config: dict[str, Any] | None = None,
        run_id: str | None = None,
    ) -> dict[str, Any]:
        raise NotImplementedError

    def queue_parse_run(
        self,
        document_id: str,
        *,
        parser_version: str = "unknown",
        config: dict[str, Any] | None = None,
        run_id: str | None = None,
    ) -> dict[str, Any]:
        return self.create_parse_run(document_id, parser_version=parser_version, config=config, run_id=run_id)

    def set_parse_dispatch(self, run_id: str, dispatch_id: str | None) -> dict[str, Any] | None:
        raise NotImplementedError

    def find_inflight_parse(self, document_id: str) -> dict[str, Any] | None:
        raise NotImplementedError

    def mark_parse_running(self, run_id: str) -> dict[str, Any] | None:
        raise NotImplementedError

    def update_parse_progress(self, run_id: str, progress: int, phase: str) -> dict[str, Any] | None:
        raise NotImplementedError

    def complete_parse(
        self,
        run_id: str,
        parsed: ParseResponse,
        *,
        parser_version: str = "unknown",
        execution_metadata: dict[str, Any] | None = None,
        duration_ms: int | None = None,
    ) -> dict[str, Any] | None:
        raise NotImplementedError

    def fail_parse(
        self,
        run_id: str,
        code: str,
        message: str,
        *,
        status: str = "failed",
        execution_metadata: dict[str, Any] | None = None,
        duration_ms: int | None = None,
    ) -> dict[str, Any] | None:
        raise NotImplementedError

    def get_document_row(self, document_id: str) -> dict[str, Any] | None:
        raise NotImplementedError

    def list_document_rows(self) -> list[dict[str, Any]]:
        raise NotImplementedError

    def delete_document(self, document_id: str) -> None:
        raise NotImplementedError

    def get_parse_row(self, run_id: str) -> dict[str, Any] | None:
        raise NotImplementedError

    def list_parse_rows(self, document_id: str) -> list[dict[str, Any]]:
        raise NotImplementedError

    def save_chunk_run(self, document_id: str, parse_run_id: str, request: ChunkRunRequest, drafts: list[Any]) -> dict[str, Any]:
        raise NotImplementedError

    def get_chunk_row(self, run_id: str) -> dict[str, Any] | None:
        raise NotImplementedError

    def list_chunk_rows(self, document_id: str) -> list[dict[str, Any]]:
        raise NotImplementedError

    def save_embedding_run(
        self,
        document_id: str,
        chunk_run_id: str,
        model: str,
        dimensions: int,
        format_version: str,
        values: list[tuple[str, list[float]]],
        input_hashes: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        raise NotImplementedError

    def get_embedding_row(self, run_id: str) -> dict[str, Any] | None:
        raise NotImplementedError

    def list_embedding_rows(self, document_id: str) -> list[dict[str, Any]]:
        raise NotImplementedError

    def get_chunks_for_embedding(self, chunk_run_id: str, embedding_run_id: str | None = None) -> list[dict[str, Any]]:
        raise NotImplementedError

    def retrieve_candidates(
        self,
        chunk_run_id: str,
        embedding_run_id: str | None,
        query: str,
        query_vector: list[float] | None,
        mode: str,
        candidate_k: int,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        raise NotImplementedError

    def save_experiment(self, row: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    def get_experiment_row(self, experiment_id: str) -> dict[str, Any] | None:
        raise NotImplementedError

    def list_experiment_rows(self, document_id: str | None = None) -> list[dict[str, Any]]:
        raise NotImplementedError

    def save_dataset(self, request: EvaluationDatasetRequest, parse_run_id: str) -> dict[str, Any]:
        raise NotImplementedError

    def list_dataset_rows(self, document_id: str | None = None) -> list[dict[str, Any]]:
        raise NotImplementedError

    def get_dataset_row(self, dataset_id: str) -> dict[str, Any] | None:
        raise NotImplementedError

    def save_evaluation(self, row: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    def get_evaluation_row(self, run_id: str) -> dict[str, Any] | None:
        raise NotImplementedError

    def list_evaluation_rows(self, dataset_id: str | None = None) -> list[dict[str, Any]]:
        raise NotImplementedError


class InMemoryRepository(Repository):
    persistent = False

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.documents: dict[str, dict[str, Any]] = {}
        self.parses: dict[str, dict[str, Any]] = {}
        self.chunk_runs: dict[str, dict[str, Any]] = {}
        self.chunks: dict[str, list[dict[str, Any]]] = {}
        self.embedding_runs: dict[str, dict[str, Any]] = {}
        self.embeddings: dict[str, list[dict[str, Any]]] = {}
        self.experiments: dict[str, dict[str, Any]] = {}
        self.datasets: dict[str, dict[str, Any]] = {}
        self.evaluations: dict[str, dict[str, Any]] = {}

    def create_document(self, metadata, storage_bucket, storage_path, sha256):
        document_id = new_id()
        row = {
            "id": document_id,
            **metadata,
            "storage_bucket": storage_bucket,
            "storage_path": storage_path,
            "sha256": sha256,
            "owner_user_id": metadata.get("owner_user_id"),
            "is_canonical": metadata.get("is_canonical", True),
            "active_parse_run_id": None,
            "active_chunk_run_id": None,
            "active_embedding_run_id": None,
            "created_at": now_utc(),
            "updated_at": now_utc(),
        }
        self.documents[document_id] = row
        return copy.deepcopy(row)

    def save_parse(self, document_id, parsed, *, run_id=None):
        queued = self.create_parse_run(document_id, parser_version="unknown", run_id=run_id)
        if queued is None:
            return None
        return self.complete_parse(queued["id"], parsed, parser_version="unknown", duration_ms=0)

    def create_parse_run(self, document_id, *, parser_version="unknown", config=None, run_id=None):
        document = self.documents.get(document_id)
        if document is None:
            return None
        with self._lock:
            existing = self.find_inflight_parse(document_id)
            if existing is not None:
                raise ApiProblem(409, "parse_already_in_progress", "A parse run is already in progress for this document.")
            identifier = run_id or new_id()
            now = now_utc()
            row = {
                "id": identifier,
                "document_id": document_id,
                "parser_name": "docling",
                "parser_version": parser_version,
                "normalized_schema_version": "normalized-v1",
                "structured": None,
                "markdown": "",
                "summary": None,
                "status": "queued",
                "error_code": None,
                "error_message": None,
                "config": copy.deepcopy(config or {}),
                "execution_metadata": {"progress": 0, "phase": "queued"},
                "dispatch_id": None,
                "started_at": None,
                "completed_at": None,
                "duration_ms": None,
                "created_at": now,
                "updated_at": now,
            }
            self.parses[identifier] = row
            return copy.deepcopy(row)

    def find_inflight_parse(self, document_id):
        with self._lock:
            rows = [
                row
                for row in self.parses.values()
                if row["document_id"] == document_id and row.get("status") in {"queued", "running"}
            ]
            rows.sort(key=lambda row: row.get("created_at") or now_utc(), reverse=True)
            return copy.deepcopy(rows[0]) if rows else None

    def set_parse_dispatch(self, run_id, dispatch_id):
        with self._lock:
            row = self.parses.get(run_id)
            if row is None:
                return None
            row["dispatch_id"] = dispatch_id
            row["updated_at"] = now_utc()
            return copy.deepcopy(row)

    def mark_parse_running(self, run_id):
        with self._lock:
            row = self.parses.get(run_id)
            if row is None:
                return None
            if row["status"] == "queued":
                row["status"] = "running"
                row["started_at"] = row.get("started_at") or now_utc()
                row["updated_at"] = now_utc()
            return copy.deepcopy(row)

    def update_parse_progress(self, run_id, progress, phase):
        with self._lock:
            row = self.parses.get(run_id)
            if row is None:
                return None
            if row["status"] in {"completed", "failed", "interrupted"}:
                return copy.deepcopy(row)
            metadata = copy.deepcopy(row.get("execution_metadata") or {})
            metadata.update({"progress": max(0, min(100, int(progress))), "phase": phase})
            row["execution_metadata"] = metadata
            row["updated_at"] = now_utc()
            return copy.deepcopy(row)

    def complete_parse(self, run_id, parsed, *, parser_version="unknown", execution_metadata=None, duration_ms=None):
        with self._lock:
            row = self.parses.get(run_id)
            if row is None:
                return None
            if row["status"] == "completed":
                return copy.deepcopy(row)
            if row["status"] in {"failed", "interrupted"}:
                return copy.deepcopy(row)
            if parsed.structured is None or parsed.summary is None:
                raise ValueError("completed parse payload is missing normalized content")
            document = self.documents.get(row["document_id"])
            if document is None:
                return None
            payload = parsed.model_dump(mode="json", by_alias=False)
            completed_at = now_utc()
            row.update(
                {
                    "parser_version": parser_version,
                    "structured": payload["structured"],
                    "markdown": payload["markdown"] or "",
                    "summary": payload["summary"],
                    "status": "completed",
                    "error_code": None,
                    "error_message": None,
                    "execution_metadata": copy.deepcopy(execution_metadata or parsed.run_metadata or {}),
                    "started_at": row.get("started_at") or completed_at,
                    "completed_at": completed_at,
                    "duration_ms": duration_ms if duration_ms is not None else 0,
                    "updated_at": completed_at,
                }
            )
            document["page_count"] = payload["document"]["page_count"]
            document["active_parse_run_id"] = run_id
            document["active_chunk_run_id"] = None
            document["active_embedding_run_id"] = None
            document["updated_at"] = completed_at
            return copy.deepcopy(row)

    def fail_parse(self, run_id, code, message, *, status="failed", execution_metadata=None, duration_ms=None):
        if status not in {"failed", "interrupted"}:
            raise ValueError("parse failure status must be failed or interrupted")
        with self._lock:
            row = self.parses.get(run_id)
            if row is None:
                return None
            if row["status"] in {"completed", "failed", "interrupted"}:
                return copy.deepcopy(row)
            completed_at = now_utc()
            row.update(
                {
                    "status": status,
                    "error_code": code,
                    "error_message": message,
                    "execution_metadata": copy.deepcopy(execution_metadata or row.get("execution_metadata") or {}),
                    "started_at": row.get("started_at"),
                    "completed_at": completed_at,
                    "duration_ms": duration_ms,
                    "updated_at": completed_at,
                }
            )
            return copy.deepcopy(row)

    def get_document_row(self, document_id):
        return copy.deepcopy(self.documents.get(document_id))

    def list_document_rows(self):
        return copy.deepcopy(list(self.documents.values()))

    def delete_document(self, document_id):
        self.documents.pop(document_id, None)
        self.parses = {key: row for key, row in self.parses.items() if row["document_id"] != document_id}
        self.chunk_runs = {key: row for key, row in self.chunk_runs.items() if row["document_id"] != document_id}
        self.chunks = {key: value for key, value in self.chunks.items() if key in self.chunk_runs}
        self.embedding_runs = {key: row for key, row in self.embedding_runs.items() if row["document_id"] != document_id}
        self.embeddings = {key: value for key, value in self.embeddings.items() if key in self.embedding_runs}
        self.experiments = {key: row for key, row in self.experiments.items() if row["document_id"] != document_id}
        dataset_ids = {key for key, row in self.datasets.items() if row["document_id"] == document_id}
        self.datasets = {key: row for key, row in self.datasets.items() if key not in dataset_ids}
        self.evaluations = {key: row for key, row in self.evaluations.items() if row["dataset_id"] not in dataset_ids}

    def get_parse_row(self, run_id):
        return copy.deepcopy(self.parses.get(run_id))

    def list_parse_rows(self, document_id):
        rows = [row for row in self.parses.values() if row["document_id"] == document_id]
        rows.sort(key=lambda row: row.get("created_at") or now_utc(), reverse=True)
        return copy.deepcopy(rows)

    def save_chunk_run(self, document_id, parse_run_id, request, drafts):
        identifier = new_id()
        config = _dump(request.config)
        row = {
            "id": identifier,
            "document_id": document_id,
            "parse_run_id": parse_run_id,
            "strategy": request.strategy,
            "config": config,
            "config_hash": hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest(),
            "tokenizer_version": TOKENIZER_VERSION,
            "chunker_version": CHUNKER_VERSION,
            "status": "completed",
            "chunk_count": len(drafts),
            "started_at": now_utc(),
            "completed_at": now_utc(),
            "duration_ms": 0,
            "created_at": now_utc(),
        }
        items: list[dict[str, Any]] = []
        for draft in drafts:
            item = {
                "id": new_id(),
                "document_id": document_id,
                "chunk_run_id": identifier,
                "ordinal": draft.ordinal,
                "text": draft.text,
                "page_numbers": list(draft.page_numbers),
                "source_element_ids": list(draft.source_element_ids),
                "heading_path": list(draft.heading_path),
                "token_count": draft.token_count,
                "character_count": draft.character_count,
            }
            items.append(item)
        self.chunk_runs[identifier] = row
        self.chunks[identifier] = items
        document = self.documents[document_id]
        document["active_chunk_run_id"] = identifier
        document["active_embedding_run_id"] = None
        document["updated_at"] = now_utc()
        return copy.deepcopy(row | {"chunks": items})

    def get_chunk_row(self, run_id):
        row = self.chunk_runs.get(run_id)
        if row is None:
            return None
        return copy.deepcopy(row | {"chunks": self.chunks.get(run_id, [])})

    def list_chunk_rows(self, document_id):
        return copy.deepcopy(
            [row | {"chunks": self.chunks.get(row["id"], [])} for row in self.chunk_runs.values() if row["document_id"] == document_id]
        )

    def save_embedding_run(self, document_id, chunk_run_id, model, dimensions, format_version, values, input_hashes=None):
        identifier = new_id()
        row = {
            "id": identifier,
            "document_id": document_id,
            "chunk_run_id": chunk_run_id,
            "model": model,
            "dimensions": dimensions,
            "embedding_format_version": format_version,
            "status": "completed",
            "embedding_count": len(values),
            "started_at": now_utc(),
            "completed_at": now_utc(),
            "duration_ms": 0,
            "created_at": now_utc(),
        }
        self.embedding_runs[identifier] = row
        self.embeddings[identifier] = [
            {"id": new_id(), "embedding_run_id": identifier, "chunk_id": chunk_id, "embedding": vector, "input_hash": (input_hashes or {}).get(chunk_id)}
            for chunk_id, vector in values
        ]
        document = self.documents[document_id]
        document["active_embedding_run_id"] = identifier
        document["updated_at"] = now_utc()
        return copy.deepcopy(row)

    def get_embedding_row(self, run_id):
        row = self.embedding_runs.get(run_id)
        return copy.deepcopy(row) if row else None

    def list_embedding_rows(self, document_id):
        return copy.deepcopy([row for row in self.embedding_runs.values() if row["document_id"] == document_id])

    def get_chunks_for_embedding(self, chunk_run_id, embedding_run_id=None):
        chunks = copy.deepcopy(self.chunks.get(chunk_run_id, []))
        if embedding_run_id:
            by_chunk = {row["chunk_id"]: row["embedding"] for row in self.embeddings.get(embedding_run_id, [])}
            for chunk in chunks:
                chunk["embedding"] = by_chunk.get(chunk["id"])
        return chunks

    def retrieve_candidates(self, chunk_run_id, embedding_run_id, query, query_vector, mode, candidate_k):
        chunks = self.get_chunks_for_embedding(chunk_run_id, embedding_run_id)
        dense: list[dict[str, Any]] = []
        keyword: list[dict[str, Any]] = []
        terms = [term.lower() for term in re.findall(r"[\wÀ-ÿ]+", query) if len(term) > 1]
        for chunk in chunks:
            if mode in {"dense", "hybrid"} and query_vector is not None:
                vector = chunk.get("embedding") or []
                denominator = math.sqrt(sum(value * value for value in query_vector)) * math.sqrt(sum(value * value for value in vector))
                score = sum(a * b for a, b in zip(query_vector, vector)) / denominator if denominator and len(vector) == len(query_vector) else 0.0
                dense.append({**chunk, "denseScore": score})
            if mode in {"keyword", "hybrid"}:
                text_value = chunk["text"].lower()
                score = sum(text_value.count(term) for term in terms) / len(terms) if terms else 0.0
                if score > 0:
                    keyword.append({**chunk, "keywordScore": score})
        dense.sort(key=lambda item: (-item["denseScore"], item["ordinal"], item["id"]))
        keyword.sort(key=lambda item: (-item["keywordScore"], item["ordinal"], item["id"]))
        return dense[:candidate_k], keyword[:candidate_k]

    def save_experiment(self, row):
        payload = copy.deepcopy(row)
        payload.setdefault("id", new_id())
        payload.setdefault("created_at", now_utc())
        self.experiments[payload["id"]] = payload
        return copy.deepcopy(payload)

    def get_experiment_row(self, experiment_id):
        return copy.deepcopy(self.experiments.get(experiment_id))

    def list_experiment_rows(self, document_id=None):
        values = self.experiments.values()
        if document_id:
            values = [row for row in values if row["document_id"] == document_id]
        return copy.deepcopy(list(values))

    def save_dataset(self, request, parse_run_id):
        identifier = new_id()
        row = {
            "id": identifier,
            "document_id": request.document_id,
            "parse_run_id": parse_run_id,
            "name": request.name,
            "version": 1,
            "cases": _dump(request.cases),
            "created_at": now_utc(),
        }
        self.datasets[identifier] = row
        return copy.deepcopy(row)

    def list_dataset_rows(self, document_id=None):
        values = self.datasets.values()
        if document_id:
            values = [row for row in values if row["document_id"] == document_id]
        return copy.deepcopy(list(values))

    def get_dataset_row(self, dataset_id):
        return copy.deepcopy(self.datasets.get(dataset_id))

    def save_evaluation(self, row):
        payload = copy.deepcopy(row)
        payload.setdefault("id", new_id())
        payload.setdefault("created_at", now_utc())
        self.evaluations[payload["id"]] = payload
        return copy.deepcopy(payload)

    def get_evaluation_row(self, run_id):
        return copy.deepcopy(self.evaluations.get(run_id))

    def list_evaluation_rows(self, dataset_id=None):
        values = self.evaluations.values()
        if dataset_id:
            values = [row for row in values if row["dataset_id"] == dataset_id]
        return copy.deepcopy(list(values))


def _orm_dict(row: Any, fields: Iterable[str]) -> dict[str, Any]:
    return {field: getattr(row, field) for field in fields}


class SqlAlchemyRepository(Repository):
    persistent = True

    def create_document(self, metadata, storage_bucket, storage_path, sha256):
        row = Document(
            id=new_id(),
            file_name=metadata["file_name"],
            media_type=metadata["media_type"],
            size_bytes=metadata["size_bytes"],
            page_count=metadata.get("page_count", 0),
            sha256=sha256,
            owner_user_id=metadata.get("owner_user_id"),
            is_canonical=metadata.get("is_canonical", True),
            storage_bucket=storage_bucket,
            storage_path=storage_path,
        )
        with session_scope() as session:
            session.add(row)
            session.flush()
            return self._document_dict(row)

    @staticmethod
    def _document_dict(row: Document) -> dict[str, Any]:
        return {
            "id": row.id,
            "file_name": row.file_name,
            "media_type": row.media_type,
            "size_bytes": row.size_bytes,
            "page_count": row.page_count,
            "sha256": row.sha256,
            "owner_user_id": row.owner_user_id,
            "is_canonical": row.is_canonical,
            "storage_bucket": row.storage_bucket,
            "storage_path": row.storage_path,
            "active_parse_run_id": row.active_parse_run_id,
            "active_chunk_run_id": row.active_chunk_run_id,
            "active_embedding_run_id": row.active_embedding_run_id,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    def save_parse(self, document_id, parsed, *, run_id=None):
        queued = self.create_parse_run(document_id, parser_version="unknown", run_id=run_id)
        if queued is None:
            return None
        return self.complete_parse(queued["id"], parsed, parser_version="unknown", duration_ms=0)

    def create_parse_run(self, document_id, *, parser_version="unknown", config=None, run_id=None):
        identifier = run_id or new_id()
        try:
            with session_scope() as session:
                document = session.get(Document, document_id)
                if document is None:
                    return None
                existing = session.scalars(
                    select(ParseRun)
                    .where(ParseRun.document_id == document_id, ParseRun.status.in_(["queued", "running"]))
                    .order_by(ParseRun.created_at.desc())
                    .with_for_update()
                ).first()
                if existing is not None:
                    raise ApiProblem(
                        409,
                        "parse_already_in_progress",
                        "A parse run is already in progress for this document.",
                    )
                row = ParseRun(
                    id=identifier,
                    document_id=document_id,
                    parser_name="docling",
                    parser_version=parser_version,
                    normalized_schema_version="normalized-v1",
                    structured=None,
                    markdown="",
                    summary=None,
                    status="queued",
                    execution_metadata={"progress": 0, "phase": "queued"},
                    started_at=None,
                    completed_at=None,
                    duration_ms=None,
                )
                session.add(row)
                session.flush()
                return self._parse_dict(row)
        except IntegrityError as exc:
            raise ApiProblem(
                409,
                "parse_already_in_progress",
                "A parse run is already in progress for this document.",
            ) from exc

    def find_inflight_parse(self, document_id):
        with session_scope() as session:
            row = session.scalars(
                select(ParseRun)
                .where(ParseRun.document_id == document_id, ParseRun.status.in_(["queued", "running"]))
                .order_by(ParseRun.created_at.desc())
            ).first()
            return self._parse_dict(row) if row else None

    def set_parse_dispatch(self, run_id, dispatch_id):
        with session_scope() as session:
            row = session.get(ParseRun, run_id)
            if row is None:
                return None
            row.dispatch_id = dispatch_id
            session.flush()
            return self._parse_dict(row)

    def mark_parse_running(self, run_id):
        with session_scope() as session:
            row = session.get(ParseRun, run_id)
            if row is None:
                return None
            if row.status == "queued":
                row.status = "running"
                row.started_at = row.started_at or now_utc()
                session.flush()
            return self._parse_dict(row)

    def update_parse_progress(self, run_id, progress, phase):
        with session_scope() as session:
            row = session.get(ParseRun, run_id)
            if row is None:
                return None
            if row.status in {"completed", "failed", "interrupted"}:
                return self._parse_dict(row)
            metadata = dict(row.execution_metadata or {})
            metadata.update({"progress": max(0, min(100, int(progress))), "phase": phase})
            row.execution_metadata = _dump(metadata)
            session.flush()
            return self._parse_dict(row)

    def complete_parse(self, run_id, parsed, *, parser_version="unknown", execution_metadata=None, duration_ms=None):
        payload = parsed.model_dump(mode="json", by_alias=False)
        if payload.get("structured") is None or payload.get("summary") is None:
            raise ValueError("completed parse payload is missing normalized content")
        with session_scope() as session:
            row = session.get(ParseRun, run_id)
            if row is None:
                return None
            if row.status == "completed" or row.status in {"failed", "interrupted"}:
                return self._parse_dict(row)
            document = session.get(Document, row.document_id)
            if document is None:
                return None
            completed_at = now_utc()
            row.parser_version = parser_version
            row.structured = payload["structured"]
            row.markdown = payload.get("markdown") or ""
            row.summary = payload["summary"]
            row.status = "completed"
            row.error_code = None
            row.error_message = None
            row.execution_metadata = _dump(execution_metadata or parsed.run_metadata or {})
            row.started_at = row.started_at or completed_at
            row.completed_at = completed_at
            row.duration_ms = duration_ms if duration_ms is not None else 0
            document.page_count = payload["document"]["page_count"]
            document.active_parse_run_id = run_id
            document.active_chunk_run_id = None
            document.active_embedding_run_id = None
            session.flush()
            return self._parse_dict(row)

    def fail_parse(self, run_id, code, message, *, status="failed", execution_metadata=None, duration_ms=None):
        if status not in {"failed", "interrupted"}:
            raise ValueError("parse failure status must be failed or interrupted")
        with session_scope() as session:
            row = session.get(ParseRun, run_id)
            if row is None:
                return None
            if row.status in {"completed", "failed", "interrupted"}:
                return self._parse_dict(row)
            completed_at = now_utc()
            row.status = status
            row.error_code = code
            row.error_message = message
            if execution_metadata is not None:
                row.execution_metadata = _dump(execution_metadata)
            row.completed_at = completed_at
            row.duration_ms = duration_ms
            session.flush()
            return self._parse_dict(row)

    @staticmethod
    def _parse_dict(row: ParseRun) -> dict[str, Any]:
        return {
            "id": row.id,
            "document_id": row.document_id,
            "parser_name": row.parser_name,
            "parser_version": row.parser_version,
            "normalized_schema_version": row.normalized_schema_version,
            "structured": row.structured,
            "markdown": row.markdown,
            "summary": row.summary,
            "status": row.status,
            "error_code": row.error_code,
            "error_message": row.error_message,
            "execution_metadata": row.execution_metadata or {},
            "dispatch_id": row.dispatch_id,
            "started_at": row.started_at,
            "completed_at": row.completed_at,
            "duration_ms": row.duration_ms,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    def get_document_row(self, document_id):
        with session_scope() as session:
            row = session.get(Document, document_id)
            return self._document_dict(row) if row else None

    def list_document_rows(self):
        with session_scope() as session:
            return [self._document_dict(row) for row in session.scalars(select(Document).order_by(Document.created_at.desc()))]

    def delete_document(self, document_id):
        with session_scope() as session:
            row = session.get(Document, document_id)
            if row is not None:
                session.delete(row)

    def get_parse_row(self, run_id):
        with session_scope() as session:
            row = session.get(ParseRun, run_id)
            return self._parse_dict(row) if row else None

    def list_parse_rows(self, document_id):
        with session_scope() as session:
            return [self._parse_dict(row) for row in session.scalars(select(ParseRun).where(ParseRun.document_id == document_id).order_by(ParseRun.created_at.desc()))]

    def save_chunk_run(self, document_id, parse_run_id, request, drafts):
        identifier = new_id()
        config = _dump(request.config)
        run = ChunkRun(
            id=identifier,
            document_id=document_id,
            parse_run_id=parse_run_id,
            strategy=request.strategy,
            config=config,
            config_hash=hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest(),
            tokenizer_version=TOKENIZER_VERSION,
            chunker_version=CHUNKER_VERSION,
            status="completed",
            chunk_count=len(drafts),
            started_at=now_utc(),
            completed_at=now_utc(),
            duration_ms=0,
        )
        with session_scope() as session:
            session.add(run)
            session.flush([run])
            for draft in drafts:
                session.add(
                    Chunk(
                        id=new_id(),
                        document_id=document_id,
                        chunk_run_id=identifier,
                        ordinal=draft.ordinal,
                        text=draft.text,
                        page_numbers=list(draft.page_numbers),
                        source_element_ids=list(draft.source_element_ids),
                        heading_path=list(draft.heading_path),
                        token_count=draft.token_count,
                        character_count=draft.character_count,
                    )
                )
            session.flush()
            document = session.get(Document, document_id)
            if document:
                document.active_chunk_run_id = identifier
                document.active_embedding_run_id = None
            session.flush()
            return self._chunk_dict(run, session)

    @staticmethod
    def _chunk_item(row: Chunk) -> dict[str, Any]:
        return {
            "id": row.id,
            "document_id": row.document_id,
            "chunk_run_id": row.chunk_run_id,
            "ordinal": row.ordinal,
            "text": row.text,
            "page_numbers": row.page_numbers or [],
            "source_element_ids": row.source_element_ids or [],
            "heading_path": row.heading_path or [],
            "token_count": row.token_count,
            "character_count": row.character_count,
        }

    def _chunk_dict(self, row: ChunkRun, session) -> dict[str, Any]:
        chunks = session.scalars(select(Chunk).where(Chunk.chunk_run_id == row.id).order_by(Chunk.ordinal)).all()
        return {
            "id": row.id,
            "document_id": row.document_id,
            "parse_run_id": row.parse_run_id,
            "strategy": row.strategy,
            "config": row.config,
            "status": row.status,
            "chunk_count": row.chunk_count,
            "started_at": row.started_at,
            "completed_at": row.completed_at,
            "duration_ms": row.duration_ms,
            "chunks": [self._chunk_item(chunk) for chunk in chunks],
        }

    def get_chunk_row(self, run_id):
        with session_scope() as session:
            row = session.get(ChunkRun, run_id)
            return self._chunk_dict(row, session) if row else None

    def list_chunk_rows(self, document_id):
        with session_scope() as session:
            rows = session.scalars(select(ChunkRun).where(ChunkRun.document_id == document_id).order_by(ChunkRun.created_at.desc())).all()
            return [self._chunk_dict(row, session) for row in rows]

    def save_embedding_run(self, document_id, chunk_run_id, model, dimensions, format_version, values, input_hashes=None):
        identifier = new_id()
        run = EmbeddingRun(
            id=identifier,
            document_id=document_id,
            chunk_run_id=chunk_run_id,
            model=model,
            dimensions=dimensions,
            embedding_format_version=format_version,
            status="completed",
            embedding_count=len(values),
            started_at=now_utc(),
            completed_at=now_utc(),
            duration_ms=0,
        )
        with session_scope() as session:
            session.add(run)
            session.flush([run])
            for chunk_id, vector in values:
                session.add(
                    ChunkEmbedding(
                        id=new_id(),
                        embedding_run_id=identifier,
                        chunk_id=chunk_id,
                        input_hash=(input_hashes or {}).get(chunk_id) or hashlib.sha256(json.dumps(vector).encode()).hexdigest(),
                        embedding=vector,
                    )
                )
            session.flush()
            document = session.get(Document, document_id)
            if document:
                document.active_embedding_run_id = identifier
            session.flush()
            return self._embedding_dict(run)

    @staticmethod
    def _embedding_dict(row: EmbeddingRun) -> dict[str, Any]:
        return {
            "id": row.id,
            "document_id": row.document_id,
            "chunk_run_id": row.chunk_run_id,
            "model": row.model,
            "dimensions": row.dimensions,
            "embedding_format_version": row.embedding_format_version,
            "status": row.status,
            "embedding_count": row.embedding_count,
            "started_at": row.started_at,
            "completed_at": row.completed_at,
            "duration_ms": row.duration_ms,
        }

    def get_embedding_row(self, run_id):
        with session_scope() as session:
            row = session.get(EmbeddingRun, run_id)
            return self._embedding_dict(row) if row else None

    def list_embedding_rows(self, document_id):
        with session_scope() as session:
            return [self._embedding_dict(row) for row in session.scalars(select(EmbeddingRun).where(EmbeddingRun.document_id == document_id).order_by(EmbeddingRun.created_at.desc()))]

    def get_chunks_for_embedding(self, chunk_run_id, embedding_run_id=None):
        with session_scope() as session:
            rows = session.scalars(select(Chunk).where(Chunk.chunk_run_id == chunk_run_id).order_by(Chunk.ordinal)).all()
            values = [self._chunk_item(row) for row in rows]
            if embedding_run_id:
                embeddings = session.scalars(select(ChunkEmbedding).where(ChunkEmbedding.embedding_run_id == embedding_run_id)).all()
                by_chunk = {row.chunk_id: list(row.embedding) for row in embeddings}
                for value in values:
                    value["embedding"] = by_chunk.get(value["id"])
            return values

    def retrieve_candidates(self, chunk_run_id, embedding_run_id, query, query_vector, mode, candidate_k):
        """Run the authoritative dense/FTS queries in PostgreSQL.

        Python is used only to merge the two already-ranked bounded result
        sets; it never scans the corpus or computes production vector scores.
        """
        dense: list[dict[str, Any]] = []
        keyword: list[dict[str, Any]] = []
        with session_scope() as session:
            if mode in {"dense", "hybrid"}:
                if not embedding_run_id or query_vector is None:
                    raise ValueError("embedding_run_id and query_vector are required for dense retrieval")
                vector_value = "[" + ",".join(format(float(value), ".9g") for value in query_vector) + "]"
                rows = session.execute(
                    text(
                        """
                        SELECT c.id, c.document_id, c.chunk_run_id, c.ordinal, c.text,
                               c.page_numbers, c.source_element_ids, c.heading_path,
                               c.token_count, c.character_count,
                               1 - (ce.embedding OPERATOR(extensions.<=>) CAST(:query_vector AS extensions.vector)) AS dense_score
                        FROM rag_lab.chunks AS c
                        JOIN rag_lab.chunk_embeddings AS ce ON ce.chunk_id = c.id
                        WHERE c.chunk_run_id = :chunk_run_id
                          AND ce.embedding_run_id = :embedding_run_id
                        ORDER BY ce.embedding OPERATOR(extensions.<=>) CAST(:query_vector AS extensions.vector), c.ordinal, c.id
                        LIMIT :candidate_k
                        """
                    ),
                    {"query_vector": vector_value, "chunk_run_id": chunk_run_id, "embedding_run_id": embedding_run_id, "candidate_k": candidate_k},
                ).mappings()
                dense = [dict(row) | {"denseScore": float(row["dense_score"])} for row in rows]
            if mode in {"keyword", "hybrid"}:
                terms = [term.lower() for term in re.findall(r"[\wÀ-ÿ]+", query) if len(term) > 1]
                if not terms:
                    return dense, keyword
                keyword_query = " | ".join(terms)
                rows = session.execute(
                    text(
                        """
                        SELECT c.id, c.document_id, c.chunk_run_id, c.ordinal, c.text,
                               c.page_numbers, c.source_element_ids, c.heading_path,
                               c.token_count, c.character_count,
                               ts_rank(c.search_vector, to_tsquery('simple', :query)) AS keyword_score
                        FROM rag_lab.chunks AS c
                        WHERE c.chunk_run_id = :chunk_run_id
                          AND c.search_vector @@ to_tsquery('simple', :query)
                        ORDER BY ts_rank(c.search_vector, to_tsquery('simple', :query)) DESC,
                                 c.ordinal, c.id
                        LIMIT :candidate_k
                        """
                    ),
                    {"query": keyword_query, "chunk_run_id": chunk_run_id, "candidate_k": candidate_k},
                ).mappings()
                keyword = [dict(row) | {"keywordScore": float(row["keyword_score"])} for row in rows]
        return dense, keyword

    @staticmethod
    def _exp_dict(row: ExperimentRun) -> dict[str, Any]:
        return {
            "id": row.id,
            "document_id": row.document_id,
            "chunk_run_id": row.chunk_run_id,
            "embedding_run_id": row.embedding_run_id,
            "query": row.query,
            "target_stage": row.target_stage,
            "config": row.config,
            "stage_results": row.stage_results,
            "status": row.status,
            "started_at": row.started_at,
            "completed_at": row.completed_at,
            "duration_ms": row.duration_ms,
            "created_at": row.created_at,
        }

    def save_experiment(self, row):
        entity = ExperimentRun(**{key: row.get(key) for key in (
            "id", "document_id", "chunk_run_id", "embedding_run_id", "query", "target_stage", "config", "stage_results", "status", "error_code", "error_message", "started_at", "completed_at", "duration_ms"
        ) if row.get(key) is not None})
        entity.id = entity.id or new_id()
        with session_scope() as session:
            session.add(entity)
            session.flush()
            return self._exp_dict(entity)

    def get_experiment_row(self, experiment_id):
        with session_scope() as session:
            row = session.get(ExperimentRun, experiment_id)
            return self._exp_dict(row) if row else None

    def list_experiment_rows(self, document_id=None):
        with session_scope() as session:
            query = select(ExperimentRun).order_by(ExperimentRun.created_at.desc())
            if document_id:
                query = query.where(ExperimentRun.document_id == document_id)
            return [self._exp_dict(row) for row in session.scalars(query)]

    @staticmethod
    def _dataset_dict(row: EvaluationDataset) -> dict[str, Any]:
        return {
            "id": row.id,
            "document_id": row.document_id,
            "parse_run_id": row.parse_run_id,
            "name": row.name,
            "version": row.version,
            "cases": row.cases,
            "created_at": row.created_at,
        }

    def save_dataset(self, request, parse_run_id):
        entity = EvaluationDataset(id=new_id(), document_id=request.document_id, parse_run_id=parse_run_id, name=request.name, version=1, cases=_dump(request.cases))
        with session_scope() as session:
            session.add(entity)
            session.flush()
            return self._dataset_dict(entity)

    def list_dataset_rows(self, document_id=None):
        with session_scope() as session:
            query = select(EvaluationDataset).order_by(EvaluationDataset.created_at.desc())
            if document_id:
                query = query.where(EvaluationDataset.document_id == document_id)
            return [self._dataset_dict(row) for row in session.scalars(query)]

    def get_dataset_row(self, dataset_id):
        with session_scope() as session:
            row = session.get(EvaluationDataset, dataset_id)
            return self._dataset_dict(row) if row else None

    @staticmethod
    def _eval_dict(row: EvaluationRun) -> dict[str, Any]:
        return {
            "id": row.id,
            "dataset_id": row.dataset_id,
            "config": row.config,
            "child_experiment_ids": row.child_experiment_ids,
            "results": row.results,
            "status": row.status,
            "started_at": row.started_at,
            "completed_at": row.completed_at,
            "duration_ms": row.duration_ms,
            "created_at": row.created_at,
        }

    def save_evaluation(self, row):
        entity = EvaluationRun(
            id=row.get("id", new_id()),
            dataset_id=row["dataset_id"],
            config=row.get("config", {}),
            child_experiment_ids=row.get("child_experiment_ids", []),
            results=row.get("results", {}),
            status=row.get("status", "completed"),
            started_at=row.get("started_at", now_utc()),
            completed_at=row.get("completed_at", now_utc()),
            duration_ms=row.get("duration_ms", 0),
        )
        with session_scope() as session:
            session.add(entity)
            session.flush()
            return self._eval_dict(entity)

    def get_evaluation_row(self, run_id):
        with session_scope() as session:
            row = session.get(EvaluationRun, run_id)
            return self._eval_dict(row) if row else None

    def list_evaluation_rows(self, dataset_id=None):
        with session_scope() as session:
            query = select(EvaluationRun).order_by(EvaluationRun.created_at.desc())
            if dataset_id:
                query = query.where(EvaluationRun.dataset_id == dataset_id)
            return [self._eval_dict(row) for row in session.scalars(query)]


class ScopedRepository(Repository):
    """Owner-scoped view over the private persistence role.

    The database role is deliberately not exposed to PostgREST. This wrapper
    makes the verified Supabase subject an explicit boundary for every
    user-facing repository lookup and write while workers continue using the
    unscoped repository with trusted internal run IDs.
    """

    def __init__(self, repository: Repository, owner_user_id: uuid.UUID) -> None:
        self._repository = repository
        self.owner_user_id = owner_user_id if isinstance(owner_user_id, uuid.UUID) else uuid.UUID(str(owner_user_id))
        self.persistent = repository.persistent

    def _owned_document(self, document_id: str) -> dict[str, Any] | None:
        document = self._repository.get_document_row(document_id)
        if document is None or document.get("owner_user_id") != self.owner_user_id:
            return None
        return document

    def _owned_document_for_row(self, row: dict[str, Any] | None) -> dict[str, Any] | None:
        return self._owned_document(row["document_id"]) if row and row.get("document_id") else None

    def create_document(self, metadata, storage_bucket, storage_path, sha256):
        payload = dict(metadata)
        payload["owner_user_id"] = self.owner_user_id
        return self._repository.create_document(payload, storage_bucket, storage_path, sha256)

    def save_parse(self, document_id, parsed, *, run_id=None):
        if self._owned_document(document_id) is None:
            return None
        return self._repository.save_parse(document_id, parsed, run_id=run_id)

    def create_parse_run(self, document_id, *, parser_version="unknown", config=None, run_id=None):
        if self._owned_document(document_id) is None:
            return None
        return self._repository.create_parse_run(document_id, parser_version=parser_version, config=config, run_id=run_id)

    def queue_parse_run(self, document_id, *, parser_version="unknown", config=None, run_id=None):
        return self.create_parse_run(document_id, parser_version=parser_version, config=config, run_id=run_id)

    def set_parse_dispatch(self, run_id, dispatch_id):
        if self.get_parse_row(run_id) is None:
            return None
        return self._repository.set_parse_dispatch(run_id, dispatch_id)

    def find_inflight_parse(self, document_id):
        if self._owned_document(document_id) is None:
            return None
        return self._repository.find_inflight_parse(document_id)

    def mark_parse_running(self, run_id):
        if self.get_parse_row(run_id) is None:
            return None
        return self._repository.mark_parse_running(run_id)

    def update_parse_progress(self, run_id, progress, phase):
        if self.get_parse_row(run_id) is None:
            return None
        return self._repository.update_parse_progress(run_id, progress, phase)

    def complete_parse(self, run_id, parsed, *, parser_version="unknown", execution_metadata=None, duration_ms=None):
        if self.get_parse_row(run_id) is None:
            return None
        return self._repository.complete_parse(run_id, parsed, parser_version=parser_version, execution_metadata=execution_metadata, duration_ms=duration_ms)

    def fail_parse(self, run_id, code, message, *, status="failed", execution_metadata=None, duration_ms=None):
        if self.get_parse_row(run_id) is None:
            return None
        return self._repository.fail_parse(run_id, code, message, status=status, execution_metadata=execution_metadata, duration_ms=duration_ms)

    def get_document_row(self, document_id):
        return self._owned_document(document_id)

    def list_document_rows(self):
        return [row for row in self._repository.list_document_rows() if row.get("owner_user_id") == self.owner_user_id]

    def delete_document(self, document_id):
        if self._owned_document(document_id) is not None:
            self._repository.delete_document(document_id)

    def get_parse_row(self, run_id):
        return self._owned_document_for_row(self._repository.get_parse_row(run_id)) and self._repository.get_parse_row(run_id)

    def list_parse_rows(self, document_id):
        if self._owned_document(document_id) is None:
            return []
        return self._repository.list_parse_rows(document_id)

    def save_chunk_run(self, document_id, parse_run_id, request, drafts):
        document = self._owned_document(document_id)
        parse = self.get_parse_row(parse_run_id)
        if document is None or parse is None or parse.get("document_id") != document_id:
            raise ApiProblem(404, "chunk_run_not_found", "The requested document lineage was not found.")
        return self._repository.save_chunk_run(document_id, parse_run_id, request, drafts)

    def get_chunk_row(self, run_id):
        return self._owned_document_for_row(self._repository.get_chunk_row(run_id)) and self._repository.get_chunk_row(run_id)

    def list_chunk_rows(self, document_id):
        if self._owned_document(document_id) is None:
            return []
        return self._repository.list_chunk_rows(document_id)

    def save_embedding_run(self, document_id, chunk_run_id, model, dimensions, format_version, values, input_hashes=None):
        if self._owned_document(document_id) is None or self.get_chunk_row(chunk_run_id) is None:
            raise ApiProblem(404, "embedding_run_not_found", "The requested document lineage was not found.")
        return self._repository.save_embedding_run(document_id, chunk_run_id, model, dimensions, format_version, values, input_hashes)

    def get_embedding_row(self, run_id):
        return self._owned_document_for_row(self._repository.get_embedding_row(run_id)) and self._repository.get_embedding_row(run_id)

    def list_embedding_rows(self, document_id):
        if self._owned_document(document_id) is None:
            return []
        return self._repository.list_embedding_rows(document_id)

    def get_chunks_for_embedding(self, chunk_run_id, embedding_run_id=None):
        row = self.get_chunk_row(chunk_run_id)
        if row is None:
            return []
        return self._repository.get_chunks_for_embedding(chunk_run_id, embedding_run_id)

    def retrieve_candidates(self, chunk_run_id, embedding_run_id, query, query_vector, mode, candidate_k):
        if self.get_chunk_row(chunk_run_id) is None:
            raise ApiProblem(404, "chunk_run_not_found", "The chunk run was not found.")
        if embedding_run_id is not None and self.get_embedding_row(embedding_run_id) is None:
            raise ApiProblem(404, "embedding_run_not_found", "The embedding run was not found.")
        return self._repository.retrieve_candidates(chunk_run_id, embedding_run_id, query, query_vector, mode, candidate_k)

    def save_experiment(self, row):
        if self._owned_document(row.get("document_id", "")) is None:
            raise ApiProblem(404, "experiment_not_found", "The experiment lineage was not found.")
        return self._repository.save_experiment(row)

    def get_experiment_row(self, experiment_id):
        return self._owned_document_for_row(self._repository.get_experiment_row(experiment_id)) and self._repository.get_experiment_row(experiment_id)

    def list_experiment_rows(self, document_id=None):
        if document_id is not None:
            return [] if self._owned_document(document_id) is None else self._repository.list_experiment_rows(document_id)
        return [row for row in self._repository.list_experiment_rows() if self._owned_document(row.get("document_id", "")) is not None]

    def save_dataset(self, request, parse_run_id):
        if self._owned_document(request.document_id) is None or self.get_parse_row(parse_run_id) is None:
            raise ApiProblem(404, "dataset_not_found", "The evaluation dataset lineage was not found.")
        return self._repository.save_dataset(request, parse_run_id)

    def list_dataset_rows(self, document_id=None):
        if document_id is not None:
            return [] if self._owned_document(document_id) is None else self._repository.list_dataset_rows(document_id)
        return [row for row in self._repository.list_dataset_rows() if self._owned_document(row.get("document_id", "")) is not None]

    def get_dataset_row(self, dataset_id):
        row = self._repository.get_dataset_row(dataset_id)
        return row if self._owned_document_for_row(row) is not None else None

    def save_evaluation(self, row):
        dataset = self.get_dataset_row(row.get("dataset_id", ""))
        if dataset is None:
            raise ApiProblem(404, "evaluation_run_not_found", "The evaluation lineage was not found.")
        return self._repository.save_evaluation(row)

    def get_evaluation_row(self, run_id):
        row = self._repository.get_evaluation_row(run_id)
        if row is None:
            return None
        return row if self.get_dataset_row(row.get("dataset_id", "")) is not None else None

    def list_evaluation_rows(self, dataset_id=None):
        if dataset_id is not None:
            return [] if self.get_dataset_row(dataset_id) is None else self._repository.list_evaluation_rows(dataset_id)
        return [row for row in self._repository.list_evaluation_rows() if self.get_dataset_row(row.get("dataset_id", "")) is not None]


_repository: Repository | None = None


def get_repository() -> Repository:
    global _repository
    if _repository is not None:
        return _repository
    settings = get_settings()
    if settings.database_url:
        _repository = SqlAlchemyRepository()
    else:
        _repository = InMemoryRepository()
    return _repository


def reset_repository() -> None:
    global _repository
    _repository = None
