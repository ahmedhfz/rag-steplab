from __future__ import annotations

import threading
import time
from typing import Any

from fastapi import Depends, FastAPI, File, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .auth import CurrentUser, get_current_user
from .db import check_database
from .errors import ApiProblem
from .modal_dispatch import (
    ModalDispatchError,
    dispatch_local_parse_run,
    dispatch_parse_run,
    parse_call_terminal_failure,
)
from .pipeline import (
    create_chunk_run,
    create_dataset,
    create_embedding_run,
    create_evaluation,
    create_experiment,
    continue_experiment,
    rerun_generation,
    queue_parse_upload,
    queue_reparse_document,
    persist_document_upload,
    run_lineage_compatibility,
    SUPPORTED_NORMALIZED_SCHEMA_VERSION,
)
from .gemini import EMBEDDING_FORMAT_VERSION
from .repository import get_repository
from .schemas import (
    ApiError,
    CapabilitiesResponse,
    ChunkRunRequest,
    ChunkRunResponse,
    EmbeddingRunResponse,
    ErrorResponse,
    EvaluationDatasetRequest,
    EvaluationRunRequest,
    ExperimentCreateRequest,
    DocumentMetadata,
    DocumentUploadResponse,
    ParseSummary,
    ParseResponse,
    StructuredContent,
)


settings = get_settings()
MAX_FILE_SIZE_BYTES = settings.max_file_size_bytes
ALLOWED_CONTENT_TYPES = {"", "application/pdf", "application/octet-stream"}

_hide_api_docs = settings.app_env in {"production", "staging"}
app = FastAPI(
    title="RAG StepLab API",
    version="1.0.0",
    docs_url=None if _hide_api_docs else "/docs",
    redoc_url=None if _hide_api_docs else "/redoc",
    openapi_url=None if _hide_api_docs else "/openapi.json",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Server-Timing"],
)
_pipeline_semaphore = threading.BoundedSemaphore(max(1, settings.max_concurrent_pipeline_runs))


@app.middleware("http")
async def add_server_timing(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - started) * 1000
    response.headers["Server-Timing"] = f"app;dur={duration_ms:.1f}"
    return response


@app.exception_handler(ApiProblem)
async def api_problem_handler(_: Request, problem: ApiProblem) -> JSONResponse:
    payload = ErrorResponse(error=ApiError(code=problem.code, message=problem.message))
    return JSONResponse(status_code=problem.status_code, content=payload.model_dump(by_alias=True), headers=problem.headers)


@app.exception_handler(Exception)
async def unexpected_error_handler(_: Request, __: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "internal_error", "message": "The request could not be completed."}},
    )


def _ensure_file(content: bytes, file_name: str, content_type: str) -> None:
    max_file_size_bytes = get_settings().max_file_size_bytes
    if not file_name.lower().endswith(".pdf") or content_type not in ALLOWED_CONTENT_TYPES:
        raise ApiProblem(400, "invalid_file_type", "Only PDF files are supported.")
    if not content:
        raise ApiProblem(400, "empty_file", "The uploaded PDF is empty.")
    if len(content) > max_file_size_bytes:
        raise ApiProblem(413, "file_too_large", "The PDF must be 50 MB or smaller.")
    if b"%PDF-" not in content[:1024]:
        raise ApiProblem(400, "invalid_file_type", "The uploaded file is not a valid PDF.")


def _camel_key(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


def _camelize(value: Any) -> Any:
    if isinstance(value, dict):
        return {_camel_key(str(key)): _camelize(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_camelize(item) for item in value]
    return value


def _guarded(function, *args, **kwargs):
    if not _pipeline_semaphore.acquire(blocking=False):
        raise ApiProblem(429, "pipeline_busy", "Another pipeline run is currently in progress.")
    try:
        return function(*args, **kwargs)
    finally:
        _pipeline_semaphore.release()


def _document_metadata(row: dict[str, Any]) -> DocumentMetadata:
    return DocumentMetadata(
        file_name=row["file_name"],
        media_type=row["media_type"],
        size_bytes=row["size_bytes"],
        page_count=row.get("page_count", 0),
        id=row.get("id"),
        sha256=row.get("sha256"),
        created_at=row.get("created_at"),
    )


def _public_parse_status(status: str | None) -> str:
    # interrupted is intentionally an internal DB state only.
    return "failed" if status == "interrupted" else (status or "failed")


def _parse_progress(parse: dict[str, Any]) -> int:
    status = _public_parse_status(parse.get("status"))
    if status == "completed":
        return 100
    value = (parse.get("execution_metadata") or {}).get("progress")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return max(0, min(100, round(value)))
    return 8 if status == "running" else 0


def _parse_response(document: dict[str, Any], parse: dict[str, Any], *, reused_document: bool = False) -> ParseResponse:
    status = _public_parse_status(parse.get("status"))
    error: ApiError | None = None
    if status == "failed":
        code = parse.get("error_code")
        message = parse.get("error_message")
        if parse.get("status") == "interrupted":
            code = "parse_interrupted"
            message = message or "The parse run was interrupted before completion."
        error = ApiError(
            code=code or "parse_failed",
            message=message or "The parse run failed before producing normalized content.",
        )
    structured = parse.get("structured")
    summary = parse.get("summary")
    if status == "completed" and structured is not None and summary is not None:
        structured_value = StructuredContent.model_validate(structured)
        summary_value = ParseSummary.model_validate(summary)
        markdown_value = parse.get("markdown") or ""
    else:
        structured_value = None
        summary_value = None
        markdown_value = None
    metadata = dict(parse.get("execution_metadata") or {})
    metadata.setdefault("parser", parse.get("parser_name", "docling"))
    metadata.setdefault("parserVersion", parse.get("parser_version", "unknown"))
    metadata.setdefault("normalizedSchemaVersion", parse.get("normalized_schema_version", "normalized-v1"))
    metadata["status"] = status
    return ParseResponse(
        document=_document_metadata(document),
        structured=structured_value,
        markdown=markdown_value,
        summary=summary_value,
        document_id=document.get("id"),
        parse_run_id=parse.get("id"),
        status=status,  # type: ignore[arg-type]
        progress=_parse_progress(parse),
        run_metadata=metadata,
        error=error,
        reused_document=reused_document,
    )


def _dispatch_queued_parse(parse: dict[str, Any]) -> dict[str, Any]:
    repository = get_repository()
    settings = get_settings()
    if settings.app_env == "development" and settings.local_parse_worker_enabled and not repository.persistent:
        dispatch_id = dispatch_local_parse_run(parse["id"])
        return repository.set_parse_dispatch(parse["id"], dispatch_id) or parse
    try:
        dispatch_id = dispatch_parse_run(parse["id"])
    except ModalDispatchError:
        # The accepted run remains durable and visibly failed; no local parser
        # fallback is attempted when Modal is unavailable.
        return repository.fail_parse(
            parse["id"],
            "modal_dispatch_failed",
            "The parse worker could not be started on Modal.",
        ) or parse
    return repository.set_parse_dispatch(parse["id"], dispatch_id) or parse


def _reconcile_terminal_worker_failure(parse: dict[str, Any]) -> dict[str, Any]:
    """Collapse a hard Modal termination into the public failed contract."""

    settings = get_settings()
    if (
        settings.app_env not in {"production", "staging"}
        or parse.get("status") not in {"queued", "running"}
        or not parse.get("dispatch_id")
        or not parse_call_terminal_failure(str(parse["dispatch_id"]))
    ):
        return parse
    return get_repository().fail_parse(
        parse["id"],
        "parse_interrupted",
        "The parse worker was interrupted before completion.",
        status="interrupted",
    ) or parse


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
def ready() -> dict[str, str]:
    current_settings = get_settings()
    if current_settings.database_url:
        try:
            check_database()
        except Exception as exc:
            raise ApiProblem(503, "database_unavailable", "Persistent database is not ready.") from exc
        if current_settings.app_env in {"production", "staging"} and (
            not current_settings.supabase_url
            or not current_settings.supabase_secret_key
            or not current_settings.gemini_api_key
            or not (current_settings.supabase_jwt_issuer or current_settings.supabase_url)
        ):
            raise ApiProblem(503, "runtime_config_incomplete", "Required runtime integrations are not configured.")
        return {"status": "ready", "persistence": "postgres"}
    if current_settings.app_env in {"production", "staging"}:
        raise ApiProblem(503, "database_not_configured", "Persistent database storage is not configured.")
    return {"status": "ready", "persistence": "memory", "environment": "development"}


def _user_repository(user: CurrentUser):
    return get_repository().scoped(user.id)


@app.get("/capabilities", response_model=CapabilitiesResponse)
def capabilities(_: CurrentUser = Depends(get_current_user)) -> CapabilitiesResponse:
    current_settings = get_settings()
    return CapabilitiesResponse(
        embedding_model=current_settings.gemini_embedding_model,
        embedding_dimensions=current_settings.gemini_embedding_dimensions,
        generation_model=current_settings.gemini_generation_model,
        rerank_model=current_settings.gemini_rerank_model,
        judge_model=current_settings.gemini_judge_model,
        embedding_format_version="gemini-embedding-2-qa-prefix-v1",
        limits={
            "maxFileSizeBytes": current_settings.max_file_size_bytes,
            "maxTopK": 50,
            "maxEvaluationCases": 10,
            "maxRerankCandidates": 20,
        },
    )


@app.post("/documents/parse", response_model=ParseResponse, status_code=202)
async def parse_document(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
) -> JSONResponse:
    file_name = file.filename or ""
    content_type = file.content_type or ""
    try:
        content = await file.read(get_settings().max_file_size_bytes + 1)
    finally:
        await file.close()
    _ensure_file(content, file_name, content_type)
    document, queued, reused_document, dispatch_required = await run_in_threadpool(
        queue_parse_upload,
        content,
        file_name,
        repository=_user_repository(user),
    )
    parse = queued if not dispatch_required else await run_in_threadpool(_dispatch_queued_parse, queued)
    payload = _parse_response(document, parse, reused_document=reused_document)
    return JSONResponse(
        status_code=202,
        content=payload.model_dump(by_alias=True, exclude_none=True, mode="json"),
    )


@app.post(
    "/documents",
    response_model=DocumentUploadResponse,
    status_code=201,
    responses={200: {"model": DocumentUploadResponse}},
)
async def upload_document(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
) -> JSONResponse:
    """Store a private source PDF; parsing is an explicit Parse-page action."""

    file_name = file.filename or ""
    content_type = file.content_type or ""
    try:
        content = await file.read(get_settings().max_file_size_bytes + 1)
    finally:
        await file.close()
    _ensure_file(content, file_name, content_type)
    document, reused_document = await run_in_threadpool(
        persist_document_upload,
        content,
        file_name,
        repository=_user_repository(user),
    )
    payload = DocumentUploadResponse(
        document=_document_list_item(document),
        reused_document=reused_document,
    )
    return JSONResponse(
        status_code=200 if reused_document else 201,
        content=payload.model_dump(by_alias=True, mode="json"),
    )


@app.post("/documents/{document_id}/parse", response_model=ParseResponse, status_code=202)
@app.post("/documents/{document_id}/reparse", response_model=ParseResponse, status_code=202, include_in_schema=False)
async def reparse(document_id: str, user: CurrentUser = Depends(get_current_user)) -> JSONResponse:
    document, queued = await run_in_threadpool(
        queue_reparse_document,
        document_id,
        repository=_user_repository(user),
    )
    parse = await run_in_threadpool(_dispatch_queued_parse, queued)
    payload = _parse_response(document, parse)
    return JSONResponse(
        status_code=202,
        content=payload.model_dump(by_alias=True, exclude_none=True, mode="json"),
    )


@app.get("/parse-runs/{run_id}", response_model=ParseResponse, response_model_exclude_none=True)
def parse_run(run_id: str, user: CurrentUser = Depends(get_current_user)) -> ParseResponse:
    repository = _user_repository(user)
    parse = repository.get_parse_row(run_id)
    if parse is None:
        raise ApiProblem(404, "parse_run_not_found", "The parse run was not found.")
    parse = _reconcile_terminal_worker_failure(parse)
    document = repository.get_document_row(parse["document_id"])
    if document is None:
        raise ApiProblem(404, "document_not_found", "The document was not found.")
    return _parse_response(document, parse)


@app.get(
    "/documents/{document_id}/parse-runs/{run_id}",
    response_model=ParseResponse,
    response_model_exclude_none=True,
    include_in_schema=False,
)
def document_parse_run(document_id: str, run_id: str, user: CurrentUser = Depends(get_current_user)) -> ParseResponse:
    repository = _user_repository(user)
    parse = repository.get_parse_row(run_id)
    if parse is None or parse.get("document_id") != document_id:
        raise ApiProblem(404, "parse_run_not_found", "The parse run was not found.")
    parse = _reconcile_terminal_worker_failure(parse)
    document = repository.get_document_row(document_id)
    if document is None:
        raise ApiProblem(404, "document_not_found", "The document was not found.")
    return _parse_response(document, parse)


def _run_summary_dict(row: dict[str, Any], document: dict[str, Any], repository) -> dict[str, Any]:
    compatible, compatibility_reason = run_lineage_compatibility(
        repository,
        document,
        row,
        settings=get_settings(),
    )
    if "structured" in row:
        historical = row["id"] != document.get("active_parse_run_id")
    elif "strategy" in row:
        historical = row["id"] != document.get("active_chunk_run_id") or row.get("parse_run_id") != document.get("active_parse_run_id")
    elif "dimensions" in row:
        historical = row["id"] != document.get("active_embedding_run_id") or row.get("chunk_run_id") != document.get("active_chunk_run_id")
    else:
        historical = row.get("chunk_run_id") != document.get("active_chunk_run_id")
        if row.get("embedding_run_id") is not None:
            historical = historical or row.get("embedding_run_id") != document.get("active_embedding_run_id")
    raw_status = row.get("status", "completed")
    status = _public_parse_status(raw_status)
    error_code = row.get("error_code")
    error_message = row.get("error_message")
    if raw_status == "interrupted":
        error_code = "parse_interrupted"
        error_message = error_message or "The parse run was interrupted before completion."
    return _camelize({
        "id": row["id"],
        "status": status,
        "progress": _parse_progress(row) if "structured" in row else None,
        # Kept as a wire-compatible alias for older clients. It no longer
        # means "not active"; only a broken/incomplete lineage is stale.
        "isStale": not compatible,
        "isCompatible": compatible,
        "compatibilityReason": compatibility_reason,
        "historicalLineage": bool(historical and row.get("status") == "completed"),
        "upstream": {
            "documentId": row.get("document_id"),
            "parseRunId": row.get("parse_run_id"),
            "chunkRunId": row.get("chunk_run_id"),
            "embeddingRunId": row.get("embedding_run_id"),
        },
        "config": row.get("config", {}),
        "timing": {
            "startedAt": row.get("started_at"),
            "completedAt": row.get("completed_at"),
            "durationMs": row.get("duration_ms"),
        },
        "error": {"code": error_code, "message": error_message}
        if error_code and error_message
        else None,
    })


def _summary_lineage_compatibility(
    row: dict[str, Any],
    document: dict[str, Any],
    bundle: dict[str, Any],
) -> tuple[bool, str | None]:
    """Evaluate lineage from projection rows without fetching artifact bodies."""
    if row.get("status") != "completed":
        return False, "run_not_completed"
    document_id = document.get("id")
    parses = {value["id"]: value for value in bundle.get("parses", [])}
    chunks = {value["id"]: value for value in bundle.get("chunks", [])}
    embeddings = {value["id"]: value for value in bundle.get("embeddings", [])}

    def parse_ok(parse_id: str | None) -> bool:
        parse = parses.get(parse_id or "")
        return bool(
            parse
            and parse.get("document_id") == document_id
            and parse.get("status") == "completed"
            and parse.get("normalized_schema_version") == SUPPORTED_NORMALIZED_SCHEMA_VERSION
            and parse.get("has_structured")
            and parse.get("has_summary")
        )

    def chunk_ok(chunk_id: str | None) -> bool:
        chunk = chunks.get(chunk_id or "")
        return bool(
            chunk
            and chunk.get("document_id") == document_id
            and chunk.get("status") == "completed"
            and parse_ok(chunk.get("parse_run_id"))
        )

    kind = row.get("kind")
    if kind == "parse":
        return parse_ok(row.get("id")), None if parse_ok(row.get("id")) else "lineage_incompatible"
    if kind == "chunk":
        return chunk_ok(row.get("id")), None if chunk_ok(row.get("id")) else "lineage_incompatible"
    if kind == "embedding":
        embedding = embeddings.get(row.get("id", ""))
        compatible = bool(
            embedding
            and embedding.get("document_id") == document_id
            and embedding.get("status") == "completed"
            and chunk_ok(embedding.get("chunk_run_id"))
            and embedding.get("model") == get_settings().gemini_embedding_model
            and embedding.get("dimensions") == get_settings().gemini_embedding_dimensions
            and embedding.get("embedding_format_version") == EMBEDDING_FORMAT_VERSION
        )
        return compatible, None if compatible else "lineage_incompatible"
    chunk_id = row.get("chunk_run_id")
    if not chunk_ok(chunk_id):
        return False, "chunk_lineage_missing"
    embedding_id = row.get("embedding_run_id")
    if embedding_id:
        embedding = embeddings.get(embedding_id)
        if not embedding or not chunk_ok(embedding.get("chunk_run_id")) or embedding.get("chunk_run_id") != chunk_id:
            return False, "lineage_incompatible"
        if (
            embedding.get("model") != get_settings().gemini_embedding_model
            or embedding.get("dimensions") != get_settings().gemini_embedding_dimensions
            or embedding.get("embedding_format_version") != EMBEDDING_FORMAT_VERSION
        ):
            return False, "lineage_incompatible"
    return True, None


def _summary_run_dict(row: dict[str, Any], document: dict[str, Any], bundle: dict[str, Any]) -> dict[str, Any]:
    compatible, compatibility_reason = _summary_lineage_compatibility(row, document, bundle)
    kind = row.get("kind")
    active_key = {
        "parse": "active_parse_run_id",
        "chunk": "active_chunk_run_id",
        "embedding": "active_embedding_run_id",
    }.get(kind)
    if kind == "parse":
        historical = row.get("id") != document.get(active_key or "")
        progress = _parse_progress(row)
    elif kind == "chunk":
        historical = row.get("id") != document.get("active_chunk_run_id") or row.get("parse_run_id") != document.get("active_parse_run_id")
        progress = None
    elif kind == "embedding":
        historical = row.get("id") != document.get("active_embedding_run_id") or row.get("chunk_run_id") != document.get("active_chunk_run_id")
        progress = None
    else:
        historical = row.get("chunk_run_id") != document.get("active_chunk_run_id") or (
            row.get("embedding_run_id") is not None and row.get("embedding_run_id") != document.get("active_embedding_run_id")
        )
        progress = None
    raw_status = row.get("status", "completed")
    error_code = row.get("error_code")
    error_message = row.get("error_message")
    if raw_status == "interrupted":
        error_code = "parse_interrupted"
        error_message = error_message or "The parse run was interrupted before completion."
    payload: dict[str, Any] = {
        "id": row["id"],
        "status": _public_parse_status(raw_status),
        "progress": progress,
        "isStale": not compatible,
        "isCompatible": compatible,
        "compatibilityReason": compatibility_reason,
        "historicalLineage": bool(historical and raw_status == "completed"),
        "upstream": {
            "documentId": row.get("document_id"),
            "parseRunId": row.get("parse_run_id"),
            "chunkRunId": row.get("chunk_run_id"),
            "embeddingRunId": row.get("embedding_run_id"),
        },
        "config": row.get("config", {}),
        "timing": {
            "startedAt": row.get("started_at"),
            "completedAt": row.get("completed_at"),
            "durationMs": row.get("duration_ms"),
        },
        "error": {"code": error_code, "message": error_message} if error_code and error_message else None,
    }
    if kind == "chunk":
        payload.update({"strategy": row.get("strategy"), "chunkCount": row.get("chunk_count", 0)})
    elif kind == "embedding":
        payload.update({
            "model": row.get("model"),
            "dimensions": row.get("dimensions"),
            "embeddingFormatVersion": row.get("embedding_format_version"),
            "embeddingCount": row.get("embedding_count", 0),
            "effectiveModel": row.get("effective_model"),
        })
    elif kind == "experiment":
        payload.update({
            "query": row.get("query", ""),
            "targetStage": row.get("target_stage"),
            "candidateCount": row.get("candidate_count"),
            "experimentFingerprint": row.get("experiment_fingerprint"),
        })
    return payload


def _summary_dataset_dict(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "documentId": row.get("document_id"),
        "parseRunId": row.get("parse_run_id"),
        "name": row.get("name", ""),
        "version": row.get("version", 1),
        "caseCount": row.get("case_count", 0),
        "createdAt": row.get("created_at"),
    }


def _summary_evaluation_dict(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "datasetId": row.get("dataset_id"),
        "status": _public_parse_status(row.get("status")),
        "config": row.get("config", {}),
        "results": row.get("aggregate", {}),
        "timing": {
            "startedAt": row.get("started_at"),
            "completedAt": row.get("completed_at"),
            "durationMs": row.get("duration_ms"),
        },
        "error": {"code": row.get("error_code"), "message": row.get("error_message")}
        if row.get("error_code") and row.get("error_message") else None,
    }


def _document_list_item(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "fileName": row["file_name"],
        "mediaType": row["media_type"],
        "sizeBytes": row["size_bytes"],
        "pageCount": row.get("page_count", 0),
        "sha256": row.get("sha256"),
        "activeParseRunId": row.get("active_parse_run_id"),
        "activeChunkRunId": row.get("active_chunk_run_id"),
        "activeEmbeddingRunId": row.get("active_embedding_run_id"),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
    }


def _persisted_parse_response(document: dict[str, Any], parse: dict[str, Any]) -> dict[str, Any]:
    return _parse_response(document, parse).model_dump(
        by_alias=True,
        exclude_none=True,
        mode="json",
    )


@app.get("/documents")
def list_documents(user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    return {"items": [_document_list_item(row) for row in _user_repository(user).list_document_rows()]}


@app.get("/documents/{document_id}")
def get_document(document_id: str, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    repository = _user_repository(user)
    document = repository.get_document_row(document_id)
    if document is None:
        raise ApiProblem(404, "document_not_found", "The document was not found.")
    parses = repository.list_parse_rows(document_id)
    chunks = repository.list_chunk_rows(document_id)
    embeddings = repository.list_embedding_rows(document_id)
    experiments = repository.list_experiment_rows(document_id)
    active_parse = next((row for row in parses if row["id"] == document.get("active_parse_run_id")), None)
    active_chunk = next((row for row in chunks if row["id"] == document.get("active_chunk_run_id")), None)
    active_embedding = next((row for row in embeddings if row["id"] == document.get("active_embedding_run_id")), None)
    return _camelize({
        **_document_list_item(document),
        "parseRuns": [_run_summary_dict(row, document, repository) for row in parses],
        "chunkRuns": [{**_run_summary_dict(row, document, repository), "strategy": row.get("strategy"), "chunkCount": row.get("chunk_count", 0)} for row in chunks],
        "embeddingRuns": [{**_run_summary_dict(row, document, repository), "model": row.get("model"), "dimensions": row.get("dimensions"), "embeddingFormatVersion": row.get("embedding_format_version"), "embeddingCount": row.get("embedding_count", 0), "effectiveModel": row.get("effective_model")} for row in embeddings],
        "experiments": [_run_summary_dict(row, document, repository) for row in experiments],
        "activeParseRun": _persisted_parse_response(document, active_parse) if active_parse else None,
        "activeChunkRun": active_chunk,
        "activeEmbeddingRun": active_embedding,
    })


@app.get("/documents/{document_id}/summary")
def get_document_summary(document_id: str, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    """Return the hot-path document projection without artifact bodies."""
    repository = _user_repository(user)
    bundle = repository.get_document_summary_bundle(document_id, owner_user_id=user.id)
    if bundle is None:
        raise ApiProblem(404, "document_not_found", "The document was not found.")
    document = bundle["document"]
    return _camelize({
        **_document_list_item(document),
        "parseRuns": [_summary_run_dict(row, document, bundle) for row in bundle["parses"]],
        "chunkRuns": [_summary_run_dict(row, document, bundle) for row in bundle["chunks"]],
        "embeddingRuns": [_summary_run_dict(row, document, bundle) for row in bundle["embeddings"]],
        "experiments": [_summary_run_dict(row, document, bundle) for row in bundle["experiments"]],
        "evaluationDatasets": [_summary_dataset_dict(row) for row in bundle["datasets"]],
    })


@app.post("/documents/{document_id}/chunks", response_model=ChunkRunResponse)
def chunks(document_id: str, request: ChunkRunRequest, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    return _camelize(_guarded(create_chunk_run, document_id, request, repository=_user_repository(user)))


@app.get("/chunk-runs/{run_id}")
def chunk_run(run_id: str, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    row = _user_repository(user).get_chunk_row(run_id)
    if row is None:
        raise ApiProblem(404, "chunk_run_not_found", "The chunk run was not found.")
    return _camelize(row)


@app.post("/documents/{document_id}/embeddings", response_model=EmbeddingRunResponse)
def embeddings(document_id: str, request: dict[str, str] | None = None, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    return _camelize(_guarded(create_embedding_run, document_id, (request or {}).get("chunkRunId"), repository=_user_repository(user)))


@app.get("/embedding-runs/{run_id}")
def embedding_run(run_id: str, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    row = _user_repository(user).get_embedding_row(run_id)
    if row is None:
        raise ApiProblem(404, "embedding_run_not_found", "The embedding run was not found.")
    return _camelize(row)


@app.post("/experiments")
def experiments(request: ExperimentCreateRequest, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    return _camelize(_guarded(create_experiment, request, repository=_user_repository(user)))


@app.get("/experiments")
def list_experiments(document_id: str | None = Query(default=None, alias="documentId"), user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    repository = _user_repository(user)
    if document_id is not None:
        bundle = repository.get_document_summary_bundle(document_id, owner_user_id=user.id)
        if bundle is None:
            raise ApiProblem(404, "document_not_found", "The document was not found.")
        items = [_summary_run_dict(row, bundle["document"], bundle) for row in bundle["experiments"]]
    else:
        items = [
            _summary_run_dict(row, {"id": row.get("document_id")}, {"experiments": [], "parses": [], "chunks": [], "embeddings": []})
            for row in repository.list_experiment_summary_rows(owner_user_id=user.id)
        ]
    return {"items": _camelize(items)}


@app.get("/experiments/{experiment_id}")
def get_experiment(experiment_id: str, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    row = _user_repository(user).get_experiment_row(experiment_id)
    if row is None:
        raise ApiProblem(404, "experiment_not_found", "The experiment was not found.")
    return _camelize(row)


@app.post("/experiments/{experiment_id}/continue")
def continue_run(experiment_id: str, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    return _camelize(_guarded(continue_experiment, experiment_id, repository=_user_repository(user)))


@app.post("/experiments/{experiment_id}/rerun-generation")
def rerun_generation_run(experiment_id: str, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    return _camelize(_guarded(rerun_generation, experiment_id, repository=_user_repository(user)))


@app.post("/evaluation/datasets")
def evaluation_dataset(request: EvaluationDatasetRequest, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    return _camelize(create_dataset(request, repository=_user_repository(user)))


@app.get("/evaluation/datasets")
def list_evaluation_datasets(document_id: str | None = Query(default=None, alias="documentId"), user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    return {"items": _camelize([_summary_dataset_dict(row) for row in _user_repository(user).list_dataset_summary_rows(document_id, owner_user_id=user.id)])}


@app.get("/evaluation/datasets/{dataset_id}")
def get_evaluation_dataset(dataset_id: str, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    row = _user_repository(user).get_dataset_row(dataset_id)
    if row is None:
        raise ApiProblem(404, "dataset_not_found", "The evaluation dataset was not found.")
    return _camelize(row)


@app.post("/evaluation/runs")
def evaluation_run(request: EvaluationRunRequest, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    return _camelize(_guarded(create_evaluation, request, repository=_user_repository(user)))


@app.get("/evaluation/runs")
def list_evaluation_runs(dataset_id: str | None = Query(default=None, alias="datasetId"), user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    return {"items": _camelize([_summary_evaluation_dict(row) for row in _user_repository(user).list_evaluation_summary_rows(dataset_id, owner_user_id=user.id)])}


@app.get("/evaluation/runs/{run_id}")
def get_evaluation_run(run_id: str, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    row = _user_repository(user).get_evaluation_row(run_id)
    if row is None:
        raise ApiProblem(404, "evaluation_run_not_found", "The evaluation run was not found.")
    return _camelize(row)
