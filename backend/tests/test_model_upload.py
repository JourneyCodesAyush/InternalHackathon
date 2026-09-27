import pytest
from unittest.mock import patch

STATUS = {"job_id": "0123456789abcdef", "state": "queued", "stage": "Queued", "progress": 2, "error": None, "stats": None}


@pytest.mark.asyncio
async def test_upload_starts_a_job(auth_client):
    with patch("app.services.downscale_service.uploads.submit_upload", return_value=STATUS) as submit:
        response = await auth_client.post(
            "/api/v1/downscale/upload",
            files=[("files", ("no2_raw_coarse_2025-12-01.tif", b"II*\x00data", "image/tiff")),
                   ("files", ("no2_raw_coarse_2025-12-02.tif", b"II*\x00more", "image/tiff"))],
        )
    assert response.status_code == 200 and response.json()["job_id"] == "0123456789abcdef"
    names = [name for name, _ in submit.call_args.args[0]]
    assert names == ["no2_raw_coarse_2025-12-01.tif", "no2_raw_coarse_2025-12-02.tif"]


@pytest.mark.asyncio
async def test_upload_format_errors_are_422(auth_client):
    with patch("app.services.downscale_service.uploads.submit_upload", side_effect=ValueError("grid differs")):
        response = await auth_client.post("/api/v1/downscale/upload",
                                          files=[("files", ("a_2025-12-01.tif", b"x", "image/tiff"))])
    assert response.status_code == 422 and "grid differs" in response.json()["detail"]


@pytest.mark.asyncio
async def test_job_status_and_unknown_job(auth_client):
    with patch("app.services.downscale_service.uploads.job_status", return_value={**STATUS, "state": "running"}):
        assert (await auth_client.get("/api/v1/downscale/jobs/0123456789abcdef")).json()["state"] == "running"
    with patch("app.services.downscale_service.uploads.job_status", side_effect=KeyError("x")):
        assert (await auth_client.get("/api/v1/downscale/jobs/ffffffffffffffff")).status_code == 404


@pytest.mark.asyncio
async def test_geotiff_serves_the_model_output(auth_client, tmp_path):
    tif = tmp_path / "no2_surface_fine.tif"
    tif.write_bytes(b"II*\x00model")
    output = {"source": "upload", "job_id": "0123456789abcdef", "stats": None, "date": "2025-12-07",
              "surface_tif": str(tif), "raw_tif": str(tmp_path / "missing.tif")}
    with patch("app.services.downscale_service.uploads.latest_output", return_value=output):
        response = await auth_client.get("/api/v1/downscale/geotiff")
        assert response.status_code == 200 and response.content == b"II*\x00model"
        assert response.headers["x-model-date"] == "2025-12-07" and response.headers["x-model-source"] == "upload"
        assert (await auth_client.get("/api/v1/downscale/geotiff?kind=raw")).status_code == 404
        latest = (await auth_client.get("/api/v1/downscale/latest")).json()
        assert latest["date"] == "2025-12-07" and "surface_tif" not in latest
    with patch("app.services.downscale_service.uploads.latest_output", return_value=None):
        assert (await auth_client.get("/api/v1/downscale/geotiff")).status_code == 404


@pytest.mark.asyncio
async def test_model_endpoints_need_login(client):
    assert (await client.get("/api/v1/downscale/geotiff")).status_code == 401
    assert (await client.get("/api/v1/downscale/latest")).status_code == 401
