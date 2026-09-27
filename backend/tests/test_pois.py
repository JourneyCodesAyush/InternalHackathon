import pytest
from unittest.mock import patch

from app.services import pois_service

OVERPASS = {"elements": [
    {"type": "way", "id": 1, "center": {"lat": 19.02, "lon": 72.85}, "tags": {"landuse": "industrial", "name": "Estate"}},
    {"type": "node", "id": 2, "lat": 19.03, "lon": 72.86, "tags": {"power": "plant", "plant:source": "gas"}},
    {"type": "node", "id": 3, "lat": 19.04, "lon": 72.87, "tags": {"man_made": "works", "product": "cement"}},
    {"type": "way", "id": 4, "tags": {"highway": "motorway", "name": "WEH"},
     "geometry": [{"lat": 19.0 + i / 100, "lon": 72.84} for i in range(50)]},
    {"type": "way", "id": 5, "tags": {"railway": "rail", "usage": "main"},
     "geometry": [{"lat": 19.0, "lon": 72.8}, {"lat": 19.1, "lon": 72.9}]},
]}


def test_sources_and_corridors_are_parsed(tmp_path, monkeypatch):
    monkeypatch.setattr(pois_service, "CACHE_DIR", tmp_path)
    with patch.object(pois_service, "_overpass", return_value=OVERPASS) as overpass:
        out = pois_service.get_pois((72.80, 18.95, 72.95, 19.10))
        again = pois_service.get_pois((72.81, 18.96, 72.94, 19.09))  # same snapped area: served from the cache
    assert overpass.call_count == 1 and again == out
    cats = {p["name"]: p["category"] for p in out["points"]}
    assert cats == {"Estate": "FACTORY", "Power plant": "POWER_PLANT", "Industrial site": "FACTORY"}
    kinds = {c["kind"] for c in out["corridors"]}
    assert kinds == {"motorway", "railway"}
    motorway = next(c for c in out["corridors"] if c["kind"] == "motorway")
    assert len(motorway["path"]) < 50 and motorway["path"][-1] == [19.49, 72.84]  # simplified, end kept


def test_too_large_area_is_rejected():
    with pytest.raises(ValueError, match="zoom in"):
        pois_service.get_pois((70.0, 15.0, 75.0, 20.0))


@pytest.mark.asyncio
async def test_pois_endpoint(auth_client):
    with patch("app.services.pois_service.get_pois", return_value={"points": [], "corridors": []}):
        assert (await auth_client.get("/api/v1/analyze/pois", params={"bbox": "72.8,18.9,72.9,19.0"})).status_code == 200
    with patch("app.services.pois_service.get_pois", side_effect=RuntimeError("Overpass unavailable")):
        assert (await auth_client.get("/api/v1/analyze/pois", params={"bbox": "72.8,18.9,72.9,19.0"})).status_code == 503
    assert (await auth_client.get("/api/v1/analyze/pois", params={"bbox": "bad"})).status_code == 422
