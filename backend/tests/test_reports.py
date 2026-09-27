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
                        "data_source": "area", "start_date": "2024-01-15",
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
                    json={"region_name": "Pune", "bbox": "73.7,18.4,74.0,18.65", "data_source": "area", "start_date": "2024-01-01",
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
                    json={"region_name": "Test", "bbox": "72.7,18.85,73.0,19.3", "data_source": "area", "start_date": "2024-01-01",
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
            "data_source": "area", "start_date": "2024-01-01",
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
            "data_source": "area", "start_date": "2024-01-01",
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
        json={"region_name": "Test", "bbox": "72.7,18.85,73.0,19.3", "data_source": "area", "start_date": "2024-01-01",
              "end_date": "2024-01-31", "language": "fr"},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_generate_report_invalid_bbox(auth_client):
    """A malformed bbox is rejected before the ML engine runs."""
    with patch("app.api.v1.reports.router.get_supabase", return_value=MagicMock()):
        response = await auth_client.post(
            "/api/v1/reports/generate",
            json={"region_name": "Test", "bbox": "73.0,18.85,72.7", "data_source": "area", "start_date": "2024-01-01", "end_date": "2024-01-31"},
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
            json={"region_name": "Mumbai", "bbox": "72.7,18.85,73.0,19.3", "data_source": "area", "start_date": "2024-01-01",
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
            json={"region_name": "Somewhere", "bbox": "72.7,18.85,73.0,19.3", "data_source": "area", "start_date": "2024-01-01",
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
            json={"region_name": "Test", "bbox": "72.7,18.85,73.0,19.3", "data_source": "area", "start_date": "2024-01-01",
                  "end_date": "2024-01-31"},
        )
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_analysis_unauthenticated(client):
    """Unauthenticated request returns 401."""
    response = await client.post(
        "/api/v1/reports/analysis",
        json={"region_name": "Test", "bbox": "72.7,18.85,73.0,19.3", "data_source": "area", "start_date": "2024-01-01",
              "end_date": "2024-01-31"},
    )
    assert response.status_code == 401



# ---------------------------------------------------------------------------
# data_source="model" (default): the agent reads the AI model output at the bbox centre
# ---------------------------------------------------------------------------

AGENT_META = {"status": "normal", "area_mean": 37.7, "date": "2025-12-07", "language": "en",
              "narrative": "template", "narrative_model": None, "notice": None, "source": "upload"}


@pytest.mark.asyncio
async def test_agent_report_uses_model_output_at_the_point(auth_client):
    with patch("app.services.activity_service.log_activity"),             patch("app.api.v1.reports.router.get_supabase", return_value=MagicMock()),             patch("app.services.reports_service.agent_report", return_value=(FAKE_PDF, AGENT_META)) as agent:
        response = await auth_client.post(
            "/api/v1/reports/generate",
            json={"region_name": "Shivaji Park, Mumbai", "bbox": "72.688,18.877,72.988,19.177",
                  "start_date": "2025-11-08", "end_date": "2025-12-07", "language": "mr", "city": "Mumbai"},
        )
    assert response.status_code == 200 and response.headers["x-report-source"] == "upload"
    lat, lon, date, name, lang = agent.call_args.args[:5]
    assert abs(lat - 19.027) < 1e-6 and abs(lon - 72.838) < 1e-6 and date == "2025-12-07" and lang == "mr"


@pytest.mark.asyncio
async def test_agent_analysis_and_no_data(auth_client):
    with patch("app.services.reports_service.agent_analysis", return_value={"current": {"mean": 37.7}}):
        ok = await auth_client.post("/api/v1/reports/analysis",
                                    json={"region_name": "X", "bbox": "72.7,18.9,73.0,19.2", "start_date": "2025-12-01",
                                          "end_date": "2025-12-07"})
    assert ok.status_code == 200 and ok.json()["current"]["mean"] == 37.7
    with patch("app.services.reports_service.agent_analysis", side_effect=RuntimeError("No AI model output covers")):
        none = await auth_client.post("/api/v1/reports/analysis",
                                      json={"region_name": "X", "bbox": "77.0,28.4,77.4,28.8", "start_date": "2025-12-01",
                                            "end_date": "2025-12-07"})
    assert none.status_code == 503 and "model output" in none.json()["detail"]
