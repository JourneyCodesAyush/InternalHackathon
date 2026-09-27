"""Fast unit tests for grid maths, dispersion physics, station handling and city lookup."""

import numpy as np
import pandas as pd
import pytest
from openpyxl import Workbook

from ml_engine.cities import city_bbox, city_of
from ml_engine.config import DispersionConfig
from ml_engine.dispersion import AdvectionDiffusionSolver
from ml_engine.grid import GridSpec, block_mean, fill_nan_nearest, upsample_bilinear
from ml_engine.ingestion import load_stations_csv, quality_control
from ml_engine.ingestion.cpcb import convert, parse_report


# ------------------------------------------------------------------------------------------------ grid
def test_grid_refine_nests_exactly():
    coarse = GridSpec.from_bbox((72.77, 18.88, 73.12, 19.32), 0.035)
    fine = coarse.refine(14)
    assert fine.shape == (coarse.height * 14, coarse.width * 14)
    assert fine.bbox == pytest.approx(coarse.bbox)


def test_block_mean_and_upsample_preserve_mean():
    rng = np.random.default_rng(0)
    coarse = rng.random((5, 6))
    fine = upsample_bilinear(coarse, 4)
    assert fine.shape == (20, 24)
    assert block_mean(fine, 4).mean() == pytest.approx(coarse.mean(), rel=0.05)


def test_block_mean_ignores_nan():
    a = np.array([[1.0, np.nan], [3.0, np.nan]])
    assert block_mean(a, 2)[0, 0] == pytest.approx(2.0)


def test_fill_nan_nearest_leaves_no_gaps():
    a = np.full((4, 4), np.nan)
    a[0, 0] = 5.0
    assert np.all(fill_nan_nearest(a) == 5.0)


# ------------------------------------------------------------------------------------------------ dispersion
def test_puff_moves_with_wind_and_conserves_mass():
    grid = GridSpec.from_bbox((72.8, 18.9, 73.2, 19.3), 0.0025)
    c0 = np.zeros(grid.shape)
    c0[80, 80] = 1000.0
    solver = AdvectionDiffusionSolver(grid, DispersionConfig(lifetime_h=1e9, emission_mode="none"))
    out = solver.forecast(c0, 3.0, 2.0, [1.0]).sel(horizon_h=1.0).values
    rows, cols = np.mgrid[0:grid.height, 0:grid.width]
    dx, dy = grid.pixel_size_m()
    east_km = ((out * cols).sum() / out.sum() - 80) * dx / 1000
    north_km = -((out * rows).sum() / out.sum() - 80) * dy / 1000
    assert east_km == pytest.approx(3.0 * 3.6, abs=0.3)  # 3 m/s for one hour
    assert north_km == pytest.approx(2.0 * 3.6, abs=0.3)
    assert out.sum() == pytest.approx(1000.0, rel=1e-3)


def test_persistent_emissions_keep_calm_field_steady():
    grid = GridSpec.from_bbox((72.8, 18.9, 72.9, 19.0), 0.0025)
    c0 = np.full(grid.shape, 30.0)
    out = AdvectionDiffusionSolver(grid, DispersionConfig()).forecast(c0, 0.0, 0.0, [6.0]).values[0]
    assert np.allclose(out, 30.0, atol=1e-6)


# ------------------------------------------------------------------------------------------------ stations
def _hourly_csv(path, rows):
    pd.DataFrame(rows).to_csv(path, index=False)
    return path


def test_loader_uses_overpass_window_and_completeness(tmp_path):
    rows = [{"station_id": "A", "lat": 19.0, "lon": 72.9, "date": f"2025-12-01 {h:02d}:00",
             "no2": 100 if 12 <= h < 16 else 10} for h in range(24)]
    rows += [{"station_id": "A", "lat": 19.0, "lon": 72.9, "date": f"2025-12-02 {h:02d}:00", "no2": 50}
             for h in (12, 13)]  # only 2 of 4 window hours -> incomplete day
    path = _hourly_csv(tmp_path / "h.csv", rows)
    df = load_stations_csv(path)
    assert df["date"].dt.day.tolist() == [1]
    assert df["no2"].tolist() == [100.0]
    assert load_stations_csv(path, None).loc[0, "no2"] == pytest.approx(25.0)


def _daily(station, lat, lon, values):
    return [{"station_id": station, "lat": lat, "lon": lon, "date": d, "no2": v}
            for d, v in zip(pd.date_range("2025-11-01", periods=len(values)), values)]


def test_quality_control_drops_faulty_stations():
    rng = np.random.default_rng(1)
    good = lambda m: list(m + 10 * rng.standard_normal(40))
    rows = (_daily("GOOD1", 19.00, 72.80, good(40)) + _daily("GOOD2", 19.20, 72.95, good(45))
            + _daily("GOOD3", 18.95, 73.05, good(38))
            + _daily("FLAT", 19.10, 72.90, [30.0 + 0.1 * (i % 2) for i in range(40)])
            + _daily("LOW", 19.30, 73.00, list(np.abs(3 + rng.standard_normal(40))))
            + _daily("NEIGHBOUR", 19.003, 72.803, list(np.abs(11 + 3 * rng.standard_normal(40)))))
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    kept, report = quality_control(df)
    assert set(kept["station_id"]) == {"GOOD1", "GOOD2", "GOOD3"}
    assert {"FLAT", "LOW", "NEIGHBOUR"} <= set(report["dropped_stations"])


def _cpcb_report(path, station, rows):
    wb = Workbook()
    ws = wb.active
    for r in [["CENTRAL POLLUTION CONTROL BOARD"], ["State", None, "Maharashtra"], ["City", None, "Mumbai"],
              ["Station", None, station], ["Parameter", None, "NO2"], ["AvgPeriod", None, "24H"],
              ["From Date", "To Date", "NO2"], *rows]:
        ws.append(r)
    wb.save(path)


def test_cpcb_converter_matches_coordinates(tmp_path):
    raw = tmp_path / "raw"
    raw.mkdir()
    _cpcb_report(raw / "r1.xlsx", "Bandra, Mumbai - MPCB",
                 [["01-11-2025 00:00", "02-11-2025 00:00", 41.5], ["02-11-2025 00:00", "03-11-2025 00:00", "NA"]])
    _cpcb_report(raw / "r2.xlsx", "Alipur, Delhi - DPCC", [["01-11-2025 00:00", "02-11-2025 00:00", 60.0]])
    meta, df = parse_report(raw / "r1.xlsx")
    assert meta["station"] == "Bandra, Mumbai - MPCB" and len(df) == 1
    coords = tmp_path / "coords.csv"
    pd.DataFrame({"station_name": ["Bandra, Mumbai - MPCB"], "lat": [19.06], "lon": [72.85]}).to_csv(coords, index=False)
    out = convert(raw, coords, tmp_path / "out.csv")
    assert out["name"].unique().tolist() == ["Bandra, Mumbai - MPCB"]  # Delhi report skipped: no coordinates


# ------------------------------------------------------------------------------------------------ cities
@pytest.mark.parametrize("station,city", [
    ("Bandra, Mumbai - MPCB", "Mumbai"), ("Sector - 125, Noida - UPPCB", "Noida"),
    ("Collectorate - Gaya - BSPCB", "Gaya"),
])
def test_city_of(station, city):
    assert city_of(station) == city


def test_city_bbox_aliases_and_errors():
    assert city_bbox("Bombay") == city_bbox("Mumbai")
    west, south, east, north = city_bbox("Pune")
    assert west < 73.86 < east and south < 18.52 < north
    with pytest.raises(KeyError, match="Mumbai"):
        city_bbox("Mumbia")


# ------------------------------------------------------------------------------------------------ file input
def _write_tif(path, data, units="umol m-2"):
    import rasterio
    from rasterio.transform import from_origin

    with rasterio.open(path, "w", driver="GTiff", height=data.shape[0], width=data.shape[1], count=1,
                       dtype="float32", crs="EPSG:4326", transform=from_origin(72.8, 19.1, 0.035, 0.035),
                       nodata=float("nan")) as dst:
        dst.write(data.astype("float32"), 1)
        dst.update_tags(units=units)


def test_geotiff_folder_input(tmp_path):
    from ml_engine.ingestion.files import load_no2_geotiffs

    a = np.full((4, 5), 120.0)
    a[0, 0] = np.nan  # a cloudy pixel
    _write_tif(tmp_path / "no2_2025-11-01.tif", a)
    _write_tif(tmp_path / "no2_2025-11-03.tif", a)  # 2 Nov missing -> a fully cloudy day
    dates, stack, grid = load_no2_geotiffs(tmp_path)
    assert [str(d.date()) for d in dates] == ["2025-11-01", "2025-11-02", "2025-11-03"]
    assert stack.shape == (3, 4, 5) and np.isnan(stack[1]).all() and np.isnan(stack[0, 0, 0])
    assert grid.res == pytest.approx(0.035) and grid.west == pytest.approx(72.8)


def test_geotiff_input_converts_mol_per_m2(tmp_path):
    from ml_engine.ingestion.files import load_no2_geotiffs

    _write_tif(tmp_path / "day_2025-11-01.tif", np.full((3, 3), 1.2e-4), units="mol m-2")
    _, stack, _ = load_no2_geotiffs(tmp_path)
    assert stack[0, 0, 0] == pytest.approx(120.0, rel=1e-4)
