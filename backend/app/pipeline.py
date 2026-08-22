"""RAG StepLab domain orchestration.

This module intentionally keeps each RAG operation explicit.  The database
stores parse/chunk/embedding artifacts separately; retrieval through
generation is persisted as visible stage objects in one experiment row.
"""

from __future__ import annotations

import copy
import hashlib
import json
import logging
import math
import re
import tempfile
import time
from pathlib import Path
from typing import Any

from .chunking import CHUNKER_VERSION, TOKENIZER, TOKENIZER_VERSION, chunk_structured, config_hash, effective_config
from .config import Settings, get_settings
from .errors import ApiProblem
from .gemini import EMBEDDING_FORMAT_VERSION, GeminiService, document_embedding_text
from .repository import (
    Repository,
    get_repository,
    new_id,
    now_utc,
)
from .schemas import (
    ChunkRunRequest,
    EvaluationDatasetRequest,
    EvaluationRunRequest,
    ExperimentCreateRequest,
    ParseResponse,
)
from .storage import get_storage
from .telemetry import measure_resource_usage


logger = logging.getLogger(__name__)
SUPPORTED_NORMALIZED_SCHEMA_VERSION = "normalized-v1"

STAGE_ORDER = ["retrieval", "reranking", "context", "generation"]
STAGE_FINGERPRINT_SCHEMA_VERSION = "stage-fingerprint-v1"
EXPERIMENT_FINGERPRINT_SCHEMA_VERSION = "experiment-fingerprint-v1"
RETRIEVAL_ALGORITHM_VERSION = "retrieval-sql-rrf-v1"
RERANK_ALGORITHM_VERSION = "gemini-listwise-v1"
RERANK_PROMPT_VERSION = "rerank-candidate-order-v1"
CONTEXT_ALGORITHM_VERSION = "greedy-budget-dedup-v1"
GENERATION_PROMPT_VERSION = "grounded-json-citations-v1"
GENERATION_VALIDATION_VERSION = "citation-validation-v1"


def _safe_model_dump(value: Any) -> dict[str, Any]:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", by_alias=False)
    return dict(value)


def _canonical_json(value: Any) -> str:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise ApiProblem(500, "fingerprint_invalid", "The experiment fingerprint input is not serializable.") from exc


def _fingerprint(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _stage_hash_payload(value: Any) -> Any:
    """Remove execution bookkeeping while retaining semantic/provenance data."""
    if isinstance(value, dict):
        return {
            key: _stage_hash_payload(item)
            for key, item in value.items()
            if key not in {"fingerprint", "fingerprintSchemaVersion", "resultHash", "reuse", "durationMs", "sourceDurationMs"}
        }
    if isinstance(value, list):
        return [_stage_hash_payload(item) for item in value]
    return value


def _stage_result_hash(value: dict[str, Any]) -> str:
    return _fingerprint(_stage_hash_payload(value))


def _model_provenance(
    configured_model: str | None,
    effective_model: str | None = None,
    *,
    required: bool = True,
    role: str,
) -> dict[str, Any]:
    configured = str(configured_model or "").strip()
    mutable = configured.lower().endswith("-latest") or configured.lower().endswith(":latest")
    return {
        "role": role,
        "required": required,
        "configuredModel": configured or None,
        "modelVersion": configured or None,
        "effectiveModel": effective_model,
        "mutable": mutable,
        "cacheable": bool(configured) and not mutable and (not required or bool(effective_model)),
    }


def _provenance_reusable(value: Any) -> bool:
    if isinstance(value, dict):
        if "cacheable" in value and value.get("cacheable") is not True:
            return False
        if value.get("mutable") is True:
            return False
        if value.get("required") is True and not value.get("effectiveModel"):
            return False
        return all(_provenance_reusable(item) for item in value.values())
    if isinstance(value, list):
        return all(_provenance_reusable(item) for item in value)
    return True


def _stage_reusable(value: Any, expected_fingerprint: str) -> bool:
    if not isinstance(value, dict):
        return False
    if value.get("status") not in {"completed", "skipped"}:
        return False
    if value.get("fingerprintSchemaVersion") != STAGE_FINGERPRINT_SCHEMA_VERSION:
        return False
    if value.get("fingerprint") != expected_fingerprint:
        return False
    result_hash = value.get("resultHash")
    if not isinstance(result_hash, str) or result_hash != _stage_result_hash(value):
        return False
    provenance = value.get("provenance")
    if not isinstance(provenance, dict) or not _provenance_reusable(provenance):
        return False
    return True


def _complete_prefix(stage_results: dict[str, Any]) -> list[str]:
    prefix: list[str] = []
    for stage in STAGE_ORDER:
        value = stage_results.get(stage)
        if not isinstance(value, dict) or value.get("status") not in {"completed", "skipped"}:
            break
        prefix.append(stage)
    return prefix


def _stage_with_identity(
    value: dict[str, Any],
    fingerprint: str,
    *,
    reused: bool,
    source_experiment_id: str | None = None,
) -> dict[str, Any]:
    result = copy.deepcopy(value)
    result["fingerprintSchemaVersion"] = STAGE_FINGERPRINT_SCHEMA_VERSION
    result["fingerprint"] = fingerprint
    result["resultHash"] = _stage_result_hash(result)
    result["reuse"] = {
        "reused": reused,
        "executed": not reused,
        "sourceExperimentId": source_experiment_id,
        "sourceDurationMs": value.get("durationMs") if reused else None,
    }
    return result


def _experiment_response(
    row: dict[str, Any],
    *,
    reused_experiment: bool = False,
    continued_from_experiment_id: str | None = None,
    generation_rerun: bool = False,
) -> dict[str, Any]:
    result = copy.deepcopy(row)
    result["reused_experiment"] = reused_experiment
    if continued_from_experiment_id is not None:
        result["continued_from_experiment_id"] = continued_from_experiment_id
    if generation_rerun:
        result["generation_rerun"] = True
    return result


def _require_write(repository: Repository, settings: Settings) -> None:
    if not settings.write_enabled:
        raise ApiProblem(503, "writes_disabled", "Pipeline writes are temporarily disabled.")
    if settings.app_env in {"production", "staging"} and not repository.persistent:
        raise ApiProblem(503, "database_not_configured", "Persistent database storage is not configured.")
    if settings.app_env in {"production", "staging"} and (
        not settings.supabase_url or not settings.supabase_secret_key
    ):
        raise ApiProblem(503, "storage_not_configured", "Private document storage is not configured.")
    if settings.app_env in {"production", "staging"} and TOKENIZER_VERSION != "local_cl100k_v1":
        raise ApiProblem(503, "tokenizer_not_configured", "The deterministic cl100k tokenizer is not available.")


def _document_or_404(repository: Repository, document_id: str) -> dict[str, Any]:
    document = repository.get_document_row(document_id)
    if document is None:
        raise ApiProblem(404, "document_not_found", "The document was not found.")
    return document


def _parse_or_404(repository: Repository, parse_run_id: str) -> dict[str, Any]:
    row = repository.get_parse_row(parse_run_id)
    if row is None:
        raise ApiProblem(404, "parse_run_not_found", "The parse run was not found.")
    if row.get("status") != "completed":
        raise ApiProblem(409, "parse_run_incomplete", "The parse run is not complete.")
    return row


def _lineage_problem(message: str) -> ApiProblem:
    return ApiProblem(409, "lineage_incompatible", message)


def _require_compatible_parse(repository: Repository, document_id: str, parse_run_id: str) -> dict[str, Any]:
    parse = _parse_or_404(repository, parse_run_id)
    if parse.get("document_id") != document_id:
        raise _lineage_problem("The parse run belongs to another document.")
    if parse.get("normalized_schema_version") != SUPPORTED_NORMALIZED_SCHEMA_VERSION:
        raise _lineage_problem("The parse run uses an unsupported normalized schema version.")
    if parse.get("structured") is None or parse.get("summary") is None:
        raise _lineage_problem("The parse run has no usable normalized output.")
    return parse


def _chunk_or_404(repository: Repository, chunk_run_id: str) -> dict[str, Any]:
    row = repository.get_chunk_row(chunk_run_id)
    if row is None:
        raise ApiProblem(404, "chunk_run_not_found", "The chunk run was not found.")
    if row.get("status") != "completed":
        raise ApiProblem(409, "chunk_run_incomplete", "The chunk run is not complete.")
    return row


def _require_compatible_chunk(repository: Repository, document_id: str, chunk_run_id: str) -> dict[str, Any]:
    chunk = _chunk_or_404(repository, chunk_run_id)
    if chunk.get("document_id") != document_id:
        raise _lineage_problem("The chunk run belongs to another document.")
    _require_compatible_parse(repository, document_id, chunk["parse_run_id"])
    return chunk


def _embedding_or_404(repository: Repository, embedding_run_id: str) -> dict[str, Any]:
    row = repository.get_embedding_row(embedding_run_id)
    if row is None:
        raise ApiProblem(404, "embedding_run_not_found", "The embedding run was not found.")
    if row.get("status") != "completed":
        raise ApiProblem(409, "embedding_run_incomplete", "The embedding run is not complete.")
    return row


def _complete_chunk_artifact(repository: Repository, row: dict[str, Any]) -> bool:
    """Only reuse a chunk row whose persisted children match its count."""
    chunks = row.get("chunks")
    return (
        row.get("status") == "completed"
        and isinstance(chunks, list)
        and row.get("chunk_count") == len(chunks)
    )


def _complete_embedding_artifact(repository: Repository, row: dict[str, Any]) -> bool:
    """Only reuse an embedding row with one valid vector per parent chunk."""
    if row.get("status") != "completed":
        return False
    chunks = repository.get_chunks_for_embedding(row["chunk_run_id"], row["id"])
    dimensions = row.get("dimensions")
    return (
        row.get("embedding_count") == len(chunks)
        and all(
            isinstance(chunk.get("embedding"), list)
            and len(chunk["embedding"]) == dimensions
            for chunk in chunks
        )
    )


def _require_compatible_embedding(
    repository: Repository,
    document_id: str,
    embedding_run_id: str,
    *,
    chunk_run_id: str | None = None,
    settings: Settings | None = None,
    require_current_contract: bool = False,
) -> dict[str, Any]:
    embedding = _embedding_or_404(repository, embedding_run_id)
    if embedding.get("document_id") != document_id:
        raise _lineage_problem("The embedding run belongs to another document.")
    parent_chunk = _require_compatible_chunk(repository, document_id, embedding["chunk_run_id"])
    if chunk_run_id is not None and embedding["chunk_run_id"] != chunk_run_id:
        raise _lineage_problem("The embedding run does not belong to the selected chunks.")
    if require_current_contract:
        settings = settings or get_settings()
        if (
            embedding.get("model") != settings.gemini_embedding_model
            or embedding.get("dimensions") != settings.gemini_embedding_dimensions
            or embedding.get("embedding_format_version") != EMBEDDING_FORMAT_VERSION
        ):
            raise _lineage_problem("The embedding run is incompatible with the current model, dimension, or format.")
    # Keep the parent lookup explicit: an embedding is usable only through a
    # completed chunk whose parse is itself compatible.
    _ = parent_chunk
    return embedding


def run_lineage_compatibility(
    repository: Repository,
    document: dict[str, Any],
    row: dict[str, Any],
    *,
    settings: Settings | None = None,
) -> tuple[bool, str | None]:
    """Return whether one persisted run can still participate in its lineage.

    Active pointers are intentionally absent from this decision: they choose
    defaults, while completed historical runs remain valid when their direct
    parents and format contracts are compatible.
    """
    if row.get("status") != "completed":
        return False, "run_not_completed"
    document_id = document.get("id")
    try:
        if "structured" in row:
            _require_compatible_parse(repository, document_id, row["id"])
        elif "strategy" in row:
            _require_compatible_chunk(repository, document_id, row["id"])
        elif "dimensions" in row:
            _require_compatible_embedding(
                repository,
                document_id,
                row["id"],
                settings=settings,
                require_current_contract=True,
            )
        else:
            chunk_id = row.get("chunk_run_id")
            if not chunk_id:
                return False, "chunk_lineage_missing"
            _require_compatible_chunk(repository, document_id, chunk_id)
            embedding_id = row.get("embedding_run_id")
            if embedding_id:
                _require_compatible_embedding(
                    repository,
                    document_id,
                    embedding_id,
                    chunk_run_id=chunk_id,
                    settings=settings,
                    require_current_contract=True,
                )
    except ApiProblem as exc:
        return False, exc.code
    return True, None


def _usable_completed_parse(row: dict[str, Any] | None) -> bool:
    return bool(
        row
        and row.get("status") == "completed"
        and row.get("normalized_schema_version") == SUPPORTED_NORMALIZED_SCHEMA_VERSION
        and row.get("structured") is not None
        and row.get("summary") is not None
    )


def _reusable_parse(repository: Repository, document: dict[str, Any]) -> dict[str, Any] | None:
    inflight = repository.find_inflight_parse(document["id"])
    if inflight is not None:
        return inflight
    rows = repository.list_parse_rows(document["id"])
    active_id = document.get("active_parse_run_id")
    active = next((row for row in rows if row.get("id") == active_id), None)
    if _usable_completed_parse(active):
        return active
    return next((row for row in rows if _usable_completed_parse(row)), None)


def _queue_parse_for_document(
    repository: Repository,
    document: dict[str, Any],
    settings: Settings,
) -> tuple[dict[str, Any], bool]:
    reusable = _reusable_parse(repository, document)
    if reusable is not None:
        return reusable, False
    try:
        parse = repository.create_parse_run(document["id"], parser_version=settings.docling_parser_version)
    except ApiProblem as exc:
        if exc.code != "parse_already_in_progress":
            raise
        inflight = repository.find_inflight_parse(document["id"])
        if inflight is None:
            raise
        return inflight, False
    if parse is None:
        raise ApiProblem(500, "persistence_failed", "The parse run could not be queued.")
    return parse, True


def parse_upload(
    content: bytes,
    file_name: str,
    parsed: ParseResponse,
    *,
    repository: Repository | None = None,
    settings: Settings | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    repository = repository or get_repository()
    settings = settings or get_settings()
    _require_write(repository, settings)
    digest = hashlib.sha256(content).hexdigest()
    storage_path = f"{new_id()}/{digest}.pdf"
    storage = get_storage()
    storage.upload_pdf(storage_path, content)
    metadata = {
        "file_name": file_name,
        "media_type": "application/pdf",
        "size_bytes": len(content),
        "page_count": parsed.document.page_count,
    }
    document: dict[str, Any] | None = None
    try:
        document = repository.create_document(
            metadata,
            settings.supabase_storage_bucket,
            storage_path,
            digest,
        )
        parse = repository.save_parse(document["id"], parsed)
    except Exception:
        if document is not None:
            repository.delete_document(document["id"])
        storage.remove(storage_path)
        raise
    if parse is None:
        storage.remove(storage_path)
        raise ApiProblem(500, "persistence_failed", "The parsed document could not be persisted.")
    return document, parse


def queue_parse_upload(
    content: bytes,
    file_name: str,
    *,
    repository: Repository | None = None,
    settings: Settings | None = None,
) -> tuple[dict[str, Any], dict[str, Any], bool, bool]:
    """Persist the PDF and a queued parse run without doing CPU-heavy work."""

    repository = repository or get_repository()
    settings = settings or get_settings()
    _require_write(repository, settings)
    digest = hashlib.sha256(content).hexdigest()
    existing = repository.get_document_by_sha256(digest)
    if existing is not None:
        parse, dispatch_required = _queue_parse_for_document(repository, existing, settings)
        return existing, parse, True, dispatch_required
    storage_path = f"{new_id()}/{digest}.pdf"
    storage = get_storage()
    metadata = {
        "file_name": file_name,
        "media_type": "application/pdf",
        "size_bytes": len(content),
        "page_count": 0,
    }
    document: dict[str, Any] | None = None
    storage = get_storage()
    try:
        # A committed Document always has a ready source object. This keeps a
        # concurrent duplicate request from dispatching a worker before the
        # winner finishes uploading the PDF.
        storage.upload_pdf(storage_path, content)
        try:
            document = repository.create_document(metadata, settings.supabase_storage_bucket, storage_path, digest)
        except Exception:
            # The unique owner+SHA identity is the arbitration point. A loser
            # removes only its own UUID object before reusing the winner.
            storage.remove(storage_path)
            raced = repository.get_document_by_sha256(digest)
            if raced is None:
                raise
            parse, dispatch_required = _queue_parse_for_document(repository, raced, settings)
            return raced, parse, True, dispatch_required
        parse, _ = _queue_parse_for_document(repository, document, settings)
    except Exception:
        if document is not None:
            repository.delete_document(document["id"])
        storage.remove(storage_path)
        raise
    if parse is None:
        storage.remove(storage_path)
        raise ApiProblem(500, "persistence_failed", "The parse run could not be queued.")
    return document, parse, False, True


def queue_reparse_document(
    document_id: str,
    *,
    repository: Repository | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Create a new parse run while preserving the current active lineage."""

    repository = repository or get_repository()
    settings = get_settings()
    _require_write(repository, settings)
    document = _document_or_404(repository, document_id)
    parse = repository.create_parse_run(
        document_id,
        parser_version=settings.docling_parser_version,
    )
    if parse is None:
        raise ApiProblem(500, "persistence_failed", "The parse run could not be queued.")
    return document, parse


def run_parse_worker(
    parse_run_id: str,
    *,
    repository: Repository | None = None,
    worker_name: str = "modal",
) -> dict[str, Any] | None:
    """Run one queued parse and persist one terminal lifecycle transition.

    This function is the only place where the full Docling converter is called
    by the Modal worker or the development worker. It never falls back to the
    old text-cell heuristic.
    """

    repository = repository or get_repository()
    settings = get_settings()
    row = repository.get_parse_row(parse_run_id)
    if row is None:
        return None
    if row.get("status") in {"completed", "failed", "interrupted"}:
        return row
    running = repository.mark_parse_running(parse_run_id)
    if running is None or running.get("status") in {"completed", "failed", "interrupted"}:
        return running
    started = time.perf_counter()

    def report_progress(progress: int, phase: str) -> None:
        try:
            repository.update_parse_progress(parse_run_id, progress, phase)
        except Exception:
            # Progress is observability; it must never prevent the parse itself.
            logger.warning("parse_progress_update_failed parse_run_id=%s phase=%s", parse_run_id, phase)

    report_progress(8, "worker_started")
    queue_duration_ms = None
    if running.get("created_at") is not None and running.get("started_at") is not None:
        queue_duration_ms = max(0, int((running["started_at"] - running["created_at"]).total_seconds() * 1000))
    logger.info(
        "parse_worker_started parse_run_id=%s parser_version=%s queue_duration_ms=%s",
        parse_run_id,
        settings.docling_parser_version,
        queue_duration_ms,
    )
    try:
        document = _document_or_404(repository, running["document_id"])
        storage_started = time.perf_counter()
        content = get_storage().download(document["storage_path"])
        storage_download_ms = max(0, int((time.perf_counter() - storage_started) * 1000))
        report_progress(15, "source_loaded")
        temporary_path: Path | None = None
        try:
            from .parser import parse_pdf_file

            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as temporary_file:
                temporary_file.write(content)
                temporary_path = Path(temporary_file.name)
            with measure_resource_usage() as measurement:
                parsed = parse_pdf_file(
                    temporary_path,
                    document["file_name"],
                    len(content),
                    progress_callback=report_progress,
                )
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
        duration_ms = int(measurement.get("elapsedMs") or (time.perf_counter() - started) * 1000)
        execution_metadata = {
            **(parsed.run_metadata or {}),
            "worker": worker_name,
            "progress": 100,
            "phase": "completed",
            "queueDurationMs": queue_duration_ms,
            "storageDownloadMs": storage_download_ms,
            "measurement": measurement,
        }
        completed = repository.complete_parse(
            parse_run_id,
            parsed,
            parser_version=settings.docling_parser_version,
            execution_metadata=execution_metadata,
            duration_ms=duration_ms,
        )
        logger.info(
            "parse_worker_completed parse_run_id=%s parser_version=%s duration_ms=%s peak_rss_mb=%s start_mode=%s",
            parse_run_id,
            settings.docling_parser_version,
            duration_ms,
            measurement.get("peakRssMb"),
            execution_metadata.get("workerStartMode"),
        )
        return completed
    except ApiProblem as exc:
        duration_ms = max(0, int((time.perf_counter() - started) * 1000))
        failed = repository.fail_parse(
            parse_run_id,
            exc.code,
            exc.message,
            status="failed",
            duration_ms=duration_ms,
        )
        logger.warning(
            "parse_worker_failed parse_run_id=%s parser_version=%s duration_ms=%s error_code=%s cause_type=%s cause=%s",
            parse_run_id,
            settings.docling_parser_version,
            duration_ms,
            exc.code,
            type(exc.__cause__).__name__ if exc.__cause__ is not None else None,
            str(exc.__cause__)[:500] if exc.__cause__ is not None else None,
        )
        return failed
    except Exception as exc:
        duration_ms = max(0, int((time.perf_counter() - started) * 1000))
        failed = repository.fail_parse(
            parse_run_id,
            "parse_worker_error",
            "The parse worker could not complete this document.",
            status="failed",
            duration_ms=duration_ms,
        )
        logger.error(
            "parse_worker_failed parse_run_id=%s parser_version=%s duration_ms=%s error_code=parse_worker_error exception_type=%s",
            parse_run_id,
            settings.docling_parser_version,
            duration_ms,
            type(exc).__name__,
        )
        return failed


def reparse_document(document_id: str, *, repository: Repository | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    repository = repository or get_repository()
    settings = get_settings()
    _require_write(repository, settings)
    document = _document_or_404(repository, document_id)
    content = get_storage().download(document["storage_path"])
    temporary_path: Path | None = None
    try:
        from .parser import parse_pdf_file

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as temporary_file:
            temporary_file.write(content)
            temporary_path = Path(temporary_file.name)
        parsed = parse_pdf_file(temporary_path, document["file_name"], len(content))
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
    parse = repository.save_parse(document_id, parsed)
    if parse is None:
        raise ApiProblem(500, "persistence_failed", "The parse run could not be persisted.")
    return repository.get_document_row(document_id) or document, parse


def create_chunk_run(document_id: str, request: ChunkRunRequest, *, repository: Repository | None = None) -> dict[str, Any]:
    repository = repository or get_repository()
    _require_write(repository, get_settings())
    document = _document_or_404(repository, document_id)
    parse_id = request.parse_run_id or document.get("active_parse_run_id")
    if not parse_id:
        raise ApiProblem(409, "parse_required", "Parse the document before chunking it.")
    parse = _require_compatible_parse(repository, document_id, parse_id)
    try:
        canonical_config = effective_config(request.config)
    except ValueError as exc:
        raise ApiProblem(422, "chunk_config_invalid", str(exc)) from exc
    claim, claimed = repository.claim_chunk_run(
        document_id,
        parse_id,
        request.strategy,
        canonical_config,
        config_hash(canonical_config),
        TOKENIZER_VERSION,
        CHUNKER_VERSION,
    )
    if not claimed:
        if claim.get("status") == "completed":
            if not _complete_chunk_artifact(repository, claim):
                repository.fail_chunk_run(
                    claim["id"],
                    "artifact_incomplete",
                    "The existing chunk artifact is incomplete and cannot be reused.",
                )
                raise ApiProblem(409, "artifact_incomplete", "The existing chunk artifact is incomplete and cannot be reused.")
            claim["reused_artifact"] = True
            return claim
        raise ApiProblem(409, "artifact_in_progress", "The chunk artifact with this identity is currently being created.")
    try:
        drafts = chunk_structured(parse["structured"], request.strategy, canonical_config)
        completed = repository.complete_chunk_run(claim["id"], drafts)
        if completed is None:
            raise ApiProblem(500, "persistence_failed", "The chunk run could not be completed.")
        completed["reused_artifact"] = False
        return completed
    except ApiProblem as exc:
        repository.fail_chunk_run(claim["id"], exc.code, exc.message)
        raise
    except Exception:
        repository.fail_chunk_run(
            claim["id"],
            "chunk_run_failed",
            "The chunk run failed before producing a completed artifact.",
        )
        raise


def create_embedding_run(document_id: str, chunk_run_id: str | None, *, repository: Repository | None = None) -> dict[str, Any]:
    repository = repository or get_repository()
    settings = get_settings()
    _require_write(repository, settings)
    document = _document_or_404(repository, document_id)
    chunk_id = chunk_run_id or document.get("active_chunk_run_id")
    if not chunk_id:
        raise ApiProblem(409, "chunks_required", "Create chunks before embedding them.")
    chunk_run = _require_compatible_chunk(repository, document_id, chunk_id)
    claim, claimed = repository.claim_embedding_run(
        document_id,
        chunk_id,
        settings.gemini_embedding_model,
        settings.gemini_embedding_dimensions,
        EMBEDDING_FORMAT_VERSION,
    )
    if not claimed:
        if claim.get("status") == "completed":
            if not _complete_embedding_artifact(repository, claim):
                repository.fail_embedding_run(
                    claim["id"],
                    "artifact_incomplete",
                    "The existing embedding artifact is incomplete and cannot be reused.",
                )
                raise ApiProblem(409, "artifact_incomplete", "The existing embedding artifact is incomplete and cannot be reused.")
            claim["reused_artifact"] = True
            return claim
        raise ApiProblem(409, "artifact_in_progress", "The embedding artifact with this identity is currently being created.")
    try:
        chunks = repository.get_chunks_for_embedding(chunk_id)
        service = GeminiService(settings)
        inputs = [document_embedding_text(chunk["text"], chunk.get("heading_path")) for chunk in chunks]
        vectors: list[list[float]] = []
        effective_model: str | None = None
        if inputs:
            for offset in range(0, len(inputs), 16):
                batch, metadata = service.embed_documents(inputs[offset : offset + 16])
                vectors.extend(batch)
                effective_model = effective_model or getattr(metadata, "effective_model", None)
        if len(vectors) != len(chunks):
            raise ApiProblem(503, "embedding_result_invalid", "Gemini did not return one embedding per chunk.")
        input_hashes = {
            chunk["id"]: hashlib.sha256(input_text.encode("utf-8")).hexdigest()
            for chunk, input_text in zip(chunks, inputs)
        }
        completed = repository.complete_embedding_run(
            claim["id"],
            [(chunk["id"], vector) for chunk, vector in zip(chunks, vectors)],
            input_hashes,
            effective_model,
        )
        if completed is None:
            raise ApiProblem(500, "persistence_failed", "The embedding run could not be completed.")
        completed["reused_artifact"] = False
        return completed
    except ApiProblem as exc:
        repository.fail_embedding_run(claim["id"], exc.code, exc.message)
        raise
    except Exception:
        repository.fail_embedding_run(
            claim["id"],
            "embedding_run_failed",
            "The embedding run failed before producing a completed artifact.",
        )
        raise


def _dot_cosine(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    denominator = math.sqrt(sum(value * value for value in left)) * math.sqrt(sum(value * value for value in right))
    return sum(a * b for a, b in zip(left, right)) / denominator if denominator else 0.0


def _keyword_score(query: str, text: str) -> float:
    terms = [term.lower() for term in re.findall(r"[\wÀ-ÿ]+", query) if len(term) > 1]
    if not terms:
        return 0.0
    haystack = text.lower()
    return sum(haystack.count(term) for term in terms) / len(terms)


def _candidate_view(chunk: dict[str, Any], *, dense: float | None = None, keyword: float | None = None) -> dict[str, Any]:
    return {
        "chunkId": chunk["id"],
        "documentId": chunk.get("document_id"),
        "ordinal": chunk["ordinal"],
        "text": chunk["text"],
        "pageNumbers": chunk.get("page_numbers", []),
        "sourceElementIds": chunk.get("source_element_ids", []),
        "headingPath": chunk.get("heading_path", []),
        "denseScore": dense,
        "keywordScore": keyword,
    }


def _assemble_retrieval(
    mode: str,
    top_k: int,
    dense_ranked: list[dict[str, Any]],
    keyword_ranked: list[dict[str, Any]],
) -> dict[str, Any]:
    dense_ranked = [_candidate_view(item, dense=item.get("denseScore")) for item in dense_ranked]
    keyword_ranked = [_candidate_view(item, keyword=item.get("keywordScore")) for item in keyword_ranked]
    dense_by_id = {item["chunkId"]: item for item in dense_ranked}
    keyword_by_id = {item["chunkId"]: item for item in keyword_ranked}
    dense_positions = {item["chunkId"]: index + 1 for index, item in enumerate(dense_ranked)}
    keyword_positions = {item["chunkId"]: index + 1 for index, item in enumerate(keyword_ranked)}
    ids = set(dense_by_id) | set(keyword_by_id)
    candidate_k = min(200, max(top_k * 4, 20))
    if mode == "dense":
        ordered_ids = [item["chunkId"] for item in dense_ranked[:candidate_k]]
    elif mode == "keyword":
        ordered_ids = [item["chunkId"] for item in keyword_ranked[:candidate_k]]
    else:
        def rrf(chunk_id: str) -> float:
            return (1 / (60 + dense_positions[chunk_id]) if chunk_id in dense_positions else 0) + (1 / (60 + keyword_positions[chunk_id]) if chunk_id in keyword_positions else 0)

        ordered_ids = sorted(ids, key=lambda chunk_id: (-rrf(chunk_id), min(dense_positions.get(chunk_id, 100000), keyword_positions.get(chunk_id, 100000)), chunk_id))[:candidate_k]
    values: list[dict[str, Any]] = []
    for rank, chunk_id in enumerate(ordered_ids[:top_k], start=1):
        base = dense_by_id.get(chunk_id) or keyword_by_id.get(chunk_id)
        assert base is not None
        dense_rank = dense_positions.get(chunk_id)
        keyword_rank = keyword_positions.get(chunk_id)
        fused = (1 / (60 + dense_rank) if dense_rank else 0) + (1 / (60 + keyword_rank) if keyword_rank else 0)
        values.append({
            **base,
            "denseRank": dense_rank,
            "keywordRank": keyword_rank,
            "rrfScore": fused if mode == "hybrid" else None,
            "rank": rank,
        })
    return {
        "status": "completed",
        "mode": mode,
        "topK": top_k,
        "candidateK": candidate_k,
        "rrfK": 60 if mode == "hybrid" else None,
        "results": values,
    }


def _retrieval_stage(
    query: str,
    mode: str,
    top_k: int,
    chunks: list[dict[str, Any]],
    query_vector: list[float] | None,
) -> dict[str, Any]:
    dense_ranked: list[dict[str, Any]] = []
    keyword_ranked: list[dict[str, Any]] = []
    if mode in {"dense", "hybrid"}:
        if query_vector is None:
            raise ApiProblem(409, "embedding_required", "Dense retrieval requires an embedding run.")
        dense_ranked = sorted(
            [{**chunk, "denseScore": _dot_cosine(query_vector, chunk.get("embedding") or [])} for chunk in chunks],
            key=lambda item: (-float(item["denseScore"] or 0), item["ordinal"], item["id"]),
        )
    if mode in {"keyword", "hybrid"}:
        keyword_ranked = sorted(
            [{**chunk, "keywordScore": _keyword_score(query, chunk["text"])} for chunk in chunks if _keyword_score(query, chunk["text"]) > 0],
            key=lambda item: (-float(item["keywordScore"] or 0), item["ordinal"], item["id"]),
        )
    return _assemble_retrieval(mode, top_k, dense_ranked[: min(200, max(top_k * 4, 20))], keyword_ranked[: min(200, max(top_k * 4, 20))])


def _rerank_stage(retrieval: dict[str, Any], service: GeminiService, candidate_count: int) -> dict[str, Any]:
    candidates = retrieval.get("results", [])[:candidate_count]
    prompt = (
        "Return JSON with orderedCandidateIds. Order only the supplied candidate IDs by relevance. "
        "Do not invent IDs.\n" + "\n".join(f"{item['chunkId']}: {item['text'][:1200]}" for item in candidates)
    )
    ordered, metadata = service.rerank(prompt)
    allowed = [item["chunkId"] for item in candidates]
    if len(set(ordered)) != len(ordered) or any(identifier not in set(allowed) for identifier in ordered):
        raise ApiProblem(503, "invalid_rerank", "The reranker returned an invalid candidate list.")
    ordered = ordered + [identifier for identifier in allowed if identifier not in ordered]
    by_id = {item["chunkId"]: item for item in candidates}
    results = [{**by_id[identifier], "retrievalRank": by_id[identifier].get("rank"), "rank": index + 1, "rerankScore": len(ordered) - index} for index, identifier in enumerate(ordered)]
    return {
        "status": "completed",
        "method": "gemini_listwise_v1",
        "configuredModel": metadata.configured_model,
        "effectiveModel": metadata.effective_model,
        "results": results,
    }


def _context_stage(candidates: list[dict[str, Any]], budget: int) -> dict[str, Any]:
    selected: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    used = 0
    seen: set[str] = set()
    for item in candidates:
        text = item["text"]
        token_count = TOKENIZER.count(text)
        if text in seen:
            excluded.append({**item, "reason": "duplicate_text", "localTokenCount": token_count})
            continue
        seen.add(text)
        if used + token_count > budget:
            excluded.append({**item, "reason": "budget_exceeded", "localTokenCount": token_count})
            continue
        citation_id = f"C{len(selected) + 1}"
        selected.append({"citationId": citation_id, **item, "localTokenCount": token_count})
        used += token_count
    formatted = "\n\n".join(f"[{item['citationId']}] {item['text']}" for item in selected)
    return {
        "status": "completed",
        "tokenBudget": budget,
        "localTokenCount": used,
        "selected": selected,
        "excluded": excluded,
        "formattedContext": formatted,
    }


def _generation_stage(query: str, context: dict[str, Any], config: Any, service: GeminiService) -> dict[str, Any]:
    selected = context.get("selected", [])
    if not selected:
        return {
            "status": "completed",
            "insufficientContext": True,
            "answer": "Yeterli bağlam bulunamadı.",
            "claims": [],
            "citations": [],
            "configuredModel": service.settings.gemini_generation_model,
            "effectiveModel": None,
        }
    prompt = (
        "Answer only from the supplied context. If it is insufficient, set insufficientContext=true. "
        "Return JSON: {insufficientContext:boolean,answer:string,claims:[{text:string,citationIds:string[]}]}.\n"
        f"Question: {query}\nContext:\n{context['formattedContext']}"
    )
    allowed = {item["citationId"]: item for item in selected}
    attempts = max(0, service.settings.gemini_max_retries) + 1
    for attempt in range(attempts):
        payload, metadata = service.generate_json(
            prompt,
            {
                "temperature": config.temperature,
                "max_output_tokens": config.max_output_tokens,
            },
        )
        try:
            insufficient = bool(payload.get("insufficientContext", False))
            answer = payload.get("answer")
            claims = payload.get("claims", [])
            if not isinstance(answer, str) or (not insufficient and not answer.strip()):
                raise ApiProblem(503, "generation_invalid", "The generated answer format is invalid.")
            if not isinstance(claims, list) or (not insufficient and not claims):
                raise ApiProblem(503, "citation_invalid", "The generated claims format is invalid.")
            citations: list[dict[str, Any]] = []
            for claim in claims:
                if not isinstance(claim, dict):
                    raise ApiProblem(503, "citation_invalid", "The generated citation format is invalid.")
                ids = claim.get("citationIds", [])
                if not isinstance(ids, list) or (not insufficient and not ids) or any(identifier not in allowed for identifier in ids):
                    raise ApiProblem(503, "citation_invalid", "The generated answer referenced an unknown citation.")
                for identifier in ids:
                    source = allowed[identifier]
                    citations.append({
                        "citationId": identifier,
                        "chunkId": source["chunkId"],
                        "documentId": source.get("documentId"),
                        "pageNumbers": source.get("pageNumbers", []),
                        "sourceElementIds": source.get("sourceElementIds", []),
                        "valid": True,
                    })
            break
        except ApiProblem:
            if attempt + 1 >= attempts:
                raise
    return {
        "status": "completed",
        "insufficientContext": insufficient,
        "answer": answer,
        "claims": claims,
        "citations": citations,
        "citationValidity": {"valid": True, "count": len(citations)},
        "configuredModel": metadata.configured_model,
        "effectiveModel": metadata.effective_model,
    }


def _stage_target(target: str) -> list[str]:
    return STAGE_ORDER[: STAGE_ORDER.index(target) + 1]


def _prepare_experiment_lineage(
    request: ExperimentCreateRequest,
    repository: Repository,
    settings: Settings,
) -> tuple[dict[str, Any], str, str | None, dict[str, Any] | None]:
    document = _document_or_404(repository, request.document_id)
    chunk_run_id = request.chunk_run_id or document.get("active_chunk_run_id")
    if not chunk_run_id:
        raise ApiProblem(409, "chunks_required", "Create chunks before running an experiment.")
    _require_compatible_chunk(repository, request.document_id, chunk_run_id)
    embedding_run_id = request.embedding_run_id or document.get("active_embedding_run_id")
    if request.retrieval.mode in {"dense", "hybrid"} and not embedding_run_id:
        raise ApiProblem(409, "embedding_required", "Dense or hybrid retrieval requires embeddings.")
    embedding = None
    if embedding_run_id:
        try:
            embedding = _require_compatible_embedding(
                repository,
                request.document_id,
                embedding_run_id,
                chunk_run_id=chunk_run_id,
                settings=settings,
                require_current_contract=request.retrieval.mode in {"dense", "hybrid"},
            )
        except ApiProblem:
            if request.embedding_run_id is not None or request.retrieval.mode in {"dense", "hybrid"}:
                raise
            # Keyword retrieval does not consume an embedding. An active
            # embedding from another historical chunk is simply not selected.
            embedding_run_id = None
    return document, chunk_run_id, embedding_run_id, embedding


def _embedding_provenance(embedding: dict[str, Any] | None) -> dict[str, Any] | None:
    if embedding is None:
        return None
    model = _model_provenance(
        embedding.get("model"),
        embedding.get("effective_model"),
        required=True,
        role="document_embedding",
    )
    return {
        "runId": embedding.get("id"),
        "model": embedding.get("model"),
        "dimensions": embedding.get("dimensions"),
        "formatVersion": embedding.get("embedding_format_version"),
        "effectiveModel": embedding.get("effective_model"),
        "modelProvenance": model,
        "cacheable": model.get("cacheable") is True
        and embedding.get("embedding_format_version") == EMBEDDING_FORMAT_VERSION
        and isinstance(embedding.get("dimensions"), int),
    }


def _retrieval_fingerprint(
    request: ExperimentCreateRequest,
    chunk_run_id: str,
    embedding_run_id: str | None,
    embedding: dict[str, Any] | None,
    settings: Settings,
) -> str:
    mode = request.retrieval.mode
    candidate_k = min(200, max(request.retrieval.top_k * 4, 20))
    return _fingerprint({
        "schema": STAGE_FINGERPRINT_SCHEMA_VERSION,
        "stage": "retrieval",
        "documentId": request.document_id,
        "chunkRunId": chunk_run_id,
        "embeddingRunId": embedding_run_id if mode in {"dense", "hybrid"} else None,
        "query": request.query,
        "config": {
            "mode": mode,
            "topK": request.retrieval.top_k,
            "candidateK": candidate_k,
            "ftsConfig": "simple",
            "rrfK": 60,
        },
        "provenance": {
            "algorithmVersion": RETRIEVAL_ALGORITHM_VERSION,
            "queryEmbeddingModel": settings.gemini_embedding_model if mode in {"dense", "hybrid"} else None,
            "queryEmbeddingDimensions": settings.gemini_embedding_dimensions if mode in {"dense", "hybrid"} else None,
            "embeddingFormatVersion": EMBEDDING_FORMAT_VERSION if mode in {"dense", "hybrid"} else None,
            "documentEmbedding": _embedding_provenance(embedding) if mode in {"dense", "hybrid"} else None,
        },
    })


def _reranking_fingerprint(
    request: ExperimentCreateRequest,
    retrieval: dict[str, Any],
    settings: Settings,
) -> str:
    return _fingerprint({
        "schema": STAGE_FINGERPRINT_SCHEMA_VERSION,
        "stage": "reranking",
        "upstream": {
            "fingerprint": retrieval.get("fingerprint"),
            "resultHash": retrieval.get("resultHash"),
        },
        "config": _safe_model_dump(request.reranking),
        "provenance": {
            "algorithmVersion": RERANK_ALGORITHM_VERSION,
            "promptVersion": RERANK_PROMPT_VERSION,
            "model": settings.gemini_rerank_model if request.reranking.enabled else None,
        },
    })


def _context_fingerprint(request: ExperimentCreateRequest, reranking: dict[str, Any]) -> str:
    return _fingerprint({
        "schema": STAGE_FINGERPRINT_SCHEMA_VERSION,
        "stage": "context",
        "upstream": {
            "fingerprint": reranking.get("fingerprint"),
            "resultHash": reranking.get("resultHash"),
        },
        "config": _safe_model_dump(request.context),
        "provenance": {
            "algorithmVersion": CONTEXT_ALGORITHM_VERSION,
            "tokenizerVersion": TOKENIZER_VERSION,
        },
    })


def _generation_fingerprint(
    request: ExperimentCreateRequest,
    context: dict[str, Any],
    settings: Settings,
) -> str:
    return _fingerprint({
        "schema": STAGE_FINGERPRINT_SCHEMA_VERSION,
        "stage": "generation",
        "upstream": {
            "fingerprint": context.get("fingerprint"),
            "resultHash": context.get("resultHash"),
        },
        "query": request.query,
        "config": _safe_model_dump(request.generation),
        "provenance": {
            "promptVersion": GENERATION_PROMPT_VERSION,
            "validationVersion": GENERATION_VALIDATION_VERSION,
            "model": settings.gemini_generation_model,
        },
    })


def _experiment_fingerprint(
    request: ExperimentCreateRequest,
    chunk_run_id: str,
    embedding_run_id: str | None,
    embedding: dict[str, Any] | None,
    settings: Settings,
) -> str:
    return _fingerprint({
        "schema": EXPERIMENT_FINGERPRINT_SCHEMA_VERSION,
        "documentId": request.document_id,
        "chunkRunId": chunk_run_id,
        "embeddingRunId": embedding_run_id,
        "query": request.query,
        "targetStage": request.target_stage,
        "retrieval": _safe_model_dump(request.retrieval),
        "reranking": _safe_model_dump(request.reranking),
        "context": _safe_model_dump(request.context),
        "generation": _safe_model_dump(request.generation),
        "provenance": {
            "retrievalAlgorithmVersion": RETRIEVAL_ALGORITHM_VERSION,
            "rerankAlgorithmVersion": RERANK_ALGORITHM_VERSION,
            "rerankPromptVersion": RERANK_PROMPT_VERSION,
            "contextAlgorithmVersion": CONTEXT_ALGORITHM_VERSION,
            "tokenizerVersion": TOKENIZER_VERSION,
            "generationPromptVersion": GENERATION_PROMPT_VERSION,
            "generationValidationVersion": GENERATION_VALIDATION_VERSION,
            "embeddingFormatVersion": EMBEDDING_FORMAT_VERSION,
            "embeddingModel": settings.gemini_embedding_model,
            "rerankModel": settings.gemini_rerank_model,
            "generationModel": settings.gemini_generation_model,
            "documentEmbedding": _embedding_provenance(embedding),
        },
    })


def _exact_experiment_reusable(
    row: dict[str, Any],
    request: ExperimentCreateRequest,
    chunk_run_id: str,
    embedding_run_id: str | None,
    embedding: dict[str, Any] | None,
    settings: Settings,
) -> bool:
    if row.get("status") != "completed":
        return False
    results = row.get("stage_results")
    if not isinstance(results, dict):
        return False
    retrieval = results.get("retrieval")
    retrieval_fp = _retrieval_fingerprint(request, chunk_run_id, embedding_run_id, embedding, settings)
    if not _stage_reusable(retrieval, retrieval_fp):
        return False
    if request.target_stage == "retrieval":
        return True
    reranking = results.get("reranking")
    rerank_fp = _reranking_fingerprint(request, retrieval, settings)
    if not _stage_reusable(reranking, rerank_fp):
        return False
    if request.target_stage == "reranking":
        return True
    context = results.get("context")
    context_fp = _context_fingerprint(request, reranking)
    if not _stage_reusable(context, context_fp):
        return False
    if request.target_stage == "context":
        return True
    generation = results.get("generation")
    return _stage_reusable(generation, _generation_fingerprint(request, context, settings))


def _find_reusable_stage(
    repository: Repository,
    document_id: str,
    stage: str,
    fingerprint: str,
    *,
    seed_stage_results: dict[str, Any] | None = None,
    seed_experiment_id: str | None = None,
) -> tuple[dict[str, Any], str] | None:
    if seed_stage_results:
        seeded = seed_stage_results.get(stage)
        if _stage_reusable(seeded, fingerprint):
            return _stage_with_identity(seeded, fingerprint, reused=True, source_experiment_id=seed_experiment_id), seed_experiment_id or "seed"
    candidate = repository.find_stage_result(document_id, stage, fingerprint)
    if candidate is None:
        return None
    value, source_experiment_id = candidate
    if not _stage_reusable(value, fingerprint):
        return None
    return _stage_with_identity(value, fingerprint, reused=True, source_experiment_id=source_experiment_id), source_experiment_id


def _persist_stage(repository: Repository, experiment_id: str, stage: str, value: dict[str, Any]) -> None:
    if repository.update_experiment_stage(experiment_id, stage, value) is None:
        raise ApiProblem(500, "persistence_failed", "The experiment stage could not be persisted.")


def _run_experiment_stages(
    request: ExperimentCreateRequest,
    repository: Repository,
    settings: Settings,
    *,
    experiment_id: str,
    chunk_run_id: str,
    embedding_run_id: str | None,
    embedding: dict[str, Any] | None,
    seed_stage_results: dict[str, Any] | None = None,
    seed_experiment_id: str | None = None,
    force_generation: bool = False,
) -> dict[str, Any]:
    target_stages = _stage_target(request.target_stage)
    stage_results: dict[str, Any] = {}
    service: GeminiService | None = None
    chunks: list[dict[str, Any]] | None = None
    candidate_k = min(200, max(request.retrieval.top_k * 4, 20))

    def get_service() -> GeminiService:
        nonlocal service
        service = service or GeminiService(settings)
        return service

    retrieval_fp = _retrieval_fingerprint(request, chunk_run_id, embedding_run_id, embedding, settings)
    reusable = _find_reusable_stage(
        repository,
        request.document_id,
        "retrieval",
        retrieval_fp,
        seed_stage_results=seed_stage_results,
        seed_experiment_id=seed_experiment_id,
    )
    if reusable is not None:
        retrieval, _ = reusable
    else:
        started = time.perf_counter()
        query_vector = None
        query_embedding_metadata = None
        if request.retrieval.mode in {"dense", "hybrid"}:
            query_vector, query_embedding_metadata = get_service().embed_query(request.query)
        if chunks is None and not repository.persistent:
            chunks = repository.get_chunks_for_embedding(chunk_run_id, embedding_run_id)
        if repository.persistent:
            try:
                dense_ranked, keyword_ranked = repository.retrieve_candidates(
                    chunk_run_id,
                    embedding_run_id,
                    request.query,
                    query_vector,
                    request.retrieval.mode,
                    candidate_k,
                )
                retrieval = _assemble_retrieval(request.retrieval.mode, request.retrieval.top_k, dense_ranked, keyword_ranked)
            except ValueError as exc:
                raise ApiProblem(409, "retrieval_config_invalid", str(exc)) from exc
        else:
            retrieval = _retrieval_stage(request.query, request.retrieval.mode, request.retrieval.top_k, chunks or [], query_vector)
        retrieval["input"] = {"query": request.query, "chunkRunId": chunk_run_id, "embeddingRunId": embedding_run_id}
        retrieval["config"] = {
            "mode": request.retrieval.mode,
            "topK": request.retrieval.top_k,
            "candidateK": candidate_k,
            "ftsConfig": "simple",
            "rrfK": 60,
            "embeddingFormatVersion": query_embedding_metadata and EMBEDDING_FORMAT_VERSION,
            "embeddingConfiguredModel": query_embedding_metadata.configured_model if query_embedding_metadata else None,
            "embeddingEffectiveModel": query_embedding_metadata.effective_model if query_embedding_metadata else None,
        }
        retrieval["durationMs"] = max(0, round((time.perf_counter() - started) * 1000))
        query_model = _model_provenance(
            query_embedding_metadata.configured_model if query_embedding_metadata else None,
            query_embedding_metadata.effective_model if query_embedding_metadata else None,
            required=request.retrieval.mode in {"dense", "hybrid"},
            role="query_embedding",
        ) if request.retrieval.mode in {"dense", "hybrid"} else {"role": "keyword", "cacheable": True}
        retrieval["provenance"] = {
            "algorithmVersion": RETRIEVAL_ALGORITHM_VERSION,
            "tokenizerVersion": TOKENIZER_VERSION,
            "embeddingFormatVersion": EMBEDDING_FORMAT_VERSION if request.retrieval.mode in {"dense", "hybrid"} else None,
            "documentEmbedding": _embedding_provenance(embedding),
            "model": query_model,
            "cacheable": query_model.get("cacheable") is True
            and (
                request.retrieval.mode not in {"dense", "hybrid"}
                or (_embedding_provenance(embedding) or {}).get("cacheable") is True
            ),
        }
        retrieval = _stage_with_identity(retrieval, retrieval_fp, reused=False)
    stage_results["retrieval"] = retrieval
    _persist_stage(repository, experiment_id, "retrieval", retrieval)

    if len(target_stages) >= 2:
        rerank_fp = _reranking_fingerprint(request, retrieval, settings)
        reusable = _find_reusable_stage(
            repository,
            request.document_id,
            "reranking",
            rerank_fp,
            seed_stage_results=seed_stage_results,
            seed_experiment_id=seed_experiment_id,
        )
        if reusable is not None:
            reranking, _ = reusable
        else:
            started = time.perf_counter()
            if request.reranking.enabled:
                reranking = _rerank_stage(retrieval, get_service(), request.reranking.candidate_count)
                metadata_model = reranking.get("effectiveModel")
                configured_model = reranking.get("configuredModel")
                model = _model_provenance(configured_model, metadata_model, required=True, role="reranker")
            else:
                reranking = {"status": "skipped", "reason": "disabled", "results": retrieval["results"]}
                model = {"role": "reranker", "cacheable": True, "notUsed": True}
            reranking["durationMs"] = max(0, round((time.perf_counter() - started) * 1000))
            reranking["config"] = {"enabled": request.reranking.enabled, "candidateCount": request.reranking.candidate_count}
            reranking["provenance"] = {
                "algorithmVersion": RERANK_ALGORITHM_VERSION,
                "promptVersion": RERANK_PROMPT_VERSION,
                "model": model,
                "cacheable": model.get("cacheable") is True,
            }
            reranking = _stage_with_identity(reranking, rerank_fp, reused=False)
        stage_results["reranking"] = reranking
        _persist_stage(repository, experiment_id, "reranking", reranking)

    if len(target_stages) >= 3:
        reranking = stage_results["reranking"]
        context_fp = _context_fingerprint(request, reranking)
        reusable = _find_reusable_stage(
            repository,
            request.document_id,
            "context",
            context_fp,
            seed_stage_results=seed_stage_results,
            seed_experiment_id=seed_experiment_id,
        )
        if reusable is not None:
            context, _ = reusable
        else:
            started = time.perf_counter()
            candidates = reranking.get("results", retrieval["results"])
            context = _context_stage(candidates, request.context.token_budget)
            context["durationMs"] = max(0, round((time.perf_counter() - started) * 1000))
            context["config"] = {"tokenBudget": request.context.token_budget}
            context["provenance"] = {
                "algorithmVersion": CONTEXT_ALGORITHM_VERSION,
                "tokenizerVersion": TOKENIZER_VERSION,
                "cacheable": True,
            }
            context = _stage_with_identity(context, context_fp, reused=False)
        stage_results["context"] = context
        _persist_stage(repository, experiment_id, "context", context)

    if len(target_stages) >= 4:
        context = stage_results["context"]
        generation_fp = _generation_fingerprint(request, context, settings)
        reusable = None if force_generation else _find_reusable_stage(
            repository,
            request.document_id,
            "generation",
            generation_fp,
            seed_stage_results=seed_stage_results,
            seed_experiment_id=seed_experiment_id,
        )
        if reusable is not None:
            generation, _ = reusable
        else:
            started = time.perf_counter()
            generation = _generation_stage(request.query, context, request.generation, get_service())
            generation["durationMs"] = max(0, round((time.perf_counter() - started) * 1000))
            generation["config"] = _safe_model_dump(request.generation)
            if context.get("selected"):
                model = _model_provenance(
                    generation.get("configuredModel"),
                    generation.get("effectiveModel"),
                    required=True,
                    role="generation",
                )
            else:
                model = {"role": "generation", "cacheable": True, "notUsed": True}
            generation["provenance"] = {
                "promptVersion": GENERATION_PROMPT_VERSION,
                "validationVersion": GENERATION_VALIDATION_VERSION,
                "model": model,
                "cacheable": model.get("cacheable") is True,
            }
            generation = _stage_with_identity(generation, generation_fp, reused=False)
        stage_results["generation"] = generation
        _persist_stage(repository, experiment_id, "generation", generation)
    return stage_results


def _create_experiment(
    request: ExperimentCreateRequest,
    *,
    repository: Repository,
    seed_stage_results: dict[str, Any] | None = None,
    seed_experiment_id: str | None = None,
    continued_from_experiment_id: str | None = None,
    force_generation: bool = False,
    allow_exact_reuse: bool = True,
) -> dict[str, Any]:
    settings = get_settings()
    _require_write(repository, settings)
    _document, chunk_run_id, embedding_run_id, embedding = _prepare_experiment_lineage(request, repository, settings)
    experiment_fingerprint = _experiment_fingerprint(request, chunk_run_id, embedding_run_id, embedding, settings)
    if allow_exact_reuse:
        existing = repository.get_completed_experiment_by_fingerprint(request.document_id, experiment_fingerprint)
        if existing is not None and _exact_experiment_reusable(existing, request, chunk_run_id, embedding_run_id, embedding, settings):
            return _experiment_response(existing, reused_experiment=True, continued_from_experiment_id=continued_from_experiment_id)

    row = {
        "id": new_id(),
        "document_id": request.document_id,
        "chunk_run_id": chunk_run_id,
        "embedding_run_id": embedding_run_id,
        "query": request.query,
        "target_stage": request.target_stage,
        "experiment_fingerprint": experiment_fingerprint,
        "config": _safe_model_dump(request),
        "stage_results": {},
        "status": "running",
        "started_at": now_utc(),
        "completed_at": None,
        "duration_ms": None,
    }
    claimed, owner = repository.claim_experiment(row)
    if not owner:
        raise ApiProblem(409, "experiment_in_progress", "The exact experiment is currently being created.")
    try:
        _run_experiment_stages(
            request,
            repository,
            settings,
            experiment_id=claimed["id"],
            chunk_run_id=chunk_run_id,
            embedding_run_id=embedding_run_id,
            embedding=embedding,
            seed_stage_results=seed_stage_results,
            seed_experiment_id=seed_experiment_id,
            force_generation=force_generation,
        )
        completed = repository.complete_experiment(claimed["id"])
        if completed is None:
            raise ApiProblem(500, "persistence_failed", "The experiment could not be completed.")
        return _experiment_response(
            completed,
            continued_from_experiment_id=continued_from_experiment_id,
            generation_rerun=force_generation,
        )
    except ApiProblem as exc:
        repository.fail_experiment(claimed["id"], exc.code, exc.message)
        raise
    except Exception as exc:
        repository.fail_experiment(
            claimed["id"],
            "experiment_failed",
            "The experiment failed before completion.",
        )
        raise exc


def create_experiment(request: ExperimentCreateRequest, *, repository: Repository | None = None) -> dict[str, Any]:
    return _create_experiment(request, repository=repository or get_repository())


def continue_experiment(experiment_id: str, *, repository: Repository | None = None) -> dict[str, Any]:
    repository = repository or get_repository()
    row = repository.get_experiment_row(experiment_id)
    if row is None:
        raise ApiProblem(404, "experiment_not_found", "The experiment was not found.")
    if row.get("status") == "running":
        raise ApiProblem(409, "experiment_in_progress", "The experiment is still running.")
    prefix = _complete_prefix(row.get("stage_results") or {})
    if not prefix:
        raise ApiProblem(409, "experiment_prefix_missing", "The experiment has no persisted completed stage prefix.")
    if len(prefix) >= len(STAGE_ORDER):
        return _experiment_response(row, reused_experiment=True)
    request_data = copy.deepcopy(row.get("config") or {})
    request_data.update({
        "document_id": row["document_id"],
        "chunk_run_id": row["chunk_run_id"],
        "embedding_run_id": row.get("embedding_run_id"),
        "target_stage": STAGE_ORDER[len(prefix)],
    })
    return _create_experiment(
        ExperimentCreateRequest.model_validate(request_data),
        repository=repository,
        seed_stage_results=row.get("stage_results") or {},
        seed_experiment_id=row["id"],
        continued_from_experiment_id=row["id"],
    )


def rerun_generation(experiment_id: str, *, repository: Repository | None = None) -> dict[str, Any]:
    repository = repository or get_repository()
    row = repository.get_experiment_row(experiment_id)
    if row is None:
        raise ApiProblem(404, "experiment_not_found", "The experiment was not found.")
    if row.get("status") == "running":
        raise ApiProblem(409, "experiment_in_progress", "The experiment is still running.")
    prefix = _complete_prefix(row.get("stage_results") or {})
    if len(prefix) < 3:
        raise ApiProblem(409, "context_required", "A completed context stage is required before rerunning generation.")
    request_data = copy.deepcopy(row.get("config") or {})
    request_data.update({
        "document_id": row["document_id"],
        "chunk_run_id": row["chunk_run_id"],
        "embedding_run_id": row.get("embedding_run_id"),
        "target_stage": "generation",
    })
    return _create_experiment(
        ExperimentCreateRequest.model_validate(request_data),
        repository=repository,
        seed_stage_results=row.get("stage_results") or {},
        seed_experiment_id=row["id"],
        force_generation=True,
        allow_exact_reuse=False,
    )


def create_dataset(request: EvaluationDatasetRequest, *, repository: Repository | None = None) -> dict[str, Any]:
    repository = repository or get_repository()
    _require_write(repository, get_settings())
    document = _document_or_404(repository, request.document_id)
    parse_id = request.parse_run_id or document.get("active_parse_run_id")
    if not parse_id:
        raise ApiProblem(409, "parse_required", "Parse the document before creating an evaluation dataset.")
    _require_compatible_parse(repository, request.document_id, parse_id)
    return repository.save_dataset(request, parse_id)


def _evaluation_metrics(results: list[dict[str, Any]]) -> dict[str, Any]:
    if not results:
        return {"caseCount": 0, "hitAtK": 0, "precisionAtK": 0, "recallAtK": 0, "mrr": 0}
    return {
        "caseCount": len(results),
        "hitAtK": sum(item["hitAtK"] for item in results) / len(results),
        "precisionAtK": sum(item["precisionAtK"] for item in results) / len(results),
        "recallAtK": sum(item["recallAtK"] for item in results) / len(results),
        "mrr": sum(item["mrr"] for item in results) / len(results),
        "citationValidity": sum(item.get("citationValidity", 0) for item in results) / len(results),
        "groundedness": sum(item.get("groundedness", 0) for item in results) / len(results),
    }


def _deterministic_groundedness(experiment: dict[str, Any]) -> dict[str, Any]:
    generation = experiment.get("stage_results", {}).get("generation", {})
    context = experiment.get("stage_results", {}).get("context", {})
    selected = {item.get("citationId"): item.get("text", "") for item in context.get("selected", [])}
    claims = generation.get("claims", [])
    if not claims:
        return {"method": "citation_token_overlap_v1", "score": 0.0, "claimResults": []}
    claim_results: list[dict[str, Any]] = []
    for claim in claims:
        claim_text = str(claim.get("text", ""))
        tokens = {token.lower() for token in re.findall(r"[\wÀ-ÿ]+", claim_text) if len(token) > 2}
        cited_text = " ".join(selected.get(identifier, "") for identifier in claim.get("citationIds", []))
        source_tokens = {token.lower() for token in re.findall(r"[\wÀ-ÿ]+", cited_text) if len(token) > 2}
        overlap = len(tokens & source_tokens) / max(1, len(tokens))
        claim_results.append({"text": claim_text, "supported": overlap >= 0.35, "tokenOverlap": overlap})
    return {
        "method": "citation_token_overlap_v1",
        "score": sum(item["tokenOverlap"] for item in claim_results) / len(claim_results),
        "claimResults": claim_results,
    }


def create_evaluation(request: EvaluationRunRequest, *, repository: Repository | None = None) -> dict[str, Any]:
    repository = repository or get_repository()
    _require_write(repository, get_settings())
    dataset = repository.get_dataset_row(request.dataset_id)
    if dataset is None:
        raise ApiProblem(404, "dataset_not_found", "The evaluation dataset was not found.")
    document = _document_or_404(repository, dataset["document_id"])
    _require_compatible_parse(repository, dataset["document_id"], dataset["parse_run_id"])
    selected_chunk_id = request.chunk_run_id or document.get("active_chunk_run_id")
    if not selected_chunk_id:
        raise ApiProblem(409, "chunks_required", "Create chunks for the dataset parse before evaluating it.")
    selected_chunk = _require_compatible_chunk(repository, dataset["document_id"], selected_chunk_id)
    if selected_chunk["parse_run_id"] != dataset["parse_run_id"]:
        raise _lineage_problem("The evaluation dataset parse and selected chunks are incompatible.")
    selected_embedding_id = request.embedding_run_id or document.get("active_embedding_run_id")
    if request.retrieval.mode in {"dense", "hybrid"} and not selected_embedding_id:
        raise ApiProblem(409, "embedding_required", "Dense or hybrid evaluation requires embeddings for the selected chunks.")
    if selected_embedding_id:
        try:
            _require_compatible_embedding(
                repository,
                dataset["document_id"],
                selected_embedding_id,
                chunk_run_id=selected_chunk_id,
                settings=get_settings(),
                require_current_contract=request.retrieval.mode in {"dense", "hybrid"},
            )
        except ApiProblem:
            if request.embedding_run_id is not None or request.retrieval.mode in {"dense", "hybrid"}:
                raise
            selected_embedding_id = None
    judge_service = GeminiService(get_settings()) if request.judge else None
    case_results: list[dict[str, Any]] = []
    child_ids: list[str] = []
    for case in dataset["cases"][:10]:
        exp_request = ExperimentCreateRequest(
            document_id=dataset["document_id"],
            chunk_run_id=selected_chunk_id,
            embedding_run_id=selected_embedding_id,
            query=case["question"],
            target_stage="generation",
            retrieval=request.retrieval,
            reranking=request.reranking,
            context=request.context,
            generation=request.generation,
        )
        experiment = create_experiment(exp_request, repository=repository)
        child_ids.append(experiment["id"])
        retrieval_results = experiment["stage_results"].get("retrieval", {}).get("results", [])
        expected = set(case.get("relevant_element_ids", []))
        relevant_ranks = [
            index + 1
            for index, result in enumerate(retrieval_results)
            if expected.intersection(result.get("sourceElementIds", []))
        ]
        denominator = len(expected) or 1
        citation_validity = 1.0 if experiment["stage_results"].get("generation", {}).get("citationValidity", {}).get("valid") else 0.0
        groundedness = _deterministic_groundedness(experiment)
        if request.judge and judge_service is not None:
            generation = experiment["stage_results"].get("generation", {})
            judge_prompt = (
                "Evaluate whether each claim is supported by its cited context. Return JSON with "
                "groundedness (0..1) and claimResults.\n"
                f"Claims: {generation.get('claims', [])}\nContext: {experiment['stage_results'].get('context', {}).get('selected', [])}"
            )
            judge_value, judge_metadata = judge_service.judge(judge_prompt)
            score = float(judge_value.get("groundedness", judge_value.get("score", -1)))
            if score < 0 or score > 1:
                raise ApiProblem(503, "invalid_groundedness", "The groundedness judge returned an invalid score.")
            groundedness = {
                "method": "gemini_claim_support_v1",
                "score": score,
                "claimResults": judge_value.get("claimResults", []),
                "configuredModel": judge_metadata.configured_model,
                "effectiveModel": judge_metadata.effective_model,
                "promptVersion": "groundedness-judge-v1",
            }
        case_results.append({
            "question": case["question"],
            "hitAtK": 1.0 if relevant_ranks else 0.0,
            "precisionAtK": len(relevant_ranks) / max(1, len(retrieval_results)),
            "recallAtK": len({source for result in retrieval_results for source in set(result.get("sourceElementIds", [])) & expected}) / denominator,
            "mrr": 1 / relevant_ranks[0] if relevant_ranks else 0.0,
            "citationValidity": citation_validity,
            "groundedness": groundedness["score"],
            "groundednessDetail": groundedness,
            "experimentId": experiment["id"],
        })
    aggregate = _evaluation_metrics(case_results)
    aggregate["judgeModel"] = get_settings().gemini_judge_model if request.judge else None
    row = {
        "id": new_id(),
        "dataset_id": request.dataset_id,
        "config": _safe_model_dump(request),
        "child_experiment_ids": child_ids,
        "results": {"aggregate": aggregate, "caseResults": case_results},
        "status": "completed",
        "started_at": now_utc(),
        "completed_at": now_utc(),
        "duration_ms": 0,
    }
    return repository.save_evaluation(row)
