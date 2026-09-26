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
