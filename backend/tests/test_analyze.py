import pytest
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# POST /api/v1/analyze/pinpoint — happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pinpoint_success(auth_client):
    """Authenticated request returns a valid PinpointResponse with 3 sources."""
    mock_supabase = MagicMock()
    (
        mock_supabase.table.return_value.select.return_value.execute.return_value.data
    ) = [
        {"name": "Steel Factory A", "category": "FACTORY"},
        {"name": "Highway NH-48", "category": "TRAFFIC_CORRIDOR"},
        {"name": "Coal Plant B", "category": "POWER_PLANT"},
    ]

    with patch("app.services.activity_service.log_activity"):
        with patch("app.api.v1.analyze.router.get_supabase", return_value=mock_supabase):
            response = await auth_client.post(
                "/api/v1/analyze/pinpoint",
                json={"lat": 19.07, "lon": 72.87, "radius_km": 5.0},
            )

    assert response.status_code == 200
    data = response.json()
    assert data["location"]["lat"] == 19.07
    assert data["location"]["lon"] == 72.87
    assert data["radius_km"] == 5.0
    assert len(data["sources"]) == 3
    for source in data["sources"]:
        assert "name" in source
        assert "category" in source
        assert 0.0 < source["attribution_weight"] <= 1.0
        assert source["distance_km"] > 0
    assert "NO" in data["summary"] or "emission" in data["summary"].lower()


# ---------------------------------------------------------------------------
# POST /api/v1/analyze/pinpoint — default radius
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pinpoint_default_radius(auth_client):
    """Request without radius_km uses the default value of 5.0."""
    mock_supabase = MagicMock()
    mock_supabase.table.return_value.select.return_value.execute.return_value.data = []

    with patch("app.services.activity_service.log_activity"):
        with patch("app.api.v1.analyze.router.get_supabase", return_value=mock_supabase):
            response = await auth_client.post(
                "/api/v1/analyze/pinpoint",
                json={"lat": 28.61, "lon": 77.20},
            )

    assert response.status_code == 200
    assert response.json()["radius_km"] == 5.0


# ---------------------------------------------------------------------------
# POST /api/v1/analyze/pinpoint — unauthenticated → 401
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pinpoint_unauthenticated(client):
    """Unauthenticated request returns 401."""
    response = await client.post(
        "/api/v1/analyze/pinpoint",
        json={"lat": 19.07, "lon": 72.87},
    )
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# POST /api/v1/analyze/pinpoint — missing required fields → 422
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pinpoint_missing_lat(auth_client):
    """Request missing 'lat' field returns 422."""
    response = await auth_client.post(
        "/api/v1/analyze/pinpoint",
        json={"lon": 72.87},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_pinpoint_invalid_body(auth_client):
    """Request with wrong field types returns 422."""
    response = await auth_client.post(
        "/api/v1/analyze/pinpoint",
        json={"lat": "not-a-float", "lon": 72.87},
    )
    assert response.status_code == 422
