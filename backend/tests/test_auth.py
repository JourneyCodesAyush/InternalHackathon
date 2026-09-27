import pytest
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# POST /api/v1/auth/login — happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_login_success(client):
    """Login with valid credentials returns access token and user profile."""
    fake_user = MagicMock()
    fake_user.id = "user-uuid-1234"

    fake_session = MagicMock()
    fake_session.access_token = "fake-access-token"

    fake_auth_response = MagicMock()
    fake_auth_response.user = fake_user
    fake_auth_response.session = fake_session

    fake_profile = {"id": "user-uuid-1234", "email": "user@example.com", "role": "NORMAL_USER"}

    mock_supabase = MagicMock()
    mock_supabase.auth.sign_in_with_password.return_value = fake_auth_response
    (
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data
    ) = fake_profile

    with patch("app.services.auth_service.log_activity"):
        with patch("app.api.v1.auth.router.get_supabase", return_value=mock_supabase):
            response = await client.post(
                "/api/v1/auth/login",
                json={"email": "user@example.com", "password": "secret123"},
            )

    assert response.status_code == 200
    data = response.json()
    assert data["access_token"] == "fake-access-token"
    assert data["token_type"] == "bearer"
    assert data["user"]["email"] == "user@example.com"
    assert data["user"]["role"] == "NORMAL_USER"


# ---------------------------------------------------------------------------
# POST /api/v1/auth/login — invalid credentials
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_login_invalid_credentials(client):
    """Login with wrong password returns 401."""
    mock_supabase = MagicMock()
    mock_supabase.auth.sign_in_with_password.side_effect = Exception("Invalid login credentials")

    with patch("app.api.v1.auth.router.get_supabase", return_value=mock_supabase):
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "user@example.com", "password": "wrongpassword"},
        )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials"


# ---------------------------------------------------------------------------
# POST /api/v1/auth/login — missing fields → 422
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_login_missing_fields(client):
    """Login request with missing password field returns 422."""
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": "user@example.com"},
    )
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# POST /api/v1/auth/login — empty body → 422
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_login_empty_body(client):
    """Login request with empty body returns 422."""
    response = await client.post("/api/v1/auth/login", json={})
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# Local demo mode (LOCAL_DEMO_MODE=true): localhost requests without a token
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_local_demo_mode_allows_localhost_without_token(client):
    """With LOCAL_DEMO_MODE on, a tokenless request from localhost acts as a non-admin demo user."""
    from app.core.config import settings

    with patch.object(settings, "LOCAL_DEMO_MODE", True), patch("app.core.config.get_supabase"):
        with patch("app.services.reports_service.build_report",
                   return_value=(b"%PDF-1.4 demo", {"status": "normal", "area_mean": 30.0, "date": "2024-01-17",
                                                    "language": "en", "narrative": "template",
                                                    "narrative_model": None})):
            with patch("app.api.v1.reports.router.get_supabase"):
                response = await client.post(
                    "/api/v1/reports/generate",
                    json={"region_name": "Demo", "bbox": "72.7,18.85,73.0,19.3", "start_date": "2024-01-01",
                          "end_date": "2024-01-17"},
                )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_local_demo_mode_off_by_default(client):
    """Without the flag, a tokenless request is still rejected."""
    response = await client.get("/api/v1/trends/predict", params={"lat": 19.07, "lon": 72.87, "hours": 6})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_local_demo_mode_never_grants_admin(client):
    """Demo users are never admins."""
    from app.core.config import settings

    with patch.object(settings, "LOCAL_DEMO_MODE", True):
        response = await client.get("/api/v1/admin/users")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_local_demo_mode_rejects_other_machines():
    """Requests from another machine still need a token even with the flag on."""
    from httpx import ASGITransport, AsyncClient
    from app.core.config import settings
    from app.main import app

    transport = ASGITransport(app=app, client=("192.168.1.50", 5000))
    with patch.object(settings, "LOCAL_DEMO_MODE", True):
        async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
            response = await ac.get("/api/v1/trends/predict", params={"lat": 19.07, "lon": 72.87, "hours": 6})
    assert response.status_code == 401
