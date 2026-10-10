"""Negative JWT verification and cross-user run-id isolation (SEC-14)."""

from __future__ import annotations

import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from app import auth
from app.auth import CurrentUser, clear_auth_caches, get_current_user, verify_access_token
from app.config import Settings
from app.errors import ApiProblem
from app.main import app
from app.repository import get_repository, reset_repository
from app.storage import reset_storage
from tests.test_pipeline import _queue_and_run

ISSUER = "https://example.supabase.co/auth/v1"
SUBJECT = uuid.UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
PRIVATE_KEY = ec.generate_private_key(ec.SECP256R1())
OTHER_KEY = ec.generate_private_key(ec.SECP256R1())


class FakePyJWK:
    def __init__(self, kid, key):
        self.key_id = kid
        self.key = key


class FakeJwks:
    def __init__(self):
        self.refreshes = 0

    def get_signing_keys(self, refresh=False):
        self.refreshes += int(refresh)
        return [FakePyJWK("good", PRIVATE_KEY.public_key())]


@pytest.fixture
def jwks(monkeypatch):
    clear_auth_caches()
    fake = FakeJwks()
    monkeypatch.setattr(auth, "_jwks_client", lambda _url: fake)
    monkeypatch.setattr(auth, "get_settings", lambda: Settings(supabase_url="https://example.supabase.co", supabase_jwt_issuer=ISSUER))
    yield fake
    clear_auth_caches()


def _token(*, key=PRIVATE_KEY, algorithm="ES256", kid="good", **overrides):
    now = int(time.time())
    claims = {"iss": ISSUER, "aud": "authenticated", "sub": str(SUBJECT), "role": "authenticated", "iat": now, "exp": now + 600}
    claims.update(overrides)
    claims = {name: value for name, value in claims.items() if value is not None}
    headers = {"kid": kid} if kid is not None else {}
    return jwt.encode(claims, key, algorithm=algorithm, headers=headers)


def test_valid_token_is_accepted(jwks):
    assert verify_access_token(_token()).id == SUBJECT


@pytest.mark.parametrize(
    "token_factory",
    [
        pytest.param(lambda: _token(exp=int(time.time()) - 10), id="expired"),
        pytest.param(lambda: _token(aud="anon"), id="audience"),
        pytest.param(lambda: _token(iss="https://evil.example/auth/v1"), id="issuer"),
        pytest.param(lambda: _token(role="anon"), id="role"),
        pytest.param(lambda: _token(role="service_role"), id="service-role"),
        pytest.param(lambda: _token(sub="not-a-uuid"), id="subject"),
        pytest.param(lambda: _token(sub=None), id="missing-subject"),
        pytest.param(lambda: _token(key=OTHER_KEY), id="wrong-signature"),
        pytest.param(lambda: _token(key="shared-secret-value-long-enough-32b", algorithm="HS256"), id="hs256"),
        pytest.param(lambda: jwt.encode({"sub": str(SUBJECT)}, None, algorithm="none", headers={"kid": "good"}), id="alg-none"),
        pytest.param(lambda: _token(kid=None), id="missing-kid"),
        pytest.param(lambda: _token(kid="../../etc"), id="malformed-kid"),
    ],
)
def test_invalid_tokens_are_rejected(jwks, token_factory):
    with pytest.raises(ApiProblem) as rejected:
        verify_access_token(token_factory())
    assert rejected.value.status_code == 401
    assert rejected.value.code == "authentication_required"


def test_unknown_kid_is_negatively_cached_and_refresh_is_rate_limited(jwks):
    for _ in range(5):
        with pytest.raises(ApiProblem):
            verify_access_token(_token(kid="unknown-1"))
    assert jwks.refreshes == 1
    # A different unknown kid inside the refresh interval does not refetch either.
    with pytest.raises(ApiProblem):
        verify_access_token(_token(kid="unknown-2"))
    assert jwks.refreshes == 1
    assert verify_access_token(_token()).id == SUBJECT


def test_negatively_cached_kid_is_accepted_once_the_cached_jwks_contains_it(jwks, monkeypatch):
    rotated = FakePyJWK("rotated", PRIVATE_KEY.public_key())
    # The rotated kid is not published yet: it is negatively cached.
    with pytest.raises(ApiProblem):
        verify_access_token(_token(kid="rotated"))
    # A later refresh (triggered by any request) loads the rotated key into the
    # JWKS cache; tokens with that kid must not stay rejected for the TTL.
    original = jwks.get_signing_keys
    monkeypatch.setattr(jwks, "get_signing_keys", lambda refresh=False: [*original(refresh), rotated])
    monkeypatch.setattr(auth, "_JWKS_REFRESH_INTERVAL_SECONDS", 0.0)
    with pytest.raises(ApiProblem):
        verify_access_token(_token(kid="some-other-unknown"))  # triggers the refresh
    assert verify_access_token(_token(kid="rotated")).id == SUBJECT


class SlowJwks(FakeJwks):
    def __init__(self, *, fail=False):
        super().__init__()
        self.fail = fail
        self.calls = 0

    def get_signing_keys(self, refresh=False):
        self.calls += 1
        time.sleep(0.05)
        if self.fail:
            raise RuntimeError("JWKS endpoint unavailable")
        return super().get_signing_keys(refresh)


def _burst(count, token):
    from concurrent.futures import ThreadPoolExecutor

    def verify(_):
        try:
            return verify_access_token(token).id
        except ApiProblem as exc:
            return exc.code

    with ThreadPoolExecutor(max_workers=count) as pool:
        return list(pool.map(verify, range(count)))


@pytest.mark.parametrize("phase", ["cold", "expired"])
def test_jwks_fetch_is_single_flight_on_cold_start_and_cache_expiry(jwks, monkeypatch, phase):
    slow = SlowJwks()
    monkeypatch.setattr(auth, "_jwks_client", lambda _url: slow)
    token = _token()
    if phase == "expired":
        assert verify_access_token(token).id == SUBJECT
        monkeypatch.setattr(auth, "_JWKS_CACHE_SECONDS", 0.0)
        monkeypatch.setattr(auth, "_last_jwks_refresh", None)
        slow.calls = 0
    assert _burst(16, token) == [SUBJECT] * 16
    assert slow.calls == 1


def test_failing_jwks_endpoint_is_not_refetched_by_every_request(jwks, monkeypatch):
    failing = SlowJwks(fail=True)
    monkeypatch.setattr(auth, "_jwks_client", lambda _url: failing)
    results = _burst(16, _token())
    assert set(results) == {"authentication_required"}
    assert failing.calls == 1


def test_disallowed_algorithm_never_reaches_the_jwks_endpoint(jwks, monkeypatch):
    def fail(_url):
        raise AssertionError("JWKS must not be fetched")

    monkeypatch.setattr(auth, "_jwks_client", fail)
    with pytest.raises(ApiProblem):
        verify_access_token(_token(key="shared-secret-value-long-enough-32b", algorithm="HS256"))


# --- cross-user run-id isolation ---------------------------------------------------------

client = TestClient(app)


def test_every_run_id_endpoint_hides_other_users_artifacts(monkeypatch):
    reset_repository()
    reset_storage()
    parsed = _queue_and_run(monkeypatch)
    document_id, parse_id = parsed["documentId"], parsed["parseRunId"]
    chunk = client.post(f"/documents/{document_id}/chunks", json={"parseRunId": parse_id, "strategy": "fixed_token"}).json()
    experiment = client.post(
        "/experiments",
        json={"documentId": document_id, "chunkRunId": chunk["id"], "query": "retrieval", "targetStage": "retrieval", "retrieval": {"mode": "keyword", "topK": 1}},
    ).json()
    dataset = client.post(
        "/evaluation/datasets", json={"documentId": document_id, "parseRunId": parse_id, "name": "d", "cases": [{"question": "retrieval"}]}
    ).json()
    repository = get_repository()
    evaluation = repository.save_evaluation({"dataset_id": dataset["id"], "status": "completed", "config": {}})
    pipeline = client.get(f"/documents/{document_id}/pipelines").json()[0]
    embedding_id = "embedding-of-a"
    repository.embedding_runs[embedding_id] = {"id": embedding_id, "document_id": document_id, "chunk_run_id": chunk["id"], "status": "completed"}

    other = CurrentUser(id=uuid.UUID("22222222-2222-4222-8222-222222222222"), role="authenticated")
    app.dependency_overrides[get_current_user] = lambda: other
    reads = [
        f"/documents/{document_id}",
        f"/documents/{document_id}/summary",
        f"/documents/{document_id}/workspace",
        f"/documents/{document_id}/pipelines",
        f"/documents/{document_id}/source-url",
        f"/documents/{document_id}/source",
        f"/parse-runs/{parse_id}",
        f"/documents/{document_id}/parse-runs/{parse_id}",
        f"/chunk-runs/{chunk['id']}",
        f"/embedding-runs/{embedding_id}",
        f"/experiments/{experiment['id']}",
        f"/experiments/{experiment['id']}/status",
        f"/experiments?documentId={document_id}",
        f"/evaluation/datasets/{dataset['id']}",
        f"/evaluation/runs/{evaluation['id']}",
        f"/evaluation/runs/{evaluation['id']}/status",
    ]
    for path in reads:
        assert client.get(path).status_code == 404, path
    assert client.get("/experiments").json()["items"] == []
    assert client.get(f"/evaluation/runs?datasetId={dataset['id']}").json()["items"] == []
    writes = [
        ("post", f"/documents/{document_id}/chunks", {"parseRunId": parse_id}),
        ("post", f"/documents/{document_id}/embeddings", {"chunkRunId": chunk["id"]}),
        ("post", f"/documents/{document_id}/parse", None),
        ("post", f"/experiments/{experiment['id']}/continue", None),
        ("post", f"/experiments/{experiment['id']}/rerun-generation", None),
        ("post", "/evaluation/runs", {"datasetId": dataset["id"]}),
        ("patch", f"/document-pipelines/{pipeline['id']}", {"expectedRevision": 1, "name": "x"}),
        ("delete", f"/document-pipelines/{pipeline['id']}", None),
        ("delete", f"/documents/{document_id}", None),
    ]
    for method, path, body in writes:
        response = getattr(client, method)(path, json=body) if body is not None else getattr(client, method)(path)
        assert response.status_code == 404, (method, path, response.status_code, response.text)
    assert repository.get_document_row(document_id) is not None
