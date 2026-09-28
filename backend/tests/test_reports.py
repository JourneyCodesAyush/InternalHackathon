import pytest
from unittest.mock import MagicMock, patch

FAKE_PDF = b"%PDF-1.4\n% fake report for tests\n"
FAKE_META = {"status": "elevated", "area_mean": 52.3, "date": "2024-01-17", "language": "hi",
             "narrative": "template", "narrative_model": None}


# ---------------------------------------------------------------------------
# POST /api/v1/reports/generate — happy path (ML engine mocked)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_report_success(auth_client):
    """Authenticated request streams the ML engine's PDF with status headers."""
    mock_supabase = MagicMock()

    with patch("app.services.activity_service.log_activity"):
        with patch("app.api.v1.reports.router.get_supabase", return_value=mock_supabase):
            with patch("app.services.reports_service.build_report", return_value=(FAKE_PDF, FAKE_META)) as build:
                response = await auth_client.post(
                    "/api/v1/reports/generate",
                    json={
                        "region_name": "Mumbai Metropolitan Region",
                        "bbox": "72.7,18.85,73.0,19.3",
                        "start_date": "2024-01-15",
                        "end_date": "2024-01-17",
                        "language": "hi",
                    },
                )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    disposition = response.headers.get("content-disposition", "")
    assert "attachment" in disposition
    assert "no2_report_Mumbai_Metropolitan_Region_2024-01-17_hi.pdf" in disposition
    assert response.headers["x-report-status"] == "elevated"
    assert response.headers["x-report-narrative"] == "template"
    assert response.content[:4] == b"%PDF"
    kwargs = build.call_args.kwargs
    assert kwargs["date"] == "2024-01-17" and kwargs["language"] == "hi"
    assert kwargs["bbox"] == (72.7, 18.85, 73.0, 19.3)


@pytest.mark.asyncio
async def test_generate_report_city_overrides_bbox(auth_client):
    """A known city name is passed to the engine instead of the bbox."""
    with patch("app.services.activity_service.log_activity"):
        with patch("app.api.v1.reports.router.get_supabase", return_value=MagicMock()):
            with patch("app.services.reports_service.build_report", return_value=(FAKE_PDF, FAKE_META)) as build:
                response = await auth_client.post(
                    "/api/v1/reports/generate",
                    json={"region_name": "Pune", "bbox": "73.7,18.4,74.0,18.65", "start_date": "2024-01-01",
                          "end_date": "2024-01-17", "city": "Pune"},
                )
    assert response.status_code == 200
    assert build.call_args.kwargs["city"] == "Pune" and "bbox" not in build.call_args.kwargs


@pytest.mark.asyncio
async def test_generate_report_engine_failure(auth_client):
    """An ML engine failure (e.g. Earth Engine quota) surfaces as 503."""
    with patch("app.services.activity_service.log_activity"):
        with patch("app.api.v1.reports.router.get_supabase", return_value=MagicMock()):
            with patch("app.services.reports_service.build_report", side_effect=RuntimeError("quota")):
                response = await auth_client.post(
                    "/api/v1/reports/generate",
                    json={"region_name": "Test", "bbox": "72.7,18.85,73.0,19.3", "start_date": "2024-01-01",
                          "end_date": "2024-01-31"},
                )
    assert response.status_code == 503


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
# POST /api/v1/reports/generate — invalid input → 422
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


@pytest.mark.asyncio
async def test_generate_report_unsupported_language(auth_client):
    """Only English, Hindi and Marathi are offered."""
    response = await auth_client.post(
        "/api/v1/reports/generate",
        json={"region_name": "Test", "bbox": "72.7,18.85,73.0,19.3", "start_date": "2024-01-01",
              "end_date": "2024-01-31", "language": "fr"},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_generate_report_invalid_bbox(auth_client):
    """A malformed bbox is rejected before the ML engine runs."""
    with patch("app.api.v1.reports.router.get_supabase", return_value=MagicMock()):
        response = await auth_client.post(
            "/api/v1/reports/generate",
            json={"region_name": "Test", "bbox": "73.0,18.85,72.7", "start_date": "2024-01-01", "end_date": "2024-01-31"},
        )
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# POST /api/v1/reports/analysis — JSON comparison for the web page
# ---------------------------------------------------------------------------

FAKE_ANALYSIS = {"date": "2024-01-17", "current": {"mean": 52.3, "status": "elevated"},
                 "labels": {"status": "Elevated"}, "texts": {"summary": "..."}}


@pytest.mark.asyncio
async def test_analysis_success(auth_client):
    """The analysis is returned as JSON, with the language passed through."""
    with patch("app.services.reports_service.build_analysis", return_value=FAKE_ANALYSIS) as analyse:
        response = await auth_client.post(
            "/api/v1/reports/analysis",
            json={"region_name": "Mumbai", "bbox": "72.7,18.85,73.0,19.3", "start_date": "2024-01-01",
                  "end_date": "2024-01-17", "language": "mr", "city": "Mumbai"},
        )
    assert response.status_code == 200
    assert response.json()["current"]["status"] == "elevated"
    kwargs = analyse.call_args.kwargs
    assert kwargs["city"] == "Mumbai" and kwargs["language"] == "mr" and kwargs["date"] == "2024-01-17"


@pytest.mark.asyncio
async def test_analysis_unknown_city_falls_back_to_bbox(auth_client):
    """An unknown city name retries with the bounding box."""
    with patch("app.services.reports_service.build_analysis", side_effect=[KeyError("x"), FAKE_ANALYSIS]) as analyse:
        response = await auth_client.post(
            "/api/v1/reports/analysis",
            json={"region_name": "Somewhere", "bbox": "72.7,18.85,73.0,19.3", "start_date": "2024-01-01",
                  "end_date": "2024-01-17", "city": "Somewhere"},
        )
    assert response.status_code == 200
    assert analyse.call_args.kwargs["bbox"] == (72.7, 18.85, 73.0, 19.3)


@pytest.mark.asyncio
async def test_analysis_engine_failure(auth_client):
    """An ML engine failure (e.g. Earth Engine quota) surfaces as 503."""
    with patch("app.services.reports_service.build_analysis", side_effect=RuntimeError("quota")):
        response = await auth_client.post(
            "/api/v1/reports/analysis",
            json={"region_name": "Test", "bbox": "72.7,18.85,73.0,19.3", "start_date": "2024-01-01",
                  "end_date": "2024-01-31"},
        )
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_analysis_unauthenticated(client):
    """Unauthenticated request returns 401."""
    response = await client.post(
        "/api/v1/reports/analysis",
        json={"region_name": "Test", "bbox": "72.7,18.85,73.0,19.3", "start_date": "2024-01-01",
              "end_date": "2024-01-31"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_drone_haze_endpoint(auth_client, tmp_path, monkeypatch):
    import cv2
    import numpy as np

    from ml_engine.report import haze

    monkeypatch.setattr(haze, "STORE", tmp_path)
    img = (np.random.default_rng(0).integers(0, 255, (120, 160, 3))).astype(np.uint8)
    ok, jpg = cv2.imencode(".jpg", img)
    r = await auth_client.post("/api/v1/drone/haze", files={"image": ("f.jpg", jpg.tobytes(), "image/jpeg")},
                               data={"lat": "19.0", "lon": "72.9"})
    assert r.status_code == 200 and 0 <= r.json()["haze_index"] <= 1 and r.json()["lat"] == 19.0
    assert (await auth_client.post("/api/v1/drone/haze", data={"haze_index": "0.7"})).json()["class"] == "dense"
    assert (await auth_client.post("/api/v1/drone/haze", data={})).status_code == 422
    body = (await auth_client.get("/api/v1/drone/haze")).json()
    assert body["summary"]["count"] == 2
