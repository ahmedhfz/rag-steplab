"""Supabase access-token verification and FastAPI user dependency."""

from __future__ import annotations

import re
import threading
import time
import uuid
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import jwt
from fastapi import Header
from jwt import PyJWKClient

from .config import get_settings
from .errors import ApiProblem


@dataclass(frozen=True)
class CurrentUser:
    id: uuid.UUID
    role: str


def _unauthorized(message: str = "Authentication is required.") -> ApiProblem:
    return ApiProblem(401, "authentication_required", message, headers={"WWW-Authenticate": "Bearer"})


@lru_cache(maxsize=4)
def _jwks_client(url: str) -> PyJWKClient:
    return PyJWKClient(url, cache_keys=True, lifespan=300)


def _settings_auth_values() -> tuple[str, str, str]:
    settings = get_settings()
    issuer = settings.supabase_jwt_issuer or (
        f"{settings.supabase_url.rstrip('/')}/auth/v1" if settings.supabase_url else ""
    )
    jwks_url = settings.supabase_jwt_jwks_url or f"{issuer}/.well-known/jwks.json"
    if not issuer or not jwks_url:
        raise _unauthorized("Authentication verification is not configured.")
    return issuer, settings.supabase_jwt_audience, jwks_url


_KID_PATTERN = re.compile(r"^[A-Za-z0-9._:\-]{1,128}$")
_UNKNOWN_KID_TTL_SECONDS = 60.0
_JWKS_REFRESH_INTERVAL_SECONDS = 5.0
# Fresh keys are served without any network call; after that a fetch is
# attempted (single-flight, rate limited). Stale keys still verify known kids
# while a fetch is rate limited or failing, but only up to this age.
_JWKS_CACHE_SECONDS = 300.0
_JWKS_MAX_STALE_SECONDS = 900.0
_kid_lock = threading.Lock()
_fetch_lock = threading.Lock()
_unknown_kids: dict[str, float] = {}
_last_jwks_refresh: float | None = None
_jwks_cache: dict[str, Any] = {"client": None, "keys": None, "fetched_at": 0.0}


def _match_key(keys, kid: str):
    return next((key for key in keys or () if getattr(key, "key_id", None) == kid), None)


def _cached_keys(client, now: float, max_age: float):
    with _kid_lock:
        if _jwks_cache["client"] is not client or _jwks_cache["keys"] is None:
            return None
        if now - _jwks_cache["fetched_at"] >= max_age:
            return None
        return _jwks_cache["keys"]


def _refresh_keys(client, requested_at: float):
    """Single-flight, rate-limited JWKS fetch shared by every request.

    Concurrent callers wait for one in-flight fetch and reuse its result; a new
    fetch starts at most once per refresh interval, also when the endpoint is
    failing, so a burst of tokens (cold start, cache expiry, unknown kids)
    costs at most one JWKS request.
    """

    global _last_jwks_refresh
    with _fetch_lock:
        with _kid_lock:
            if _jwks_cache["client"] is client and _jwks_cache["fetched_at"] >= requested_at:
                return _jwks_cache["keys"]  # another request fetched while we waited
            now = time.monotonic()
            if _last_jwks_refresh is not None and now - _last_jwks_refresh < _JWKS_REFRESH_INTERVAL_SECONDS:
                return None
            _last_jwks_refresh = now
        try:
            keys = client.get_signing_keys(refresh=True)
        except Exception:
            return None
        with _kid_lock:
            _jwks_cache.update(client=client, keys=keys, fetched_at=time.monotonic())
        return keys


def _signing_key(client, token: str, kid: str):
    """Resolve a signing key without letting tokens hammer the JWKS endpoint.

    Fresh cached keys are tried first (no network). A kid that is in the cached
    JWKS is always accepted, even if it was negatively cached before, so a
    rotated key cannot stay locked out; the negative cache only suppresses
    fetches for unknown kids.
    """

    now = time.monotonic()
    if getattr(client, "get_signing_keys", None) is None:  # pragma: no cover - non-PyJWT test doubles
        return client.get_signing_key_from_jwt(token)
    fresh = _cached_keys(client, now, _JWKS_CACHE_SECONDS)
    key = _match_key(fresh, kid)
    if key is not None:
        return key
    with _kid_lock:
        negative = _unknown_kids.get(kid, 0.0) > now
    if fresh is None or not negative:
        # Cold/expired cache, or a kid we have not ruled out yet.
        key = _match_key(_refresh_keys(client, now), kid)
        if key is None:
            # Rate limited or failing endpoint: known kids keep verifying with
            # bounded-staleness keys instead of every request refetching.
            key = _match_key(_cached_keys(client, time.monotonic(), _JWKS_MAX_STALE_SECONDS), kid)
    if key is None:
        with _kid_lock:
            if len(_unknown_kids) > 1024:
                _unknown_kids.clear()
            _unknown_kids[kid] = now + _UNKNOWN_KID_TTL_SECONDS
        raise _unauthorized("The access token is invalid or expired.")
    return key


def verify_access_token(token: str) -> CurrentUser:
    if not token or len(token) > 8192:
        raise _unauthorized("The access token is invalid.")
    issuer, audience, jwks_url = _settings_auth_values()
    try:
        header = jwt.get_unverified_header(token)
        algorithm = header.get("alg")
        kid = header.get("kid")
        # Reject before any network work: only asymmetric Supabase keys.
        if algorithm not in {"ES256", "RS256"} or not isinstance(kid, str) or not _KID_PATTERN.match(kid):
            raise _unauthorized("The access token is invalid.")
        signing_key = _signing_key(_jwks_client(jwks_url), token, kid)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=[algorithm],
            audience=audience,
            issuer=issuer,
            options={"require": ["exp", "iat", "iss", "aud", "sub", "role"]},
        )
    except ApiProblem:
        raise
    except Exception as exc:
        raise _unauthorized("The access token is invalid or expired.") from exc

    subject = claims.get("sub")
    role = claims.get("role")
    try:
        user_id = uuid.UUID(str(subject))
    except (ValueError, TypeError, AttributeError) as exc:
        raise _unauthorized("The access token subject is invalid.") from exc
    if role != "authenticated":
        raise _unauthorized("The access token role is invalid.")
    return CurrentUser(id=user_id, role=role)


def get_current_user(authorization: str | None = Header(default=None)) -> CurrentUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise _unauthorized()
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise _unauthorized()
    return verify_access_token(token)


def clear_auth_caches() -> None:
    global _last_jwks_refresh
    getattr(_jwks_client, "cache_clear", lambda: None)()
    with _kid_lock:
        _unknown_kids.clear()
        _last_jwks_refresh = None
        _jwks_cache.update(client=None, keys=None, fetched_at=0.0)
