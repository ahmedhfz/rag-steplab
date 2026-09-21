from __future__ import annotations

import time
import uuid

import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.config import Settings
from app.main import app
from app.repository import get_repository, reset_repository
from app.storage import reset_storage


client = TestClient(app)
USER_A = uuid.UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
USER_B = uuid.UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")


def setup_function():
    reset_repository()
    reset_storage()


def _document(owner: uuid.UUID, name: str) -> dict:
    return get_repository().create_document(
        {
            "file_name": name,
            "media_type": "application/pdf",
            "size_bytes": 8,
            "page_count": 0,
            "owner_user_id": owner,
        },
        "rag-documents",
        f"{owner}/{name}",
        str(owner).replace("-", "")[:8],
    )


def test_missing_auth_is_401_with_bearer_challenge():
    app.dependency_overrides.pop(get_current_user, None)
    response = client.get("/documents")
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.json()["error"]["code"] == "authentication_required"


def test_invalid_auth_is_401_without_leaking_token_details(monkeypatch):
    app.dependency_overrides.pop(get_current_user, None)

    class FakeJwks:
        def get_signing_key_from_jwt(self, _token):
            raise ValueError("invalid")

    monkeypatch.setattr("app.auth._jwks_client", lambda _url: FakeJwks())
    monkeypatch.setattr("app.auth.get_settings", lambda: Settings(supabase_url="https://example.supabase.co"))
    response = client.get("/documents", headers={"Authorization": "Bearer malformed"})
    assert response.status_code == 401
    assert "malformed" not in response.text


def test_valid_supabase_claims_are_accepted(monkeypatch):
    private_key = ec.generate_private_key(ec.SECP256R1())
    now = int(time.time())
    token = jwt.encode(
        {
            "iss": "https://example.supabase.co/auth/v1",
            "aud": "authenticated",
            "sub": str(USER_A),
            "role": "authenticated",
            "iat": now,
            "exp": now + 3600,
        },
        private_key,
        algorithm="ES256",
    )

    class FakeKey:
        key = private_key.public_key()

    class FakeJwks:
        def get_signing_key_from_jwt(self, _token):
            return FakeKey()

    monkeypatch.setattr("app.auth._jwks_client", lambda _url: FakeJwks())
    monkeypatch.setattr(
        "app.auth.get_settings",
        lambda: Settings(
            supabase_url="https://example.supabase.co",
            supabase_jwt_issuer="https://example.supabase.co/auth/v1",
        ),
    )
    user = get_current_user(f"Bearer {token}")
    assert user.id == USER_A
    assert user.role == "authenticated"


def test_user_scope_hides_other_users_document_by_list_and_id():
    document_a = _document(USER_A, "a.pdf")
    document_b = _document(USER_B, "b.pdf")

    app.dependency_overrides[get_current_user] = lambda: type("User", (), {"id": USER_A})()
    listed = client.get("/documents")
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()["items"]] == [document_a["id"]]

    direct = client.get(f"/documents/{document_b['id']}")
    assert direct.status_code == 404
    assert direct.json()["error"]["code"] == "document_not_found"

    foreign_delete = client.delete(f"/documents/{document_b['id']}")
    assert foreign_delete.status_code == 404
    assert get_repository().get_document_row(document_b["id"]) is not None
    assert get_repository().list_pending_storage_cleanups(owner_user_id=USER_A) == []

    own_delete = client.delete(f"/documents/{document_a['id']}")
    assert own_delete.status_code == 204
    assert get_repository().get_document_row(document_a["id"]) is None
    cleanup_rows = list(get_repository().storage_cleanups.values())
    assert len(cleanup_rows) == 1
    assert cleanup_rows[0]["owner_user_id"] == USER_A
    assert cleanup_rows[0]["status"] == "completed"


def test_private_source_preview_respects_document_owner_scope():
    document_a = _document(USER_A, "a.pdf")
    document_b = _document(USER_B, "b.pdf")

    app.dependency_overrides[get_current_user] = lambda: type("User", (), {"id": USER_A})()
    own_descriptor = client.get(f"/documents/{document_a['id']}/source-url")
    assert own_descriptor.status_code == 200
    assert own_descriptor.json()["sourceUrl"] == f"/documents/{document_a['id']}/source"

    app.dependency_overrides[get_current_user] = lambda: type("User", (), {"id": USER_B})()
    foreign_descriptor = client.get(f"/documents/{document_a['id']}/source-url")
    foreign_source = client.get(f"/documents/{document_a['id']}/source")
    assert foreign_descriptor.status_code == 404
    assert foreign_source.status_code == 404
    assert client.get(f"/documents/{document_b['id']}/source-url").status_code == 200


def test_upload_sha_reuse_is_scoped_to_authenticated_owner():
    app.dependency_overrides[get_current_user] = lambda: type("User", (), {"id": USER_A})()
    first = client.post("/documents", files={"file": ("shared.pdf", b"%PDF-1.7", "application/pdf")})
    assert first.status_code == 201

    app.dependency_overrides[get_current_user] = lambda: type("User", (), {"id": USER_B})()
    second = client.post("/documents", files={"file": ("shared.pdf", b"%PDF-1.7", "application/pdf")})
    assert second.status_code == 201
    assert second.json()["reusedDocument"] is False
    assert second.json()["document"]["id"] != first.json()["document"]["id"]
