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
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from sqlalchemy import and_, delete, func, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError

from .chunking import TOKENIZER_VERSION, chunker_version_for_strategy, config_hash
from .config import PARSE_RUN_TIMEOUT_SECONDS, get_settings, pipeline_lease_duration_seconds
from .db import session_scope
from .errors import ApiProblem
from .models import (
    Base,
    Chunk,
    ChunkEmbedding,
    ChunkRun,
    Document,
    DocumentPipeline,
    EmbeddingRun,
    EvaluationDataset,
    EvaluationRun,
    ExperimentRun,
    ParseRun,
    StorageCleanup,
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


def duration_ms_between(started_at: datetime | None, completed_at: datetime | None) -> int | None:
    """Return server-observed elapsed time for an executed lifecycle.

    A terminal run that never started has no honest duration.  A run that did
    execute is reported as at least one millisecond so a fast operation is not
    serialized as a misleading zero-duration result.
    """
    if started_at is None or completed_at is None:
        return None
    return max(1, math.ceil((completed_at - started_at).total_seconds() * 1000))


def _lease_expired(row: dict[str, Any], now: datetime | None = None) -> bool:
    """Treat a legacy active row as expired only after its derived budget."""

    current = now or now_utc()
    expiry = row.get("lease_expires_at")
    if isinstance(expiry, datetime):
        return expiry <= current
    started = row.get("started_at") or row.get("created_at")
    if not isinstance(started, datetime):
        return False
    return started + timedelta(seconds=pipeline_lease_duration_seconds(get_settings())) <= current


def _artifact_fence_allows(row: dict[str, Any], lease_token: str | None, unfenced: bool) -> bool:
    """Chunk/embedding writes need the live lease token unless explicitly unfenced.

    ``unfenced`` is reserved for deliberate maintenance transitions (an
    ``artifact_incomplete`` repair of a completed row); a missing token is
    never an implicit bypass.
    """

    if unfenced:
        return True
    if lease_token is None or row.get("lease_token") is None:
        return False
    return str(row["lease_token"]) == str(lease_token) and not _lease_expired(row)


def _completion_replay(status: str | None, lease_token: str | None) -> bool:
    """A retried completion of an already completed artifact is a read, not a write.

    A successful completion clears the lease, so a retry after a lost
    acknowledgement would otherwise fail the fence and look like a persistence
    failure. Returning the durable row is safe: nothing from the retrying
    attempt is written, and the row is the run's single immutable artifact
    (its identity fixes the inputs). Only ``completed`` qualifies; a failed or
    interrupted row still goes through the fence and never reads as success.
    """

    return status == "completed" and lease_token is not None


def _embedding_advances_default(
    active_parse_id: str | None,
    active_chunk_id: str | None,
    chunk_parse_id: str | None,
    chunk_id: str,
) -> bool:
    """A completed embedding becomes the document default only along that default."""

    if active_chunk_id is not None:
        return active_chunk_id == chunk_id
    return chunk_parse_id is not None and active_parse_id in {None, chunk_parse_id}


def _expired_run_update(row: dict[str, Any], *, parse: bool = False, now: datetime | None = None) -> dict[str, Any]:
    """Close abandoned runs without deleting history or inventing execution time."""
    if row.get("status") not in {"queued", "running"}:
        return {}
    current = now or now_utc()
    if parse:
        started = row.get("started_at") or row.get("created_at")
        expired = isinstance(started, datetime) and started + timedelta(seconds=PARSE_RUN_TIMEOUT_SECONDS) <= current
    else:
        expired = _lease_expired(row, current)
    if not expired:
        return {}
    values = {
        "status": "interrupted",
        "error_code": "parse_timeout" if parse else "worker_lease_expired",
        "error_message": "The run exceeded its execution deadline before completion.",
        "completed_at": current,
        # The worker's actual stop time is unknown; wall time since creation
        # would misleadingly report weeks of execution for a legacy orphan.
        "duration_ms": None,
    }
    if not parse:
        values.update(identity_claimed=None, lease_token=None, lease_expires_at=None)
    return values


def simple_fts_terms(query: str) -> list[str]:
    """Build the terms passed to PostgreSQL's intentionally unstemmed `simple` FTS config."""

    return [term.lower() for term in re.findall(r"[\wÀ-ÿ]+", query) if len(term) > 1]


def _dump(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", by_alias=False)
    if isinstance(value, dict):
        return {key: _dump(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_dump(item) for item in value]
    return value


def chunk_lineage_fingerprint(row: dict[str, Any]) -> str | None:
    required = (
        row.get("parse_run_id"),
        row.get("strategy"),
        row.get("config_hash"),
        row.get("tokenizer_version"),
        row.get("chunker_version"),
    )
    if any(value is None for value in required):
        return None
    payload = json.dumps(required, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


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
        run_number=row.get("run_number"),
        created_at=row.get("created_at"),
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
        config_hash=row.get("config_hash"),
        tokenizer_version=row.get("tokenizer_version"),
        chunker_version=row.get("chunker_version"),
        lineage_fingerprint=chunk_lineage_fingerprint(row),
        timing=_record_timing(row),
        error=ApiError(code=error_code, message=error_message) if error_code and error_message else None,
    )


def _summary_parse_row(row: dict[str, Any]) -> dict[str, Any]:
    """Return parse history metadata without normalized document content."""
    return {
        "kind": "parse",
        "id": row["id"],
        "run_number": row.get("run_number"),
        "document_id": row.get("document_id"),
        "parser_name": row.get("parser_name"),
        "parser_version": row.get("parser_version"),
        "normalized_schema_version": row.get("normalized_schema_version"),
        "has_structured": bool(row.get("structured") is not None) if "structured" in row else bool(row.get("has_structured")),
        "has_summary": bool(row.get("summary") is not None) if "summary" in row else bool(row.get("has_summary")),
        "status": row.get("status", "completed"),
        "error_code": row.get("error_code"),
        "error_message": row.get("error_message"),
        "execution_metadata": copy.deepcopy(row.get("execution_metadata") or {}),
        "started_at": row.get("started_at"),
        "completed_at": row.get("completed_at"),
        "duration_ms": row.get("duration_ms"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "config": copy.deepcopy(row.get("config") or {}),
    }


def _summary_chunk_row(row: dict[str, Any]) -> dict[str, Any]:
    """Return chunk history metadata; child chunk text is deliberately absent."""
    return {
        "kind": "chunk",
        "id": row["id"],
        "run_number": row.get("run_number"),
        "document_id": row.get("document_id"),
        "parse_run_id": row.get("parse_run_id"),
        "strategy": row.get("strategy"),
        "config": copy.deepcopy(row.get("config") or {}),
        "config_hash": row.get("config_hash"),
        "tokenizer_version": row.get("tokenizer_version"),
        "chunker_version": row.get("chunker_version"),
        "lineage_fingerprint": chunk_lineage_fingerprint(row),
        "status": row.get("status", "completed"),
        "chunk_count": row.get("chunk_count", 0),
        "error_code": row.get("error_code"),
        "error_message": row.get("error_message"),
        "started_at": row.get("started_at"),
        "completed_at": row.get("completed_at"),
        "duration_ms": row.get("duration_ms"),
        "created_at": row.get("created_at"),
    }


def _summary_embedding_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": "embedding",
        "id": row["id"],
        "run_number": row.get("run_number"),
        "document_id": row.get("document_id"),
        "chunk_run_id": row.get("chunk_run_id"),
        "model": row.get("model"),
        "dimensions": row.get("dimensions"),
        "embedding_format_version": row.get("embedding_format_version"),
        "effective_model": row.get("effective_model"),
        "status": row.get("status", "completed"),
        "embedding_count": row.get("embedding_count", 0),
        "error_code": row.get("error_code"),
        "error_message": row.get("error_message"),
        "started_at": row.get("started_at"),
        "completed_at": row.get("completed_at"),
        "duration_ms": row.get("duration_ms"),
        "created_at": row.get("created_at"),
    }


def _summary_experiment_row(row: dict[str, Any]) -> dict[str, Any]:
    stage_results = row.get("stage_results") if "stage_results" in row else None
    retrieval = stage_results.get("retrieval") if isinstance(stage_results, dict) else None
    candidates = retrieval.get("results", retrieval.get("candidates", [])) if isinstance(retrieval, dict) else None
    stage_statuses = {
        stage: (
            (stage_results.get(stage) or {}).get("status")
            if isinstance(stage_results, dict)
            else row.get(f"{stage}_status")
        )
        for stage in ("retrieval", "reranking", "context", "generation")
    }
    return {
        "kind": "experiment",
        "id": row["id"],
        "document_id": row.get("document_id"),
        "chunk_run_id": row.get("chunk_run_id"),
        "embedding_run_id": row.get("embedding_run_id"),
        "query": row.get("query", ""),
        "target_stage": row.get("target_stage"),
        "experiment_fingerprint": row.get("experiment_fingerprint"),
        "config": _public_config(row.get("config")),
        "candidate_count": len(candidates) if isinstance(candidates, list) else row.get("candidate_count"),
        "stage_statuses": {stage: status for stage, status in stage_statuses.items() if status},
        "status": row.get("status", "completed"),
        "error_code": row.get("error_code"),
        "error_message": row.get("error_message"),
        "started_at": row.get("started_at"),
        "completed_at": row.get("completed_at"),
        "duration_ms": row.get("duration_ms"),
        "created_at": row.get("created_at"),
    }


def _summary_pipeline_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "owner_user_id": row.get("owner_user_id"),
        "document_id": row.get("document_id"),
        "name": row.get("name"),
        "parse_run_id": row.get("parse_run_id"),
        "chunk_run_id": row.get("chunk_run_id"),
        "embedding_run_id": row.get("embedding_run_id"),
        "revision": row.get("revision"),
        "is_default": row.get("name") == "Default Pipeline",
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _public_config(config: Any) -> dict[str, Any]:
    """Copy a run config without worker-only execution bookkeeping."""

    value = copy.deepcopy(config) if isinstance(config, dict) else {}
    value.pop("_execution", None)
    return value


def _summary_dataset_row(row: dict[str, Any]) -> dict[str, Any]:
    cases = row.get("cases") if "cases" in row else None
    return {
        "kind": "dataset",
        "id": row["id"],
        "document_id": row.get("document_id"),
        "parse_run_id": row.get("parse_run_id"),
        "name": row.get("name", ""),
        "version": row.get("version", 1),
        "series_id": row.get("series_id"),
        "case_count": len(cases) if isinstance(cases, list) else row.get("case_count", 0),
        "created_at": row.get("created_at"),
    }


def _summary_evaluation_row(row: dict[str, Any]) -> dict[str, Any]:
    results = row.get("results") if "results" in row else {}
    aggregate = results.get("aggregate", results) if isinstance(results, dict) else {}
    return {
        "kind": "evaluation",
        "id": row["id"],
        "dataset_id": row.get("dataset_id"),
        "config": copy.deepcopy(row.get("config") or {}),
        "status": row.get("status", "completed"),
        "error_code": row.get("error_code"),
        "error_message": row.get("error_message"),
        "aggregate": copy.deepcopy(aggregate if isinstance(aggregate, dict) else {}),
        "started_at": row.get("started_at"),
        "completed_at": row.get("completed_at"),
        "duration_ms": row.get("duration_ms"),
        "created_at": row.get("created_at"),
    }


def _summary_document_evaluation_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": "evaluation",
        "id": row["id"],
        "dataset_id": row.get("dataset_id"),
        "parse_run_id": row.get("parse_run_id"),
        "chunk_run_id": row.get("chunk_run_id"),
        "embedding_run_id": row.get("embedding_run_id"),
        "status": row.get("status", "completed"),
        "error_code": row.get("error_code"),
        "error_message": row.get("error_message"),
        "started_at": row.get("started_at"),
        "completed_at": row.get("completed_at"),
        "duration_ms": row.get("duration_ms"),
        "created_at": row.get("created_at"),
    }


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
        admission_owner_user_id: uuid.UUID | str | None = None,
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

    def get_document_by_sha256(
        self, sha256: str, *, owner_user_id: uuid.UUID | str | None = None
    ) -> dict[str, Any] | None:
        raise NotImplementedError

    def list_document_rows(self, *, owner_user_id: uuid.UUID | str | None = None) -> list[dict[str, Any]]:
        raise NotImplementedError

    def latest_parse_metadata(self, *, owner_user_id=None) -> dict[str, dict[str, Any]]:
        raise NotImplementedError

    def delete_document(self, document_id: str) -> None:
        raise NotImplementedError

    def delete_document_with_cleanup(self, document_id: str) -> dict[str, Any] | None:
        raise NotImplementedError

    def list_pending_storage_cleanups(
        self,
        *,
        limit: int = 3,
        owner_user_id: uuid.UUID | str | None = None,
    ) -> list[dict[str, Any]]:
        raise NotImplementedError

    def complete_storage_cleanup(self, cleanup_id: str) -> None:
        raise NotImplementedError

    def fail_storage_cleanup(self, cleanup_id: str, code: str) -> None:
        raise NotImplementedError

    def create_document_pipeline(self, row: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    def get_document_pipeline_row(
        self, pipeline_id: str, *, owner_user_id: uuid.UUID | str | None = None
    ) -> dict[str, Any] | None:
        raise NotImplementedError

    def list_document_pipeline_rows(
        self, document_id: str, *, owner_user_id: uuid.UUID | str | None = None
    ) -> list[dict[str, Any]] | None:
        raise NotImplementedError

    def update_document_pipeline(
        self,
        pipeline_id: str,
        expected_revision: int,
        changes: dict[str, Any],
        *,
        owner_user_id: uuid.UUID | str | None = None,
    ) -> dict[str, Any] | None:
        raise NotImplementedError

    def delete_document_pipeline(
        self, pipeline_id: str, *, owner_user_id: uuid.UUID | str | None = None
    ) -> bool:
        raise NotImplementedError

    def get_parse_row(self, run_id: str) -> dict[str, Any] | None:
        raise NotImplementedError

    def list_parse_rows(self, document_id: str) -> list[dict[str, Any]]:
        raise NotImplementedError

    def get_document_summary_bundle(
        self,
        document_id: str,
        *,
        owner_user_id: uuid.UUID | str | None = None,
    ) -> dict[str, Any] | None:
        raise NotImplementedError

    def save_chunk_run(self, document_id: str, parse_run_id: str, request: ChunkRunRequest, drafts: list[Any]) -> dict[str, Any]:
        raise NotImplementedError

    def claim_chunk_run(
        self,
        document_id: str,
        parse_run_id: str,
        strategy: str,
        config: dict[str, Any],
        config_hash_value: str,
        tokenizer_version: str,
        chunker_version: str,
    ) -> tuple[dict[str, Any], bool]:
        raise NotImplementedError

    def complete_chunk_run(
        self, run_id: str, drafts: list[Any], lease_token: str | None = None, *, unfenced: bool = False
    ) -> dict[str, Any] | None:
        raise NotImplementedError

    def fail_chunk_run(
        self, run_id: str, code: str, message: str, lease_token: str | None = None, *, unfenced: bool = False
    ) -> dict[str, Any] | None:
        raise NotImplementedError

    def get_chunk_row(
        self, run_id: str, *, owner_user_id: uuid.UUID | str | None = None
    ) -> dict[str, Any] | None:
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

    def claim_embedding_run(
        self,
        document_id: str,
        chunk_run_id: str,
        model: str,
        dimensions: int,
        format_version: str,
        admission_owner_user_id: uuid.UUID | str | None = None,
    ) -> tuple[dict[str, Any], bool]:
        raise NotImplementedError

    def complete_embedding_run(
        self,
        run_id: str,
        values: list[tuple[str, list[float]]],
        input_hashes: dict[str, str] | None = None,
        effective_model: str | None = None,
        lease_token: str | None = None,
        *,
        unfenced: bool = False,
    ) -> dict[str, Any] | None:
        raise NotImplementedError

    def fail_embedding_run(
        self, run_id: str, code: str, message: str, lease_token: str | None = None, *, unfenced: bool = False
    ) -> dict[str, Any] | None:
        raise NotImplementedError

    def get_embedding_row(
        self, run_id: str, *, owner_user_id: uuid.UUID | str | None = None
    ) -> dict[str, Any] | None:
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

    def get_completed_experiment_by_fingerprint(
        self, document_id: str, experiment_fingerprint: str
    ) -> dict[str, Any] | None:
        raise NotImplementedError

    def claim_experiment(
        self,
        row: dict[str, Any],
        *,
        admission_owner_user_id: uuid.UUID | str | None = None,
        bypass_user_admission: bool = False,
    ) -> tuple[dict[str, Any], bool]:
        """Claim one exact request; ``True`` means this caller owns execution."""
        raise NotImplementedError

    def update_experiment_stage(
        self,
        experiment_id: str,
        stage: str,
        result: dict[str, Any],
        lease_token: str | None = None,
    ) -> dict[str, Any] | None:
        raise NotImplementedError

    def complete_experiment(self, experiment_id: str, lease_token: str | None = None) -> dict[str, Any] | None:
        raise NotImplementedError

    def fail_experiment(
        self,
        experiment_id: str,
        code: str,
        message: str,
        lease_token: str | None = None,
    ) -> dict[str, Any] | None:
        raise NotImplementedError

    def set_pipeline_dispatch(
        self,
        kind: str,
        run_id: str,
        dispatch_id: str,
        lease_token: str | None = None,
        expected_dispatch_id: str | None = None,
    ) -> dict[str, Any] | None:
        raise NotImplementedError

    def claim_pipeline_dispatch(
        self, kind: str, run_id: str, dispatch_id: str, lease_token: str | None = None
    ) -> dict[str, Any] | None:
        """Atomically reserve the first dispatch slot for an active run."""
        raise NotImplementedError

    def start_pipeline_worker(
        self, kind: str, run_id: str, lease_token: str, lease_duration_seconds: int
    ) -> dict[str, Any] | None:
        raise NotImplementedError

    def renew_pipeline_lease(
        self, kind: str, run_id: str, lease_token: str, lease_duration_seconds: int
    ) -> dict[str, Any] | None:
        raise NotImplementedError

    def complete_pipeline_worker(
        self, kind: str, run_id: str, lease_token: str
    ) -> dict[str, Any] | None:
        raise NotImplementedError

    def fail_pipeline_worker(
        self, kind: str, run_id: str, lease_token: str, code: str, message: str
    ) -> dict[str, Any] | None:
        raise NotImplementedError

    def reconcile_pipeline_lease(
        self, kind: str, run_id: str
    ) -> dict[str, Any] | None:
        """Fence and terminalize an active run whose lease has expired."""
        raise NotImplementedError

    def find_stage_result(
        self, document_id: str, stage: str, fingerprint: str
    ) -> tuple[dict[str, Any], str] | None:
        """Find a persisted, candidate stage and its owning experiment ID."""
        raise NotImplementedError

    def get_experiment_row(self, experiment_id: str) -> dict[str, Any] | None:
        raise NotImplementedError

    def list_experiment_rows(self, document_id: str | None = None) -> list[dict[str, Any]]:
        raise NotImplementedError

    def list_experiment_summary_rows(
        self,
        document_id: str | None = None,
        *,
        owner_user_id: uuid.UUID | str | None = None,
    ) -> list[dict[str, Any]]:
        raise NotImplementedError

    def save_dataset(self, request: EvaluationDatasetRequest, parse_run_id: str) -> dict[str, Any]:
        raise NotImplementedError

    def list_dataset_rows(self, document_id: str | None = None) -> list[dict[str, Any]]:
        raise NotImplementedError

    def list_dataset_summary_rows(
        self,
        document_id: str | None = None,
        *,
        owner_user_id: uuid.UUID | str | None = None,
    ) -> list[dict[str, Any]]:
        raise NotImplementedError

    def get_dataset_row(self, dataset_id: str) -> dict[str, Any] | None:
        raise NotImplementedError

    def save_evaluation(self, row: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    def claim_evaluation(
        self,
        row: dict[str, Any],
        *,
        admission_owner_user_id: uuid.UUID | str | None = None,
    ) -> tuple[dict[str, Any], bool]:
        """Claim one active exact evaluation request."""
        raise NotImplementedError

    def get_evaluation_by_fingerprint(
        self, dataset_id: str, evaluation_fingerprint: str
    ) -> dict[str, Any] | None:
        raise NotImplementedError

    def update_evaluation(
        self, run_id: str, changes: dict[str, Any], lease_token: str | None = None
    ) -> dict[str, Any] | None:
        raise NotImplementedError

    def get_evaluation_row(self, run_id: str) -> dict[str, Any] | None:
        raise NotImplementedError

    def list_evaluation_rows(self, dataset_id: str | None = None) -> list[dict[str, Any]]:
        raise NotImplementedError

    def list_evaluation_summary_rows(
        self,
        dataset_id: str | None = None,
        *,
        owner_user_id: uuid.UUID | str | None = None,
    ) -> list[dict[str, Any]]:
        raise NotImplementedError


class InMemoryRepository(Repository):
    persistent = False

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.documents: dict[str, dict[str, Any]] = {}
        self.document_pipelines: dict[str, dict[str, Any]] = {}
        self.parses: dict[str, dict[str, Any]] = {}
        self.chunk_runs: dict[str, dict[str, Any]] = {}
        self.chunks: dict[str, list[dict[str, Any]]] = {}
        self.embedding_runs: dict[str, dict[str, Any]] = {}
        self.embeddings: dict[str, list[dict[str, Any]]] = {}
        self.experiments: dict[str, dict[str, Any]] = {}
        self.datasets: dict[str, dict[str, Any]] = {}
        self.evaluations: dict[str, dict[str, Any]] = {}
        self.storage_cleanups: dict[str, dict[str, Any]] = {}
        self._run_number_counters: dict[tuple[str, str], int] = {}

    def _assert_user_heavy_run_available(self, owner_user_id: uuid.UUID | str | None) -> None:
        if owner_user_id is None:
            return
        owner = owner_user_id if isinstance(owner_user_id, uuid.UUID) else uuid.UUID(str(owner_user_id))
        document_ids = {
            row["id"] for row in self.documents.values() if row.get("owner_user_id") == owner
        }
        dataset_ids = {
            row["id"] for row in self.datasets.values() if row.get("document_id") in document_ids
        }
        active = False
        current = now_utc()
        for store, key, ids, parse in (
            (self.parses, "document_id", document_ids, True),
            (self.embedding_runs, "document_id", document_ids, False),
            (self.experiments, "document_id", document_ids, False),
            (self.evaluations, "dataset_id", dataset_ids, False),
        ):
            for row in store.values():
                if row.get(key) not in ids:
                    continue
                row.update(_expired_run_update(row, parse=parse, now=current))
                active = active or row.get("status") in {"queued", "running"}
        if active:
            raise ApiProblem(
                429,
                "user_run_limit_reached",
                "Another expensive operation is already queued or running for this user.",
            )

    def _next_run_number(self, document_id: str, kind: str) -> int:
        key = (document_id, kind)
        value = self._run_number_counters.get(key, 0) + 1
        self._run_number_counters[key] = value
        return value

    def create_document(self, metadata, storage_bucket, storage_path, sha256):
        document_id = new_id()
        owner_user_id = metadata.get("owner_user_id")
        with self._lock:
            if self.get_document_by_sha256(sha256, owner_user_id=owner_user_id) is not None:
                raise ApiProblem(409, "duplicate_document", "A document with this SHA256 already exists for this user.")
        row = {
            "id": document_id,
            **metadata,
            "storage_bucket": storage_bucket,
            "storage_path": storage_path,
            "sha256": sha256,
            "owner_user_id": metadata.get("owner_user_id"),
            "active_parse_run_id": None,
            "active_chunk_run_id": None,
            "active_embedding_run_id": None,
            "created_at": now_utc(),
            "updated_at": now_utc(),
        }
        self.documents[document_id] = row
        # Every document starts with one explicit lineage container.  This
        # keeps downstream actions deterministic even before the first parse.
        default_pipeline_id = new_id()
        self.document_pipelines[default_pipeline_id] = {
            "id": default_pipeline_id,
            "owner_user_id": row.get("owner_user_id"),
            "document_id": document_id,
            "name": "Default Pipeline",
            "parse_run_id": None,
            "chunk_run_id": None,
            "embedding_run_id": None,
            "revision": 1,
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
        return copy.deepcopy(row)

    def save_parse(self, document_id, parsed, *, run_id=None):
        queued = self.create_parse_run(document_id, parser_version="unknown", run_id=run_id)
        if queued is None:
            return None
        self.mark_parse_running(queued["id"])
        return self.complete_parse(queued["id"], parsed, parser_version="unknown")

    def create_parse_run(
        self,
        document_id,
        *,
        parser_version="unknown",
        config=None,
        run_id=None,
        admission_owner_user_id=None,
    ):
        document = self.documents.get(document_id)
        if document is None:
            return None
        with self._lock:
            existing = self.find_inflight_parse(document_id)
            if existing is not None:
                raise ApiProblem(409, "parse_already_in_progress", "A parse run is already in progress for this document.")
            self._assert_user_heavy_run_available(admission_owner_user_id)
            identifier = run_id or new_id()
            now = now_utc()
            row = {
                "id": identifier,
                "run_number": self._next_run_number(document_id, "parse"),
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
            for row in self.parses.values():
                if row["document_id"] == document_id:
                    row.update(_expired_run_update(row, parse=True))
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
                    "duration_ms": duration_ms if duration_ms is not None else duration_ms_between(
                        row.get("started_at"), completed_at
                    ),
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
            if code == "parse_timeout" and not _expired_run_update(row, parse=True):
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

    def get_document_by_sha256(self, sha256, *, owner_user_id=None):
        owner = owner_user_id
        if owner is not None and not isinstance(owner, uuid.UUID):
            owner = uuid.UUID(str(owner))
        with self._lock:
            rows = [
                row for row in self.documents.values()
                if row.get("sha256") == sha256
                and (owner is None or row.get("owner_user_id") == owner)
            ]
            rows.sort(
                key=lambda row: (
                    row.get("active_parse_run_id") is not None,
                    row.get("updated_at") or datetime.min.replace(tzinfo=timezone.utc),
                    row.get("created_at") or datetime.min.replace(tzinfo=timezone.utc),
                ),
                reverse=True,
            )
            return copy.deepcopy(rows[0]) if rows else None

    def list_document_rows(self, *, owner_user_id=None):
        owner = owner_user_id
        if owner is not None and not isinstance(owner, uuid.UUID):
            owner = uuid.UUID(str(owner))
        return copy.deepcopy([row for row in self.documents.values() if owner is None or row.get("owner_user_id") == owner])

    def latest_parse_metadata(self, *, owner_user_id=None):
        document_ids = {row["id"] for row in self.list_document_rows(owner_user_id=owner_user_id)}
        latest = {}
        for row in self.parses.values():
            document_id = row["document_id"]
            if document_id not in document_ids:
                continue
            key = (row.get("created_at") or datetime.min.replace(tzinfo=timezone.utc), row["id"])
            if document_id not in latest or key > latest[document_id][0]:
                latest[document_id] = (key, {field: row.get(field) for field in ("status", "error_code", "error_message")})
        return {document_id: metadata for document_id, (_, metadata) in latest.items()}

    def delete_document(self, document_id):
        self.documents.pop(document_id, None)
        self.document_pipelines = {
            key: row for key, row in self.document_pipelines.items() if row["document_id"] != document_id
        }
        self.parses = {key: row for key, row in self.parses.items() if row["document_id"] != document_id}
        self.chunk_runs = {key: row for key, row in self.chunk_runs.items() if row["document_id"] != document_id}
        self.chunks = {key: value for key, value in self.chunks.items() if key in self.chunk_runs}
        self.embedding_runs = {key: row for key, row in self.embedding_runs.items() if row["document_id"] != document_id}
        self.embeddings = {key: value for key, value in self.embeddings.items() if key in self.embedding_runs}
        self.experiments = {key: row for key, row in self.experiments.items() if row["document_id"] != document_id}
        dataset_ids = {key for key, row in self.datasets.items() if row["document_id"] == document_id}
        self.datasets = {key: row for key, row in self.datasets.items() if key not in dataset_ids}
        self.evaluations = {key: row for key, row in self.evaluations.items() if row["dataset_id"] not in dataset_ids}

    def delete_document_with_cleanup(self, document_id):
        with self._lock:
            document = self.documents.get(document_id)
            if document is None:
                return None
            existing = next(
                (
                    row for row in self.storage_cleanups.values()
                    if row["storage_path"] == document["storage_path"]
                ),
                None,
            )
            cleanup = existing or {
                "id": new_id(),
                "owner_user_id": document["owner_user_id"],
                "storage_bucket": document["storage_bucket"],
                "storage_path": document["storage_path"],
                "status": "pending",
                "attempt_count": 0,
                "last_error_code": None,
                "created_at": now_utc(),
                "completed_at": None,
            }
            self.storage_cleanups[cleanup["id"]] = cleanup
            self.delete_document(document_id)
            return copy.deepcopy(cleanup)

    def list_pending_storage_cleanups(self, *, limit=3, owner_user_id=None):
        owner = None if owner_user_id is None else uuid.UUID(str(owner_user_id))
        rows = [
            row for row in self.storage_cleanups.values()
            if row["status"] == "pending" and (owner is None or row["owner_user_id"] == owner)
        ]
        rows.sort(key=lambda row: (row["created_at"], row["id"]))
        return copy.deepcopy(rows[: max(0, limit)])

    def complete_storage_cleanup(self, cleanup_id):
        with self._lock:
            row = self.storage_cleanups.get(cleanup_id)
            if row is not None:
                row.update({"status": "completed", "last_error_code": None, "completed_at": now_utc()})

    def fail_storage_cleanup(self, cleanup_id, code):
        with self._lock:
            row = self.storage_cleanups.get(cleanup_id)
            if row is not None and row["status"] == "pending":
                row["attempt_count"] += 1
                row["last_error_code"] = code

    def _ensure_unique_pipeline_name(self, document_id, name, *, exclude_id=None):
        normalized = name.casefold()
        if any(
            row["document_id"] == document_id
            and row["id"] != exclude_id
            and row["name"].casefold() == normalized
            for row in self.document_pipelines.values()
        ):
            raise ApiProblem(409, "pipeline_name_conflict", "A pipeline with this name already exists.")

    def create_document_pipeline(self, row):
        with self._lock:
            document = self.documents.get(row["document_id"])
            if document is None or document.get("owner_user_id") != row.get("owner_user_id"):
                return None
            self._ensure_unique_pipeline_name(row["document_id"], row["name"])
            now = now_utc()
            stored = {
                **copy.deepcopy(row),
                "id": row.get("id") or new_id(),
                "revision": 1,
                "created_at": now,
                "updated_at": now,
            }
            self.document_pipelines[stored["id"]] = stored
            return copy.deepcopy(stored)

    def get_document_pipeline_row(self, pipeline_id, *, owner_user_id=None):
        row = self.document_pipelines.get(pipeline_id)
        if row is None:
            return None
        if owner_user_id is not None and row.get("owner_user_id") != uuid.UUID(str(owner_user_id)):
            return None
        return copy.deepcopy(row)

    def list_document_pipeline_rows(self, document_id, *, owner_user_id=None):
        if owner_user_id is not None:
            document = self.documents.get(document_id)
            if document is None or document.get("owner_user_id") != uuid.UUID(str(owner_user_id)):
                return None
        rows = [row for row in self.document_pipelines.values() if row["document_id"] == document_id]
        if owner_user_id is not None:
            rows = [row for row in rows if row.get("owner_user_id") == uuid.UUID(str(owner_user_id))]
        rows.sort(key=lambda row: (row.get("created_at") or now_utc(), row["id"]))
        return copy.deepcopy(rows)

    def update_document_pipeline(self, pipeline_id, expected_revision, changes, *, owner_user_id=None):
        with self._lock:
            row = self.document_pipelines.get(pipeline_id)
            if row is None or (
                owner_user_id is not None
                and row.get("owner_user_id") != uuid.UUID(str(owner_user_id))
            ):
                return None
            if row["revision"] != expected_revision:
                raise ApiProblem(409, "pipeline_conflict", "The pipeline changed. Reload it before saving again.")
            if "name" in changes:
                self._ensure_unique_pipeline_name(row["document_id"], changes["name"], exclude_id=pipeline_id)
            row.update(copy.deepcopy(changes))
            row["revision"] += 1
            row["updated_at"] = now_utc()
            return copy.deepcopy(row)

    def delete_document_pipeline(self, pipeline_id, *, owner_user_id=None):
        with self._lock:
            row = self.document_pipelines.get(pipeline_id)
            if row is None or (
                owner_user_id is not None
                and row.get("owner_user_id") != uuid.UUID(str(owner_user_id))
            ):
                return False
            siblings = [item for item in self.document_pipelines.values() if item["document_id"] == row["document_id"]]
            if len(siblings) <= 1:
                raise ApiProblem(409, "default_pipeline_required", "A document must keep at least one pipeline.")
            return self.document_pipelines.pop(pipeline_id, None) is not None

    def get_parse_row(self, run_id):
        return copy.deepcopy(self.parses.get(run_id))

    def list_parse_rows(self, document_id):
        rows = [row for row in self.parses.values() if row["document_id"] == document_id]
        rows.sort(key=lambda row: row.get("created_at") or now_utc(), reverse=True)
        return copy.deepcopy(rows)

    def get_document_summary_bundle(self, document_id, *, owner_user_id=None):
        document = self.get_document_row(document_id)
        if document is None:
            return None
        if owner_user_id is not None and document.get("owner_user_id") != uuid.UUID(str(owner_user_id)):
            return None
        return {
            "document": document,
            "pipelines": self.list_document_pipeline_rows(document_id) or [],
            "parses": [_summary_parse_row(row) for row in self.list_parse_rows(document_id)],
            "chunks": [_summary_chunk_row(row) for row in self.list_chunk_rows(document_id)],
            "embeddings": [_summary_embedding_row(row) for row in self.list_embedding_rows(document_id)],
            "experiments": [_summary_experiment_row(row) for row in self.list_experiment_rows(document_id)],
            "datasets": [_summary_dataset_row(row) for row in self.list_dataset_rows(document_id)],
            "evaluations": [
                _summary_document_evaluation_row(
                    {
                        **row,
                        "parse_run_id": self.datasets[row["dataset_id"]]["parse_run_id"],
                        "chunk_run_id": (row.get("config") or {}).get("chunk_run_id"),
                        "embedding_run_id": (row.get("config") or {}).get("embedding_run_id"),
                    }
                )
                for row in self.evaluations.values()
                if row.get("dataset_id") in self.datasets
                and self.datasets[row["dataset_id"]].get("document_id") == document_id
            ],
        }

    def claim_chunk_run(
        self,
        document_id,
        parse_run_id,
        strategy,
        config,
        config_hash_value,
        tokenizer_version,
        chunker_version,
    ):
        with self._lock:
            existing = next(
                (
                    row
                    for row in self.chunk_runs.values()
                    if row["document_id"] == document_id
                    and row["parse_run_id"] == parse_run_id
                    and row["strategy"] == strategy
                    and row["config_hash"] == config_hash_value
                    and row["tokenizer_version"] == tokenizer_version
                    and row["chunker_version"] == chunker_version
                    and row.get("identity_claimed") is True
                    and row["status"] in {"running", "completed"}
                ),
                None,
            )
            if existing is not None:
                if existing.get("status") == "running" and _lease_expired(existing):
                    started_at = now_utc()
                    existing.update(
                        {
                            "lease_token": str(uuid.uuid4()),
                            "lease_expires_at": started_at + timedelta(seconds=pipeline_lease_duration_seconds(get_settings())),
                            "started_at": started_at,
                            "completed_at": None,
                            "error_code": None,
                            "error_message": None,
                        }
                    )
                    return copy.deepcopy(existing | {"chunks": self.chunks.get(existing["id"], []), "lineage_fingerprint": chunk_lineage_fingerprint(existing)}), True
                return copy.deepcopy(existing | {"chunks": self.chunks.get(existing["id"], []), "lineage_fingerprint": chunk_lineage_fingerprint(existing)}), False

            identifier = new_id()
            started_at = now_utc()
            row = {
                "id": identifier,
                "run_number": self._next_run_number(document_id, "chunk"),
                "document_id": document_id,
                "parse_run_id": parse_run_id,
                "strategy": strategy,
                "config": copy.deepcopy(config),
                "config_hash": config_hash_value,
                "tokenizer_version": tokenizer_version,
                "chunker_version": chunker_version,
                "identity_claimed": True,
                "lease_token": str(uuid.uuid4()),
                "lease_expires_at": started_at + timedelta(seconds=pipeline_lease_duration_seconds(get_settings())),
                "status": "running",
                "chunk_count": 0,
                "error_code": None,
                "error_message": None,
                "started_at": started_at,
                "completed_at": None,
                "duration_ms": None,
                "created_at": started_at,
            }
            self.chunk_runs[identifier] = row
            self.chunks[identifier] = []
            return copy.deepcopy(row | {"chunks": [], "lineage_fingerprint": chunk_lineage_fingerprint(row)}), True

    def complete_chunk_run(self, run_id, drafts, lease_token=None, *, unfenced=False):
        with self._lock:
            row = self.chunk_runs.get(run_id)
            if row is None:
                return None
            if _completion_replay(row.get("status"), lease_token):
                return copy.deepcopy(row | {"chunks": self.chunks.get(run_id, []), "lineage_fingerprint": chunk_lineage_fingerprint(row)})
            if not _artifact_fence_allows(row, lease_token, unfenced):
                return None
            if row["status"] != "running":
                return copy.deepcopy(row | {"chunks": self.chunks.get(run_id, []), "lineage_fingerprint": chunk_lineage_fingerprint(row)})

            completed_at = now_utc()
            items: list[dict[str, Any]] = []
            for draft in drafts:
                items.append(
                    {
                        "id": new_id(),
                        "document_id": row["document_id"],
                        "chunk_run_id": run_id,
                        "ordinal": draft.ordinal,
                        "text": draft.text,
                        "page_numbers": list(draft.page_numbers),
                        "source_element_ids": list(draft.source_element_ids),
                        "heading_path": list(draft.heading_path),
                        "token_count": draft.token_count,
                        "character_count": draft.character_count,
                    }
                )
            row.update(
                {
                    "status": "completed",
                    "chunk_count": len(items),
                    "completed_at": completed_at,
                    "duration_ms": duration_ms_between(row.get("started_at"), completed_at),
                    "error_code": None,
                    "error_message": None,
                    "lease_token": None,
                    "lease_expires_at": None,
                }
            )
            self.chunks[run_id] = items
            document = self.documents[row["document_id"]]
            if document.get("active_parse_run_id") in {None, row["parse_run_id"]}:
                document["active_parse_run_id"] = row["parse_run_id"]
                document["active_chunk_run_id"] = run_id
                document["active_embedding_run_id"] = None
                document["updated_at"] = completed_at
            return copy.deepcopy(row | {"chunks": items, "lineage_fingerprint": chunk_lineage_fingerprint(row)})

    def fail_chunk_run(self, run_id, code, message, lease_token=None, *, unfenced=False):
        with self._lock:
            row = self.chunk_runs.get(run_id)
            if row is None:
                return None
            if not _artifact_fence_allows(row, lease_token, unfenced):
                return None
            if row["status"] in {"failed", "interrupted"} or (
                row["status"] == "completed" and code != "artifact_incomplete"
            ):
                return copy.deepcopy(row | {"chunks": self.chunks.get(run_id, [])})
            if row["status"] == "completed":
                self._detach_failed_artifact(row["document_id"], "chunk", run_id)
            completed_at = now_utc()
            row.update(
                {
                    "identity_claimed": None,
                    "status": "failed",
                    "error_code": code,
                    "error_message": message,
                    "lease_token": None,
                    "lease_expires_at": None,
                    "completed_at": completed_at,
                    "duration_ms": duration_ms_between(row.get("started_at"), completed_at),
                }
            )
            return copy.deepcopy(row | {"chunks": self.chunks.get(run_id, [])})

    def save_chunk_run(self, document_id, parse_run_id, request, drafts):
        config = _dump(request.config)
        claim, claimed = self.claim_chunk_run(
            document_id,
            parse_run_id,
            request.strategy,
            config,
            config_hash(config),
            TOKENIZER_VERSION,
            chunker_version_for_strategy(request.strategy),
        )
        return self.complete_chunk_run(claim["id"], drafts, claim.get("lease_token")) if claimed else claim

    def get_chunk_row(self, run_id, *, owner_user_id=None):
        row = self.chunk_runs.get(run_id)
        if row is None:
            return None
        if owner_user_id is not None:
            document = self.documents.get(row["document_id"])
            if document is None or document.get("owner_user_id") != uuid.UUID(str(owner_user_id)):
                return None
        return copy.deepcopy(row | {"chunks": self.chunks.get(run_id, []), "lineage_fingerprint": chunk_lineage_fingerprint(row)})

    def list_chunk_rows(self, document_id):
        return copy.deepcopy(
            [row | {"chunks": self.chunks.get(row["id"], []), "lineage_fingerprint": chunk_lineage_fingerprint(row)} for row in self.chunk_runs.values() if row["document_id"] == document_id]
        )

    def claim_embedding_run(
        self,
        document_id,
        chunk_run_id,
        model,
        dimensions,
        format_version,
        admission_owner_user_id=None,
    ):
        with self._lock:
            existing = next(
                (
                    row
                    for row in self.embedding_runs.values()
                    if row["document_id"] == document_id
                    and row["chunk_run_id"] == chunk_run_id
                    and row["model"] == model
                    and row["dimensions"] == dimensions
                    and row["embedding_format_version"] == format_version
                    and row.get("identity_claimed") is True
                    and row["status"] in {"running", "completed"}
                ),
                None,
            )
            if existing is not None:
                if existing.get("status") == "running" and _lease_expired(existing):
                    self._assert_user_heavy_run_available(admission_owner_user_id)
                    existing["identity_claimed"] = True
                    existing["status"] = "running"
                    started_at = now_utc()
                    existing.update(
                        {
                            "lease_token": str(uuid.uuid4()),
                            "lease_expires_at": started_at + timedelta(seconds=pipeline_lease_duration_seconds(get_settings())),
                            "started_at": started_at,
                            "completed_at": None,
                            "error_code": None,
                            "error_message": None,
                        }
                    )
                    return copy.deepcopy(existing), True
                return copy.deepcopy(existing), False

            self._assert_user_heavy_run_available(admission_owner_user_id)

            identifier = new_id()
            started_at = now_utc()
            row = {
                "id": identifier,
                "run_number": self._next_run_number(document_id, "embedding"),
                "document_id": document_id,
                "chunk_run_id": chunk_run_id,
                "model": model,
                "dimensions": dimensions,
                "embedding_format_version": format_version,
                "identity_claimed": True,
                "lease_token": str(uuid.uuid4()),
                "lease_expires_at": started_at + timedelta(seconds=pipeline_lease_duration_seconds(get_settings())),
                "effective_model": None,
                "status": "running",
                "embedding_count": 0,
                "error_code": None,
                "error_message": None,
                "started_at": started_at,
                "completed_at": None,
                "duration_ms": None,
                "created_at": started_at,
            }
            self.embedding_runs[identifier] = row
            self.embeddings[identifier] = []
            return copy.deepcopy(row), True

    def complete_embedding_run(self, run_id, values, input_hashes=None, effective_model=None, lease_token=None, *, unfenced=False):
        with self._lock:
            row = self.embedding_runs.get(run_id)
            if row is None:
                return None
            if _completion_replay(row.get("status"), lease_token):
                return copy.deepcopy(row)
            if not _artifact_fence_allows(row, lease_token, unfenced):
                return None
            if row["status"] != "running":
                return copy.deepcopy(row)
            completed_at = now_utc()
            self.embeddings[run_id] = [
                {
                    "id": new_id(),
                    "embedding_run_id": run_id,
                    "chunk_id": chunk_id,
                    "embedding": vector,
                    "input_hash": (input_hashes or {}).get(chunk_id),
                }
                for chunk_id, vector in values
            ]
            row.update(
                {
                    "status": "completed",
                    "embedding_count": len(values),
                    "effective_model": effective_model,
                    "completed_at": completed_at,
                    "duration_ms": duration_ms_between(row.get("started_at"), completed_at),
                    "error_code": None,
                    "error_message": None,
                    "lease_token": None,
                    "lease_expires_at": None,
                }
            )
            document = self.documents[row["document_id"]]
            chunk_parse_id = self.chunk_runs[row["chunk_run_id"]]["parse_run_id"]
            if _embedding_advances_default(
                document.get("active_parse_run_id"), document.get("active_chunk_run_id"), chunk_parse_id, row["chunk_run_id"]
            ):
                document["active_parse_run_id"] = chunk_parse_id
                document["active_chunk_run_id"] = row["chunk_run_id"]
                document["active_embedding_run_id"] = run_id
                document["updated_at"] = completed_at
            return copy.deepcopy(row)

    def _detach_failed_artifact(self, document_id: str, kind: str, run_id: str) -> None:
        document = self.documents.get(document_id)
        if kind == "chunk":
            if document is not None and document.get("active_chunk_run_id") == run_id:
                document["active_chunk_run_id"] = None
                document["active_embedding_run_id"] = None
            fields = ("chunk_run_id", "embedding_run_id")
        else:
            if document is not None and document.get("active_embedding_run_id") == run_id:
                document["active_embedding_run_id"] = None
            fields = ("embedding_run_id",)
        for pipeline in self.document_pipelines.values():
            if pipeline.get(fields[0]) == run_id:
                for field in fields:
                    pipeline[field] = None
                pipeline["revision"] += 1
                pipeline["updated_at"] = now_utc()

    def fail_embedding_run(self, run_id, code, message, lease_token=None, *, unfenced=False):
        with self._lock:
            row = self.embedding_runs.get(run_id)
            if row is None:
                return None
            if not _artifact_fence_allows(row, lease_token, unfenced):
                return None
            if row["status"] in {"failed", "interrupted"} or (
                row["status"] == "completed" and code != "artifact_incomplete"
            ):
                return copy.deepcopy(row)
            if row["status"] == "completed":
                self._detach_failed_artifact(row["document_id"], "embedding", run_id)
            completed_at = now_utc()
            row.update(
                {
                    "identity_claimed": None,
                    "status": "failed",
                    "error_code": code,
                    "error_message": message,
                    "lease_token": None,
                    "lease_expires_at": None,
                    "completed_at": completed_at,
                    "duration_ms": duration_ms_between(row.get("started_at"), completed_at),
                }
            )
            return copy.deepcopy(row)

    def save_embedding_run(self, document_id, chunk_run_id, model, dimensions, format_version, values, input_hashes=None):
        claim, claimed = self.claim_embedding_run(document_id, chunk_run_id, model, dimensions, format_version)
        return self.complete_embedding_run(claim["id"], values, input_hashes, None, claim.get("lease_token")) if claimed else claim

    def get_embedding_row(self, run_id, *, owner_user_id=None):
        row = self.embedding_runs.get(run_id)
        if row is not None and owner_user_id is not None:
            document = self.documents.get(row["document_id"])
            if document is None or document.get("owner_user_id") != uuid.UUID(str(owner_user_id)):
                return None
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

    def get_completed_experiment_by_fingerprint(self, document_id, experiment_fingerprint):
        with self._lock:
            rows = [
                row
                for row in self.experiments.values()
                if row.get("document_id") == document_id
                and row.get("experiment_fingerprint") == experiment_fingerprint
                and row.get("status") == "completed"
            ]
            rows.sort(key=lambda row: (row.get("created_at") or now_utc(), row.get("id", "")), reverse=True)
            return copy.deepcopy(rows[0]) if rows else None

    def claim_experiment(self, row, *, admission_owner_user_id=None, bypass_user_admission=False):
        with self._lock:
            requested_status = row.get("status", "running")
            durable = requested_status in {"queued", "running"} and row.get("lease_token") is not None
            existing = next(
                (
                    value
                    for value in self.experiments.values()
                    if value.get("document_id") == row.get("document_id")
                    and value.get("experiment_fingerprint") == row.get("experiment_fingerprint")
                    and value.get("identity_claimed") is True
                    and value.get("status") in {"queued", "running"}
                ),
                None,
            )
            if existing is not None:
                if durable and _lease_expired(existing):
                    if not bypass_user_admission:
                        self._assert_user_heavy_run_available(admission_owner_user_id)
                    existing["identity_claimed"] = True
                    existing.update(
                        {
                            "status": "queued",
                            "lease_token": row.get("lease_token"),
                            "lease_expires_at": row.get("lease_expires_at"),
                            "dispatch_id": None,
                            "worker_started_at": None,
                            "attempt_count": int(existing.get("attempt_count", 0)) + 1,
                            "started_at": now_utc(),
                            "completed_at": None,
                            "error_code": None,
                            "error_message": None,
                        }
                    )
                    return copy.deepcopy(existing), True
                return copy.deepcopy(existing), False
            if not bypass_user_admission:
                self._assert_user_heavy_run_available(admission_owner_user_id)
            payload = copy.deepcopy(row)
            payload.setdefault("id", new_id())
            payload.setdefault("created_at", now_utc())
            payload.setdefault("started_at", now_utc())
            payload.setdefault("stage_results", {})
            payload["status"] = requested_status
            payload["identity_claimed"] = True
            payload.setdefault("attempt_count", 1 if durable else 0)
            self.experiments[payload["id"]] = payload
            return copy.deepcopy(payload), True

    def update_experiment_stage(self, experiment_id, stage, result, lease_token=None):
        with self._lock:
            row = self.experiments.get(experiment_id)
            if row is None:
                return None
            if row.get("status") == "interrupted":
                return None
            if lease_token is not None and (
                str(row.get("lease_token")) != str(lease_token) or _lease_expired(row)
            ):
                return None
            stage_results = copy.deepcopy(row.get("stage_results") or {})
            stage_results[stage] = copy.deepcopy(result)
            row["stage_results"] = stage_results
            return copy.deepcopy(row)

    def complete_experiment(self, experiment_id, lease_token=None):
        with self._lock:
            row = self.experiments.get(experiment_id)
            if row is None:
                return None
            if row.get("status") == "interrupted":
                return None
            if lease_token is not None and (
                str(row.get("lease_token")) != str(lease_token) or _lease_expired(row)
            ):
                return None
            row["status"] = "completed"
            row["identity_claimed"] = None
            row["lease_token"] = None
            row["lease_expires_at"] = None
            row["completed_at"] = row.get("completed_at") or now_utc()
            started = row.get("started_at")
            if row.get("duration_ms") is None and started is not None:
                row["duration_ms"] = duration_ms_between(started, row["completed_at"])
            return copy.deepcopy(row)

    def fail_experiment(self, experiment_id, code, message, lease_token=None):
        with self._lock:
            row = self.experiments.get(experiment_id)
            if row is None:
                return None
            if row.get("status") == "interrupted":
                return None
            if lease_token is not None and (
                str(row.get("lease_token")) != str(lease_token) or _lease_expired(row)
            ):
                return None
            row["status"] = "failed"
            row["identity_claimed"] = None
            row["lease_token"] = None
            row["lease_expires_at"] = None
            row["error_code"] = code
            row["error_message"] = message
            row["completed_at"] = row.get("completed_at") or now_utc()
            started = row.get("started_at")
            if row.get("duration_ms") is None and started is not None:
                row["duration_ms"] = duration_ms_between(started, row["completed_at"])
            return copy.deepcopy(row)

    def find_stage_result(self, document_id, stage, fingerprint):
        with self._lock:
            rows = [
                row
                for row in self.experiments.values()
                if row.get("document_id") == document_id
                and row.get("status") in {"completed", "failed"}
                and isinstance((row.get("stage_results") or {}).get(stage), dict)
                and (row.get("stage_results") or {})[stage].get("fingerprint") == fingerprint
            ]
            rows.sort(key=lambda row: (row.get("created_at") or now_utc(), row.get("id", "")), reverse=True)
            if not rows:
                return None
            return copy.deepcopy(rows[0]["stage_results"][stage]), rows[0]["id"]

    def get_experiment_row(self, experiment_id):
        return copy.deepcopy(self.experiments.get(experiment_id))

    def list_experiment_rows(self, document_id=None):
        values = self.experiments.values()
        if document_id:
            values = [row for row in values if row["document_id"] == document_id]
        return copy.deepcopy(list(values))

    def list_experiment_summary_rows(self, document_id=None, *, owner_user_id=None):
        owner = uuid.UUID(str(owner_user_id)) if owner_user_id is not None else None
        values = self.experiments.values()
        rows = [
            row for row in values
            if (document_id is None or row.get("document_id") == document_id)
            and (owner is None or self.documents.get(row.get("document_id"), {}).get("owner_user_id") == owner)
        ]
        rows.sort(key=lambda row: row.get("created_at") or now_utc(), reverse=True)
        return [_summary_experiment_row(row) for row in copy.deepcopy(rows)]

    def save_dataset(self, request, parse_run_id):
        identifier = new_id()
        base = self.datasets.get(request.base_dataset_id) if getattr(request, "base_dataset_id", None) else None
        if request.base_dataset_id and (base is None or base.get("document_id") != request.document_id):
            raise ApiProblem(404, "dataset_not_found", "The base evaluation dataset was not found.")
        series_id = base.get("series_id") if base else identifier
        version = max((row.get("version", 0) for row in self.datasets.values() if row.get("series_id") == series_id), default=0) + 1
        row = {
            "id": identifier,
            "document_id": request.document_id,
            "parse_run_id": parse_run_id,
            "name": request.name,
            "series_id": series_id,
            "version": version,
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

    def list_dataset_summary_rows(self, document_id=None, *, owner_user_id=None):
        owner = uuid.UUID(str(owner_user_id)) if owner_user_id is not None else None
        values = self.datasets.values()
        rows = [
            row for row in values
            if (document_id is None or row.get("document_id") == document_id)
            and (owner is None or self.documents.get(row.get("document_id"), {}).get("owner_user_id") == owner)
        ]
        rows.sort(key=lambda row: row.get("created_at") or now_utc(), reverse=True)
        return [_summary_dataset_row(row) for row in copy.deepcopy(rows)]

    def get_dataset_row(self, dataset_id):
        return copy.deepcopy(self.datasets.get(dataset_id))

    def save_evaluation(self, row):
        payload = copy.deepcopy(row)
        payload.setdefault("id", new_id())
        payload.setdefault("created_at", now_utc())
        self.evaluations[payload["id"]] = payload
        return copy.deepcopy(payload)

    def claim_evaluation(self, row, *, admission_owner_user_id=None):
        with self._lock:
            requested_status = row.get("status", "queued")
            durable = requested_status in {"queued", "running"} and row.get("lease_token") is not None
            existing = next(
                (
                    value
                    for value in self.evaluations.values()
                    if value.get("dataset_id") == row.get("dataset_id")
                    and value.get("evaluation_fingerprint") == row.get("evaluation_fingerprint")
                    and value.get("identity_claimed") is True
                    and value.get("status") in {"queued", "running"}
                ),
                None,
            )
            if existing is not None:
                if durable and _lease_expired(existing):
                    self._assert_user_heavy_run_available(admission_owner_user_id)
                    existing["identity_claimed"] = True
                    existing.update(
                        {
                            "status": "queued",
                            "lease_token": row.get("lease_token"),
                            "lease_expires_at": row.get("lease_expires_at"),
                            "dispatch_id": None,
                            "worker_started_at": None,
                            "attempt_count": int(existing.get("attempt_count", 0)) + 1,
                            "error_code": None,
                            "error_message": None,
                            "started_at": row.get("started_at") or now_utc(),
                            "completed_at": None,
                        }
                    )
                    return copy.deepcopy(existing), True
                return copy.deepcopy(existing), False
            self._assert_user_heavy_run_available(admission_owner_user_id)
            payload = copy.deepcopy(row)
            payload.setdefault("id", new_id())
            payload.setdefault("created_at", now_utc())
            payload.setdefault("attempt_count", 1 if durable else 0)
            payload["identity_claimed"] = True
            self.evaluations[payload["id"]] = payload
            return copy.deepcopy(payload), True

    def get_evaluation_by_fingerprint(self, dataset_id, evaluation_fingerprint):
        with self._lock:
            rows = [
                row
                for row in self.evaluations.values()
                if row.get("dataset_id") == dataset_id
                and row.get("evaluation_fingerprint") == evaluation_fingerprint
                and row.get("status") in {"queued", "running", "completed"}
            ]
            rows.sort(key=lambda row: (row.get("created_at") or now_utc(), row.get("id", "")), reverse=True)
            return copy.deepcopy(rows[0]) if rows else None

    def update_evaluation(self, run_id, changes, lease_token=None):
        with self._lock:
            row = self.evaluations.get(run_id)
            if row is None:
                return None
            if row.get("status") == "interrupted":
                return None
            if lease_token is not None and (
                str(row.get("lease_token")) != str(lease_token) or _lease_expired(row)
            ):
                return None
            row.update(copy.deepcopy(changes))
            return copy.deepcopy(row)

    def set_pipeline_dispatch(self, kind, run_id, dispatch_id, lease_token=None, expected_dispatch_id=None):
        with self._lock:
            store = self.experiments if kind == "experiment" else self.evaluations
            row = store.get(run_id)
            if (
                row is None
                or row.get("status") not in {"queued", "running"}
                or (
                    lease_token is not None
                    and (str(row.get("lease_token")) != str(lease_token) or _lease_expired(row))
                )
                or (expected_dispatch_id is not None and row.get("dispatch_id") != expected_dispatch_id)
            ):
                return None
            row["dispatch_id"] = dispatch_id
            return copy.deepcopy(row)

    def claim_pipeline_dispatch(self, kind, run_id, dispatch_id, lease_token=None):
        with self._lock:
            store = self.experiments if kind == "experiment" else self.evaluations
            row = store.get(run_id)
            if (
                row is None
                or row.get("status") not in {"queued", "running"}
                or (
                    lease_token is not None
                    and (str(row.get("lease_token")) != str(lease_token) or _lease_expired(row))
                )
            ):
                return None
            if row.get("dispatch_id") is None:
                row["dispatch_id"] = dispatch_id
            return copy.deepcopy(row)

    def start_pipeline_worker(self, kind, run_id, lease_token, lease_duration_seconds):
        with self._lock:
            store = self.experiments if kind == "experiment" else self.evaluations
            row = store.get(run_id)
            if row is None or str(row.get("lease_token")) != str(lease_token) or _lease_expired(row):
                return None
            if row.get("status") not in {"queued", "running"}:
                return None
            now = now_utc()
            row.update({"status": "running", "worker_started_at": now, "lease_expires_at": now + timedelta(seconds=lease_duration_seconds)})
            if row.get("started_at") is None:
                row["started_at"] = now
            return copy.deepcopy(row)

    def renew_pipeline_lease(self, kind, run_id, lease_token, lease_duration_seconds):
        with self._lock:
            store = self.experiments if kind == "experiment" else self.evaluations
            row = store.get(run_id)
            if row is None or str(row.get("lease_token")) != str(lease_token) or row.get("status") != "running" or _lease_expired(row):
                return None
            row["lease_expires_at"] = now_utc() + timedelta(seconds=lease_duration_seconds)
            return copy.deepcopy(row)

    def complete_pipeline_worker(self, kind, run_id, lease_token):
        return self.complete_experiment(run_id, lease_token) if kind == "experiment" else self.update_evaluation(
            run_id,
            {
                "status": "completed",
                "identity_claimed": None,
                "completed_at": now_utc(),
                "lease_token": None,
                "lease_expires_at": None,
            },
            lease_token,
        )

    def fail_pipeline_worker(self, kind, run_id, lease_token, code, message):
        return self.fail_experiment(run_id, code, message, lease_token) if kind == "experiment" else self.update_evaluation(
            run_id,
            {
                "status": "failed",
                "identity_claimed": None,
                "error_code": code,
                "error_message": message,
                "completed_at": now_utc(),
                "lease_token": None,
                "lease_expires_at": None,
            },
            lease_token,
        )

    def reconcile_pipeline_lease(self, kind, run_id):
        with self._lock:
            store = self.experiments if kind == "experiment" else self.evaluations
            row = store.get(run_id)
            if row is None:
                return None
            row.update(_expired_run_update(row))
            return copy.deepcopy(row)

    def get_evaluation_row(self, run_id):
        return copy.deepcopy(self.evaluations.get(run_id))

    def list_evaluation_rows(self, dataset_id=None):
        values = self.evaluations.values()
        if dataset_id:
            values = [row for row in values if row["dataset_id"] == dataset_id]
        return copy.deepcopy(list(values))

    def list_evaluation_summary_rows(self, dataset_id=None, *, owner_user_id=None):
        owner = uuid.UUID(str(owner_user_id)) if owner_user_id is not None else None
        rows = [
            row for row in self.evaluations.values()
            if (dataset_id is None or row.get("dataset_id") == dataset_id)
            and (
                owner is None
                or self.documents.get(self.datasets.get(row.get("dataset_id"), {}).get("document_id"), {}).get("owner_user_id") == owner
            )
        ]
        rows.sort(key=lambda row: row.get("created_at") or now_utc(), reverse=True)
        return [_summary_evaluation_row(row) for row in copy.deepcopy(rows)]


def _orm_dict(row: Any, fields: Iterable[str]) -> dict[str, Any]:
    return {field: getattr(row, field) for field in fields}


class SqlAlchemyRepository(Repository):
    persistent = True

    @staticmethod
    def _lock_user_admission(session, owner_user_id: uuid.UUID | str | None) -> None:
        if owner_user_id is None:
            return
        owner = str(owner_user_id)
        # Every admission check and insert for a user occurs under the same
        # transaction-scoped Postgres lock, so separate API containers agree.
        session.execute(
            text("select pg_advisory_xact_lock(hashtextextended(:owner_user_id, 0))"),
            {"owner_user_id": owner},
        )

    @classmethod
    def _assert_user_heavy_run_available(cls, session, owner_user_id: uuid.UUID | str | None) -> None:
        if owner_user_id is None:
            return
        cls._lock_user_admission(session, owner_user_id)
        owner = uuid.UUID(str(owner_user_id))
        active = False
        current = now_utc()
        for model in (ParseRun, EmbeddingRun, ExperimentRun, EvaluationRun):
            query = select(model)
            if model is EvaluationRun:
                query = query.join(EvaluationDataset, EvaluationDataset.id == model.dataset_id)
                query = query.join(Document, Document.id == EvaluationDataset.document_id)
            else:
                query = query.join(Document, Document.id == model.document_id)
            rows = session.scalars(
                query.where(Document.owner_user_id == owner, model.status.in_(["queued", "running"]))
                .order_by(model.id)
                .with_for_update(of=model)
            )
            for row in rows:
                payload = {
                    "status": row.status,
                    "started_at": row.started_at,
                    "created_at": row.created_at,
                    "lease_expires_at": getattr(row, "lease_expires_at", None),
                }
                for key, value in _expired_run_update(payload, parse=model is ParseRun, now=current).items():
                    setattr(row, key, value)
                active = active or row.status in {"queued", "running"}
        session.flush()
        if active:
            raise ApiProblem(
                429,
                "user_run_limit_reached",
                "Another expensive operation is already queued or running for this user.",
            )

    def create_document(self, metadata, storage_bucket, storage_path, sha256):
        row = Document(
            id=new_id(),
            file_name=metadata["file_name"],
            media_type=metadata["media_type"],
            size_bytes=metadata["size_bytes"],
            page_count=metadata.get("page_count", 0),
            sha256=sha256,
            owner_user_id=metadata.get("owner_user_id"),
            storage_bucket=storage_bucket,
            storage_path=storage_path,
        )
        with session_scope() as session:
            session.add(row)
            session.flush()
            if row.owner_user_id is not None:
                session.add(
                    DocumentPipeline(
                        id=new_id(),
                        owner_user_id=row.owner_user_id,
                        document_id=row.id,
                        name="Default Pipeline",
                        revision=1,
                    )
                )
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
            "storage_bucket": row.storage_bucket,
            "storage_path": row.storage_path,
            "active_parse_run_id": row.active_parse_run_id,
            "active_chunk_run_id": row.active_chunk_run_id,
            "active_embedding_run_id": row.active_embedding_run_id,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    @staticmethod
    def _document_summary_dict(row: dict[str, Any]) -> dict[str, Any]:
        """Map the document-only summary projection without materializing an ORM row."""
        return {
            "id": row["id"],
            "file_name": row["file_name"],
            "media_type": row["media_type"],
            "size_bytes": row["size_bytes"],
            "page_count": row.get("page_count", 0),
            "sha256": row.get("sha256"),
            "owner_user_id": row.get("owner_user_id"),
            "storage_bucket": row.get("storage_bucket"),
            "storage_path": row.get("storage_path"),
            "active_parse_run_id": row.get("active_parse_run_id"),
            "active_chunk_run_id": row.get("active_chunk_run_id"),
            "active_embedding_run_id": row.get("active_embedding_run_id"),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
        }

    def save_parse(self, document_id, parsed, *, run_id=None):
        queued = self.create_parse_run(document_id, parser_version="unknown", run_id=run_id)
        if queued is None:
            return None
        self.mark_parse_running(queued["id"])
        return self.complete_parse(queued["id"], parsed, parser_version="unknown")

    def create_parse_run(
        self,
        document_id,
        *,
        parser_version="unknown",
        config=None,
        run_id=None,
        admission_owner_user_id=None,
    ):
        identifier = run_id or new_id()
        try:
            with session_scope() as session:
                self._lock_user_admission(session, admission_owner_user_id)
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
                    for key, value in _expired_run_update(self._parse_dict(existing), parse=True).items():
                        setattr(existing, key, value)
                    session.flush()
                    if existing.status == "interrupted":
                        existing = None
                if existing is not None:
                    raise ApiProblem(
                        409,
                        "parse_already_in_progress",
                        "A parse run is already in progress for this document.",
                    )
                self._assert_user_heavy_run_available(session, admission_owner_user_id)
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
                .with_for_update()
            ).first()
            if row is not None:
                for key, value in _expired_run_update(self._parse_dict(row), parse=True).items():
                    setattr(row, key, value)
                session.flush()
                if row.status == "interrupted":
                    return None
            return self._parse_dict(row) if row else None

    def set_parse_dispatch(self, run_id, dispatch_id):
        with session_scope() as session:
            row = session.get(ParseRun, run_id, with_for_update=True)
            if row is None:
                return None
            row.dispatch_id = dispatch_id
            session.flush()
            return self._parse_dict(row)

    def mark_parse_running(self, run_id):
        with session_scope() as session:
            row = session.get(ParseRun, run_id, with_for_update=True)
            if row is None:
                return None
            if row.status == "queued":
                row.status = "running"
                row.started_at = row.started_at or now_utc()
                session.flush()
            return self._parse_dict(row)

    def update_parse_progress(self, run_id, progress, phase):
        with session_scope() as session:
            row = session.get(ParseRun, run_id, with_for_update=True)
            if row is None:
                return None
            if row.status in {"completed", "failed", "interrupted"}:
                return self._parse_dict(row)
            metadata = dict(row.execution_metadata or {})
            metadata.update({"progress": max(0, min(100, int(progress))), "phase": phase})
            row.execution_metadata = _dump(metadata)
            session.flush()
            return self._parse_dict(row)

    @staticmethod
    def _lock_run_document(session, model, run_id):
        """Lock the owning document before the run row.

        Every pointer writer takes ``documents`` first and the run second, the
        same order as document deletion, so concurrent completions serialize on
        the document instead of interleaving stale pointer reads.

        ``FOR NO KEY UPDATE`` (only pointer columns change) still conflicts with
        other pointer writers and with deletion, but not with the ``KEY SHARE``
        lock of child-row inserts (new runs, pipelines, experiments), so those
        are not blocked for the duration of a large artifact write.
        """

        document_id = session.scalar(select(model.document_id).where(model.id == run_id))
        if document_id is None:
            return None, None
        document = session.scalars(
            select(Document).where(Document.id == document_id).with_for_update(key_share=True)
        ).first()
        run = session.scalars(select(model).where(model.id == run_id).with_for_update()).first()
        return document, run

    @staticmethod
    def _detach_failed_artifact(session, document, kind: str, run_id: str) -> None:
        """Remove a no-longer-completed artifact from defaults and saved pipelines."""

        if kind == "chunk":
            if document is not None and document.active_chunk_run_id == run_id:
                document.active_chunk_run_id = None
                document.active_embedding_run_id = None
            target = DocumentPipeline.chunk_run_id == run_id
            values = {"chunk_run_id": None, "embedding_run_id": None}
        else:
            if document is not None and document.active_embedding_run_id == run_id:
                document.active_embedding_run_id = None
            target = DocumentPipeline.embedding_run_id == run_id
            values = {"embedding_run_id": None}
        session.flush()
        session.execute(
            update(DocumentPipeline)
            .where(target)
            .values(**values, revision=DocumentPipeline.revision + 1, updated_at=now_utc())
        )

    def complete_parse(self, run_id, parsed, *, parser_version="unknown", execution_metadata=None, duration_ms=None):
        payload = parsed.model_dump(mode="json", by_alias=False)
        if payload.get("structured") is None or payload.get("summary") is None:
            raise ValueError("completed parse payload is missing normalized content")
        with session_scope() as session:
            document, row = self._lock_run_document(session, ParseRun, run_id)
            if row is None:
                return None
            if row.status == "completed" or row.status in {"failed", "interrupted"}:
                return self._parse_dict(row)
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
            row.duration_ms = duration_ms if duration_ms is not None else duration_ms_between(row.started_at, completed_at)
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
            row = session.get(ParseRun, run_id, with_for_update=True)
            if row is None:
                return None
            if row.status in {"completed", "failed", "interrupted"}:
                return self._parse_dict(row)
            if code == "parse_timeout" and not _expired_run_update(self._parse_dict(row), parse=True):
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
            "run_number": row.run_number,
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

    def get_document_by_sha256(self, sha256, *, owner_user_id=None):
        with session_scope() as session:
            query = select(Document).where(Document.sha256 == sha256)
            if owner_user_id is not None:
                query = query.where(Document.owner_user_id == owner_user_id)
            query = query.order_by(
                Document.active_parse_run_id.is_not(None).desc(),
                Document.updated_at.desc(),
                Document.created_at.desc(),
                Document.id,
            )
            row = session.scalars(query).first()
            return self._document_dict(row) if row else None

    def list_document_rows(self, *, owner_user_id=None):
        with session_scope() as session:
            query = select(Document).order_by(Document.created_at.desc())
            if owner_user_id is not None:
                query = query.where(Document.owner_user_id == self._owner_uuid(owner_user_id))
            return [self._document_dict(row) for row in session.scalars(query)]

    def latest_parse_metadata(self, *, owner_user_id=None):
        ranked = select(
            ParseRun.document_id, ParseRun.status, ParseRun.error_code, ParseRun.error_message,
            func.row_number().over(partition_by=ParseRun.document_id,
                                   order_by=(ParseRun.created_at.desc(), ParseRun.id.desc())).label("position"),
        ).join(Document, Document.id == ParseRun.document_id)
        if owner_user_id is not None:
            ranked = ranked.where(Document.owner_user_id == self._owner_uuid(owner_user_id))
        latest = ranked.subquery()
        with session_scope() as session:
            rows = session.execute(select(latest.c.document_id, latest.c.status, latest.c.error_code,
                                          latest.c.error_message).where(latest.c.position == 1)).mappings()
            return {row["document_id"]: dict(row) for row in rows}

    def delete_document(self, document_id):
        with session_scope() as session:
            row = session.get(Document, document_id)
            if row is not None:
                session.delete(row)

    @staticmethod
    def _storage_cleanup_dict(row: StorageCleanup) -> dict[str, Any]:
        return {
            "id": row.id,
            "owner_user_id": row.owner_user_id,
            "storage_bucket": row.storage_bucket,
            "storage_path": row.storage_path,
            "status": row.status,
            "attempt_count": row.attempt_count,
            "last_error_code": row.last_error_code,
            "created_at": row.created_at,
            "completed_at": row.completed_at,
        }

    def delete_document_with_cleanup(self, document_id):
        with session_scope() as session:
            document = session.scalars(
                select(Document).where(Document.id == document_id).with_for_update()
            ).first()
            if document is None:
                return None
            cleanup = session.scalars(
                select(StorageCleanup).where(StorageCleanup.storage_path == document.storage_path)
            ).first()
            if cleanup is None:
                cleanup = StorageCleanup(
                    id=new_id(),
                    owner_user_id=document.owner_user_id,
                    storage_bucket=document.storage_bucket,
                    storage_path=document.storage_path,
                    status="pending",
                    attempt_count=0,
                )
                session.add(cleanup)
                session.flush()
            payload = self._storage_cleanup_dict(cleanup)
            session.delete(document)
            session.flush()
            return payload

    def list_pending_storage_cleanups(self, *, limit=3, owner_user_id=None):
        with session_scope() as session:
            query = select(StorageCleanup).where(StorageCleanup.status == "pending")
            if owner_user_id is not None:
                query = query.where(StorageCleanup.owner_user_id == self._owner_uuid(owner_user_id))
            rows = session.scalars(query.order_by(StorageCleanup.created_at, StorageCleanup.id).limit(max(0, limit))).all()
            return [self._storage_cleanup_dict(row) for row in rows]

    def complete_storage_cleanup(self, cleanup_id):
        with session_scope() as session:
            row = session.get(StorageCleanup, cleanup_id)
            if row is not None:
                row.status = "completed"
                row.last_error_code = None
                row.completed_at = now_utc()

    def fail_storage_cleanup(self, cleanup_id, code):
        with session_scope() as session:
            row = session.get(StorageCleanup, cleanup_id)
            if row is not None and row.status == "pending":
                row.attempt_count += 1
                row.last_error_code = code

    @staticmethod
    def _document_pipeline_dict(row: DocumentPipeline) -> dict[str, Any]:
        return {
            "id": row.id,
            "owner_user_id": row.owner_user_id,
            "document_id": row.document_id,
            "name": row.name,
            "parse_run_id": row.parse_run_id,
            "chunk_run_id": row.chunk_run_id,
            "embedding_run_id": row.embedding_run_id,
            "revision": row.revision,
            "is_default": row.name == "Default Pipeline",
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    def create_document_pipeline(self, values):
        row = DocumentPipeline(id=values.get("id") or new_id(), **{key: value for key, value in values.items() if key != "id"})
        try:
            with session_scope() as session:
                session.add(row)
                session.flush()
                return self._document_pipeline_dict(row)
        except IntegrityError as exc:
            if "uq_document_pipelines_document_name" in str(exc.orig):
                raise ApiProblem(409, "pipeline_name_conflict", "A pipeline with this name already exists.") from exc
            raise

    def get_document_pipeline_row(self, pipeline_id, *, owner_user_id=None):
        with session_scope() as session:
            query = select(DocumentPipeline).where(DocumentPipeline.id == pipeline_id)
            if owner_user_id is not None:
                query = query.where(DocumentPipeline.owner_user_id == self._owner_uuid(owner_user_id))
            row = session.scalars(query).first()
            return self._document_pipeline_dict(row) if row else None

    def list_document_pipeline_rows(self, document_id, *, owner_user_id=None):
        with session_scope() as session:
            if owner_user_id is None:
                query = select(DocumentPipeline).where(
                    DocumentPipeline.document_id == document_id
                ).order_by(DocumentPipeline.created_at, DocumentPipeline.id)
                return [self._document_pipeline_dict(row) for row in session.scalars(query)]

            owner_id = self._owner_uuid(owner_user_id)
            query = (
                select(Document, DocumentPipeline)
                .outerjoin(
                    DocumentPipeline,
                    and_(
                        DocumentPipeline.document_id == Document.id,
                        DocumentPipeline.owner_user_id == owner_id,
                    ),
                )
                .where(Document.id == document_id, Document.owner_user_id == owner_id)
                .order_by(DocumentPipeline.created_at, DocumentPipeline.id)
            )
            rows = session.execute(query).all()
            if not rows:
                return None
            return [
                self._document_pipeline_dict(pipeline)
                for _document, pipeline in rows
                if pipeline is not None
            ]

    def update_document_pipeline(self, pipeline_id, expected_revision, changes, *, owner_user_id=None):
        values = {**changes, "revision": expected_revision + 1, "updated_at": now_utc()}
        filters = [DocumentPipeline.id == pipeline_id, DocumentPipeline.revision == expected_revision]
        if owner_user_id is not None:
            filters.append(DocumentPipeline.owner_user_id == self._owner_uuid(owner_user_id))
        statement = update(DocumentPipeline).where(*filters).values(**values).returning(DocumentPipeline)
        try:
            with session_scope() as session:
                row = session.scalars(statement).first()
                if row is not None:
                    return self._document_pipeline_dict(row)
                exists_query = select(DocumentPipeline.id).where(DocumentPipeline.id == pipeline_id)
                if owner_user_id is not None:
                    exists_query = exists_query.where(
                        DocumentPipeline.owner_user_id == self._owner_uuid(owner_user_id)
                    )
                exists = session.scalars(exists_query).first()
                if exists is not None:
                    raise ApiProblem(409, "pipeline_conflict", "The pipeline changed. Reload it before saving again.")
                return None
        except IntegrityError as exc:
            if "uq_document_pipelines_document_name" in str(exc.orig):
                raise ApiProblem(409, "pipeline_name_conflict", "A pipeline with this name already exists.") from exc
            raise

    def delete_document_pipeline(self, pipeline_id, *, owner_user_id=None):
        with session_scope() as session:
            filters = [DocumentPipeline.id == pipeline_id]
            if owner_user_id is not None:
                filters.append(DocumentPipeline.owner_user_id == self._owner_uuid(owner_user_id))
            target_document_id = session.scalar(select(DocumentPipeline.document_id).where(*filters))
            if target_document_id is None:
                return False
            # Serialize sibling deletes on the document so two concurrent
            # deletes cannot both observe two pipelines and leave zero.
            session.execute(
                select(Document.id).where(Document.id == target_document_id).with_for_update(key_share=True)
            )
            target = session.scalars(select(DocumentPipeline).where(*filters).with_for_update()).first()
            if target is None:
                return False
            sibling_count = session.scalar(
                select(func.count(DocumentPipeline.id)).where(DocumentPipeline.document_id == target.document_id)
            ) or 0
            if sibling_count <= 1:
                raise ApiProblem(409, "default_pipeline_required", "A document must keep at least one pipeline.")
            statement = delete(DocumentPipeline).where(*filters).returning(DocumentPipeline.id)
            return session.execute(statement).scalar_one_or_none() is not None

    def get_parse_row(self, run_id):
        with session_scope() as session:
            row = session.get(ParseRun, run_id)
            return self._parse_dict(row) if row else None

    def list_parse_rows(self, document_id):
        with session_scope() as session:
            return [self._parse_dict(row) for row in session.scalars(select(ParseRun).where(ParseRun.document_id == document_id).order_by(ParseRun.created_at.desc()))]

    @staticmethod
    def _owner_uuid(owner_user_id):
        return uuid.UUID(str(owner_user_id)) if owner_user_id is not None else None

    def _summary_parse_rows(self, session, document_id, owner_user_id=None):
        query = select(
            ParseRun.id,
            ParseRun.run_number,
            ParseRun.document_id,
            ParseRun.parser_name,
            ParseRun.parser_version,
            ParseRun.normalized_schema_version,
            ParseRun.structured.is_not(None).label("has_structured"),
            ParseRun.summary.is_not(None).label("has_summary"),
            ParseRun.status,
            ParseRun.error_code,
            ParseRun.error_message,
            ParseRun.execution_metadata,
            ParseRun.started_at,
            ParseRun.completed_at,
            ParseRun.duration_ms,
            ParseRun.created_at,
            ParseRun.updated_at,
        ).where(ParseRun.document_id == document_id).order_by(ParseRun.created_at.desc())
        if owner_user_id is not None:
            query = query.join(Document, Document.id == ParseRun.document_id).where(Document.owner_user_id == self._owner_uuid(owner_user_id))
        return [_summary_parse_row(dict(row)) for row in session.execute(query).mappings().all()]

    def _summary_chunk_rows(self, session, document_id, owner_user_id=None):
        query = select(
            ChunkRun.id,
            ChunkRun.run_number,
            ChunkRun.document_id,
            ChunkRun.parse_run_id,
            ChunkRun.strategy,
            ChunkRun.config,
            ChunkRun.status,
            ChunkRun.chunk_count,
            ChunkRun.error_code,
            ChunkRun.error_message,
            ChunkRun.started_at,
            ChunkRun.completed_at,
            ChunkRun.duration_ms,
            ChunkRun.created_at,
        ).where(ChunkRun.document_id == document_id).order_by(ChunkRun.created_at.desc())
        if owner_user_id is not None:
            query = query.join(Document, Document.id == ChunkRun.document_id).where(Document.owner_user_id == self._owner_uuid(owner_user_id))
        return [_summary_chunk_row(dict(row)) for row in session.execute(query).mappings().all()]

    def _summary_embedding_rows(self, session, document_id, owner_user_id=None):
        query = select(
            EmbeddingRun.id,
            EmbeddingRun.run_number,
            EmbeddingRun.document_id,
            EmbeddingRun.chunk_run_id,
            EmbeddingRun.model,
            EmbeddingRun.dimensions,
            EmbeddingRun.embedding_format_version,
            EmbeddingRun.effective_model,
            EmbeddingRun.status,
            EmbeddingRun.embedding_count,
            EmbeddingRun.error_code,
            EmbeddingRun.error_message,
            EmbeddingRun.started_at,
            EmbeddingRun.completed_at,
            EmbeddingRun.duration_ms,
            EmbeddingRun.created_at,
        ).where(EmbeddingRun.document_id == document_id).order_by(EmbeddingRun.created_at.desc())
        if owner_user_id is not None:
            query = query.join(Document, Document.id == EmbeddingRun.document_id).where(Document.owner_user_id == self._owner_uuid(owner_user_id))
        return [_summary_embedding_row(dict(row)) for row in session.execute(query).mappings().all()]

    def _summary_experiment_rows(self, session, document_id=None, owner_user_id=None):
        candidate_count = func.coalesce(
            func.jsonb_array_length(ExperimentRun.stage_results["retrieval"]["results"]),
            func.jsonb_array_length(ExperimentRun.stage_results["retrieval"]["candidates"]),
        ).label("candidate_count")
        query = select(
            ExperimentRun.id,
            ExperimentRun.document_id,
            ExperimentRun.chunk_run_id,
            ExperimentRun.embedding_run_id,
            ExperimentRun.query,
            ExperimentRun.target_stage,
            ExperimentRun.experiment_fingerprint,
            ExperimentRun.config,
            candidate_count,
            ExperimentRun.stage_results["retrieval"]["status"].astext.label("retrieval_status"),
            ExperimentRun.stage_results["reranking"]["status"].astext.label("reranking_status"),
            ExperimentRun.stage_results["context"]["status"].astext.label("context_status"),
            ExperimentRun.stage_results["generation"]["status"].astext.label("generation_status"),
            ExperimentRun.status,
            ExperimentRun.error_code,
            ExperimentRun.error_message,
            ExperimentRun.started_at,
            ExperimentRun.completed_at,
            ExperimentRun.duration_ms,
            ExperimentRun.created_at,
        ).order_by(ExperimentRun.created_at.desc())
        if document_id is not None:
            query = query.where(ExperimentRun.document_id == document_id)
        if owner_user_id is not None:
            query = query.join(Document, Document.id == ExperimentRun.document_id).where(Document.owner_user_id == self._owner_uuid(owner_user_id))
        return [_summary_experiment_row(dict(row)) for row in session.execute(query).mappings().all()]

    def _summary_dataset_rows(self, session, document_id=None, owner_user_id=None):
        query = select(
            EvaluationDataset.id,
            EvaluationDataset.document_id,
            EvaluationDataset.parse_run_id,
            EvaluationDataset.name,
            EvaluationDataset.series_id,
            EvaluationDataset.version,
            func.jsonb_array_length(EvaluationDataset.cases).label("case_count"),
            EvaluationDataset.created_at,
        ).order_by(EvaluationDataset.created_at.desc())
        if document_id is not None:
            query = query.where(EvaluationDataset.document_id == document_id)
        if owner_user_id is not None:
            query = query.join(Document, Document.id == EvaluationDataset.document_id).where(Document.owner_user_id == self._owner_uuid(owner_user_id))
        return [_summary_dataset_row(dict(row)) for row in session.execute(query).mappings().all()]

    def _summary_document_evaluation_rows(self, session, document_id, owner_user_id=None):
        query = (
            select(
                EvaluationRun.id,
                EvaluationRun.dataset_id,
                EvaluationDataset.parse_run_id,
                EvaluationRun.config["chunk_run_id"].astext.label("chunk_run_id"),
                EvaluationRun.config["embedding_run_id"].astext.label("embedding_run_id"),
                EvaluationRun.status,
                EvaluationRun.error_code,
                EvaluationRun.error_message,
                EvaluationRun.started_at,
                EvaluationRun.completed_at,
                EvaluationRun.duration_ms,
                EvaluationRun.created_at,
            )
            .join(EvaluationDataset, EvaluationDataset.id == EvaluationRun.dataset_id)
            .where(EvaluationDataset.document_id == document_id)
            .order_by(EvaluationRun.created_at.desc())
        )
        if owner_user_id is not None:
            query = query.join(Document, Document.id == EvaluationDataset.document_id).where(
                Document.owner_user_id == self._owner_uuid(owner_user_id)
            )
        return [
            _summary_document_evaluation_row(dict(row))
            for row in session.execute(query).mappings().all()
        ]

    def _summary_evaluation_rows(self, session, dataset_id=None, owner_user_id=None):
        query = select(
            EvaluationRun.id,
            EvaluationRun.dataset_id,
            EvaluationRun.config,
            EvaluationRun.status,
            EvaluationRun.error_code,
            EvaluationRun.error_message,
            EvaluationRun.results["aggregate"].label("aggregate"),
            EvaluationRun.started_at,
            EvaluationRun.completed_at,
            EvaluationRun.duration_ms,
            EvaluationRun.created_at,
        ).order_by(EvaluationRun.created_at.desc())
        if dataset_id is not None:
            query = query.where(EvaluationRun.dataset_id == dataset_id)
        if owner_user_id is not None:
            query = query.join(EvaluationDataset, EvaluationDataset.id == EvaluationRun.dataset_id).join(
                Document, Document.id == EvaluationDataset.document_id
            ).where(Document.owner_user_id == self._owner_uuid(owner_user_id))
        rows = []
        for row in session.execute(query).mappings().all():
            value = dict(row)
            value["results"] = {"aggregate": value.pop("aggregate") or {}}
            rows.append(_summary_evaluation_row(value))
        return rows

    def get_document_summary_bundle(self, document_id, *, owner_user_id=None):
        with session_scope() as session:
            document_query = select(
                Document.id,
                Document.file_name,
                Document.media_type,
                Document.size_bytes,
                Document.page_count,
                Document.sha256,
                Document.owner_user_id,
                Document.storage_bucket,
                Document.storage_path,
                Document.active_parse_run_id,
                Document.active_chunk_run_id,
                Document.active_embedding_run_id,
                Document.created_at,
                Document.updated_at,
            ).where(Document.id == document_id)
            if owner_user_id is not None:
                document_query = document_query.where(Document.owner_user_id == self._owner_uuid(owner_user_id))
            document_row = session.execute(document_query).mappings().first()
            if document_row is None:
                return None
            document = self._document_summary_dict(dict(document_row))
            # One projection statement keeps the hot summary contract light while
            # avoiding one network round-trip per artifact family.
            projection_rows = session.execute(
                text(
                    """
                    SELECT kind, payload
                    FROM (
                        SELECT 1 AS kind_order, p.created_at AS sort_created, p.id AS sort_id,
                               'parse' AS kind,
                               jsonb_build_object(
                                   'id', p.id, 'run_number', p.run_number, 'document_id', p.document_id,
                                   'parser_name', p.parser_name, 'parser_version', p.parser_version,
                                   'normalized_schema_version', p.normalized_schema_version,
                                   'has_structured', p.structured IS NOT NULL,
                                   'has_summary', p.summary IS NOT NULL,
                                   'status', p.status, 'error_code', p.error_code,
                                   'error_message', p.error_message,
                                   'execution_metadata', p.execution_metadata,
                                   'started_at', p.started_at, 'completed_at', p.completed_at,
                                   'duration_ms', p.duration_ms, 'created_at', p.created_at,
                                   'updated_at', p.updated_at
                               ) AS payload
                        FROM rag_lab.parse_runs AS p
                        WHERE p.document_id = :document_id

                        UNION ALL

                        SELECT 0, pl.created_at, pl.id, 'pipeline',
                               jsonb_build_object(
                                   'id', pl.id, 'owner_user_id', pl.owner_user_id,
                                   'document_id', pl.document_id, 'name', pl.name,
                                   'parse_run_id', pl.parse_run_id, 'chunk_run_id', pl.chunk_run_id,
                                   'embedding_run_id', pl.embedding_run_id, 'revision', pl.revision,
                                   'created_at', pl.created_at, 'updated_at', pl.updated_at
                               )
                        FROM rag_lab.document_pipelines AS pl
                        WHERE pl.document_id = :document_id

                        UNION ALL

                        SELECT 2, c.created_at, c.id, 'chunk',
                               jsonb_build_object(
                                   'id', c.id, 'run_number', c.run_number, 'document_id', c.document_id,
                                   'parse_run_id', c.parse_run_id, 'strategy', c.strategy,
                                   'config', c.config, 'status', c.status,
                                   'chunk_count', c.chunk_count, 'error_code', c.error_code,
                                   'error_message', c.error_message, 'started_at', c.started_at,
                                   'completed_at', c.completed_at, 'duration_ms', c.duration_ms,
                                   'created_at', c.created_at
                               )
                        FROM rag_lab.chunk_runs AS c
                        WHERE c.document_id = :document_id

                        UNION ALL

                        SELECT 3, e.created_at, e.id, 'embedding',
                               jsonb_build_object(
                                   'id', e.id, 'run_number', e.run_number, 'document_id', e.document_id,
                                   'chunk_run_id', e.chunk_run_id, 'model', e.model,
                                   'dimensions', e.dimensions,
                                   'embedding_format_version', e.embedding_format_version,
                                   'effective_model', e.effective_model, 'status', e.status,
                                   'embedding_count', e.embedding_count,
                                   'error_code', e.error_code, 'error_message', e.error_message,
                                   'started_at', e.started_at, 'completed_at', e.completed_at,
                                   'duration_ms', e.duration_ms, 'created_at', e.created_at
                               )
                        FROM rag_lab.embedding_runs AS e
                        WHERE e.document_id = :document_id

                        UNION ALL

                        SELECT 4, x.created_at, x.id, 'experiment',
                               jsonb_build_object(
                                   'id', x.id, 'document_id', x.document_id,
                                   'chunk_run_id', x.chunk_run_id,
                                   'embedding_run_id', x.embedding_run_id,
                                   'query', x.query, 'target_stage', x.target_stage,
                                   'experiment_fingerprint', x.experiment_fingerprint,
                                   'config', x.config - '_execution',
                                   'candidate_count', COALESCE(
                                       CASE WHEN jsonb_typeof(x.stage_results #> '{retrieval,results}') = 'array'
                                            THEN jsonb_array_length(x.stage_results #> '{retrieval,results}') END,
                                       CASE WHEN jsonb_typeof(x.stage_results #> '{retrieval,candidates}') = 'array'
                                            THEN jsonb_array_length(x.stage_results #> '{retrieval,candidates}') END
                                   ),
                                   'retrieval_status', x.stage_results #>> '{retrieval,status}',
                                   'reranking_status', x.stage_results #>> '{reranking,status}',
                                   'context_status', x.stage_results #>> '{context,status}',
                                   'generation_status', x.stage_results #>> '{generation,status}',
                                   'status', x.status, 'error_code', x.error_code,
                                   'error_message', x.error_message, 'started_at', x.started_at,
                                   'completed_at', x.completed_at, 'duration_ms', x.duration_ms,
                                   'created_at', x.created_at
                               )
                        FROM rag_lab.experiment_runs AS x
                        WHERE x.document_id = :document_id

                        UNION ALL

                        SELECT 5, d.created_at, d.id, 'dataset',
                               jsonb_build_object(
                                   'id', d.id, 'document_id', d.document_id,
                                   'parse_run_id', d.parse_run_id, 'name', d.name,
                                   'version', d.version,
                                   'case_count', CASE WHEN jsonb_typeof(d.cases) = 'array'
                                                      THEN jsonb_array_length(d.cases) ELSE 0 END,
                                   'created_at', d.created_at
                               )
                        FROM rag_lab.evaluation_datasets AS d
                        WHERE d.document_id = :document_id

                        UNION ALL

                        SELECT 6, r.created_at, r.id, 'evaluation',
                               jsonb_build_object(
                                   'id', r.id, 'dataset_id', r.dataset_id,
                                   'parse_run_id', d.parse_run_id,
                                   'chunk_run_id', r.config ->> 'chunk_run_id',
                                   'embedding_run_id', r.config ->> 'embedding_run_id',
                                   'status', r.status, 'error_code', r.error_code,
                                   'error_message', r.error_message, 'started_at', r.started_at,
                                   'completed_at', r.completed_at, 'duration_ms', r.duration_ms,
                                   'created_at', r.created_at
                               )
                        FROM rag_lab.evaluation_runs AS r
                        JOIN rag_lab.evaluation_datasets AS d ON d.id = r.dataset_id
                        WHERE d.document_id = :document_id
                    ) AS projection
                    ORDER BY kind_order, sort_created DESC, sort_id
                    """
                ),
                {"document_id": document_id},
            ).mappings().all()
            grouped: dict[str, list[dict[str, Any]]] = {
                "pipeline": [], "parse": [], "chunk": [], "embedding": [],
                "experiment": [], "dataset": [], "evaluation": [],
            }
            normalizers = {
                "pipeline": _summary_pipeline_row,
                "parse": _summary_parse_row,
                "chunk": _summary_chunk_row,
                "embedding": _summary_embedding_row,
                "experiment": _summary_experiment_row,
                "dataset": _summary_dataset_row,
                "evaluation": _summary_document_evaluation_row,
            }
            for projection in projection_rows:
                kind = projection["kind"]
                payload = projection["payload"]
                if isinstance(payload, str):
                    payload = json.loads(payload)
                grouped[kind].append(normalizers[kind](dict(payload)))
            return {
                "document": document,
                "pipelines": sorted(
                    grouped["pipeline"], key=lambda row: (str(row.get("created_at") or ""), row["id"])
                ),
                "parses": grouped["parse"],
                "chunks": grouped["chunk"],
                "embeddings": grouped["embedding"],
                "experiments": grouped["experiment"],
                "datasets": grouped["dataset"],
                "evaluations": grouped["evaluation"],
            }

    def claim_chunk_run(
        self,
        document_id,
        parse_run_id,
        strategy,
        config,
        config_hash_value,
        tokenizer_version,
        chunker_version,
    ):
        identifier = new_id()
        started_at = now_utc()
        values = {
            "id": identifier,
            "document_id": document_id,
            "parse_run_id": parse_run_id,
            "strategy": strategy,
            "config": _dump(config),
            "config_hash": config_hash_value,
            "tokenizer_version": tokenizer_version,
            "chunker_version": chunker_version,
            "identity_claimed": True,
            "lease_token": uuid.uuid4(),
            "lease_expires_at": started_at + timedelta(seconds=pipeline_lease_duration_seconds(get_settings())),
            "status": "running",
            "chunk_count": 0,
            "started_at": started_at,
            "completed_at": None,
            "duration_ms": None,
        }
        with session_scope() as session:
            result = session.execute(
                pg_insert(ChunkRun)
                .values(**values)
                .on_conflict_do_nothing(
                    index_elements=[
                        ChunkRun.parse_run_id,
                        ChunkRun.strategy,
                        ChunkRun.config_hash,
                        ChunkRun.tokenizer_version,
                        ChunkRun.chunker_version,
                        ChunkRun.identity_claimed,
                    ]
                )
                .returning(ChunkRun.id)
            )
            inserted_id = result.scalar_one_or_none()
            if inserted_id is not None:
                run = session.get(ChunkRun, inserted_id)
                return self._chunk_dict(run, session), True
            run = session.scalars(
                select(ChunkRun)
                .where(
                    ChunkRun.parse_run_id == parse_run_id,
                    ChunkRun.strategy == strategy,
                    ChunkRun.config_hash == config_hash_value,
                    ChunkRun.tokenizer_version == tokenizer_version,
                    ChunkRun.chunker_version == chunker_version,
                    ChunkRun.identity_claimed.is_(True),
                    ChunkRun.status.in_(["running", "completed"]),
                )
                .with_for_update()
                .order_by(ChunkRun.created_at.asc(), ChunkRun.id.asc())
            ).first()
            if run is None:  # pragma: no cover - protects an impossible concurrent delete
                raise ApiProblem(409, "artifact_in_progress", "The chunk artifact is currently being created.")
            payload = self._chunk_dict(run, session)
            if run.status == "running" and _lease_expired(payload):
                renewed_at = now_utc()
                run.lease_token = uuid.uuid4()
                run.lease_expires_at = renewed_at + timedelta(seconds=pipeline_lease_duration_seconds(get_settings()))
                run.started_at = renewed_at
                run.completed_at = None
                run.error_code = None
                run.error_message = None
                session.flush()
                return self._chunk_dict(run, session), True
            return payload, False

    def complete_chunk_run(self, run_id, drafts, lease_token=None, *, unfenced=False):
        with session_scope() as session:
            document, run = self._lock_run_document(session, ChunkRun, run_id)
            if run is None:
                return None
            if _completion_replay(run.status, lease_token):
                return self._chunk_dict(run, session)
            if not _artifact_fence_allows(
                {"lease_token": run.lease_token, "lease_expires_at": run.lease_expires_at}, lease_token, unfenced
            ):
                return None
            if run.status != "running":
                return self._chunk_dict(run, session)
            for draft in drafts:
                session.add(
                    Chunk(
                        id=new_id(),
                        document_id=run.document_id,
                        chunk_run_id=run.id,
                        ordinal=draft.ordinal,
                        text=draft.text,
                        page_numbers=list(draft.page_numbers),
                        source_element_ids=list(draft.source_element_ids),
                        heading_path=list(draft.heading_path),
                        token_count=draft.token_count,
                        character_count=draft.character_count,
                    )
                )
            completed_at = now_utc()
            run.status = "completed"
            run.chunk_count = len(drafts)
            run.completed_at = completed_at
            run.duration_ms = duration_ms_between(run.started_at, completed_at)
            run.error_code = None
            run.error_message = None
            run.lease_token = None
            run.lease_expires_at = None
            if document is not None and document.active_parse_run_id in {None, run.parse_run_id}:
                # Advance the default only along its own parse; a late chunk
                # of an older parse never rolls the default parse back.
                document.active_parse_run_id = run.parse_run_id
                document.active_chunk_run_id = run.id
                document.active_embedding_run_id = None
            session.flush()
            return self._chunk_dict(run, session)

    def fail_chunk_run(self, run_id, code, message, lease_token=None, *, unfenced=False):
        with session_scope() as session:
            document, run = self._lock_run_document(session, ChunkRun, run_id)
            if run is None:
                return None
            if not _artifact_fence_allows(
                {"lease_token": run.lease_token, "lease_expires_at": run.lease_expires_at}, lease_token, unfenced
            ):
                return None
            if run.status in {"failed", "interrupted"} or (
                run.status == "completed" and code != "artifact_incomplete"
            ):
                return self._chunk_dict(run, session)
            if run.status == "completed":
                self._detach_failed_artifact(session, document, "chunk", run.id)
            run.identity_claimed = None
            run.status = "failed"
            run.error_code = code
            run.error_message = message
            run.lease_token = None
            run.lease_expires_at = None
            run.completed_at = now_utc()
            run.duration_ms = duration_ms_between(run.started_at, run.completed_at)
            session.flush()
            return self._chunk_dict(run, session)

    def save_chunk_run(self, document_id, parse_run_id, request, drafts):
        config = _dump(request.config)
        claim, claimed = self.claim_chunk_run(
            document_id,
            parse_run_id,
            request.strategy,
            config,
            config_hash(config),
            TOKENIZER_VERSION,
            chunker_version_for_strategy(request.strategy),
        )
        return self.complete_chunk_run(claim["id"], drafts, claim.get("lease_token")) if claimed else claim

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

    def _chunk_dict_with_chunks(self, row: ChunkRun, chunks: list[Chunk]) -> dict[str, Any]:
        payload = {
            "id": row.id,
            "run_number": row.run_number,
            "document_id": row.document_id,
            "parse_run_id": row.parse_run_id,
            "strategy": row.strategy,
            "config": row.config,
            "config_hash": row.config_hash,
            "tokenizer_version": row.tokenizer_version,
            "chunker_version": row.chunker_version,
            "identity_claimed": row.identity_claimed,
            "lease_token": str(row.lease_token) if row.lease_token else None,
            "lease_expires_at": row.lease_expires_at,
            "status": row.status,
            "chunk_count": row.chunk_count,
            "started_at": row.started_at,
            "completed_at": row.completed_at,
            "duration_ms": row.duration_ms,
            "chunks": [self._chunk_item(chunk) for chunk in chunks],
        }
        payload["lineage_fingerprint"] = chunk_lineage_fingerprint(payload)
        return payload

    def _chunk_dict(self, row: ChunkRun, session) -> dict[str, Any]:
        chunks = session.scalars(select(Chunk).where(Chunk.chunk_run_id == row.id).order_by(Chunk.ordinal)).all()
        return self._chunk_dict_with_chunks(row, chunks)

    def get_chunk_row(self, run_id, *, owner_user_id=None):
        with session_scope() as session:
            query = (
                select(ChunkRun, Chunk)
                .outerjoin(Chunk, Chunk.chunk_run_id == ChunkRun.id)
                .where(ChunkRun.id == run_id)
                .order_by(Chunk.ordinal)
            )
            if owner_user_id is not None:
                query = query.join(Document, Document.id == ChunkRun.document_id).where(
                    Document.owner_user_id == self._owner_uuid(owner_user_id)
                )
            pairs = session.execute(query).all()
            if not pairs:
                return None
            run = pairs[0][0]
            chunks = [chunk for _run, chunk in pairs if chunk is not None]
            return self._chunk_dict_with_chunks(run, chunks)

    def list_chunk_rows(self, document_id):
        with session_scope() as session:
            pairs = session.execute(
                select(ChunkRun, Chunk)
                .outerjoin(Chunk, Chunk.chunk_run_id == ChunkRun.id)
                .where(ChunkRun.document_id == document_id)
                .order_by(ChunkRun.created_at.desc(), Chunk.ordinal)
            ).all()
            grouped: dict[str, tuple[ChunkRun, list[Chunk]]] = {}
            for run, chunk in pairs:
                if run.id not in grouped:
                    grouped[run.id] = (run, [])
                if chunk is not None:
                    grouped[run.id][1].append(chunk)
            return [self._chunk_dict_with_chunks(run, chunks) for run, chunks in grouped.values()]

    def claim_embedding_run(
        self,
        document_id,
        chunk_run_id,
        model,
        dimensions,
        format_version,
        admission_owner_user_id=None,
    ):
        identifier = new_id()
        started_at = now_utc()
        values = {
            "id": identifier,
            "document_id": document_id,
            "chunk_run_id": chunk_run_id,
            "model": model,
            "dimensions": dimensions,
            "embedding_format_version": format_version,
            "identity_claimed": True,
            "lease_token": uuid.uuid4(),
            "lease_expires_at": started_at + timedelta(seconds=pipeline_lease_duration_seconds(get_settings())),
            "status": "running",
            "embedding_count": 0,
            "started_at": started_at,
            "completed_at": None,
            "duration_ms": None,
        }
        with session_scope() as session:
            self._lock_user_admission(session, admission_owner_user_id)
            existing = session.scalars(
                select(EmbeddingRun)
                .where(
                    EmbeddingRun.chunk_run_id == chunk_run_id,
                    EmbeddingRun.model == model,
                    EmbeddingRun.dimensions == dimensions,
                    EmbeddingRun.embedding_format_version == format_version,
                    EmbeddingRun.identity_claimed.is_(True),
                    EmbeddingRun.status.in_(["running", "completed"]),
                )
                .with_for_update()
                .order_by(EmbeddingRun.created_at.asc(), EmbeddingRun.id.asc())
            ).first()
            if existing is not None:
                payload = self._embedding_dict(existing)
                if existing.status == "running" and _lease_expired(payload):
                    self._assert_user_heavy_run_available(session, admission_owner_user_id)
                    existing.identity_claimed = True
                    existing.status = "running"
                    renewed_at = now_utc()
                    existing.lease_token = uuid.uuid4()
                    existing.lease_expires_at = renewed_at + timedelta(seconds=pipeline_lease_duration_seconds(get_settings()))
                    existing.started_at = renewed_at
                    existing.completed_at = None
                    existing.error_code = None
                    existing.error_message = None
                    session.flush()
                    return self._embedding_dict(existing), True
                return payload, False
            self._assert_user_heavy_run_available(session, admission_owner_user_id)
            result = session.execute(
                pg_insert(EmbeddingRun)
                .values(**values)
                .on_conflict_do_nothing(
                    index_elements=[
                        EmbeddingRun.chunk_run_id,
                        EmbeddingRun.model,
                        EmbeddingRun.dimensions,
                        EmbeddingRun.embedding_format_version,
                        EmbeddingRun.identity_claimed,
                    ]
                )
                .returning(EmbeddingRun.id)
            )
            inserted_id = result.scalar_one_or_none()
            if inserted_id is not None:
                run = session.get(EmbeddingRun, inserted_id)
                return self._embedding_dict(run), True
            run = session.scalars(
                select(EmbeddingRun)
                .where(
                    EmbeddingRun.chunk_run_id == chunk_run_id,
                    EmbeddingRun.model == model,
                    EmbeddingRun.dimensions == dimensions,
                    EmbeddingRun.embedding_format_version == format_version,
                    EmbeddingRun.identity_claimed.is_(True),
                    EmbeddingRun.status.in_(["running", "completed"]),
                )
                .with_for_update()
                .order_by(EmbeddingRun.created_at.asc(), EmbeddingRun.id.asc())
            ).first()
            if run is None:  # pragma: no cover - protects an impossible concurrent delete
                raise ApiProblem(409, "artifact_in_progress", "The embedding artifact is currently being created.")
            payload = self._embedding_dict(run)
            if run.status == "running" and _lease_expired(payload):
                self._assert_user_heavy_run_available(session, admission_owner_user_id)
                run.identity_claimed = True
                run.status = "running"
                renewed_at = now_utc()
                run.lease_token = uuid.uuid4()
                run.lease_expires_at = renewed_at + timedelta(seconds=pipeline_lease_duration_seconds(get_settings()))
                run.started_at = renewed_at
                run.completed_at = None
                run.error_code = None
                run.error_message = None
                session.flush()
                return self._embedding_dict(run), True
            return payload, False

    def complete_embedding_run(self, run_id, values, input_hashes=None, effective_model=None, lease_token=None, *, unfenced=False):
        with session_scope() as session:
            document, run = self._lock_run_document(session, EmbeddingRun, run_id)
            if run is None:
                return None
            if _completion_replay(run.status, lease_token):
                return self._embedding_dict(run)
            if not _artifact_fence_allows(
                {"lease_token": run.lease_token, "lease_expires_at": run.lease_expires_at}, lease_token, unfenced
            ):
                return None
            if run.status != "running":
                return self._embedding_dict(run)
            for chunk_id, vector in values:
                session.add(
                    ChunkEmbedding(
                        id=new_id(),
                        embedding_run_id=run.id,
                        chunk_id=chunk_id,
                        input_hash=(input_hashes or {}).get(chunk_id) or hashlib.sha256(json.dumps(vector).encode()).hexdigest(),
                        embedding=vector,
                    )
                )
            completed_at = now_utc()
            run.status = "completed"
            run.embedding_count = len(values)
            run.effective_model = effective_model
            run.completed_at = completed_at
            run.duration_ms = duration_ms_between(run.started_at, completed_at)
            run.error_code = None
            run.error_message = None
            run.lease_token = None
            run.lease_expires_at = None
            if document is not None:
                chunk_parse_id = session.scalar(select(ChunkRun.parse_run_id).where(ChunkRun.id == run.chunk_run_id))
                if _embedding_advances_default(
                    document.active_parse_run_id, document.active_chunk_run_id, chunk_parse_id, run.chunk_run_id
                ):
                    document.active_parse_run_id = chunk_parse_id
                    document.active_chunk_run_id = run.chunk_run_id
                    document.active_embedding_run_id = run.id
            session.flush()
            return self._embedding_dict(run)

    def fail_embedding_run(self, run_id, code, message, lease_token=None, *, unfenced=False):
        with session_scope() as session:
            document, run = self._lock_run_document(session, EmbeddingRun, run_id)
            if run is None:
                return None
            if not _artifact_fence_allows(
                {"lease_token": run.lease_token, "lease_expires_at": run.lease_expires_at}, lease_token, unfenced
            ):
                return None
            if run.status in {"failed", "interrupted"} or (
                run.status == "completed" and code != "artifact_incomplete"
            ):
                return self._embedding_dict(run)
            if run.status == "completed":
                self._detach_failed_artifact(session, document, "embedding", run.id)
            run.identity_claimed = None
            run.status = "failed"
            run.error_code = code
            run.error_message = message
            run.lease_token = None
            run.lease_expires_at = None
            run.completed_at = now_utc()
            run.duration_ms = duration_ms_between(run.started_at, run.completed_at)
            session.flush()
            return self._embedding_dict(run)

    def save_embedding_run(self, document_id, chunk_run_id, model, dimensions, format_version, values, input_hashes=None):
        claim, claimed = self.claim_embedding_run(document_id, chunk_run_id, model, dimensions, format_version)
        return self.complete_embedding_run(claim["id"], values, input_hashes, None, claim.get("lease_token")) if claimed else claim

    @staticmethod
    def _embedding_dict(row: EmbeddingRun) -> dict[str, Any]:
        return {
            "id": row.id,
            "run_number": row.run_number,
            "document_id": row.document_id,
            "chunk_run_id": row.chunk_run_id,
            "model": row.model,
            "dimensions": row.dimensions,
            "embedding_format_version": row.embedding_format_version,
            "identity_claimed": row.identity_claimed,
            "lease_token": str(row.lease_token) if row.lease_token else None,
            "lease_expires_at": row.lease_expires_at,
            "effective_model": row.effective_model,
            "status": row.status,
            "embedding_count": row.embedding_count,
            "started_at": row.started_at,
            "completed_at": row.completed_at,
            "duration_ms": row.duration_ms,
        }

    def get_embedding_row(self, run_id, *, owner_user_id=None):
        with session_scope() as session:
            query = select(EmbeddingRun).where(EmbeddingRun.id == run_id)
            if owner_user_id is not None:
                query = query.join(Document, Document.id == EmbeddingRun.document_id).where(
                    Document.owner_user_id == self._owner_uuid(owner_user_id)
                )
            row = session.scalars(query).first()
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
                terms = simple_fts_terms(query)
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
            "experiment_fingerprint": row.experiment_fingerprint,
            "identity_claimed": row.identity_claimed,
            "dispatch_id": row.dispatch_id,
            "attempt_count": row.attempt_count,
            "lease_token": str(row.lease_token) if row.lease_token else None,
            "lease_expires_at": row.lease_expires_at,
            "worker_started_at": row.worker_started_at,
            "config": row.config,
            "stage_results": row.stage_results,
            "status": row.status,
            "error_code": row.error_code,
            "error_message": row.error_message,
            "started_at": row.started_at,
            "completed_at": row.completed_at,
            "duration_ms": row.duration_ms,
            "created_at": row.created_at,
        }

    def save_experiment(self, row):
        entity = ExperimentRun(**{key: row.get(key) for key in (
            "id", "document_id", "chunk_run_id", "embedding_run_id", "query", "target_stage", "experiment_fingerprint", "identity_claimed", "config", "stage_results", "status", "error_code", "error_message", "started_at", "completed_at", "duration_ms", "dispatch_id", "attempt_count", "lease_token", "lease_expires_at", "worker_started_at"
        ) if row.get(key) is not None})
        entity.id = entity.id or new_id()
        with session_scope() as session:
            session.add(entity)
            session.flush()
            return self._exp_dict(entity)

    def get_completed_experiment_by_fingerprint(self, document_id, experiment_fingerprint):
        with session_scope() as session:
            row = session.scalars(
                select(ExperimentRun)
                .where(
                    ExperimentRun.document_id == document_id,
                    ExperimentRun.experiment_fingerprint == experiment_fingerprint,
                    ExperimentRun.status == "completed",
                )
                .order_by(ExperimentRun.created_at.desc(), ExperimentRun.id.desc())
            ).first()
            return self._exp_dict(row) if row else None

    def claim_experiment(self, row, *, admission_owner_user_id=None, bypass_user_admission=False):
        identifier = row.get("id") or new_id()
        started_at = row.get("started_at") or now_utc()
        lease_token = row.get("lease_token")
        lease_token_value = uuid.UUID(str(lease_token)) if lease_token else None
        requested_status = row.get("status", "running")
        durable = requested_status in {"queued", "running"} and lease_token_value is not None
        values = {
            "id": identifier,
            "document_id": row["document_id"],
            "chunk_run_id": row["chunk_run_id"],
            "embedding_run_id": row.get("embedding_run_id"),
            "query": row["query"],
            "target_stage": row["target_stage"],
            "experiment_fingerprint": row.get("experiment_fingerprint"),
            "identity_claimed": True,
            "config": _dump(row.get("config", {})),
            "stage_results": _dump(row.get("stage_results", {})),
            "status": requested_status,
            "started_at": started_at,
            "completed_at": None,
            "duration_ms": None,
            "dispatch_id": row.get("dispatch_id"),
            "attempt_count": row.get("attempt_count", 1 if durable else 0),
            "lease_token": lease_token_value,
            "lease_expires_at": row.get("lease_expires_at"),
            "worker_started_at": row.get("worker_started_at"),
        }
        with session_scope() as session:
            self._lock_user_admission(session, admission_owner_user_id)
            existing = session.scalars(
                select(ExperimentRun)
                .where(
                    ExperimentRun.document_id == row["document_id"],
                    ExperimentRun.experiment_fingerprint == row.get("experiment_fingerprint"),
                    ExperimentRun.identity_claimed.is_(True),
                    ExperimentRun.status.in_(["queued", "running"]),
                )
                .with_for_update()
                .order_by(ExperimentRun.created_at.asc(), ExperimentRun.id.asc())
            ).first()
            if existing is not None:
                existing_payload = self._exp_dict(existing)
                if durable and _lease_expired(existing_payload):
                    if not bypass_user_admission:
                        self._assert_user_heavy_run_available(session, admission_owner_user_id)
                    existing.identity_claimed = True
                    existing.status = requested_status
                    existing.lease_token = lease_token_value
                    existing.lease_expires_at = row.get("lease_expires_at")
                    existing.dispatch_id = None
                    existing.worker_started_at = None
                    existing.attempt_count = (existing.attempt_count or 0) + 1
                    existing.error_code = None
                    existing.error_message = None
                    existing.started_at = started_at
                    existing.completed_at = None
                    session.flush()
                    return self._exp_dict(existing), True
                return existing_payload, False
            if not bypass_user_admission:
                self._assert_user_heavy_run_available(session, admission_owner_user_id)
            result = session.execute(
                pg_insert(ExperimentRun)
                .values(**values)
                .on_conflict_do_nothing(
                    index_elements=[ExperimentRun.document_id, ExperimentRun.experiment_fingerprint],
                    index_where=ExperimentRun.identity_claimed.is_(True),
                )
                .returning(ExperimentRun.id)
            )
            inserted_id = result.scalar_one_or_none()
            if inserted_id is not None:
                claimed = session.get(ExperimentRun, inserted_id)
                return self._exp_dict(claimed), True
            existing = session.scalars(
                select(ExperimentRun)
                .where(
                    ExperimentRun.document_id == row["document_id"],
                    ExperimentRun.experiment_fingerprint == row.get("experiment_fingerprint"),
                    ExperimentRun.identity_claimed.is_(True),
                    ExperimentRun.status.in_(["queued", "running"]),
                )
                .with_for_update()
                .order_by(ExperimentRun.created_at.asc(), ExperimentRun.id.asc())
            ).first()
            if existing is None:  # pragma: no cover - protects an impossible concurrent delete
                raise ApiProblem(409, "experiment_in_progress", "The experiment is currently being created.")
            existing_payload = self._exp_dict(existing)
            if durable and _lease_expired(existing_payload):
                if not bypass_user_admission:
                    self._assert_user_heavy_run_available(session, admission_owner_user_id)
                existing.identity_claimed = True
                existing.status = requested_status
                existing.lease_token = lease_token_value
                existing.lease_expires_at = row.get("lease_expires_at")
                existing.dispatch_id = None
                existing.worker_started_at = None
                existing.attempt_count = (existing.attempt_count or 0) + 1
                existing.error_code = None
                existing.error_message = None
                existing.started_at = started_at
                existing.completed_at = None
                session.flush()
                return self._exp_dict(existing), True
            return existing_payload, False

    def update_experiment_stage(self, experiment_id, stage, result, lease_token=None):
        with session_scope() as session:
            row = session.scalars(
                select(ExperimentRun).where(ExperimentRun.id == experiment_id).with_for_update()
            ).first()
            if row is None:
                return None
            if row.status == "interrupted":
                return None
            if lease_token is not None and (
                str(row.lease_token) != str(lease_token) or _lease_expired(self._exp_dict(row))
            ):
                return None
            stage_results = dict(row.stage_results or {})
            stage_results[stage] = _dump(result)
            row.stage_results = stage_results
            session.flush()
            return self._exp_dict(row)

    def complete_experiment(self, experiment_id, lease_token=None):
        with session_scope() as session:
            row = session.scalars(
                select(ExperimentRun).where(ExperimentRun.id == experiment_id).with_for_update()
            ).first()
            if row is None:
                return None
            if row.status == "interrupted":
                return None
            if lease_token is not None and (
                str(row.lease_token) != str(lease_token) or _lease_expired(self._exp_dict(row))
            ):
                return None
            if row.status == "completed":
                return self._exp_dict(row)
            row.status = "completed"
            row.identity_claimed = None
            row.lease_token = None
            row.lease_expires_at = None
            row.completed_at = row.completed_at or now_utc()
            if row.duration_ms is None and row.started_at is not None:
                row.duration_ms = duration_ms_between(row.started_at, row.completed_at)
            session.flush()
            return self._exp_dict(row)

    def fail_experiment(self, experiment_id, code, message, lease_token=None):
        with session_scope() as session:
            row = session.scalars(
                select(ExperimentRun).where(ExperimentRun.id == experiment_id).with_for_update()
            ).first()
            if row is None:
                return None
            if row.status == "interrupted":
                return None
            if lease_token is not None and (
                str(row.lease_token) != str(lease_token) or _lease_expired(self._exp_dict(row))
            ):
                return None
            if row.status == "completed":
                return self._exp_dict(row)
            row.status = "failed"
            row.identity_claimed = None
            row.lease_token = None
            row.lease_expires_at = None
            row.error_code = code
            row.error_message = message
            row.completed_at = row.completed_at or now_utc()
            if row.duration_ms is None and row.started_at is not None:
                row.duration_ms = duration_ms_between(row.started_at, row.completed_at)
            session.flush()
            return self._exp_dict(row)

    def find_stage_result(self, document_id, stage, fingerprint):
        with session_scope() as session:
            rows = session.scalars(
                select(ExperimentRun)
                .where(
                    ExperimentRun.document_id == document_id,
                    ExperimentRun.status.in_(["completed", "failed"]),
                )
                .order_by(ExperimentRun.created_at.desc(), ExperimentRun.id.desc())
            ).all()
            for row in rows:
                value = (row.stage_results or {}).get(stage)
                if isinstance(value, dict) and value.get("fingerprint") == fingerprint:
                    return copy.deepcopy(value), row.id
            return None

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

    def list_experiment_summary_rows(self, document_id=None, *, owner_user_id=None):
        with session_scope() as session:
            return self._summary_experiment_rows(session, document_id, owner_user_id)

    @staticmethod
    def _dataset_dict(row: EvaluationDataset) -> dict[str, Any]:
        return {
            "id": row.id,
            "document_id": row.document_id,
            "parse_run_id": row.parse_run_id,
            "name": row.name,
            "series_id": row.series_id,
            "version": row.version,
            "cases": row.cases,
            "created_at": row.created_at,
        }

    def save_dataset(self, request, parse_run_id):
        with session_scope() as session:
            base = session.get(EvaluationDataset, request.base_dataset_id) if getattr(request, "base_dataset_id", None) else None
            if request.base_dataset_id and (base is None or base.document_id != request.document_id):
                raise ApiProblem(404, "dataset_not_found", "The base evaluation dataset was not found.")
            series_id = base.series_id if base is not None else new_id()
            version = (session.scalar(
                select(func.max(EvaluationDataset.version)).where(EvaluationDataset.series_id == series_id)
            ) or 0) + 1
            entity = EvaluationDataset(id=new_id(), document_id=request.document_id, parse_run_id=parse_run_id, series_id=series_id, name=request.name, version=version, cases=_dump(request.cases))
            session.add(entity)
            session.flush()
            return self._dataset_dict(entity)

    def list_dataset_rows(self, document_id=None):
        with session_scope() as session:
            query = select(EvaluationDataset).order_by(EvaluationDataset.created_at.desc())
            if document_id:
                query = query.where(EvaluationDataset.document_id == document_id)
            return [self._dataset_dict(row) for row in session.scalars(query)]

    def list_dataset_summary_rows(self, document_id=None, *, owner_user_id=None):
        with session_scope() as session:
            return self._summary_dataset_rows(session, document_id, owner_user_id)

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
            "evaluation_fingerprint": row.evaluation_fingerprint,
            "identity_claimed": row.identity_claimed,
            "dispatch_id": row.dispatch_id,
            "attempt_count": row.attempt_count,
            "lease_token": str(row.lease_token) if row.lease_token else None,
            "lease_expires_at": row.lease_expires_at,
            "worker_started_at": row.worker_started_at,
            "error_code": row.error_code,
            "error_message": row.error_message,
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
            evaluation_fingerprint=row.get("evaluation_fingerprint"),
            identity_claimed=row.get("identity_claimed"),
            dispatch_id=row.get("dispatch_id"),
            attempt_count=row.get("attempt_count", 0),
            lease_token=uuid.UUID(str(row["lease_token"])) if row.get("lease_token") else None,
            lease_expires_at=row.get("lease_expires_at"),
            worker_started_at=row.get("worker_started_at"),
            started_at=row.get("started_at"),
            completed_at=row.get("completed_at"),
            duration_ms=row.get("duration_ms"),
        )
        with session_scope() as session:
            session.add(entity)
            session.flush()
            return self._eval_dict(entity)

    def update_evaluation(self, run_id, changes, lease_token=None):
        with session_scope() as session:
            entity = session.scalars(
                select(EvaluationRun).where(EvaluationRun.id == run_id).with_for_update()
            ).first()
            if entity is None:
                return None
            if entity.status == "interrupted":
                return None
            if lease_token is not None and (
                str(entity.lease_token) != str(lease_token) or _lease_expired(self._eval_dict(entity))
            ):
                return None
            for key, value in changes.items():
                if hasattr(entity, key):
                    setattr(entity, key, _dump(value))
            session.flush()
            return self._eval_dict(entity)

    def claim_evaluation(self, row, *, admission_owner_user_id=None):
        identifier = row.get("id") or new_id()
        started_at = row.get("started_at") or now_utc()
        lease_token = row.get("lease_token")
        lease_token_value = uuid.UUID(str(lease_token)) if lease_token else None
        requested_status = row.get("status", "queued")
        durable = requested_status in {"queued", "running"} and lease_token_value is not None
        values = {
            "id": identifier,
            "dataset_id": row["dataset_id"],
            "config": _dump(row.get("config", {})),
            "child_experiment_ids": _dump(row.get("child_experiment_ids", [])),
            "results": _dump(row.get("results", {})),
            "status": requested_status,
            "evaluation_fingerprint": row.get("evaluation_fingerprint"),
            "identity_claimed": True,
            "dispatch_id": row.get("dispatch_id"),
            "attempt_count": row.get("attempt_count", 1 if durable else 0),
            "lease_token": lease_token_value,
            "lease_expires_at": row.get("lease_expires_at"),
            "worker_started_at": row.get("worker_started_at"),
            "started_at": started_at,
            "completed_at": row.get("completed_at"),
            "duration_ms": row.get("duration_ms"),
        }
        with session_scope() as session:
            self._lock_user_admission(session, admission_owner_user_id)
            existing = session.scalars(
                select(EvaluationRun)
                .where(
                    EvaluationRun.dataset_id == row["dataset_id"],
                    EvaluationRun.evaluation_fingerprint == row.get("evaluation_fingerprint"),
                    EvaluationRun.identity_claimed.is_(True),
                    EvaluationRun.status.in_(["queued", "running"]),
                )
                .with_for_update()
                .order_by(EvaluationRun.created_at.asc(), EvaluationRun.id.asc())
            ).first()
            if existing is not None:
                existing_payload = self._eval_dict(existing)
                if durable and _lease_expired(existing_payload):
                    self._assert_user_heavy_run_available(session, admission_owner_user_id)
                    existing.identity_claimed = True
                    existing.status = requested_status
                    existing.lease_token = lease_token_value
                    existing.lease_expires_at = row.get("lease_expires_at")
                    existing.dispatch_id = None
                    existing.worker_started_at = None
                    existing.attempt_count = (existing.attempt_count or 0) + 1
                    existing.error_code = None
                    existing.error_message = None
                    existing.started_at = started_at
                    existing.completed_at = None
                    session.flush()
                    return self._eval_dict(existing), True
                return existing_payload, False
            self._assert_user_heavy_run_available(session, admission_owner_user_id)
            result = session.execute(
                pg_insert(EvaluationRun)
                .values(**values)
                .on_conflict_do_nothing(
                    index_elements=[EvaluationRun.dataset_id, EvaluationRun.evaluation_fingerprint],
                    index_where=EvaluationRun.identity_claimed.is_(True),
                )
                .returning(EvaluationRun.id)
            )
            inserted_id = result.scalar_one_or_none()
            if inserted_id is not None:
                entity = session.get(EvaluationRun, inserted_id)
                return self._eval_dict(entity), True
            existing = session.scalars(
                select(EvaluationRun)
                .where(
                    EvaluationRun.dataset_id == row["dataset_id"],
                    EvaluationRun.evaluation_fingerprint == row.get("evaluation_fingerprint"),
                    EvaluationRun.identity_claimed.is_(True),
                    EvaluationRun.status.in_(["queued", "running"]),
                )
                .with_for_update()
                .order_by(EvaluationRun.created_at.asc(), EvaluationRun.id.asc())
            ).first()
            if existing is None:  # pragma: no cover - protects an impossible concurrent delete
                raise ApiProblem(409, "evaluation_in_progress", "The evaluation is currently being created.")
            existing_payload = self._eval_dict(existing)
            if durable and _lease_expired(existing_payload):
                self._assert_user_heavy_run_available(session, admission_owner_user_id)
                existing.identity_claimed = True
                existing.status = requested_status
                existing.lease_token = lease_token_value
                existing.lease_expires_at = row.get("lease_expires_at")
                existing.dispatch_id = None
                existing.worker_started_at = None
                existing.attempt_count = (existing.attempt_count or 0) + 1
                existing.error_code = None
                existing.error_message = None
                existing.started_at = started_at
                existing.completed_at = None
                session.flush()
                return self._eval_dict(existing), True
            return existing_payload, False

    def get_evaluation_by_fingerprint(self, dataset_id, evaluation_fingerprint):
        with session_scope() as session:
            row = session.scalars(
                select(EvaluationRun)
                .where(
                    EvaluationRun.dataset_id == dataset_id,
                    EvaluationRun.evaluation_fingerprint == evaluation_fingerprint,
                    EvaluationRun.status.in_(["queued", "running", "completed"]),
                )
                .order_by(EvaluationRun.created_at.desc(), EvaluationRun.id.desc())
            ).first()
            return self._eval_dict(row) if row else None

    def _pipeline_entity(self, session, kind, run_id, *, for_update=False):
        model = ExperimentRun if kind == "experiment" else EvaluationRun
        if for_update:
            return session.scalars(
                select(model).where(model.id == run_id).with_for_update()
            ).first()
        return session.get(model, run_id)

    def set_pipeline_dispatch(self, kind, run_id, dispatch_id, lease_token=None, expected_dispatch_id=None):
        with session_scope() as session:
            entity = self._pipeline_entity(session, kind, run_id, for_update=True)
            if (
                entity is None
                or entity.status not in {"queued", "running"}
                or (
                    lease_token is not None
                    and (str(entity.lease_token) != str(lease_token) or _lease_expired(
                        self._exp_dict(entity) if kind == "experiment" else self._eval_dict(entity)
                    ))
                )
                or (expected_dispatch_id is not None and entity.dispatch_id != expected_dispatch_id)
            ):
                return None
            entity.dispatch_id = dispatch_id
            session.flush()
            return self._exp_dict(entity) if kind == "experiment" else self._eval_dict(entity)

    def claim_pipeline_dispatch(self, kind, run_id, dispatch_id, lease_token=None):
        with session_scope() as session:
            entity = self._pipeline_entity(session, kind, run_id, for_update=True)
            if (
                entity is None
                or entity.status not in {"queued", "running"}
                or (
                    lease_token is not None
                    and (str(entity.lease_token) != str(lease_token) or _lease_expired(
                        self._exp_dict(entity) if kind == "experiment" else self._eval_dict(entity)
                    ))
                )
            ):
                return None
            if entity.dispatch_id is None:
                entity.dispatch_id = dispatch_id
                session.flush()
            return self._exp_dict(entity) if kind == "experiment" else self._eval_dict(entity)

    def start_pipeline_worker(self, kind, run_id, lease_token, lease_duration_seconds):
        with session_scope() as session:
            entity = self._pipeline_entity(session, kind, run_id, for_update=True)
            payload = self._exp_dict(entity) if entity is not None and kind == "experiment" else self._eval_dict(entity) if entity is not None else None
            if entity is None or str(entity.lease_token) != str(lease_token) or entity.status not in {"queued", "running"} or _lease_expired(payload or {}):
                return None
            current = now_utc()
            entity.status = "running"
            entity.worker_started_at = current
            entity.lease_expires_at = current + timedelta(seconds=lease_duration_seconds)
            entity.started_at = entity.started_at or current
            session.flush()
            return self._exp_dict(entity) if kind == "experiment" else self._eval_dict(entity)

    def renew_pipeline_lease(self, kind, run_id, lease_token, lease_duration_seconds):
        with session_scope() as session:
            entity = self._pipeline_entity(session, kind, run_id, for_update=True)
            payload = self._exp_dict(entity) if entity is not None and kind == "experiment" else self._eval_dict(entity) if entity is not None else None
            if entity is None or str(entity.lease_token) != str(lease_token) or entity.status != "running" or _lease_expired(payload or {}):
                return None
            entity.lease_expires_at = now_utc() + timedelta(seconds=lease_duration_seconds)
            session.flush()
            return self._exp_dict(entity) if kind == "experiment" else self._eval_dict(entity)

    def complete_pipeline_worker(self, kind, run_id, lease_token):
        if kind == "experiment":
            return self.complete_experiment(run_id, lease_token)
        return self.update_evaluation(
            run_id,
            {
                "status": "completed",
                "identity_claimed": None,
                "completed_at": now_utc(),
                "lease_token": None,
                "lease_expires_at": None,
            },
            lease_token,
        )

    def fail_pipeline_worker(self, kind, run_id, lease_token, code, message):
        if kind == "experiment":
            return self.fail_experiment(run_id, code, message, lease_token)
        return self.update_evaluation(
            run_id,
            {
                "status": "failed",
                "identity_claimed": None,
                "error_code": code,
                "error_message": message,
                "completed_at": now_utc(),
                "lease_token": None,
                "lease_expires_at": None,
            },
            lease_token,
        )

    def reconcile_pipeline_lease(self, kind, run_id):
        with session_scope() as session:
            entity = self._pipeline_entity(session, kind, run_id, for_update=True)
            if entity is None:
                return None
            payload = self._exp_dict(entity) if kind == "experiment" else self._eval_dict(entity)
            for key, value in _expired_run_update(payload).items():
                setattr(entity, key, value)
            session.flush()
            return self._exp_dict(entity) if kind == "experiment" else self._eval_dict(entity)

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

    def list_evaluation_summary_rows(self, dataset_id=None, *, owner_user_id=None):
        with session_scope() as session:
            return self._summary_evaluation_rows(session, dataset_id, owner_user_id)


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
        return self._repository.create_parse_run(
            document_id,
            parser_version=parser_version,
            config=config,
            run_id=run_id,
            admission_owner_user_id=self.owner_user_id,
        )

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

    def get_document_summary_bundle(self, document_id, *, owner_user_id=None):
        requested_owner = self.owner_user_id if owner_user_id is None else uuid.UUID(str(owner_user_id))
        if requested_owner != self.owner_user_id:
            return None
        return self._repository.get_document_summary_bundle(document_id, owner_user_id=self.owner_user_id)

    def get_document_by_sha256(self, sha256, *, owner_user_id=None):
        if owner_user_id is not None and uuid.UUID(str(owner_user_id)) != self.owner_user_id:
            return None
        return self._repository.get_document_by_sha256(sha256, owner_user_id=self.owner_user_id)

    def list_document_rows(self, *, owner_user_id=None):
        requested_owner = self.owner_user_id if owner_user_id is None else uuid.UUID(str(owner_user_id))
        if requested_owner != self.owner_user_id:
            return []
        return self._repository.list_document_rows(owner_user_id=self.owner_user_id)

    def latest_parse_metadata(self, *, owner_user_id=None):
        if owner_user_id is not None and uuid.UUID(str(owner_user_id)) != self.owner_user_id:
            return {}
        return self._repository.latest_parse_metadata(owner_user_id=self.owner_user_id)

    def delete_document(self, document_id):
        if self._owned_document(document_id) is not None:
            self._repository.delete_document(document_id)

    def delete_document_with_cleanup(self, document_id):
        if self._owned_document(document_id) is None:
            return None
        return self._repository.delete_document_with_cleanup(document_id)

    def list_pending_storage_cleanups(self, *, limit=3):
        return self._repository.list_pending_storage_cleanups(
            limit=limit,
            owner_user_id=self.owner_user_id,
        )

    def complete_storage_cleanup(self, cleanup_id):
        owned = {row["id"] for row in self.list_pending_storage_cleanups(limit=100)}
        if cleanup_id in owned:
            self._repository.complete_storage_cleanup(cleanup_id)

    def fail_storage_cleanup(self, cleanup_id, code):
        owned = {row["id"] for row in self.list_pending_storage_cleanups(limit=100)}
        if cleanup_id in owned:
            self._repository.fail_storage_cleanup(cleanup_id, code)

    def create_document_pipeline(self, row):
        payload = dict(row)
        payload["owner_user_id"] = self.owner_user_id
        return self._repository.create_document_pipeline(payload)

    def get_document_pipeline_row(self, pipeline_id):
        return self._repository.get_document_pipeline_row(
            pipeline_id, owner_user_id=self.owner_user_id
        )

    def list_document_pipeline_rows(self, document_id):
        return self._repository.list_document_pipeline_rows(
            document_id, owner_user_id=self.owner_user_id
        )

    def update_document_pipeline(self, pipeline_id, expected_revision, changes):
        return self._repository.update_document_pipeline(
            pipeline_id,
            expected_revision,
            changes,
            owner_user_id=self.owner_user_id,
        )

    def delete_document_pipeline(self, pipeline_id):
        return self._repository.delete_document_pipeline(
            pipeline_id, owner_user_id=self.owner_user_id
        )

    def get_parse_row(self, run_id):
        row = self._repository.get_parse_row(run_id)
        return row if self._owned_document_for_row(row) is not None else None

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

    def claim_chunk_run(self, document_id, parse_run_id, strategy, config, config_hash_value, tokenizer_version, chunker_version):
        document = self._owned_document(document_id)
        parse = self.get_parse_row(parse_run_id)
        if document is None or parse is None or parse.get("document_id") != document_id:
            raise ApiProblem(404, "chunk_run_not_found", "The requested document lineage was not found.")
        return self._repository.claim_chunk_run(
            document_id,
            parse_run_id,
            strategy,
            config,
            config_hash_value,
            tokenizer_version,
            chunker_version,
        )

    def complete_chunk_run(self, run_id, drafts, lease_token=None, *, unfenced=False):
        if self.get_chunk_row(run_id) is None:
            return None
        return self._repository.complete_chunk_run(run_id, drafts, lease_token, unfenced=unfenced)

    def fail_chunk_run(self, run_id, code, message, lease_token=None, *, unfenced=False):
        if self.get_chunk_row(run_id) is None:
            return None
        return self._repository.fail_chunk_run(run_id, code, message, lease_token, unfenced=unfenced)

    def get_chunk_row(self, run_id):
        return self._repository.get_chunk_row(run_id, owner_user_id=self.owner_user_id)

    def list_chunk_rows(self, document_id):
        if self._owned_document(document_id) is None:
            return []
        return self._repository.list_chunk_rows(document_id)

    def save_embedding_run(self, document_id, chunk_run_id, model, dimensions, format_version, values, input_hashes=None):
        if self._owned_document(document_id) is None or self.get_chunk_row(chunk_run_id) is None:
            raise ApiProblem(404, "embedding_run_not_found", "The requested document lineage was not found.")
        return self._repository.save_embedding_run(document_id, chunk_run_id, model, dimensions, format_version, values, input_hashes)

    def claim_embedding_run(self, document_id, chunk_run_id, model, dimensions, format_version):
        if self._owned_document(document_id) is None or self.get_chunk_row(chunk_run_id) is None:
            raise ApiProblem(404, "embedding_run_not_found", "The requested document lineage was not found.")
        return self._repository.claim_embedding_run(
            document_id,
            chunk_run_id,
            model,
            dimensions,
            format_version,
            admission_owner_user_id=self.owner_user_id,
        )

    def complete_embedding_run(self, run_id, values, input_hashes=None, effective_model=None, lease_token=None, *, unfenced=False):
        if self.get_embedding_row(run_id) is None:
            return None
        return self._repository.complete_embedding_run(run_id, values, input_hashes, effective_model, lease_token, unfenced=unfenced)

    def fail_embedding_run(self, run_id, code, message, lease_token=None, *, unfenced=False):
        if self.get_embedding_row(run_id) is None:
            return None
        return self._repository.fail_embedding_run(run_id, code, message, lease_token, unfenced=unfenced)

    def get_embedding_row(self, run_id):
        return self._repository.get_embedding_row(run_id, owner_user_id=self.owner_user_id)

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

    def get_completed_experiment_by_fingerprint(self, document_id, experiment_fingerprint):
        if self._owned_document(document_id) is None:
            return None
        return self._repository.get_completed_experiment_by_fingerprint(document_id, experiment_fingerprint)

    def claim_experiment(self, row, *, bypass_user_admission=False):
        if self._owned_document(row.get("document_id", "")) is None:
            raise ApiProblem(404, "experiment_not_found", "The experiment lineage was not found.")
        return self._repository.claim_experiment(
            row,
            admission_owner_user_id=None if bypass_user_admission else self.owner_user_id,
            bypass_user_admission=bypass_user_admission,
        )

    def update_experiment_stage(self, experiment_id, stage, result, lease_token=None):
        if self.get_experiment_row(experiment_id) is None:
            return None
        return self._repository.update_experiment_stage(experiment_id, stage, result, lease_token)

    def complete_experiment(self, experiment_id, lease_token=None):
        if self.get_experiment_row(experiment_id) is None:
            return None
        return self._repository.complete_experiment(experiment_id, lease_token)

    def fail_experiment(self, experiment_id, code, message, lease_token=None):
        if self.get_experiment_row(experiment_id) is None:
            return None
        return self._repository.fail_experiment(experiment_id, code, message, lease_token)

    def set_pipeline_dispatch(self, kind, run_id, dispatch_id, lease_token=None, expected_dispatch_id=None):
        row = self.get_experiment_row(run_id) if kind == "experiment" else self.get_evaluation_row(run_id)
        if row is None:
            return None
        return self._repository.set_pipeline_dispatch(
            kind,
            run_id,
            dispatch_id,
            lease_token,
            expected_dispatch_id,
        )

    def claim_pipeline_dispatch(self, kind, run_id, dispatch_id, lease_token=None):
        row = self.get_experiment_row(run_id) if kind == "experiment" else self.get_evaluation_row(run_id)
        if row is None:
            return None
        return self._repository.claim_pipeline_dispatch(kind, run_id, dispatch_id, lease_token)

    def start_pipeline_worker(self, kind, run_id, lease_token, lease_duration_seconds):
        row = self.get_experiment_row(run_id) if kind == "experiment" else self.get_evaluation_row(run_id)
        if row is None:
            return None
        return self._repository.start_pipeline_worker(kind, run_id, lease_token, lease_duration_seconds)

    def renew_pipeline_lease(self, kind, run_id, lease_token, lease_duration_seconds):
        row = self.get_experiment_row(run_id) if kind == "experiment" else self.get_evaluation_row(run_id)
        if row is None:
            return None
        return self._repository.renew_pipeline_lease(kind, run_id, lease_token, lease_duration_seconds)

    def complete_pipeline_worker(self, kind, run_id, lease_token):
        row = self.get_experiment_row(run_id) if kind == "experiment" else self.get_evaluation_row(run_id)
        if row is None:
            return None
        return self._repository.complete_pipeline_worker(kind, run_id, lease_token)

    def fail_pipeline_worker(self, kind, run_id, lease_token, code, message):
        row = self.get_experiment_row(run_id) if kind == "experiment" else self.get_evaluation_row(run_id)
        if row is None:
            return None
        return self._repository.fail_pipeline_worker(kind, run_id, lease_token, code, message)

    def reconcile_pipeline_lease(self, kind, run_id):
        row = self.get_experiment_row(run_id) if kind == "experiment" else self.get_evaluation_row(run_id)
        if row is None:
            return None
        return self._repository.reconcile_pipeline_lease(kind, run_id)

    def find_stage_result(self, document_id, stage, fingerprint):
        if self._owned_document(document_id) is None:
            return None
        return self._repository.find_stage_result(document_id, stage, fingerprint)

    def get_experiment_row(self, experiment_id):
        row = self._repository.get_experiment_row(experiment_id)
        return row if self._owned_document_for_row(row) is not None else None

    def list_experiment_rows(self, document_id=None):
        if document_id is not None:
            return [] if self._owned_document(document_id) is None else self._repository.list_experiment_rows(document_id)
        return [row for row in self._repository.list_experiment_rows() if self._owned_document(row.get("document_id", "")) is not None]

    def list_experiment_summary_rows(self, document_id=None, *, owner_user_id=None):
        requested_owner = self.owner_user_id if owner_user_id is None else uuid.UUID(str(owner_user_id))
        if requested_owner != self.owner_user_id:
            return []
        return self._repository.list_experiment_summary_rows(document_id, owner_user_id=self.owner_user_id)

    def save_dataset(self, request, parse_run_id):
        if self._owned_document(request.document_id) is None or self.get_parse_row(parse_run_id) is None:
            raise ApiProblem(404, "dataset_not_found", "The evaluation dataset lineage was not found.")
        return self._repository.save_dataset(request, parse_run_id)

    def list_dataset_rows(self, document_id=None):
        if document_id is not None:
            return [] if self._owned_document(document_id) is None else self._repository.list_dataset_rows(document_id)
        return [row for row in self._repository.list_dataset_rows() if self._owned_document(row.get("document_id", "")) is not None]

    def list_dataset_summary_rows(self, document_id=None, *, owner_user_id=None):
        requested_owner = self.owner_user_id if owner_user_id is None else uuid.UUID(str(owner_user_id))
        if requested_owner != self.owner_user_id:
            return []
        return self._repository.list_dataset_summary_rows(document_id, owner_user_id=self.owner_user_id)

    def get_dataset_row(self, dataset_id):
        row = self._repository.get_dataset_row(dataset_id)
        return row if self._owned_document_for_row(row) is not None else None

    def save_evaluation(self, row):
        dataset = self.get_dataset_row(row.get("dataset_id", ""))
        if dataset is None:
            raise ApiProblem(404, "evaluation_run_not_found", "The evaluation lineage was not found.")
        return self._repository.save_evaluation(row)

    def claim_evaluation(self, row):
        dataset = self.get_dataset_row(row.get("dataset_id", ""))
        if dataset is None:
            raise ApiProblem(404, "evaluation_run_not_found", "The evaluation lineage was not found.")
        return self._repository.claim_evaluation(
            row,
            admission_owner_user_id=self.owner_user_id,
        )

    def get_evaluation_by_fingerprint(self, dataset_id, evaluation_fingerprint):
        dataset = self.get_dataset_row(dataset_id)
        if dataset is None:
            return None
        return self._repository.get_evaluation_by_fingerprint(dataset_id, evaluation_fingerprint)

    def update_evaluation(self, run_id, changes, lease_token=None):
        if self.get_evaluation_row(run_id) is None:
            return None
        return self._repository.update_evaluation(run_id, changes, lease_token)

    def get_evaluation_row(self, run_id):
        row = self._repository.get_evaluation_row(run_id)
        if row is None:
            return None
        return row if self.get_dataset_row(row.get("dataset_id", "")) is not None else None

    def list_evaluation_rows(self, dataset_id=None):
        if dataset_id is not None:
            return [] if self.get_dataset_row(dataset_id) is None else self._repository.list_evaluation_rows(dataset_id)
        return [row for row in self._repository.list_evaluation_rows() if self.get_dataset_row(row.get("dataset_id", "")) is not None]

    def list_evaluation_summary_rows(self, dataset_id=None, *, owner_user_id=None):
        requested_owner = self.owner_user_id if owner_user_id is None else uuid.UUID(str(owner_user_id))
        if requested_owner != self.owner_user_id:
            return []
        return self._repository.list_evaluation_summary_rows(dataset_id, owner_user_id=self.owner_user_id)


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
