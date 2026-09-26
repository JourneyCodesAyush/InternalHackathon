import pytest
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# GET /api/v1/trends/predict — happy path (hours=6)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_predict_success(auth_client):
    """Authenticated request with valid hours returns correct number of predictions."""
    mock_supabase = MagicMock()

    with patch("app.services.activity_service.log_activity"):
        with patch("app.api.v1.trends.router.get_supabase", return_value=mock_supabase):
            response = await auth_client.get(
                "/api/v1/trends/predict",
                params={"lat": 19.07, "lon": 72.87, "hours": 6},
            )

    assert response.status_code == 200
    data = response.json()
    assert data["lat"] == 19.07
    assert data["lon"] == 72.87
    assert data["hours"] == 6
    # 6 hours / 3 = 2 prediction intervals
    assert len(data["predictions"]) == 2
    for pred in data["predictions"]:
        assert "hour" in pred
        assert "no2_concentration" in pred
        assert 40.0 <= pred["no2_concentration"] <= 160.0 or pred["no2_concentration"] > 0
        assert "wind_speed" in pred
        assert "wind_direction" in pred
        assert "confidence" in pred


# ---------------------------------------------------------------------------
# GET /api/v1/trends/predict — happy path (hours=24)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_predict_24_hours(auth_client):
    """24-hour forecast returns 8 prediction intervals."""
    mock_supabase = MagicMock()

    with patch("app.services.activity_service.log_activity"):
        with patch("app.api.v1.trends.router.get_supabase", return_value=mock_supabase):
            response = await auth_client.get(
                "/api/v1/trends/predict",
                params={"lat": 28.61, "lon": 77.20, "hours": 24},
            )

    assert response.status_code == 200
    assert len(response.json()["predictions"]) == 8


# ---------------------------------------------------------------------------
# GET /api/v1/trends/predict — unauthenticated → 401
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_predict_unauthenticated(client):
    """Unauthenticated request returns 401."""
    response = await client.get(
        "/api/v1/trends/predict",
        params={"lat": 19.07, "lon": 72.87, "hours": 6},
    )
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/v1/trends/predict — invalid hours value → 422
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_predict_invalid_hours(auth_client):
    """Request with hours=5 (not in allowed set) returns 422."""
    mock_supabase = MagicMock()

    with patch("app.api.v1.trends.router.get_supabase", return_value=mock_supabase):
        response = await auth_client.get(
            "/api/v1/trends/predict",
            params={"lat": 19.07, "lon": 72.87, "hours": 5},
        )

    assert response.status_code == 422


# ---------------------------------------------------------------------------
# GET /api/v1/trends/predict — missing lat/lon → 422
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_predict_missing_params(auth_client):
    """Request missing required lat parameter returns 422."""
    response = await auth_client.get(
        "/api/v1/trends/predict",
        params={"lon": 72.87, "hours": 6},
    )
    assert response.status_code == 422
