"""Supabase access-token verification and FastAPI user dependency."""

from __future__ import annotations

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


def verify_access_token(token: str) -> CurrentUser:
    if not token or len(token) > 8192:
        raise _unauthorized("The access token is invalid.")
    issuer, audience, jwks_url = _settings_auth_values()
    try:
        signing_key = _jwks_client(jwks_url).get_signing_key_from_jwt(token)
        header = jwt.get_unverified_header(token)
        algorithm = header.get("alg")
        if algorithm not in {"ES256", "RS256"}:
            raise _unauthorized("The access token is invalid.")
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
    _jwks_client.cache_clear()
