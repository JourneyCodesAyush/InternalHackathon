"""Satellite NO2 input from local GeoTIFF files (instead of downloading Sentinel-5P from Earth Engine).

One GeoTIFF per day, all on the same grid, each named with its date (``..._2025-11-24.tif`` or inside a
``2025-11-24/`` folder). Values are the tropospheric NO2 column in umol/m^2 (mol/m^2 is detected and
converted); cloud-covered pixels are no-data / NaN. Days missing from the folder become fully cloudy
days, which the gap-filler handles. Weather and land-use layers are still fetched from Earth Engine for
the files' area and dates.
"""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio

from ..config import COLUMN_SCALE
from ..grid import GridSpec

DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")


def _date_of(path: Path) -> pd.Timestamp:
    hits = DATE_RE.findall(str(path))
    if not hits:
        raise ValueError(f"{path}: no YYYY-MM-DD date in the file or folder name")
    return pd.Timestamp(hits[-1])


def load_no2_geotiffs(input_dir: str | Path) -> tuple[pd.DatetimeIndex, np.ndarray, GridSpec]:
    """Return (daily dates, NO2 column (time, y, x) in umol/m^2 with NaN for clouds, grid)."""
    paths = sorted(p for p in Path(input_dir).rglob("*") if p.suffix.lower() in (".tif", ".tiff"))
    if not paths:
        raise FileNotFoundError(f"No GeoTIFF files in {input_dir}")
    layers: dict[pd.Timestamp, np.ndarray] = {}
    ref = None
    for path in paths:
        with rasterio.open(path) as src:
            if src.crs is None or src.crs.to_epsg() != 4326:
                raise ValueError(f"{path}: expected EPSG:4326 (lat/lon), got {src.crs}")
            if ref is None:
                ref = (src.transform, src.shape)
                units = (src.tags().get("units") or "").lower()
            elif (src.transform, src.shape) != ref:
                raise ValueError(f"{path}: grid differs from {paths[0].name}; all days must share one grid")
            data = src.read(1, masked=True).astype(np.float32).filled(np.nan)
        day = _date_of(path)
        if day in layers:
            raise ValueError(f"Two files for {day.date()}")
        layers[day] = data

    transform, (height, width) = ref
    res_x, res_y = transform.a, -transform.e
    if not np.isclose(res_x, res_y, rtol=1e-3):
        raise ValueError(f"Pixels must be square in degrees, got {res_x} x {res_y}")
    grid = GridSpec(west=transform.c, north=transform.f, res=float(res_x), width=width, height=height)

    dates = pd.date_range(min(layers), max(layers), freq="D")
    stack = np.full((len(dates), height, width), np.nan, dtype=np.float32)
    for i, day in enumerate(dates):
        if day in layers:
            stack[i] = layers[day]
    finite = stack[np.isfinite(stack)]
    in_mol = "umol" not in units and ("mol" in units or (finite.size and np.nanmedian(np.abs(finite)) < 0.01))
    if in_mol:
        stack *= COLUMN_SCALE
    return dates, stack, grid
