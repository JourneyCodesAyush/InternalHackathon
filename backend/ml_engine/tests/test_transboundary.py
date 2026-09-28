import numpy as np
import pytest

from ml_engine.globe import load_demo
from ml_engine.transboundary import (
    _sample_bilinear,
    _segment_flux,
    calculate_transboundary_flux,
)


def test_sample_bilinear():
    arr = np.array([[10.0, 20.0], [30.0, 40.0]], dtype=np.float32)
    # arr has 2 rows (lat: 90 to -90, res=90 deg: row 0 is 90N, row 1 is 0)
    # and 2 cols (lon: -180 to 180, res=180 deg: col 0 is -180, col 1 is 0)
    val = _sample_bilinear(arr, lon=-180.0, lat=90.0, res=90.0)
    assert np.isclose(val, 10.0)


def test_segment_flux_perpendicular_wind():
    # Segment running West to East along Lat 28.0 from Lon 76.0 to 77.0
    # Inward normal points North: n = (0, 1)
    p1 = (76.0, 28.0)
    p2 = (77.0, 28.0)

    no2_grid = np.full((360, 720), 40.0, dtype=np.float32)  # 40 umol/m2
    # Wind blowing North: u = 0, v = 5 m/s (straight across the border into the northern region)
    u_grid = np.zeros((360, 720), dtype=np.float32)
    v_grid = np.full((360, 720), 5.0, dtype=np.float32)

    res = _segment_flux(p1, p2, no2_grid, u_grid, v_grid, res=0.5)
    assert res["inflow_tonnes_day"] > 0
    assert res["outflow_tonnes_day"] == 0
    assert res["flux_tonnes_day"] > 0
    assert res["mean_no2"] == 40.0


def test_segment_flux_parallel_wind_is_zero():
    # Segment running West to East along Lat 28.0
    p1 = (76.0, 28.0)
    p2 = (77.0, 28.0)

    no2_grid = np.full((360, 720), 40.0, dtype=np.float32)
    # Wind blowing purely East: parallel to border -> no cross-border transport
    u_grid = np.full((360, 720), 5.0, dtype=np.float32)
    v_grid = np.zeros((360, 720), dtype=np.float32)

    res = _segment_flux(p1, p2, no2_grid, u_grid, v_grid, res=0.5)
    assert np.isclose(res["flux_tonnes_day"], 0.0, atol=0.1)


def test_calculate_transboundary_flux_with_demo():
    demo = load_demo()
    assert demo is not None
    result = calculate_transboundary_flux(demo["no2"], demo["u"], demo["v"], demo["meta"], target_region="delhi")

    assert result["status"] == "ready"
    assert "delhi_summary" in result
    delhi = result["delhi_summary"]

    assert "headline" in delhi
    assert "Delhi's NO₂ today arrived from outside the city" in delhi["headline"]
    assert 5.0 <= delhi["external_attribution_pct"] <= 95.0
    assert delhi["inflow_tonnes_day"] >= 0
    assert delhi["outflow_tonnes_day"] >= 0
    assert len(delhi["corridors"]) == 4

    # Check vector geometries
    vectors = result["vectors"]
    assert len(vectors) >= 4
    for vec in vectors:
        assert "start" in vec and len(vec["start"]) == 2
        assert "end" in vec and len(vec["end"]) == 2
        assert "flux_tonnes_day" in vec
        assert "intensity" in vec

    assert len(result["gateways"]) >= 3
    assert "available_regions" in result
    assert len(result["available_regions"]) == 4

    # Test other Indian regions
    pb = calculate_transboundary_flux(demo["no2"], demo["u"], demo["v"], demo["meta"], target_region="punjab")
    assert pb["region_id"] == "punjab"
    assert len(pb["gateways"]) >= 3

    igp = calculate_transboundary_flux(demo["no2"], demo["u"], demo["v"], demo["meta"], target_region="igp_east")
    assert igp["region_id"] == "igp_east"

    sk = calculate_transboundary_flux(demo["no2"], demo["u"], demo["v"], demo["meta"], target_region="singrauli_korba")
    assert sk["region_id"] == "singrauli_korba"
