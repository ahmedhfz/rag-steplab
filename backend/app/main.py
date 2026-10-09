from __future__ import annotations

import copy
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import BackgroundTasks, Depends, FastAPI, File, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import get_settings
from .auth import CurrentUser, get_current_user
from .db import check_database
from .errors import ApiProblem
from .modal_dispatch import (
    ModalDispatchError,
    dispatch_local_parse_run,
    dispatch_parse_run,
    dispatch_pipeline_run,
    parse_call_terminal_failure,
)
from .pipeline import (
    create_chunk_run,
    create_dataset,
    create_embedding_run,
    create_evaluation,
    queue_evaluation,
    run_queued_evaluation,
    create_experiment,
    queue_experiment,
    queue_continue_experiment,
    queue_rerun_generation,
    run_queued_experiment,
    continue_experiment,
    rerun_generation,
    queue_parse_upload,
    queue_reparse_document,
    persist_document_upload,
    SUPPORTED_NORMALIZED_SCHEMA_VERSION,
)
from .document_pipelines import (
    create_document_pipeline as create_named_pipeline,
    update_document_pipeline as update_named_pipeline,
)
from .gemini import EMBEDDING_FORMAT_VERSION
from .lineage import is_historical, resolve_from_rows, select_pipeline
from .repository import _expired_run_update, get_repository
from .storage import get_storage
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
    DocumentPipelineCreateRequest,
    DocumentPipelineResponse,
    DocumentPipelineUpdateRequest,
    DocumentUploadResponse,
    ParseSummary,
    ParseResponse,
    StructuredContent,
    MAX_BENCHMARK_EVALUATION_CASES,
    MAX_INTERACTIVE_EVALUATION_CASES,
)


settings = get_settings()
MAX_FILE_SIZE_BYTES = settings.max_file_size_bytes
ALLOWED_CONTENT_TYPES = {"", "application/pdf", "application/octet-stream"}

_hide_api_docs = settings.app_env in {"production", "staging"}


def require_writes_enabled(request: Request) -> None:
    # Read-side lease reconciliation and existing workers remain operational.
    if request.method in {"POST", "PUT", "PATCH", "DELETE"} and not get_settings().write_enabled:
        raise ApiProblem(503, "writes_disabled", "Pipeline writes are temporarily disabled.")


app = FastAPI(
    title="RAG StepLab API",
    version="1.0.0",
    docs_url=None if _hide_api_docs else "/docs",
    redoc_url=None if _hide_api_docs else "/redoc",
    openapi_url=None if _hide_api_docs else "/openapi.json",
    dependencies=[Depends(require_writes_enabled)],
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
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


_HTTP_ERROR_CODES = {
    401: "authentication_required",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    413: "request_too_large",
}


def _validation_message(errors: list[dict[str, Any]]) -> str:
    """Summarise the first validation error without echoing the submitted value."""

    if not errors:
        return "The request is invalid."
    first = errors[0]
    parts = list(first.get("loc", ()))
    if parts and parts[0] in {"body", "query", "path", "header"}:
        parts = parts[1:]
    location = ".".join(str(part) for part in parts)
    message = str(first.get("msg") or "Invalid value.").removeprefix("Value error, ")
    return f"{location}: {message}" if location else message


@app.exception_handler(RequestValidationError)
async def request_validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    payload = ErrorResponse(error=ApiError(code="request_invalid", message=_validation_message(list(exc.errors()))))
    return JSONResponse(status_code=422, content=payload.model_dump(by_alias=True))


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    code = _HTTP_ERROR_CODES.get(exc.status_code, "http_error")
    message = exc.detail if isinstance(exc.detail, str) and exc.detail else "The request could not be completed."
    payload = ErrorResponse(error=ApiError(code=code, message=message))
    return JSONResponse(
        status_code=exc.status_code,
        content=payload.model_dump(by_alias=True),
        headers=getattr(exc, "headers", None),
    )


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


def _public_status(status: str | None, *, default: str = "failed") -> str:
    # interrupted is intentionally an internal DB state only.
    return "failed" if status == "interrupted" else (status or default)


def _public_error(row: dict[str, Any], kind: str) -> tuple[str | None, str | None]:
    """Keep a run's own failure code; only parse keeps the parse_interrupted code."""

    code = row.get("error_code")
    message = row.get("error_message")
    if row.get("status") == "interrupted":
        if kind == "parse":
            code = "parse_interrupted"
            message = message or "The parse run was interrupted before completion."
        else:
            code = code or "worker_interrupted"
            message = message or "The worker was interrupted before completion."
    return code, message


def _public_run_row(
    row: dict[str, Any],
    *,
    kind: str = "experiment",
) -> dict[str, Any]:
    """Remove worker-only credentials and execution bookkeeping from DTOs."""

    result = copy.deepcopy(row)
    result.pop("lease_token", None)
    if isinstance(result.get("config"), dict):
        execution = result["config"].pop("_execution", None)
        if kind == "experiment" and isinstance(execution, dict):
            # Provenance the browser needs survives the durable worker round-trip.
            if result.get("continued_from_experiment_id") is None and execution.get("continuedFromExperimentId"):
                result["continued_from_experiment_id"] = execution["continuedFromExperimentId"]
            if "generation_rerun" not in result:
                result["generation_rerun"] = bool(execution.get("forceGeneration", False))
    result["error_code"], result["error_message"] = _public_error(row, kind)
    result["status"] = _public_status(row.get("status"))
    if kind == "experiment":
        result["reused_experiment"] = bool(result.get("reused_experiment", False))
    return result


def _public_artifact_row(row: dict[str, Any]) -> dict[str, Any]:
    result = copy.deepcopy(row)
    result.pop("lease_token", None)
    return result


def _durable_pipeline_response(kind: str, row: dict[str, Any], repository) -> JSONResponse:
    """Dispatch a persisted run exactly once and return its state-machine DTO."""

    current = repository.get_experiment_row(row["id"]) if kind == "experiment" else repository.get_evaluation_row(row["id"])
    current = current or row
    # Reuse/continuation is request-level provenance, not a column of the
    # persisted row; the queue response carries it and it must survive here.
    request_flags = {
        key: row[key]
        for key in ("reused_experiment", "continued_from_experiment_id", "generation_rerun")
        if row.get(key) is not None
    }

    def respond(status_code: int, value: dict[str, Any]) -> JSONResponse:
        payload = _public_run_row({**value, **request_flags}, kind=kind)
        return JSONResponse(status_code=status_code, content=jsonable_encoder(_camelize(payload)))

    status = current.get("status")
    if status not in {"queued", "running"}:
        return respond(200, current)
    if current.get("dispatch_id"):
        return respond(202, current)
    lease_token = current.get("lease_token")
    if not lease_token:
        raise ApiProblem(409, "worker_lease_missing", "The queued pipeline run has no fencing lease.")
    reservation_id = f"dispatching-{uuid.uuid4()}"
    reserved = repository.claim_pipeline_dispatch(kind, current["id"], reservation_id, str(lease_token))
    if reserved is None:
        raise ApiProblem(409, "worker_lease_lost", "The pipeline run lease was lost before dispatch reservation.")
    if reserved.get("dispatch_id") != reservation_id:
        return respond(202, reserved)
    try:
        dispatch_id = dispatch_pipeline_run(kind, current["id"], str(lease_token), settings=get_settings())
        dispatched = repository.set_pipeline_dispatch(
            kind,
            current["id"],
            dispatch_id,
            str(lease_token),
            reservation_id,
        )
        if dispatched is None:
            latest = repository.get_experiment_row(current["id"]) if kind == "experiment" else repository.get_evaluation_row(current["id"])
            if latest is not None and latest.get("status") in {"queued", "running", "completed"}:
                return respond(200 if latest.get("status") == "completed" else 202, latest)
            raise ApiProblem(409, "worker_lease_lost", "The pipeline run lease was lost before dispatch was recorded.")
    except ApiProblem:
        raise
    except ModalDispatchError as exc:
        repository.fail_pipeline_worker(
            kind,
            current["id"],
            str(lease_token),
            "pipeline_dispatch_failed",
            "The pipeline worker could not be started.",
        )
        raise ApiProblem(503, "pipeline_dispatch_failed", "The pipeline worker could not be started.") from exc
    return respond(202, dispatched)


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
    return _public_status(status)


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
    metadata["durationMs"] = parse.get("duration_ms") if parse.get("duration_ms") != 0 else None
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

    expired = _expired_run_update(parse, parse=True)
    if expired:
        return get_repository().fail_parse(
            parse["id"], expired["error_code"], expired["error_message"], status="interrupted"
        ) or parse
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


def _retry_pending_storage_cleanups(repository, *, limit: int = 3) -> dict[str, int]:
    attempted = completed = failed = 0
    for cleanup in repository.list_pending_storage_cleanups(limit=limit):
        attempted += 1
        try:
            get_storage().remove(cleanup["storage_path"])
        except ApiProblem as exc:
            repository.fail_storage_cleanup(cleanup["id"], exc.code)
            failed += 1
        except Exception:
            repository.fail_storage_cleanup(cleanup["id"], "storage_delete_failed")
            failed += 1
        else:
            repository.complete_storage_cleanup(cleanup["id"])
            completed += 1
    return {"attempted": attempted, "completed": completed, "failed": failed}


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
            # Keep the existing UI-facing key stable while exposing the
            # bounded backend benchmark admission limit separately.
            "maxEvaluationCases": MAX_INTERACTIVE_EVALUATION_CASES,
            "maxInteractiveEvaluationCases": MAX_INTERACTIVE_EVALUATION_CASES,
            "maxBenchmarkEvaluationCases": MAX_BENCHMARK_EVALUATION_CASES,
            "maxRerankCandidates": 200,
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
    # Storage cleanup retries are mutation-scoped.  Keep document listing
    # read-only while allowing normal upload activity to drain pending
    # outbox entries for this owner.
    await run_in_threadpool(_retry_pending_storage_cleanups, _user_repository(user))
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


def _bundle_lineage(bundle: dict[str, Any], pipeline_id: str | None = None) -> dict[str, Any]:
    """Resolve the in-use lineage of one summary bundle (see ``app.lineage``)."""

    pipeline = select_pipeline(bundle.get("pipelines") or [], pipeline_id)
    if pipeline_id and pipeline is None:
        raise ApiProblem(404, "document_pipeline_not_found", "The pipeline was not found.")
    return resolve_from_rows(
        bundle["document"],
        pipeline,
        parses=bundle.get("parses", []),
        chunks=bundle.get("chunks", []),
        embeddings=bundle.get("embeddings", []),
    )


def _summary_run_dict(
    row: dict[str, Any],
    document: dict[str, Any],
    bundle: dict[str, Any],
    lineage: dict[str, Any] | None = None,
) -> dict[str, Any]:
    compatible, compatibility_reason = _summary_lineage_compatibility(row, document, bundle)
    kind = row.get("kind") or "experiment"
    lineage = lineage if lineage is not None else _bundle_lineage(bundle)
    historical = is_historical(kind, row, lineage)
    progress = _parse_progress(row) if kind == "parse" else None
    raw_status = row.get("status", "completed")
    error_code, error_message = _public_error(row, kind)
    public_duration = row.get("duration_ms")
    if public_duration == 0:
        public_duration = None
    payload: dict[str, Any] = {
        "id": row["id"],
        "runNumber": row.get("run_number"),
        "createdAt": row.get("created_at"),
        "status": _public_parse_status(raw_status),
        "progress": progress,
        "runMetadata": dict(row.get("execution_metadata") or {}) if kind == "parse" else None,
        "isStale": not compatible,
        "isCompatible": compatible,
        "compatibilityReason": compatibility_reason,
        "historicalLineage": historical,
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
            "durationMs": public_duration,
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
            # Hafif summary geçerli kalmalı; böylece istemci eski artifact
            # endpoint'ine düşmeden deney lineage'ını normalize edebilir.
            "documentId": row.get("document_id"),
            "chunkRunId": row.get("chunk_run_id"),
            "embeddingRunId": row.get("embedding_run_id"),
            "query": row.get("query", ""),
            "targetStage": row.get("target_stage"),
            "candidateCount": row.get("candidate_count"),
            "experimentFingerprint": row.get("experiment_fingerprint"),
            "stageStatuses": row.get("stage_statuses", {}),
        })
    return payload


def _summary_dataset_dict(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "documentId": row.get("document_id"),
        "parseRunId": row.get("parse_run_id"),
        "name": row.get("name", ""),
        "version": row.get("version", 1),
        "seriesId": row.get("series_id"),
        "caseCount": row.get("case_count", 0),
        "createdAt": row.get("created_at"),
    }


def _summary_evaluation_dict(row: dict[str, Any]) -> dict[str, Any]:
    public_duration = row.get("duration_ms")
    if public_duration == 0:
        public_duration = None
    return {
        "id": row["id"],
        "createdAt": row.get("created_at"),
        "datasetId": row.get("dataset_id"),
        "status": _public_parse_status(row.get("status") or "completed"),
        "config": row.get("config", {}),
        "results": row.get("aggregate", {}),
        "timing": {
            "startedAt": row.get("started_at"),
            "completedAt": row.get("completed_at"),
            "durationMs": public_duration,
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
        "latestParseStatus": row.get("latest_parse_status"),
        "latestParseError": (
            {"code": row.get("latest_parse_error_code"), "message": row.get("latest_parse_error_message")}
            if row.get("latest_parse_error_code") and row.get("latest_parse_error_message") else None
        ),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
    }


def _summary_document_evaluation_dict(row: dict[str, Any]) -> dict[str, Any]:
    public_duration = row.get("duration_ms")
    if public_duration == 0:
        public_duration = None
    return {
        "id": row["id"],
        "datasetId": row.get("dataset_id"),
        "parseRunId": row.get("parse_run_id"),
        "chunkRunId": row.get("chunk_run_id"),
        "embeddingRunId": row.get("embedding_run_id"),
        "status": _public_parse_status(row.get("status") or "completed"),
        "timing": {
            "startedAt": row.get("started_at"),
            "completedAt": row.get("completed_at"),
            "durationMs": public_duration,
        },
        "error": {"code": row.get("error_code"), "message": row.get("error_message")}
        if row.get("error_code") and row.get("error_message")
        else None,
    }


def _document_pipeline_response(row: dict[str, Any]) -> DocumentPipelineResponse:
    return DocumentPipelineResponse(
        id=row["id"],
        document_id=row["document_id"],
        name=row["name"],
        parse_run_id=row.get("parse_run_id"),
        chunk_run_id=row.get("chunk_run_id"),
        embedding_run_id=row.get("embedding_run_id"),
        revision=row["revision"],
        is_default=bool(row.get("is_default", row.get("name") == "Default Pipeline")),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


def _persisted_parse_response(document: dict[str, Any], parse: dict[str, Any]) -> dict[str, Any]:
    return _parse_response(document, parse).model_dump(
        by_alias=True,
        exclude_none=True,
        mode="json",
    )


@app.get("/documents")
def list_documents(user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    repository = _user_repository(user)
    items = []
    latest_parses = repository.latest_parse_metadata()
    for row in repository.list_document_rows():
        latest = latest_parses.get(row["id"])
        if latest is not None:
            row = {
                **row,
                "latest_parse_status": _public_parse_status(latest.get("status")),
                "latest_parse_error_code": latest.get("error_code"),
                "latest_parse_error_message": latest.get("error_message"),
            }
        items.append(_document_list_item(row))
    return {"items": items}


@app.get("/documents/{document_id}")
def get_document(
    document_id: str,
    pipeline_id: str | None = Query(default=None, alias="pipelineId"),
    user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    """Legacy detail: the summary projection plus the in-use artifact bodies."""

    repository = _user_repository(user)
    bundle = repository.get_document_summary_bundle(document_id, owner_user_id=user.id)
    if bundle is None:
        raise ApiProblem(404, "document_not_found", "The document was not found.")
    payload = _document_summary_payload(bundle, pipeline_id)
    lineage = payload["activeLineage"]
    document = bundle["document"]
    active_parse = repository.get_parse_row(lineage["parseRunId"]) if lineage["parseRunId"] else None
    active_chunk = repository.get_chunk_row(lineage["chunkRunId"]) if lineage["chunkRunId"] else None
    active_embedding = repository.get_embedding_row(lineage["embeddingRunId"]) if lineage["embeddingRunId"] else None
    payload.update({
        "activeParseRun": _persisted_parse_response(document, active_parse) if active_parse else None,
        "activeChunkRun": _public_artifact_row(active_chunk) if active_chunk else None,
        "activeEmbeddingRun": _public_artifact_row(active_embedding) if active_embedding else None,
    })
    return _camelize(payload)


@app.delete("/documents/{document_id}", status_code=204)
def delete_document(document_id: str, user: CurrentUser = Depends(get_current_user)) -> Response:
    repository = _user_repository(user)
    document = repository.get_document_row(document_id)
    if document is None:
        raise ApiProblem(404, "document_not_found", "The document was not found.")
    cleanup = repository.delete_document_with_cleanup(document_id)
    if cleanup is None:
        raise ApiProblem(404, "document_not_found", "The document was not found.")
    _retry_pending_storage_cleanups(repository)
    return Response(status_code=204)


def _active_lineage_dict(lineage: dict[str, Any]) -> dict[str, Any]:
    return {
        "pipelineId": lineage.get("pipeline_id"),
        "parseRunId": lineage.get("parse_run_id"),
        "chunkRunId": lineage.get("chunk_run_id"),
        "embeddingRunId": lineage.get("embedding_run_id"),
        "sources": dict(lineage.get("sources") or {}),
    }


def _document_summary_payload(bundle: dict[str, Any], pipeline_id: str | None) -> dict[str, Any]:
    document = bundle["document"]
    lineage = _bundle_lineage(bundle, pipeline_id)
    return {
        **_document_list_item(document),
        # Canonical in-use lineage of the requested (or default) saved
        # pipeline. ``historicalLineage`` on every run is relative to it.
        "activeLineage": _active_lineage_dict(lineage),
        "pipelines": [
            _document_pipeline_response(row).model_dump(by_alias=True, mode="json")
            for row in bundle.get("pipelines") or []
        ],
        "parseRuns": [_summary_run_dict(row, document, bundle, lineage) for row in bundle["parses"]],
        "chunkRuns": [_summary_run_dict(row, document, bundle, lineage) for row in bundle["chunks"]],
        "embeddingRuns": [_summary_run_dict(row, document, bundle, lineage) for row in bundle["embeddings"]],
        "experiments": [_summary_run_dict(row, document, bundle, lineage) for row in bundle["experiments"]],
        "evaluationDatasets": [_summary_dataset_dict(row) for row in bundle["datasets"]],
        "evaluationRuns": [_summary_document_evaluation_dict(row) for row in bundle["evaluations"]],
    }


@app.get("/documents/{document_id}/summary")
def get_document_summary(
    document_id: str,
    pipeline_id: str | None = Query(default=None, alias="pipelineId"),
    user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    """Return the hot-path document projection without artifact bodies."""
    repository = _user_repository(user)
    bundle = repository.get_document_summary_bundle(document_id, owner_user_id=user.id)
    if bundle is None:
        raise ApiProblem(404, "document_not_found", "The document was not found.")
    return _camelize(_document_summary_payload(bundle, pipeline_id))


@app.get("/documents/{document_id}/source-url")
def document_source_url(document_id: str, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    """Return a short-lived signed URL, or an authenticated proxy URL.

    Storage paths and service credentials never cross this boundary.
    """
    repository = _user_repository(user)
    document = repository.get_document_row(document_id)
    if document is None:
        raise ApiProblem(404, "document_not_found", "The document was not found.")
    storage = get_storage()
    signed_url = storage.create_signed_url(document["storage_path"], 60)
    if signed_url:
        return {"sourceUrl": signed_url, "expiresIn": 60, "mode": "signed"}
    return {
        "sourceUrl": f"/documents/{document_id}/source",
        "expiresIn": 60,
        "mode": "proxy",
    }


@app.get("/documents/{document_id}/source")
def document_source(document_id: str, user: CurrentUser = Depends(get_current_user)) -> Response:
    """Authenticated, non-cacheable PDF proxy used only when signing is unavailable."""
    document = _user_repository(user).get_document_row(document_id)
    if document is None:
        raise ApiProblem(404, "document_not_found", "The document was not found.")
    content = get_storage().download(document["storage_path"])
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Cache-Control": "private, no-store", "Content-Disposition": "inline"},
    )


@app.get("/documents/{document_id}/pipelines", response_model=list[DocumentPipelineResponse])
def list_document_pipelines(
    document_id: str, user: CurrentUser = Depends(get_current_user)
) -> list[DocumentPipelineResponse]:
    repository = _user_repository(user)
    rows = repository.list_document_pipeline_rows(document_id)
    if rows is None:
        raise ApiProblem(404, "document_not_found", "The document was not found.")
    return [_document_pipeline_response(row) for row in rows]


@app.post("/documents/{document_id}/pipelines", response_model=DocumentPipelineResponse, status_code=201)
def create_document_pipeline_route(
    document_id: str,
    request: DocumentPipelineCreateRequest,
    user: CurrentUser = Depends(get_current_user),
) -> DocumentPipelineResponse:
    row = create_named_pipeline(_user_repository(user), document_id, request)
    return _document_pipeline_response(row)


@app.patch("/document-pipelines/{pipeline_id}", response_model=DocumentPipelineResponse)
def update_document_pipeline_route(
    pipeline_id: str,
    request: DocumentPipelineUpdateRequest,
    user: CurrentUser = Depends(get_current_user),
) -> DocumentPipelineResponse:
    row = update_named_pipeline(_user_repository(user), pipeline_id, request)
    return _document_pipeline_response(row)


@app.delete("/document-pipelines/{pipeline_id}", status_code=204)
def delete_document_pipeline_route(
    pipeline_id: str, user: CurrentUser = Depends(get_current_user)
) -> Response:
    if not _user_repository(user).delete_document_pipeline(pipeline_id):
        raise ApiProblem(404, "document_pipeline_not_found", "The pipeline was not found.")
    return Response(status_code=204)


@app.post("/documents/{document_id}/chunks", response_model=ChunkRunResponse)
def chunks(document_id: str, request: ChunkRunRequest, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    return _camelize(_public_artifact_row(_guarded(create_chunk_run, document_id, request, repository=_user_repository(user))))


@app.get("/chunk-runs/{run_id}")
def chunk_run(run_id: str, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    row = _user_repository(user).get_chunk_row(run_id)
    if row is None:
        raise ApiProblem(404, "chunk_run_not_found", "The chunk run was not found.")
    return _camelize(_public_artifact_row(row))


@app.post("/documents/{document_id}/embeddings", response_model=EmbeddingRunResponse)
def embeddings(document_id: str, request: dict[str, str] | None = None, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    return _camelize(_public_artifact_row(_guarded(create_embedding_run, document_id, (request or {}).get("chunkRunId"), repository=_user_repository(user))))


@app.get("/embedding-runs/{run_id}")
def embedding_run(run_id: str, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    row = _user_repository(user).get_embedding_row(run_id)
    if row is None:
        raise ApiProblem(404, "embedding_run_not_found", "The embedding run was not found.")
    return _camelize(_public_artifact_row(row))


@app.post("/experiments", response_model=None)
def experiments(
    request: ExperimentCreateRequest,
    background_tasks: BackgroundTasks,
    async_run: bool = Query(default=False, alias="async"),
    user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any] | JSONResponse:
    repository = _user_repository(user)
    # Hosted execution is always durable async. The query flag remains a
    # development/test convenience for the existing synchronous contract.
    if get_settings().app_env in {"production", "staging"}:
        queued = queue_experiment(request, repository=repository)
        return _durable_pipeline_response("experiment", queued, repository)
    if not async_run:
        return _camelize(_guarded(create_experiment, request, repository=repository))
    if not _pipeline_semaphore.acquire(blocking=False):
        raise ApiProblem(429, "pipeline_busy", "Another pipeline run is currently in progress.")
    try:
        queued = queue_experiment(request, repository=repository)
        if queued.get("status") == "completed":
            _pipeline_semaphore.release()
            return _camelize(queued)
        background_tasks.add_task(_run_queued_experiment_and_release, request, queued["id"], repository)
        return JSONResponse(status_code=202, content=jsonable_encoder(_camelize(queued)))
    except Exception:
        _pipeline_semaphore.release()
        raise


def _run_queued_experiment_and_release(request: ExperimentCreateRequest, experiment_id: str, repository) -> None:
    try:
        run_queued_experiment(request, experiment_id, repository=repository)
    finally:
        _pipeline_semaphore.release()


@app.get("/experiments")
def list_experiments(
    document_id: str | None = Query(default=None, alias="documentId"),
    pipeline_id: str | None = Query(default=None, alias="pipelineId"),
    user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    repository = _user_repository(user)
    if document_id is not None:
        bundle = repository.get_document_summary_bundle(document_id, owner_user_id=user.id)
        if bundle is None:
            raise ApiProblem(404, "document_not_found", "The document was not found.")
        lineage = _bundle_lineage(bundle, pipeline_id)
        items = [_summary_run_dict(row, bundle["document"], bundle, lineage) for row in bundle["experiments"]]
    else:
        # Lineage compatibility needs each run's own document projection; the
        # cache keeps this to one projection query per document.
        bundles: dict[str, tuple[dict[str, Any], dict[str, Any]] | None] = {}
        items = []
        for row in repository.list_experiment_summary_rows(owner_user_id=user.id):
            row_document_id = row.get("document_id")
            if row_document_id not in bundles:
                bundle = repository.get_document_summary_bundle(row_document_id, owner_user_id=user.id)
                bundles[row_document_id] = (bundle, _bundle_lineage(bundle)) if bundle is not None else None
            entry = bundles[row_document_id]
            if entry is None:
                continue
            bundle, lineage = entry
            items.append(_summary_run_dict(row, bundle["document"], bundle, lineage))
    return {"items": _camelize(items)}


@app.get("/experiments/{experiment_id}")
def get_experiment(experiment_id: str, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    repository = _user_repository(user)
    row = repository.reconcile_pipeline_lease("experiment", experiment_id)
    if row is None:
        raise ApiProblem(404, "experiment_not_found", "The experiment was not found.")
    return _camelize(_public_run_row(row))


@app.get("/experiments/{experiment_id}/status")
def get_experiment_status(experiment_id: str, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    repository = _user_repository(user)
    row = repository.reconcile_pipeline_lease("experiment", experiment_id)
    if row is None:
        raise ApiProblem(404, "experiment_not_found", "The experiment was not found.")
    stage_results = row.get("stage_results") or {}
    return _camelize({
        "id": row["id"],
        "status": _public_parse_status(row.get("status") or "completed"),
        "stageStatuses": {
            stage: (stage_results.get(stage) or {}).get("status")
            for stage in ("retrieval", "reranking", "context", "generation")
            if isinstance(stage_results.get(stage), dict) and (stage_results.get(stage) or {}).get("status")
        },
        "timing": {
            "startedAt": row.get("started_at"),
            "completedAt": row.get("completed_at"),
            "durationMs": None if row.get("duration_ms") == 0 else row.get("duration_ms"),
        },
        "error": {"code": row.get("error_code"), "message": row.get("error_message")}
        if row.get("error_code") and row.get("error_message") else None,
    })


@app.post("/experiments/{experiment_id}/continue")
def continue_run(experiment_id: str, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    repository = _user_repository(user)
    if get_settings().app_env in {"production", "staging"}:
        queued = queue_continue_experiment(experiment_id, repository=repository)
        return _durable_pipeline_response("experiment", queued, repository)
    return _camelize(_guarded(continue_experiment, experiment_id, repository=_user_repository(user)))


@app.post("/experiments/{experiment_id}/rerun-generation")
def rerun_generation_run(experiment_id: str, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    repository = _user_repository(user)
    if get_settings().app_env in {"production", "staging"}:
        queued = queue_rerun_generation(experiment_id, repository=repository)
        return _durable_pipeline_response("experiment", queued, repository)
    return _camelize(_guarded(rerun_generation, experiment_id, repository=_user_repository(user)))


@app.post("/evaluation/datasets")
def evaluation_dataset(request: EvaluationDatasetRequest, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    if request.evaluation_mode == "benchmark" and not get_settings().benchmark_evaluation_enabled:
        raise ApiProblem(
            403,
            "benchmark_evaluation_disabled",
            "Benchmark evaluation is available only when explicitly enabled by the server.",
        )
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


@app.post("/evaluation/runs", response_model=None)
def evaluation_run(
    request: EvaluationRunRequest,
    background_tasks: BackgroundTasks,
    async_run: bool = Query(default=False, alias="async"),
    user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any] | JSONResponse:
    repository = _user_repository(user)
    if get_settings().app_env in {"production", "staging"}:
        queued = queue_evaluation(request, repository=repository)
        return _durable_pipeline_response("evaluation", queued, repository)
    if not async_run:
        return _camelize(_guarded(create_evaluation, request, repository=repository))
    if not _pipeline_semaphore.acquire(blocking=False):
        raise ApiProblem(429, "pipeline_busy", "Another pipeline run is currently in progress.")
    try:
        queued = queue_evaluation(request, repository=repository)
        if queued.get("status") == "completed":
            _pipeline_semaphore.release()
            return JSONResponse(status_code=200, content=jsonable_encoder(_camelize(queued)))
        background_tasks.add_task(_run_queued_evaluation_and_release, request, queued["id"], repository)
        return JSONResponse(status_code=202, content=jsonable_encoder(_camelize(queued)))
    except Exception:
        _pipeline_semaphore.release()
        raise


def _run_queued_evaluation_and_release(request: EvaluationRunRequest, evaluation_id: str, repository) -> None:
    try:
        run_queued_evaluation(request, evaluation_id, repository=repository)
    finally:
        _pipeline_semaphore.release()


@app.get("/evaluation/runs")
def list_evaluation_runs(dataset_id: str | None = Query(default=None, alias="datasetId"), user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    repository = _user_repository(user)
    items = []
    for row in repository.list_evaluation_summary_rows(dataset_id, owner_user_id=user.id):
        payload = _summary_evaluation_dict(row)
        dataset = repository.get_dataset_row(row.get("dataset_id", ""))
        if dataset:
            config = row.get("config") or {}
            payload.update({
                "parseRunId": dataset.get("parse_run_id"),
                "chunkRunId": config.get("chunk_run_id"),
                "embeddingRunId": config.get("embedding_run_id"),
            })
        items.append(_camelize(payload))
    return {"items": items}


@app.get("/evaluation/runs/{run_id}")
def get_evaluation_run(run_id: str, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    repository = _user_repository(user)
    row = repository.reconcile_pipeline_lease("evaluation", run_id)
    if row is None:
        raise ApiProblem(404, "evaluation_run_not_found", "The evaluation run was not found.")
    return _camelize(_public_run_row(row, kind="evaluation"))


@app.get("/evaluation/runs/{run_id}/status")
def get_evaluation_run_status(run_id: str, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    repository = _user_repository(user)
    row = repository.reconcile_pipeline_lease("evaluation", run_id)
    if row is None:
        raise ApiProblem(404, "evaluation_run_not_found", "The evaluation run was not found.")
    results = row.get("results") or {}
    aggregate = results.get("aggregate", {}) if isinstance(results, dict) else {}
    dataset = repository.get_dataset_row(row["dataset_id"])
    return _camelize({
        "id": row["id"],
        "status": _public_parse_status(row.get("status") or "completed"),
        "completedCases": len(results.get("caseResults", [])) if isinstance(results, dict) and isinstance(results.get("caseResults"), list) else 0,
        "totalCases": len(dataset.get("cases", [])) if dataset else 0,
        "results": aggregate,
        "timing": {"startedAt": row.get("started_at"), "completedAt": row.get("completed_at"), "durationMs": None if row.get("duration_ms") == 0 else row.get("duration_ms")},
        "error": {"code": row.get("error_code"), "message": row.get("error_message")}
        if row.get("error_code") and row.get("error_message") else None,
    })
