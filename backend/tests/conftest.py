import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.dependencies import get_current_user, require_admin

# ---------------------------------------------------------------------------
# Fake user data
# ---------------------------------------------------------------------------

FAKE_NORMAL_USER = {
    "id": "user-uuid-1234",
    "email": "user@example.com",
    "full_name": "Test User",
    "role": "NORMAL_USER",
    "is_blocked": False,
    "created_at": "2024-01-01T00:00:00+00:00",
}

FAKE_ADMIN_USER = {
    "id": "admin-uuid-5678",
    "email": "admin@example.com",
    "full_name": "Admin User",
    "role": "ADMIN",
    "is_blocked": False,
    "created_at": "2024-01-01T00:00:00+00:00",
}

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _no_local_demo_mode():
    """Tests see the default (off) even when a developer's backend/.env turns LOCAL_DEMO_MODE on."""
    from app.core.config import settings

    with patch.object(settings, "LOCAL_DEMO_MODE", False):
        yield


@pytest_asyncio.fixture
async def client():
    """Return an AsyncClient wired to the FastAPI app via ASGI transport."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as ac:
        yield ac


@pytest.fixture
def mock_supabase():
    """Patch the Supabase client factory and return the mock instance."""
    mock = MagicMock()
    with patch("app.core.config.get_supabase", return_value=mock):
        yield mock


@pytest_asyncio.fixture
async def auth_client():
    """
    Return an AsyncClient where get_current_user is overridden to return
    a fake normal user without hitting Supabase or validating any JWT.
    """
    app.dependency_overrides[get_current_user] = lambda: FAKE_NORMAL_USER
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def admin_client():
    """
    Return an AsyncClient where both get_current_user and require_admin
    are overridden to return a fake admin user.
    """
    app.dependency_overrides[get_current_user] = lambda: FAKE_ADMIN_USER
    app.dependency_overrides[require_admin] = lambda: FAKE_ADMIN_USER
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture
def auth_headers():
    """Return a Bearer auth header dict (token is not validated in override fixtures)."""
    return {"Authorization": "Bearer fake-token"}


@pytest.fixture
def admin_headers():
    """Return a Bearer auth header dict for admin scenarios."""
    return {"Authorization": "Bearer fake-admin-token"}
