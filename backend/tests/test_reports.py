import pytest
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# POST /api/v1/reports/generate — happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_report_success(auth_client):
    """Authenticated request returns a PDF streaming response."""
    mock_supabase = MagicMock()

    with patch("app.services.activity_service.log_activity"):
        with patch("app.api.v1.reports.router.get_supabase", return_value=mock_supabase):
            response = await auth_client.post(
                "/api/v1/reports/generate",
                json={
                    "region_name": "Mumbai Metropolitan Region",
                    "bbox": "72.7,18.85,73.0,19.3",
                    "start_date": "2024-01-15",
                    "end_date": "2024-01-17",
                },
            )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert "attachment" in response.headers.get("content-disposition", "")
    assert "report.pdf" in response.headers.get("content-disposition", "")
    # Verify the response body starts with the PDF magic bytes
    assert response.content[:4] == b"%PDF"


# ---------------------------------------------------------------------------
# POST /api/v1/reports/generate — unauthenticated → 401
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_report_unauthenticated(client):
    """Unauthenticated request returns 401."""
    response = await client.post(
        "/api/v1/reports/generate",
        json={
            "region_name": "Test Region",
            "bbox": "72.7,18.85,73.0,19.3",
            "start_date": "2024-01-01",
            "end_date": "2024-01-31",
        },
    )
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# POST /api/v1/reports/generate — missing required fields → 422
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_report_missing_region(auth_client):
    """Request missing 'region_name' returns 422."""
    response = await auth_client.post(
        "/api/v1/reports/generate",
        json={
            "bbox": "72.7,18.85,73.0,19.3",
            "start_date": "2024-01-01",
            "end_date": "2024-01-31",
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_generate_report_empty_body(auth_client):
    """Request with empty body returns 422."""
    response = await auth_client.post("/api/v1/reports/generate", json={})
    assert response.status_code == 422
