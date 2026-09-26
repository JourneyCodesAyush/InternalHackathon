import pytest
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# GET /api/v1/downscale/map — happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_map_success(auth_client):
    """Authenticated request returns a valid DownscaleMapResponse."""
    mock_supabase = MagicMock()

    with patch("app.services.activity_service.log_activity"):
        with patch("app.api.v1.downscale.router.get_supabase", return_value=mock_supabase):
            response = await auth_client.get(
                "/api/v1/downscale/map",
                params={"bbox": "72.8,18.9,73.1,19.2", "timestamp": "2024-01-15T10:00:00Z"},
            )

    assert response.status_code == 200
    data = response.json()
    assert data["resolution"] == "1km"
    assert data["format"] == "GeoTIFF"
    assert len(data["bbox"]) == 4
    assert data["bbox"] == [72.8, 18.9, 73.1, 19.2]
    assert "stub.tif" in data["grid_url"]


# ---------------------------------------------------------------------------
# GET /api/v1/downscale/map — unauthenticated → 401
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_map_unauthenticated(client):
    """Request without Authorization header returns 401."""
    response = await client.get(
        "/api/v1/downscale/map",
        params={"bbox": "72.8,18.9,73.1,19.2", "timestamp": "2024-01-15T10:00:00Z"},
    )
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/v1/downscale/map — missing query params → 422
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_map_missing_params(auth_client):
    """Request missing the required bbox parameter returns 422."""
    response = await auth_client.get(
        "/api/v1/downscale/map",
        params={"timestamp": "2024-01-15T10:00:00Z"},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_get_map_missing_timestamp(auth_client):
    """Request missing the required timestamp parameter returns 422."""
    response = await auth_client.get(
        "/api/v1/downscale/map",
        params={"bbox": "72.8,18.9,73.1,19.2"},
    )
    assert response.status_code == 422
