import pytest
from unittest.mock import MagicMock, patch


@pytest.mark.asyncio
async def test_point_value_and_forecast_from_uploaded_day(auth_client):
    """The value comes from that day's uploaded GeoTIFF (as the map/plume page) + forecast model predictions."""
    import numpy as np
    import rasterio

    from app.services import upload_data

    response = await auth_client.get("/api/v1/trends/point", params={"lat": 19.027, "lon": 72.838, "date": "2025-11-05"})
    assert response.status_code == 200
    body = response.json()
    assert body["date"] == "2025-11-05" and body["inside"] is True
    assert [h["hours"] for h in body["horizons"]] == [3, 6, 12, 24]
    arr, t, _ = upload_data.read_day("2025-11-05")
    col, row = ~t * (72.838, 19.027)
    assert body["value"] == round(float(arr[int(row), int(col)]), 1)
    assert body["wind"]["direction"] in {"N", "NE", "E", "SE", "S", "SW", "W", "NW"}


@pytest.mark.asyncio
async def test_point_outside_uploaded_area(auth_client):
    response = await auth_client.get("/api/v1/trends/point", params={"lat": 28.61, "lon": 77.2, "date": "2025-11-05"})
    assert response.status_code == 200 and response.json()["inside"] is False


@pytest.mark.asyncio
async def test_report_for_an_uploaded_day(auth_client):
    meta = {"status": "normal", "area_mean": 36.4, "date": "2025-11-05", "language": "en", "narrative": "template",
            "narrative_model": None, "notice": None}
    with patch("app.services.activity_service.log_activity"), \
            patch("app.api.v1.reports.router.get_supabase", return_value=MagicMock()), \
            patch("app.services.reports_service.generate_upload_report", return_value=(b"%PDF-1.4", meta)) as gen:
        response = await auth_client.post("/api/v1/reports/generate", json={
            "region_name": "Shivaji Park, Mumbai", "bbox": "72.688,18.877,72.988,19.177", "start_date": "2025-10-07",
            "end_date": "2025-11-05", "language": "hi", "data_source": "upload"})
    assert response.status_code == 200 and response.content[:4] == b"%PDF"
    input_dir, date = gen.call_args.args[:2]
    from pathlib import Path

    assert date == "2025-11-05" and Path(input_dir).as_posix().endswith("data/test_data")
