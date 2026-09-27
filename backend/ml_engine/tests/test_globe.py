import numpy as np
import pytest

from ml_engine import globe


def _snap(tag: str) -> dict:
    return {"no2": np.full((2, 4), 5.0, np.float32), "age_h": np.full((2, 4), 3.0, np.float32),
            "u": np.zeros((2, 4), np.float32), "v": np.zeros((2, 4), np.float32),
            "meta": {"fetched_at": tag, "stale": False}}


@pytest.fixture
def cache(tmp_path, monkeypatch):
    monkeypatch.setattr(globe, "CACHE_DIR", tmp_path)
    return tmp_path


def test_snapshot_is_cached(cache, monkeypatch):
    calls = []
    monkeypatch.setattr(globe, "_fetch", lambda hours, res: calls.append(hours) or _snap("first"))
    assert globe.global_no2(24)["meta"]["fetched_at"] == "first"
    assert globe.global_no2(24)["meta"]["fetched_at"] == "first"
    assert calls == [24]


def test_failed_refresh_serves_stale_snapshot(cache, monkeypatch):
    monkeypatch.setattr(globe, "_fetch", lambda hours, res: _snap("old"))
    globe.global_no2(24)
    monkeypatch.setattr(globe, "CACHE_TTL_S", -1)  # force a refresh

    def down(hours, res):
        raise RuntimeError("Earth Engine quota")

    monkeypatch.setattr(globe, "_fetch", down)
    snap = globe.global_no2(24)
    assert snap["meta"]["fetched_at"] == "old" and snap["meta"]["stale"] is True
    np.testing.assert_allclose(snap["no2"], 5.0)


def test_no_snapshot_and_no_earth_engine_raises(cache, tmp_path, monkeypatch):
    monkeypatch.setattr(globe, "DEMO_SNAPSHOT", tmp_path / "missing.npz")  # no bundled fallback either
    monkeypatch.setattr(globe, "_fetch", lambda hours, res: (_ for _ in ()).throw(RuntimeError("down")))
    with pytest.raises(RuntimeError):
        globe.global_no2(24)


def test_grid_is_global():
    g = globe._grid(0.5)
    assert g["dimensions"] == {"width": 720, "height": 360}
    assert g["affineTransform"]["translateX"] == -180.0 and g["affineTransform"]["translateY"] == 90.0


def test_offline_mode_serves_the_stored_snapshot(cache, monkeypatch):
    monkeypatch.setattr(globe, "_fetch", lambda hours, res: _snap("stored"))
    globe.global_no2(24)
    monkeypatch.setattr(globe, "CACHE_TTL_S", -1)  # expired: would normally refresh
    monkeypatch.setenv("ML_ENGINE_OFFLINE", "true")
    monkeypatch.setattr(globe, "_fetch", lambda hours, res: pytest.fail("offline mode must not call Earth Engine"))
    snap = globe.global_no2(24)
    assert snap["meta"]["fetched_at"] == "stored" and snap["meta"]["frozen"] is True


def test_bundled_demo_when_nothing_is_cached(cache, tmp_path, monkeypatch):
    demo_path = tmp_path / "demo.npz"
    snap = _snap("bundled-day")
    snap["no2"][0, 0] = np.nan
    globe.save_demo(snap, demo_path)
    monkeypatch.setattr(globe, "DEMO_SNAPSHOT", demo_path)
    monkeypatch.setattr(globe, "_fetch", lambda hours, res: (_ for _ in ()).throw(RuntimeError("quota")))
    out = globe.global_no2(24)  # Earth Engine down, empty cache -> bundled snapshot
    assert out["meta"]["demo"] is True and out["meta"]["fetched_at"] == "bundled-day"
    assert np.isnan(out["no2"][0, 0]) and np.allclose(out["no2"][0, 1:], 5.0)
    monkeypatch.setenv("ML_ENGINE_OFFLINE", "true")
    assert globe.global_no2(24)["meta"]["demo"] is True  # offline with an empty cache


def test_shipped_demo_snapshot_loads():
    demo = globe.load_demo()
    assert demo is not None, "ml_engine/pretrained/globe_demo_snapshot.npz is missing"
    assert demo["no2"].shape == (360, 720) and 0.2 < np.isfinite(demo["no2"]).mean() < 0.9


def test_block_mean_is_a_true_cell_average():
    fine = np.full((10, 10), np.nan, np.float32)
    fine[0:5, 0:5] = 2.0
    fine[0, 0] = 100.0  # a sharp plume inside the first cell is averaged in, not sampled or dropped
    fine[5, 5] = 7.0  # a single clear pixel is not enough to stand for a whole cell
    fine[0:5, 5:8] = 4.0  # 15 of 25 clear: mean of the clear ones
    out = globe._block_mean(fine, 5, min_valid=3)
    assert out.shape == (2, 2)
    np.testing.assert_allclose(out[0, 0], (24 * 2.0 + 100.0) / 25)
    np.testing.assert_allclose(out[0, 1], 4.0)
    assert np.isnan(out[1, 1]) and np.isnan(out[1, 0])


def test_payload_keeps_city_peaks():
    snap = _snap("x")
    snap["no2"][0, 0] = 512.3  # above the old ±327 int16 range
    field = globe.payload(snap)["fields"]["no2"]
    import base64

    q = np.frombuffer(base64.b64decode(field["data"]), "<i2")
    assert abs(q[0] * field["scale"] - 512.3) <= field["scale"] / 2 + 1e-6
