"""Private Supabase Storage adapter with a test-only memory fallback."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .config import Settings, get_settings
from .errors import ApiProblem


@dataclass
class MemoryStorage:
    objects: dict[str, bytes] = field(default_factory=dict)

    def upload_pdf(self, path: str, content: bytes) -> str:
        self.objects[path] = bytes(content)
        return path

    def download(self, path: str) -> bytes:
        try:
            return self.objects[path]
        except KeyError as exc:
            raise ApiProblem(404, "storage_object_not_found", "The stored PDF was not found.") from exc

    def remove(self, path: str) -> None:
        self.objects.pop(path, None)


class SupabaseStorage:
    def __init__(self, settings: Settings) -> None:
        if not settings.supabase_url or not settings.supabase_secret_key:
            raise RuntimeError("Supabase Storage is not configured")
        try:
            from supabase import create_client
        except ImportError as exc:  # pragma: no cover - dependency installation issue
            raise RuntimeError("supabase-py is not installed") from exc
        self._client = create_client(settings.supabase_url, settings.supabase_secret_key)
        self._bucket = settings.supabase_storage_bucket

    def upload_pdf(self, path: str, content: bytes) -> str:
        try:
            self._client.storage.from_(self._bucket).upload(
                path,
                content,
                {"content-type": "application/pdf", "upsert": False},
            )
        except Exception as exc:
            raise ApiProblem(503, "storage_upload_failed", "The PDF could not be stored.") from exc
        return path

    def download(self, path: str) -> bytes:
        try:
            return bytes(self._client.storage.from_(self._bucket).download(path))
        except Exception as exc:
            raise ApiProblem(404, "storage_object_not_found", "The stored PDF was not found.") from exc

    def remove(self, path: str) -> None:
        try:
            self._client.storage.from_(self._bucket).remove([path])
        except Exception:
            # Compensation is best effort; the original DB/storage error is more useful.
            return


_memory_storage = MemoryStorage()
_storage: MemoryStorage | SupabaseStorage | None = None


def get_storage() -> MemoryStorage | SupabaseStorage:
    global _storage
    if _storage is not None:
        return _storage
    settings = get_settings()
    if settings.supabase_url and settings.supabase_secret_key:
        _storage = SupabaseStorage(settings)
    else:
        _storage = _memory_storage
    return _storage


def reset_storage() -> None:
    global _storage
    _storage = None
    _memory_storage.objects.clear()
