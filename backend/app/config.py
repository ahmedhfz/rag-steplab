"""Environment-backed backend configuration.

The backend deliberately reads secrets only at runtime.  Nothing from this
module is serialised into API responses or logged.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


def _load_local_dotenv() -> None:
    """Load the repository .env without adding a runtime dependency.

    Existing process environment values always win.  This helper is only for
    local development; hosted services inject their values directly.
    """

    candidates = (Path.cwd() / ".env", Path(__file__).resolve().parents[2] / ".env")
    for path in candidates:
        if not path.is_file():
            continue
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for raw_line in lines:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if not key or key in os.environ:
                continue
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                value = value[1:-1]
            os.environ[key] = value
        break


def _bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


DEFAULT_GEMINI_TEXT_MODEL = "gemini-3.5-flash-lite"


@dataclass(frozen=True)
class Settings:
    app_env: str = "development"
    log_level: str = "INFO"
    database_url: str | None = None
    database_schema: str = "rag_lab"
    supabase_url: str | None = None
    supabase_secret_key: str | None = None
    supabase_jwt_issuer: str | None = None
    supabase_jwt_audience: str = "authenticated"
    supabase_jwt_jwks_url: str | None = None
    supabase_storage_bucket: str = "rag-documents"
    gemini_api_key: str | None = None
    gemini_embedding_model: str = "gemini-embedding-2"
    gemini_embedding_dimensions: int = 768
    # Pinned model IDs keep experiments reproducible and stage results
    # cacheable; "-latest" aliases are treated as mutable and never reused.
    gemini_generation_model: str = DEFAULT_GEMINI_TEXT_MODEL
    gemini_rerank_model: str = DEFAULT_GEMINI_TEXT_MODEL
    gemini_judge_model: str = DEFAULT_GEMINI_TEXT_MODEL
    gemini_timeout_seconds: int = 60
    gemini_max_retries: int = 2
    cors_origins: tuple[str, ...] = ("http://localhost:3000", "http://127.0.0.1:3000")
    cors_origin_regex: str | None = None
    write_enabled: bool = True
    max_concurrent_pipeline_runs: int = 1
    benchmark_evaluation_enabled: bool = False
    pipeline_worker_timeout_seconds: int = 1800
    pipeline_worker_startup_timeout_seconds: int = 300
    pipeline_lease_grace_seconds: int = 120
    # Hosted embedding runs execute on the durable pipeline worker. A request
    # without ?async=true waits at most this long for the terminal state
    # (well below the 150 s Modal web redirect and 300 s function limits).
    embedding_sync_wait_seconds: int = 100
    # Re-dispatch a queued run whose "dispatching-*" reservation was never
    # replaced by a real Modal call id (API container died in between).
    dispatch_reservation_ttl_seconds: int = 60
    # Storage cleanup outbox retry policy.
    storage_cleanup_max_attempts: int = 8
    storage_cleanup_backoff_base_seconds: int = 30
    storage_cleanup_backoff_max_seconds: int = 6 * 3600
    max_file_size_bytes: int = 50 * 1024 * 1024
    # Per-user upload quotas (0 disables). Generous defaults: a learning lab
    # user keeps far fewer PDFs; the limits stop unbounded storage growth.
    max_documents_per_user: int = 200
    max_storage_bytes_per_user: int = 2 * 1024 * 1024 * 1024
    # Modal ve Docling değerleri deploy sırasında environment'tan gelir.
    # Varsayılanlar local import/test akışını belirli bir platforma kilitlemez.
    modal_app_name: str = "rag-steplab-api"
    modal_parse_function_name: str = "parse_worker"
    modal_dispatch_enabled: bool = True
    # Development without a shared database/storage runs the same real Docling
    # worker path in-process so the async lifecycle remains usable locally.
    local_parse_worker_enabled: bool = False
    docling_artifacts_path: str | None = None
    docling_parser_version: str = "docling-2.117.0"
    # Explicit parse budgets: an over-limit PDF fails with a clear code
    # instead of an OOM or the Modal hard timeout.
    docling_max_num_pages: int = 200
    docling_document_timeout_seconds: int = 780


PARSE_WORKER_TIMEOUT_SECONDS = 900
PARSE_WORKER_STARTUP_TIMEOUT_SECONDS = 300
PARSE_RUN_TIMEOUT_SECONDS = PARSE_WORKER_TIMEOUT_SECONDS + PARSE_WORKER_STARTUP_TIMEOUT_SECONDS + 120


def pipeline_lease_duration_seconds(settings: Settings) -> int:
    """Bound the lease by the real worker/provider execution budget.

    The Modal invocation timeout is the hard upper bound for a healthy
    worker. Provider retry envelopes are included so a provider call cannot
    outlive the lease calculation if the worker timeout is reduced.
    """

    retry_attempts = max(0, settings.gemini_max_retries) + 1
    # A structured generation can retry the provider call for transport
    # errors, invalid JSON, and (for citations) invalid output. Bound the
    # nested envelope conservatively so a reduced worker timeout cannot make
    # a healthy provider operation outlive its fencing lease.
    provider_attempts = retry_attempts**3
    provider_budget = max(1, settings.gemini_timeout_seconds) * provider_attempts + provider_attempts * 2
    operation_budget = max(settings.pipeline_worker_timeout_seconds, provider_budget)
    return (
        settings.pipeline_worker_startup_timeout_seconds
        + operation_budget
        + settings.pipeline_lease_grace_seconds
    )


# The chunk run executes synchronously inside one API request; the Modal web
# function timeout is its hard execution bound.
API_REQUEST_TIMEOUT_SECONDS = 300


def chunk_lease_duration_seconds(settings: Settings) -> int:
    return API_REQUEST_TIMEOUT_SECONDS + settings.pipeline_lease_grace_seconds


def embedding_batch_lease_seconds(settings: Settings) -> int:
    """Lease renewed before every provider batch: one batch's retry envelope + grace."""

    attempts = max(0, settings.gemini_max_retries) + 1
    return max(1, settings.gemini_timeout_seconds) * attempts + attempts * 2 + settings.pipeline_lease_grace_seconds


def embedding_claim_lease_seconds(settings: Settings) -> int:
    """The first lease also covers dispatch and worker cold start."""

    return settings.pipeline_worker_startup_timeout_seconds + embedding_batch_lease_seconds(settings)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    _load_local_dotenv()
    app_env = os.getenv("APP_ENV", "development")
    database_url = os.getenv("DATABASE_URL") or None
    origins = tuple(
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
        ).split(",")
        if origin.strip()
    )
    return Settings(
        app_env=app_env,
        log_level=os.getenv("LOG_LEVEL", "INFO"),
        database_url=database_url,
        database_schema=os.getenv("DATABASE_SCHEMA", "rag_lab"),
        supabase_url=os.getenv("SUPABASE_URL") or None,
        supabase_secret_key=os.getenv("SUPABASE_SECRET_KEY") or None,
        supabase_jwt_issuer=os.getenv("SUPABASE_JWT_ISSUER") or None,
        supabase_jwt_audience=os.getenv("SUPABASE_JWT_AUDIENCE", "authenticated"),
        supabase_jwt_jwks_url=os.getenv("SUPABASE_JWT_JWKS_URL") or None,
        supabase_storage_bucket=os.getenv("SUPABASE_STORAGE_BUCKET", "rag-documents"),
        gemini_api_key=os.getenv("GEMINI_API_KEY") or None,
        gemini_embedding_model=os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-2"),
        gemini_embedding_dimensions=_int("GEMINI_EMBEDDING_DIMENSIONS", 768),
        gemini_generation_model=os.getenv("GEMINI_GENERATION_MODEL", DEFAULT_GEMINI_TEXT_MODEL),
        gemini_rerank_model=os.getenv("GEMINI_RERANK_MODEL", DEFAULT_GEMINI_TEXT_MODEL),
        gemini_judge_model=os.getenv("GEMINI_JUDGE_MODEL", DEFAULT_GEMINI_TEXT_MODEL),
        gemini_timeout_seconds=_int("GEMINI_TIMEOUT_SECONDS", 60),
        gemini_max_retries=_int("GEMINI_MAX_RETRIES", 2),
        cors_origins=origins,
        cors_origin_regex=os.getenv("CORS_ORIGIN_REGEX") or None,
        write_enabled=_bool("WRITE_ENABLED", True),
        max_concurrent_pipeline_runs=max(1, _int("MAX_CONCURRENT_PIPELINE_RUNS", 1)),
        benchmark_evaluation_enabled=_bool("BENCHMARK_EVALUATION_ENABLED", False),
        pipeline_worker_timeout_seconds=max(60, _int("PIPELINE_WORKER_TIMEOUT_SECONDS", 1800)),
        pipeline_worker_startup_timeout_seconds=max(30, _int("PIPELINE_WORKER_STARTUP_TIMEOUT_SECONDS", 300)),
        pipeline_lease_grace_seconds=max(10, _int("PIPELINE_LEASE_GRACE_SECONDS", 120)),
        embedding_sync_wait_seconds=max(0, min(140, _int("EMBEDDING_SYNC_WAIT_SECONDS", 100))),
        dispatch_reservation_ttl_seconds=max(10, _int("DISPATCH_RESERVATION_TTL_SECONDS", 60)),
        storage_cleanup_max_attempts=max(1, _int("STORAGE_CLEANUP_MAX_ATTEMPTS", 8)),
        storage_cleanup_backoff_base_seconds=max(1, _int("STORAGE_CLEANUP_BACKOFF_BASE_SECONDS", 30)),
        storage_cleanup_backoff_max_seconds=max(1, _int("STORAGE_CLEANUP_BACKOFF_MAX_SECONDS", 6 * 3600)),
        max_file_size_bytes=max(1, _int("MAX_FILE_SIZE_BYTES", 50 * 1024 * 1024)),
        max_documents_per_user=max(0, _int("MAX_DOCUMENTS_PER_USER", 200)),
        max_storage_bytes_per_user=max(0, _int("MAX_STORAGE_BYTES_PER_USER", 2 * 1024 * 1024 * 1024)),
        modal_app_name=os.getenv("MODAL_APP_NAME", "rag-steplab-api"),
        modal_parse_function_name=os.getenv("MODAL_PARSE_FUNCTION_NAME", "parse_worker"),
        modal_dispatch_enabled=_bool("MODAL_DISPATCH_ENABLED", True),
        local_parse_worker_enabled=_bool(
            "LOCAL_PARSE_WORKER_ENABLED",
            app_env == "development" and database_url is None,
        ),
        docling_artifacts_path=os.getenv("DOCLING_ARTIFACTS_PATH") or None,
        docling_parser_version=os.getenv("DOCLING_PARSER_VERSION", "docling-2.117.0"),
        docling_max_num_pages=max(1, _int("DOCLING_MAX_NUM_PAGES", 200)),
        docling_document_timeout_seconds=max(30, _int("DOCLING_DOCUMENT_TIMEOUT_SECONDS", 780)),
    )


def clear_settings_cache() -> None:
    get_settings.cache_clear()
