"""End-to-end checks on a small synthetic scene (no Earth Engine needed, ~1 minute)."""

import json
from pathlib import Path

import numpy as np
import pytest
import rasterio

from ml_engine import service
from ml_engine.config import PipelineConfig
from ml_engine.pipeline import NO2Pipeline

SMALL_BBOX = (72.80, 18.95, 72.975, 19.125)  # 5 x 5 coarse cells


@pytest.fixture(scope="module")
def synthetic_run(tmp_path_factory):
    out = tmp_path_factory.mktemp("run")
    cfg = PipelineConfig(bbox=SMALL_BBOX, start_date="2025-11-01", end_date="2025-11-14", output_dir=out,
                         model_dir=out / "models")
    return NO2Pipeline(cfg).run(source="synthetic"), out


def test_gapfill_leaves_no_nan(synthetic_run):
    res, _ = synthetic_run
    assert res.report["gapfill"]["nan_fraction_out"] == 0.0
    assert np.isfinite(res.gapfilled["no2"].values).all()


def test_outputs_are_written(synthetic_run):
    res, out = synthetic_run
    assert json.loads((out / "report.json").read_text())["source"] == "synthetic"
    daily = res.outputs["daily"]
    assert len(daily) == 14
    with rasterio.open(daily["2025-11-14"]["surface_tif"]) as src:
        assert src.crs.to_string() == "EPSG:4326"
        assert src.read(1).shape == (70, 70)  # 5 coarse cells x 14 refinement
    with rasterio.open(res.outputs["forecast_tif"]) as src:
        assert src.count == 3  # +1 h, +3 h, +6 h


def test_service_map_and_forecast(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "RUNS_ROOT", Path(tmp_path))
    monkeypatch.setattr(service, "WINDOW_DAYS", 10)
    monkeypatch.setattr(service, "_area_for_point", lambda lat, lon: SMALL_BBOX)
    m = service.generate_map(bbox=SMALL_BBOX, date="2025-11-20", source="synthetic")
    assert Path(m["surface_tif"]).exists() and m["units"] == "ug m-3"
    assert 200 < m["resolution_m"] < 300
    f = service.forecast_point(19.05, 72.88, 12, date="2025-11-20", source="synthetic")
    assert [p["hour"] for p in f["predictions"]] == [3, 6, 9, 12]
    assert all(p["no2_concentration"] >= 0 and 0 <= p["confidence"] <= 1 for p in f["predictions"])
    with pytest.raises(ValueError):
        service.forecast_point(19.05, 72.88, 5, date="2025-11-20", source="synthetic")
