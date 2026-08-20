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


@dataclass(frozen=True)
class Settings:
    app_env: str = "development"
    log_level: str = "INFO"
    database_url: str | None = None
    database_schema: str = "rag_lab"
    supabase_url: str | None = None
    supabase_secret_key: str | None = None
    supabase_storage_bucket: str = "rag-documents"
    gemini_api_key: str | None = None
    gemini_embedding_model: str = "gemini-embedding-2"
    gemini_embedding_dimensions: int = 768
    gemini_generation_model: str = "gemini-flash-lite-latest"
    gemini_rerank_model: str = "gemini-flash-lite-latest"
    gemini_judge_model: str = "gemini-flash-lite-latest"
    gemini_timeout_seconds: int = 60
    gemini_max_retries: int = 2
    cors_origins: tuple[str, ...] = ("http://localhost:3000", "http://127.0.0.1:3000")
    cors_origin_regex: str | None = None
    write_enabled: bool = True
    max_concurrent_pipeline_runs: int = 1
    max_file_size_bytes: int = 50 * 1024 * 1024


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    _load_local_dotenv()
    origins = tuple(
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
        ).split(",")
        if origin.strip()
    )
    return Settings(
        app_env=os.getenv("APP_ENV", "development"),
        log_level=os.getenv("LOG_LEVEL", "INFO"),
        database_url=os.getenv("DATABASE_URL") or None,
        database_schema=os.getenv("DATABASE_SCHEMA", "rag_lab"),
        supabase_url=os.getenv("SUPABASE_URL") or None,
        supabase_secret_key=os.getenv("SUPABASE_SECRET_KEY") or None,
        supabase_storage_bucket=os.getenv("SUPABASE_STORAGE_BUCKET", "rag-documents"),
        gemini_api_key=os.getenv("GEMINI_API_KEY") or None,
        gemini_embedding_model=os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-2"),
        gemini_embedding_dimensions=_int("GEMINI_EMBEDDING_DIMENSIONS", 768),
        gemini_generation_model=os.getenv(
            "GEMINI_GENERATION_MODEL", "gemini-flash-lite-latest"
        ),
        gemini_rerank_model=os.getenv("GEMINI_RERANK_MODEL", "gemini-flash-lite-latest"),
        gemini_judge_model=os.getenv("GEMINI_JUDGE_MODEL", "gemini-flash-lite-latest"),
        gemini_timeout_seconds=_int("GEMINI_TIMEOUT_SECONDS", 60),
        gemini_max_retries=_int("GEMINI_MAX_RETRIES", 2),
        cors_origins=origins,
        cors_origin_regex=os.getenv("CORS_ORIGIN_REGEX") or None,
        write_enabled=_bool("WRITE_ENABLED", True),
        max_concurrent_pipeline_runs=max(1, _int("MAX_CONCURRENT_PIPELINE_RUNS", 1)),
        max_file_size_bytes=max(1, _int("MAX_FILE_SIZE_BYTES", 50 * 1024 * 1024)),
    )


def clear_settings_cache() -> None:
    get_settings.cache_clear()
