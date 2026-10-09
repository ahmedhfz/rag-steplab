"""Supabase access-token verification and FastAPI user dependency."""

from __future__ import annotations

import re
import threading
import time
import uuid
from dataclasses import dataclass
from functools import lru_cache

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
_kid_lock = threading.Lock()
_unknown_kids: dict[str, float] = {}
_last_jwks_refresh = 0.0


def _match_key(keys, kid: str):
    return next((key for key in keys if getattr(key, "key_id", None) == kid), None)


def _signing_key(client, token: str, kid: str):
    """Resolve a signing key without letting unknown kids hammer the JWKS endpoint.

    Cached keys are tried first; a refresh for an unseen kid happens at most
    once per interval process-wide, and an unknown kid is negatively cached.
    """

    global _last_jwks_refresh
    now = time.monotonic()
    with _kid_lock:
        if _unknown_kids.get(kid, 0.0) > now:
            raise _unauthorized("The access token is invalid or expired.")
    get_keys = getattr(client, "get_signing_keys", None)
    if get_keys is None:  # pragma: no cover - non-PyJWT test doubles
        return client.get_signing_key_from_jwt(token)
    key = _match_key(get_keys(), kid)
    if key is not None:
        return key
    with _kid_lock:
        allowed = now - _last_jwks_refresh >= _JWKS_REFRESH_INTERVAL_SECONDS
        if allowed:
            _last_jwks_refresh = now
    key = _match_key(get_keys(refresh=True), kid) if allowed else None
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
        _last_jwks_refresh = 0.0
