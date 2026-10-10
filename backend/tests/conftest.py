import uuid

import pytest

from app.auth import CurrentUser, get_current_user
from app.main import app
# Shared PostgreSQL fixtures (registered here so test modules only import helpers).
from tests.postgres_support import admin_engine, app_database_url, pg  # noqa: F401


TEST_USER_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")
TEST_USER = CurrentUser(id=TEST_USER_ID, role="authenticated")


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "postgres: runs against a real migrated PostgreSQL (set RAG_TEST_DATABASE_URL); skipped otherwise",
    )


@pytest.fixture(autouse=True)
def authenticated_test_user():
    app.dependency_overrides[get_current_user] = lambda: TEST_USER
    yield
    app.dependency_overrides.pop(get_current_user, None)
