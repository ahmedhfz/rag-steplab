"""SQLAlchemy engine/session utilities.

The hosted path uses Supavisor session pooling.  Unit tests and local parser
development intentionally work without PostgreSQL by using the in-memory
repository in ``repository.py``.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from .config import get_settings


def _normalise_database_url(url: str) -> str:
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url.removeprefix("postgres://")
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url.removeprefix("postgresql://")
    return url


def build_engine(database_url: str | None = None):
    settings = get_settings()
    url = _normalise_database_url(database_url or settings.database_url or "")
    if not url:
        return None
    connect_args: dict[str, object] = {}
    if url.startswith("postgresql+"):
        connect_args["sslmode"] = "require"
    return create_engine(
        url,
        connect_args=connect_args,
        pool_pre_ping=True,
        pool_size=2,
        max_overflow=0,
        future=True,
    )


_engine = None
_session_factory: sessionmaker[Session] | None = None


def get_engine():
    global _engine, _session_factory
    if _engine is None:
        _engine = build_engine()
        if _engine is not None:
            _session_factory = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


@contextmanager
def session_scope() -> Iterator[Session]:
    engine = get_engine()
    if engine is None or _session_factory is None:
        raise RuntimeError("DATABASE_URL is not configured")
    session = _session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def check_database() -> bool:
    engine = get_engine()
    if engine is None:
        return False
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    return True


def dispose_engine() -> None:
    global _engine, _session_factory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _session_factory = None
