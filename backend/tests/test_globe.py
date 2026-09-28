import base64

import numpy as np
import pytest
from unittest.mock import patch


def _snapshot():
    no2 = np.array([[1.5, np.nan], [250.0, -3.2]], dtype=np.float32)
    return {
        "no2": no2, "age_h": np.array([[3.4, np.nan], [10.0, 23.9]], dtype=np.float32),
        "u": np.ones((2, 2), np.float32), "v": -np.ones((2, 2), np.float32),
        "meta": {"fetched_at": "2026-09-27T13:19Z", "width": 2, "height": 2, "res_deg": 90.0, "stale": False},
    }


def _decode(field, nodata=-32768):
    ints = np.frombuffer(base64.b64decode(field["data"]), dtype="<i2")
    return np.where(ints == nodata, np.nan, ints * field["scale"])


@pytest.mark.asyncio
async def test_global_no2_is_quantised(auth_client):
    """The grid comes back as base64 int16 that decodes to the original values (NaN = no data)."""
    with patch("app.services.globe_service.global_no2", return_value=_snapshot()) as fetch:
        response = await auth_client.get("/api/v1/globe/no2?hours=24")
    assert response.status_code == 200
    body = response.json()
    assert body["width"] == 2 and body["nodata"] == -32768 and body["stale"] is False
    no2 = _decode(body["fields"]["no2"])
    assert np.isnan(no2[1]) and np.allclose(no2[[0, 2, 3]], [1.5, 250.0, -3.2], atol=0.005)
    assert np.allclose(_decode(body["fields"]["v"]), -1.0)
    fetch.assert_called_once_with(24)


@pytest.mark.asyncio
async def test_global_no2_hours_validated(auth_client):
    response = await auth_client.get("/api/v1/globe/no2?hours=500")
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_global_no2_unavailable(auth_client):
    """No stored snapshot and Earth Engine down -> 503."""
    with patch("app.services.globe_service.global_no2", side_effect=RuntimeError("quota")):
        response = await auth_client.get("/api/v1/globe/no2")
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_global_no2_unauthenticated(client):
    response = await client.get("/api/v1/globe/no2")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_transboundary_flux_endpoint(auth_client):
    from ml_engine.globe import load_demo

    demo = load_demo()
    assert demo is not None
    with patch("app.services.globe_service.global_no2", return_value=demo):
        response = await auth_client.get("/api/v1/globe/transboundary-flux?region=delhi")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    assert "delhi_summary" in data
    assert "Delhi's NO₂ today arrived from outside the city" in data["delhi_summary"]["headline"]
    assert "vectors" in data and len(data["vectors"]) >= 5
    assert "punjab_international" in data
    assert "legal_evidence_brief" in data


@pytest.mark.asyncio
async def test_transboundary_flux_unauthenticated(client):
    response = await client.get("/api/v1/globe/transboundary-flux")
    assert response.status_code == 401

