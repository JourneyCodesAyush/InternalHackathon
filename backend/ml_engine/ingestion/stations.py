"""Ground monitoring stations (e.g. CPCB CAAQMS) and vector road layers."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from rasterio import features
from scipy import ndimage

from ..grid import GridSpec

STATION_COLUMNS = ["station_id", "lat", "lon", "date", "no2"]


def load_stations_csv(path: str | Path) -> pd.DataFrame:
    """Load daily station NO2.

    Required columns: ``station_id, lat, lon, date, no2`` (no2 in ug/m^3, date as YYYY-MM-DD).
    Optional: ``name``. Hourly CPCB exports can be passed as well - they are averaged to daily means.
    """
    df = pd.read_csv(path)
    df.columns = [c.strip().lower() for c in df.columns]
    missing = [c for c in STATION_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Station file {path} is missing columns: {missing}")
    df["date"] = pd.to_datetime(df["date"]).dt.normalize()
    df["no2"] = pd.to_numeric(df["no2"], errors="coerce")
    df = df.dropna(subset=["lat", "lon", "no2"])
    df = df[(df["no2"] >= 0) & (df["no2"] < 1000)]  # drop sensor faults / sentinel values
    group = ["station_id", "date"]
    agg = {"lat": "first", "lon": "first", "no2": "mean"}
    if "name" in df.columns:
        agg["name"] = "first"
    return df.groupby(group, as_index=False).agg(agg)


def quality_control(df: pd.DataFrame, min_cv: float = 0.10, min_days: int = 15,
                    low_fraction: float = 0.25) -> tuple[pd.DataFrame, dict]:
    """Remove stuck-analyser data from daily station NO2.

    * Row level: a day identical (+-0.05 ug/m^3) to the previous valid day is a frozen reading.
    * Station level: drop stations whose coefficient of variation is below ``min_cv`` (a flat line
      over weeks is not physically plausible for urban NO2) or with fewer than ``min_days`` days left.
    * Stations whose mean is below ``low_fraction`` x the network median are only *flagged*: low values
      can be genuine (e.g. a station inside a national park).
    """
    df = df.sort_values(["station_id", "date"]).copy()
    frozen = df.groupby("station_id")["no2"].diff().abs() < 0.05
    cleaned = df[~frozen]
    stats = cleaned.groupby("station_id")["no2"].agg(["count", "mean", "std"])
    stats["cv"] = stats["std"] / stats["mean"]
    network_median = float(stats["mean"].median())
    dropped = {}
    for sid, row in stats.iterrows():
        if row["count"] < min_days:
            dropped[sid] = f"only {int(row['count'])} valid days"
        elif row["cv"] < min_cv:
            dropped[sid] = f"flat-lined (CV={row['cv']:.2f})"
    flagged = {sid: f"mean {row['mean']:.1f} vs network median {network_median:.1f}"
               for sid, row in stats.iterrows()
               if sid not in dropped and row["mean"] < low_fraction * network_median}
    out = cleaned[~cleaned["station_id"].isin(dropped)]
    report = {
        "rows_in": int(len(df)), "frozen_rows_removed": int(frozen.sum()), "rows_out": int(len(out)),
        "stations_in": int(df["station_id"].nunique()), "stations_out": int(out["station_id"].nunique()),
        "dropped_stations": dropped, "flagged_low_stations": flagged,
    }
    return out, report


def road_density_from_geojson(path: str | Path, grid: GridSpec, smooth_px: float = 2.0) -> np.ndarray:
    """Rasterise road lines (e.g. an OSM export) into a smoothed 0..1 density surface on ``grid``.

    Features may carry a ``highway`` property; motorway/trunk/primary roads get higher weights because
    they dominate vehicular NOx emissions.
    """
    weights = {"motorway": 3.0, "trunk": 2.5, "primary": 2.0, "secondary": 1.5, "tertiary": 1.0}
    with open(path, encoding="utf-8") as fh:
        gj = json.load(fh)
    feats = gj["features"] if gj.get("type") == "FeatureCollection" else [gj]
    shapes = []
    for f in feats:
        geom = f.get("geometry")
        if not geom or geom["type"] not in ("LineString", "MultiLineString", "Polygon", "MultiPolygon"):
            continue
        cls = str((f.get("properties") or {}).get("highway", "")).lower()
        shapes.append((geom, weights.get(cls, 0.7)))
    if not shapes:
        raise ValueError(f"No line geometries found in {path}")
    raster = features.rasterize(
        shapes, out_shape=grid.shape, transform=grid.transform, fill=0.0, all_touched=True, dtype="float32",
        merge_alg=features.MergeAlg.add,
    )
    dens = ndimage.gaussian_filter(raster.astype(np.float64), smooth_px)
    peak = np.percentile(dens, 99.5)
    return np.clip(dens / peak, 0, 1).astype(np.float32) if peak > 0 else dens.astype(np.float32)
