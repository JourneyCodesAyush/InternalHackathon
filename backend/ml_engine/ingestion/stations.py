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


def load_stations_csv(path: str | Path, hours: tuple[int, int] | None = (12, 16),
                      min_completeness: float = 0.75) -> pd.DataFrame:
    """Load station NO2 as one value per station-day.

    Required columns: ``station_id, lat, lon, date, no2`` (no2 in ug/m^3). ``date`` is YYYY-MM-DD for daily
    data or ``YYYY-MM-DD HH:MM`` (local time, start of the averaging hour) for hourly data. Optional: ``name``.

    Hourly data is averaged over ``hours`` = [start, end) local time only, matching the ~13:30 local solar
    time Sentinel-5P overpass instead of a 24 h mean the satellite never sees; ``None`` averages the whole day.
    Daily data is used as is. A day from hourly data is kept only if at least ``min_completeness`` of the
    window's hours are present (the 75% validity rule used by EPA / CPCB for averaged concentrations).
    """
    df = pd.read_csv(path)
    df.columns = [c.strip().lower() for c in df.columns]
    missing = [c for c in STATION_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Station file {path} is missing columns: {missing}")
    stamp = pd.to_datetime(df["date"])
    df["no2"] = pd.to_numeric(df["no2"], errors="coerce")
    hourly = bool((stamp.dt.hour != 0).any())
    if hourly and hours is not None:
        keep = (stamp.dt.hour >= hours[0]) & (stamp.dt.hour < hours[1])
        df, stamp = df[keep], stamp[keep]
    df["date"] = stamp.dt.normalize()
    df = df.dropna(subset=["lat", "lon", "no2"])
    df = df[(df["no2"] >= 0) & (df["no2"] < 1000)]  # drop sensor faults / sentinel values
    group = ["station_id", "date"]
    agg = {"lat": "first", "lon": "first", "no2": "mean"}
    if "name" in df.columns:
        agg["name"] = "first"
    daily = df.groupby(group, as_index=False).agg(agg)
    if hourly:
        expected = (hours[1] - hours[0]) if hours is not None else 24
        counts = df.groupby(group)["no2"].count().to_numpy()
        daily = daily[counts >= np.ceil(min_completeness * expected)]
    return daily


def quality_control(df: pd.DataFrame, min_cv: float = 0.10, min_days: int = 15, low_fraction: float = 0.25,
                    neighbour_km: float = 2.0, neighbour_ratio: float = 3.0) -> tuple[pd.DataFrame, dict]:
    """Remove faulty-analyser data from daily station NO2.

    * Row level: a day identical (+-0.05 ug/m^3) to the previous valid day is a frozen reading.
    * Station level, dropped when:
      - fewer than ``min_days`` valid days remain, or the coefficient of variation is below ``min_cv``
        (a flat line over weeks is not physically plausible for urban NO2);
      - the station median is below ``low_fraction`` x the network median of station medians
        (failing chemiluminescence analysers drift towards zero);
      - a station within ``neighbour_km`` reads ``neighbour_ratio`` times higher - urban NO2 cannot differ
        several-fold over ~1 km, so the lower (drifting) instrument is removed.
    """
    df = df.sort_values(["station_id", "date"]).copy()
    frozen = df.groupby("station_id")["no2"].diff().abs() < 0.05
    cleaned = df[~frozen]
    stats = cleaned.groupby("station_id").agg(count=("no2", "count"), mean=("no2", "mean"), std=("no2", "std"),
                                               median=("no2", "median"), lat=("lat", "first"), lon=("lon", "first"))
    stats["cv"] = stats["std"] / stats["mean"]
    dropped: dict[str, str] = {}
    for sid, row in stats.iterrows():
        if row["count"] < min_days:
            dropped[sid] = f"only {int(row['count'])} valid days"
        elif row["cv"] < min_cv:
            dropped[sid] = f"flat-lined (CV={row['cv']:.2f})"

    alive = stats.drop(index=list(dropped))
    network_median = float(alive["median"].median()) if len(alive) else float("nan")
    for sid, row in alive.iterrows():
        if row["median"] < low_fraction * network_median:
            dropped[sid] = f"implausibly low (median {row['median']:.1f} vs network {network_median:.1f})"

    alive = stats.drop(index=list(dropped))
    ids = list(alive.index)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            ra, rb = alive.loc[a], alive.loc[b]
            km = float(np.hypot((ra.lat - rb.lat) * 110.57, (ra.lon - rb.lon) * 111.32 * np.cos(np.radians(ra.lat))))
            if km > neighbour_km:
                continue
            lo, hi = (a, b) if ra["median"] < rb["median"] else (b, a)
            if alive.loc[hi, "median"] > neighbour_ratio * alive.loc[lo, "median"] and lo not in dropped:
                dropped[lo] = (f"inconsistent with {hi} {km:.1f} km away "
                               f"(median {alive.loc[lo, 'median']:.1f} vs {alive.loc[hi, 'median']:.1f})")

    out = cleaned[~cleaned["station_id"].isin(dropped)]
    report = {
        "rows_in": int(len(df)), "frozen_rows_removed": int(frozen.sum()), "rows_out": int(len(out)),
        "stations_in": int(df["station_id"].nunique()), "stations_out": int(out["station_id"].nunique()),
        "network_median_ugm3": network_median, "dropped_stations": dropped,
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
