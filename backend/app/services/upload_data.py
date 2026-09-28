"""The uploaded daily NO2 GeoTIFFs (backend/data/test_data), read the same way the Plume Flow endpoints read
them (``GET /downscale/dates``, ``GET /downscale/geotiff?timestamp=``), for the home page's pinpoint card and
the area reports."""

from __future__ import annotations

import math
import re
from pathlib import Path

import numpy as np
import rasterio


def data_dir() -> Path:
    for candidate in (Path("data/test_data"), Path("backend/data/test_data")):
        if candidate.exists():
            return candidate
    return Path("data/test_data")


def available_dates() -> list[str]:
    dates = set()
    for file in data_dir().glob("*.tif"):
        match = re.search(r"(\d{4}-\d{2}-\d{2})", file.name)
        if match:
            dates.add(match.group(1))
    return sorted(dates)


def read_day(date: str) -> tuple[np.ndarray, rasterio.Affine, str]:
    """(values, transform, date used) for one day; clouds filled with the day's mean like the plume stream."""
    path = data_dir() / f"no2_raw_coarse_{date}.tif"
    if not path.exists():
        files = sorted(data_dir().glob("*.tif"))
        if not files:
            raise FileNotFoundError("No uploaded GeoTIFF data found")
        path = files[0]
    with rasterio.open(path) as src:
        arr = src.read(1).astype(np.float32)
        transform = src.transform
    if np.isnan(arr).all():
        arr = np.full_like(arr, 45.0)
    elif np.isnan(arr).any():
        arr = np.nan_to_num(arr, nan=float(np.nanmean(arr)))
    used = re.search(r"(\d{4}-\d{2}-\d{2})", path.name)
    return arr, transform, used.group(1) if used else date


def plume_wind(hours: float, shape: tuple[int, int]) -> tuple[np.ndarray, np.ndarray]:
    """The diurnal wind the Plume Flow stream uses at ``hours`` after midnight (m/s, east/north)."""
    rad = (hours / 24.0) * 2.0 * np.pi
    return (np.full(shape, 4.5 + 2.5 * np.cos(rad), np.float32), np.full(shape, 3.0 + 1.8 * np.sin(rad), np.float32))


def compass(deg: float) -> str:
    names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    return names[int(((deg % 360) + 22.5) // 45) % 8]


def point_forecast(lat: float, lon: float, date: str, horizons_h: tuple[int, ...] = (3, 6, 12, 24)) -> dict:
    """NO2 at the point from that day's upload, and the forecasting model's predictions from it (hybrid
    physics + AI residual) under the Plume Flow wind cycle. ``inside`` is False when the point is outside the
    uploaded area (values are then from the nearest cell)."""
    from ml_engine.forecasting.config import ForecastConfig, PhysicsConfig
    from ml_engine.forecasting.engine import ForecastEngine

    arr, t, used = read_day(date)
    h, w = arr.shape
    y = (t.f + t.e * (np.arange(h) + 0.5)).astype(np.float32)
    x = (t.c + t.a * (np.arange(w) + 0.5)).astype(np.float32)
    col, row = ~t * (lon, lat)
    inside = 0 <= row < h and 0 <= col < w
    j, i = min(max(int(row), 0), h - 1), min(max(int(col), 0), w - 1)

    step_h = 3
    cfg = ForecastConfig()
    cfg.physics = PhysicsConfig(export_interval_min=step_h * 60, max_horizon_min=max(horizons_h) * 60)
    winds = [plume_wind(hr, arr.shape) for hr in range(max(horizons_h) + 1)]
    result = ForecastEngine(cfg).predict(arr, winds[0][0], winds[0][1], y, x, wind_sequence=winds)
    by_h = {m // 60: k for k, m in enumerate(result.horizons_min)}

    u0, v0 = float(winds[0][0][0, 0]), float(winds[0][1][0, 0])
    wind_from = (math.degrees(math.atan2(-u0, -v0)) + 360) % 360
    return {
        "date": used,
        "inside": inside,
        "value": round(float(arr[j, i]), 1),
        "horizons": [{"hours": hr, "no2": round(float(result.no2_hybrid[by_h[hr]][j, i]), 1),
                      "confidence": round(float(result.confidence[by_h[hr]][j, i]), 2)}
                     for hr in horizons_h if hr in by_h],
        "wind": {"speed": round(math.hypot(u0, v0), 1), "deg": round(wind_from), "direction": compass(wind_from)},
    }
