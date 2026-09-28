"""DCP haze model and pre-inspection flight plans."""
import numpy as np
import pytest

from ml_engine.report import flightplan, haze


def _scene(seed=0):
    import cv2

    rng = np.random.default_rng(seed)
    img = np.zeros((240, 320, 3), np.uint8)
    for _ in range(60):
        x, y = rng.integers(0, 300), rng.integers(0, 220)
        c = [int(v) for v in rng.integers(0, 255, 3)]
        c[rng.integers(0, 3)] = 5
        cv2.rectangle(img, (int(x), int(y)), (int(x) + 40, int(y) + 30), c, -1)
    return img


@pytest.mark.parametrize("amount", [0.0, 0.4, 0.75])
def test_dcp_recovers_the_haze_amount(amount):
    clear = _scene()
    hazy = (clear * (1 - amount) + np.full_like(clear, 210) * amount).astype(np.uint8)
    r = haze.analyse_image(hazy)
    assert abs(r["haze_index"] - amount) < 0.08
    assert r["class"] == haze.haze_class(r["haze_index"])


def test_haze_store_and_summary(tmp_path, monkeypatch):
    monkeypatch.setattr(haze, "STORE", tmp_path)
    assert haze.summary() is None
    haze.record_reading({"haze_index": 0.2, "class": "clear", "transmission_mean": 0.8}, lat=19.0, lon=72.9)
    haze.record_reading({"haze_index": 0.7, "class": "dense", "transmission_mean": 0.3})
    s = haze.summary()
    assert s["count"] == 2 and s["latest"]["class"] == "dense" and s["max"] == 0.7


def test_flight_plan_short_hop_is_go():
    target = {"lat": 19.2, "lon": 73.3, "near": "Test site"}  # far from any airport
    fp = flightplan.plan(target, 3.0, 270.0, home=(19.2, 73.28))
    assert fp["decision"] == "go" and fp["relocation"] is None
    assert 1.5 < fp["distance_km"] < 2.5 and fp["bearing_compass"] in {"E", "ENE", "ESE"}
    assert fp["airspace"]["zone"] == "green" and fp["elevation"]["cruise_agl_m"] == 80
    assert sum(p["mah"] for p in fp["phases"]) == fp["total_mah"] < fp["battery"]["usable_mah"]
    assert [w["action"] for w in fp["waypoints"]][0] == "take_off" and fp["waypoints"][-1]["action"] == "land"


def test_flight_plan_out_of_range_gets_a_forward_launch_point():
    target = {"lat": 19.2, "lon": 73.6, "near": "Far site"}
    fp = flightplan.plan(target, 2.0, 0.0, home=(19.2, 73.3))
    assert fp["decision"] == "no_go" and "battery" in fp["issues"]
    rel = fp["relocation"]
    assert rel is not None and abs(rel["distance_km"] - flightplan.FORWARD_LAUNCH_KM) < 0.05
    assert rel["total_mah"] < rel["battery"]["usable_mah"]


def test_airspace_rules_near_an_airport():
    near_bom = flightplan.plan({"lat": 19.10, "lon": 72.88, "near": "x"}, 1.0, 0.0, home=(19.09, 72.87))
    assert near_bom["airspace"]["zone"] == "yellow" and "airspace" in near_bom["issues"]
    assert near_bom["decision"] == "conditional"


def test_head_and_tailwind():
    out = flightplan._leg(1000, 90.0, 5.0, 90.0)  # flying east into an easterly wind
    back = flightplan._leg(1000, 270.0, 5.0, 90.0)
    assert out["headwind_ms"] == pytest.approx(5.0) and back["headwind_ms"] == pytest.approx(-5.0)
    assert out["ground_speed_ms"] < back["ground_speed_ms"]
