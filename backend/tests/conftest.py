import uuid

import pytest

from app.auth import CurrentUser, get_current_user
from app.main import app


TEST_USER_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")
TEST_USER = CurrentUser(id=TEST_USER_ID, role="authenticated")


@pytest.fixture(autouse=True)
def authenticated_test_user():
    app.dependency_overrides[get_current_user] = lambda: TEST_USER
    yield
    app.dependency_overrides.pop(get_current_user, None)
