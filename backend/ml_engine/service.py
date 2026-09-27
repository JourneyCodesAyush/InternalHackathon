"""Programmatic entry points for the web backend (FastAPI services call these instead of the CLI).

* ``generate_map``  -> ``GET /api/v1/downscale/map``: 250 m ground-level NO2 map for an area and date.
* ``forecast_point`` -> ``GET /api/v1/trends/predict``: NO2 and wind at a point over the next hours.

Both are blocking (Earth Engine download + model fitting take ~1-2 min for a new area); call them via
``await asyncio.to_thread(...)`` from async endpoints. Runs are cached on disk per (area, period, product),
so repeated requests for the same area and dates return immediately.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import threading
from datetime import date as date_cls
from datetime import timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr

from .cities import city_bbox, city_table
from .config import PRETRAINED_SURFACE_MODEL, DispersionConfig, PipelineConfig
from .dispersion import AdvectionDiffusionSolver
from .grid import GridSpec, upsample_bilinear
from .pipeline import NO2Pipeline

log = logging.getLogger(__name__)

RUNS_ROOT = Path(os.environ.get("ML_ENGINE_RUNS_DIR", "outputs/runs"))
WINDOW_DAYS = 30  # history the gap-filler and downscaler learn from for each requested date
OFFL_LAG_DAYS = 12  # reprocessed S5P lags ~10 days; newer dates use the near-real-time product
POINT_HALF_SIZE_DEG = 0.12  # forecast area around a point that falls outside every known city
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(key: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(key, threading.Lock())


def _parse_date(value: str | date_cls | None) -> pd.Timestamp:
    if value is None:
        return pd.Timestamp.today().normalize() - timedelta(days=1)
    return pd.Timestamp(value).tz_localize(None).normalize() if pd.Timestamp(value).tzinfo else pd.Timestamp(value).normalize()


def _run(bbox: tuple[float, float, float, float], day: pd.Timestamp, ee_project: str | None,
         source: str = "gee", stations_csv: str | None = None) -> Path:
    """Run (or reuse) the pipeline for the WINDOW_DAYS ending on ``day``; returns the run directory."""
    start = day - timedelta(days=WINDOW_DAYS - 1)
    product = "OFFL" if (pd.Timestamp.today().normalize() - day).days > OFFL_LAG_DAYS else "NRTI"
    bbox = tuple(round(float(v), 3) for v in bbox)
    model_tag = PRETRAINED_SURFACE_MODEL.stat().st_mtime_ns if PRETRAINED_SURFACE_MODEL.exists() else 0
    key = hashlib.sha1(json.dumps([bbox, str(start.date()), str(day.date()), product, source, model_tag,
                                   stations_csv]).encode()).hexdigest()[:16]
    run_dir = RUNS_ROOT / key
    with _lock_for(key):
        if (run_dir / "report.json").exists():
            return run_dir
        cfg = PipelineConfig(bbox=bbox, start_date=str(start.date()), end_date=str(day.date()),
                             output_dir=run_dir, model_dir=run_dir / "models", s5p_product=product)
        if source == "gee" and PRETRAINED_SURFACE_MODEL.exists():
            cfg.surface_model_path = PRETRAINED_SURFACE_MODEL
        log.info("ML engine run %s: bbox=%s %s..%s (%s)", key, bbox, start.date(), day.date(), product)
        NO2Pipeline(cfg).run(source=source, stations_csv=stations_csv, ee_project=ee_project)
    return run_dir


def generate_map(bbox: tuple[float, float, float, float] | None = None, date: str | date_cls | None = None,
                 city: str | None = None, ee_project: str | None = None, source: str = "gee",
                 stations_csv: str | None = None) -> dict:
    """250 m ground-level NO2 map for ``date`` (default: yesterday) over ``bbox`` or ``city``.

    Returns the day's GeoTIFF / GeoJSON paths, the full-period NetCDF, grid metadata and the accuracy
    figures of the models used.
    """
    if (bbox is None) == (city is None):
        raise ValueError("Pass exactly one of bbox or city")
    bbox = city_bbox(city) if city else tuple(bbox)
    day = _parse_date(date)
    run_dir = _run(bbox, day, ee_project or os.environ.get("EE_PROJECT"), source, stations_csv)
    report = json.loads((run_dir / "report.json").read_text())
    daily = report["outputs"]["daily"].get(str(day.date()))
    if daily is None:
        raise RuntimeError(f"Run {run_dir} has no output for {day.date()}")
    fine = report["grids"]["fine"]
    pretrained = report.get("pretrained_surface_model", {})
    return {
        "bbox": list(bbox),
        "date": str(day.date()),
        "crs": fine["crs"],
        "resolution_deg": fine["res"],
        "resolution_m": round(fine["res"] * 111_320 * math.cos(math.radians((bbox[1] + bbox[3]) / 2))),
        "surface_tif": daily["surface_tif"],
        "raw_tif": daily["raw_tif"],
        "gapfilled_tif": daily["gapfilled_tif"],
        "hazard_geojson": daily["hazard_geojson"],
        "surface_netcdf": report["outputs"]["surface_nc"],
        "units": "ug m-3",
        "s5p_product": report["config"]["s5p_product"],
        "metrics": {
            "gapfill_holdout_r2": report["gapfill_holdout"]["all"]["r2"],
            "downscale_holdout_r2": report["downscaler"]["temporal_holdout_coarse"]["r2"],
            "surface_model": pretrained.get("model"),
            "surface_model_validation": _pretrained_validation(),
            "independent_test": pretrained.get("independent_test", {}).get("overall"),
        },
        "run_dir": str(run_dir),
    }


def _pretrained_validation() -> dict | None:
    """Headline validation of the shipped national model (unseen cities / stations+dates / years)."""
    report_path = PRETRAINED_SURFACE_MODEL.with_name(PRETRAINED_SURFACE_MODEL.stem + "_report.json")
    if not report_path.exists():
        return None
    r = json.loads(report_path.read_text())
    sel = r["selected"]
    return {name: {"r2": ev["candidates"][sel]["overall"]["r2"], "rmse_ugm3": ev["candidates"][sel]["overall"]["rmse"],
                   "design": ev["design"]} for name, ev in r["evaluations"].items()}


def _area_for_point(lat: float, lon: float) -> tuple[float, float, float, float]:
    """Reuse the enclosing city's area (shared cache with map requests); otherwise a small box."""
    for row in city_table().sort_values("stations", ascending=False).itertuples():
        west, south, east, north = city_bbox(row.city)
        if west <= lon <= east and south <= lat <= north:
            return west, south, east, north
    h = POINT_HALF_SIZE_DEG
    return (lon - h, lat - h, lon + h, lat + h)


def forecast_point(lat: float, lon: float, hours: int, date: str | date_cls | None = None, step_h: int = 3,
                   ee_project: str | None = None, source: str = "gee") -> dict:
    """NO2 (ug/m^3) and wind at (lat, lon) every ``step_h`` hours up to ``hours`` ahead of ``date``'s map.

    The day's 250 m surface map is advected with that day's ERA5 overpass-hour wind by the physics solver
    (advection + eddy diffusion + chemical decay, persistent emissions). ``wind_direction`` follows the
    meteorological convention (degrees the wind blows *from*). ``confidence`` is indicative: the shipped
    model's median day-to-day correlation at unseen stations, decaying with lead time (e-folding 24 h).
    """
    if hours <= 0 or hours % step_h:
        raise ValueError(f"hours must be a positive multiple of {step_h}")
    day = _parse_date(date)
    bbox = _area_for_point(lat, lon)
    run_dir = _run(bbox, day, ee_project or os.environ.get("EE_PROJECT"), source)
    report = json.loads((run_dir / "report.json").read_text())
    fine = GridSpec(**report["grids"]["fine"])
    factor = report["config"]["refine_factor"]

    surface = xr.load_dataset(run_dir / "no2_surface_fine.nc", engine="h5netcdf")["no2_surface"].sel(
        time=str(day.date())).squeeze()
    coarse = xr.load_dataset(run_dir / "coarse_raw.nc", engine="h5netcdf").sel(time=str(day.date())).squeeze()
    u = upsample_bilinear(coarse["u10"].values.astype(np.float64), factor)
    v = upsample_bilinear(coarse["v10"].values.astype(np.float64), factor)
    horizons = list(range(step_h, hours + 1, step_h))
    solver = AdvectionDiffusionSolver(fine, DispersionConfig(horizons_h=tuple(float(h) for h in horizons)))
    forecast = solver.forecast(surface.values, u, v)

    row, col, inside = fine.index_of(np.array([lon]), np.array([lat]))
    if not inside[0]:
        raise ValueError("Point lies outside the modelled area")
    r, c = int(row[0]), int(col[0])
    speed = float(np.hypot(u[r, c], v[r, c]))
    wind_from = float((math.degrees(math.atan2(-u[r, c], -v[r, c])) + 360) % 360)
    base_skill = _base_temporal_skill()
    predictions = [{
        "hour": h,
        "no2_concentration": round(float(forecast.sel(horizon_h=float(h)).values[r, c]), 2),
        "wind_speed": round(speed, 2),
        "wind_direction": round(wind_from, 1),
        "confidence": round(max(0.0, base_skill * math.exp(-h / 24.0)), 2),
    } for h in horizons]
    return {"lat": lat, "lon": lon, "hours": hours, "base_date": str(day.date()),
            "current_no2": round(float(surface.values[r, c]), 2), "predictions": predictions}


def _base_temporal_skill() -> float:
    report_path = PRETRAINED_SURFACE_MODEL.with_name(PRETRAINED_SURFACE_MODEL.stem + "_report.json")
    try:
        r = json.loads(report_path.read_text())
        return float(r["evaluations"]["unseen_cities"]["candidates"][r["selected"]]["median_within_station_r"])
    except (OSError, KeyError, ValueError):
        return 0.5
