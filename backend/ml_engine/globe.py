"""Global near-real-time NO2 for the 3-D globe page.

Sentinel-5P passes over each place once a day (~13:30 local time) and its near-real-time (NRTI) product
reaches Earth Engine ~3 hours after sensing, so "the last two hours" of data does not exist yet anywhere.
The globe instead shows, for every cell, the **most recent cloud-free observation of the last
``hours`` hours** (default 24, which covers the sunlit globe once), with the observation age per cell so
the page can highlight the newest orbit swaths. Winds are the latest NOAA GFS analysis (10 m, 0.25°),
used by the browser to animate wind-driven drift.

Values are tropospheric NO2 columns (µmol/m²) straight from the satellite: the ground-level model is
trained for India only, so it is not applied globally.

    from ml_engine.globe import global_no2
    snap = global_no2()            # cached for CACHE_TTL_S; the last good snapshot is served if EE fails

If Earth Engine fails and nothing is cached (e.g. a fresh machine), a real snapshot bundled with the code
(``DEMO_SNAPSHOT``, refresh with ``python -m ml_engine.globe --save-demo``) is served with ``meta.demo``.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .config import PRETRAINED_SURFACE_MODEL
from .env import offline, setting

log = logging.getLogger(__name__)

NRTI_COLLECTION = "COPERNICUS/S5P/NRTI/L3_NO2"
NO2_BAND = "tropospheric_NO2_column_number_density"
GFS_COLLECTION = "NOAA/GFS0P25"
MAX_CLOUD_FRACTION = 0.3
RES_DEG = 0.5  # 720 x 360 cells: ~2 MB per snapshot, fetched in ~7 s
CACHE_TTL_S = 20 * 60  # new NRTI granules arrive every ~100 min (one orbit)
NODATA = -9999.0
CACHE_DIR = Path(setting("ML_ENGINE_GLOBE_CACHE", "cache/globe"))
DEMO_SNAPSHOT = PRETRAINED_SURFACE_MODEL.parent / "globe_demo_snapshot.npz"  # int16-quantised, ~0.7 MB
DEMO_SCALE = 0.01
_lock = threading.Lock()


def _grid(res: float) -> dict:
    return {"dimensions": {"width": int(round(360 / res)), "height": int(round(180 / res))},
            "affineTransform": {"scaleX": res, "shearX": 0, "translateX": -180.0,
                                "shearY": 0, "scaleY": -res, "translateY": 90.0},
            "crsCode": "EPSG:4326"}


def _fetch(hours: int, res: float) -> dict:
    """One Earth Engine request: latest-on-top mosaic of NRTI NO2 + its sensing time + GFS 10 m wind."""
    import ee

    from .ingestion.gee import initialize

    initialize()
    now_ms = int(time.time() * 1000)
    now = ee.Date(now_ms)
    granules = ee.ImageCollection(NRTI_COLLECTION).filterDate(now.advance(-hours, "hour"), now)

    def prep(img):
        clear = img.select("cloud_fraction").lt(MAX_CLOUD_FRACTION)
        no2 = img.select(NO2_BAND).multiply(1e6).rename("no2").updateMask(clear)  # mol/m² -> µmol/m²
        minutes = ee.Image.constant(img.date().millis().divide(60_000)).toFloat().rename("t_min").updateMask(no2.mask())
        return no2.addBands(minutes).set("system:time_start", img.get("system:time_start"))

    mosaic = granules.map(prep).sort("system:time_start").mosaic()  # newest granule on top
    gfs = (ee.ImageCollection(GFS_COLLECTION).filter(ee.Filter.eq("forecast_hours", 0))
           .filterDate(now.advance(-2, "day"), now).sort("system:time_start", False).first())
    wind = gfs.select(["u_component_of_wind_10m_above_ground", "v_component_of_wind_10m_above_ground"], ["u", "v"])
    image = mosaic.addBands(wind).unmask(NODATA).toFloat()
    arr = ee.data.computePixels({"expression": image, "fileFormat": "NUMPY_NDARRAY", "grid": _grid(res)})
    gfs_ms = gfs.get("system:time_start").getInfo()

    no2 = np.where(arr["no2"] > NODATA / 2, arr["no2"], np.nan).astype(np.float32)
    t_min = np.where(arr["t_min"] > NODATA / 2, arr["t_min"], np.nan)
    age_h = ((now_ms / 60_000 - t_min) / 60.0).astype(np.float32)
    u = np.nan_to_num(arr["u"], nan=0.0).astype(np.float32)
    v = np.nan_to_num(arr["v"], nan=0.0).astype(np.float32)
    u[arr["u"] <= NODATA / 2] = 0.0
    v[arr["v"] <= NODATA / 2] = 0.0
    valid = np.isfinite(no2)
    return {
        "no2": no2, "age_h": age_h, "u": u, "v": v,
        "meta": {
            "fetched_at": _iso(now_ms), "hours": hours, "res_deg": res,
            "width": int(no2.shape[1]), "height": int(no2.shape[0]), "west": -180.0, "north": 90.0,
            "units": "µmol/m²", "quantity": "Sentinel-5P tropospheric NO2 column (NRTI)",
            "newest_obs": _iso(now_ms - float(np.nanmin(age_h)) * 3_600_000) if valid.any() else None,
            "oldest_obs": _iso(now_ms - float(np.nanmax(age_h)) * 3_600_000) if valid.any() else None,
            "coverage": round(float(valid.mean()), 3),
            "wind_analysis": _iso(gfs_ms) if gfs_ms else None,
            "wind_source": "NOAA GFS 0.25° analysis, 10 m",
            "stale": False,
        },
    }


def _iso(ms: float) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%MZ")


def _paths(hours: int, res: float) -> tuple[Path, Path]:
    stem = f"no2_{hours}h_{res:g}deg"
    return CACHE_DIR / f"{stem}.npz", CACHE_DIR / f"{stem}.json"


def _save(snap: dict, hours: int, res: float) -> None:
    data, meta = _paths(hours, res)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    # write to temporary files and swap them in, so a request never reads a half-written snapshot
    tmp_data = data.with_name(data.stem + ".tmp.npz")
    tmp_meta = meta.with_name(meta.name + ".tmp")
    np.savez_compressed(tmp_data, **{k: snap[k] for k in ("no2", "age_h", "u", "v")})
    tmp_meta.write_text(json.dumps(snap["meta"]))
    os.replace(tmp_data, data)
    os.replace(tmp_meta, meta)


def _load(hours: int, res: float) -> tuple[dict, float] | None:
    data, meta = _paths(hours, res)
    if not (data.exists() and meta.exists()):
        return None
    with np.load(data) as z:
        snap = {k: z[k] for k in ("no2", "age_h", "u", "v")}
    snap["meta"] = json.loads(meta.read_text())
    return snap, data.stat().st_mtime


def save_demo(snap: dict, path: Path | None = None) -> None:
    """Store ``snap`` as the bundled fallback (int16 at 0.01 resolution, NaN -> -32768)."""
    path = path or DEMO_SNAPSHOT
    q = {k: np.where(np.isfinite(snap[k]), np.clip(np.round(snap[k] / DEMO_SCALE), -32767, 32767), -32768)
         .astype(np.int16) for k in ("no2", "age_h", "u", "v")}
    np.savez_compressed(path, meta=np.array(json.dumps(snap["meta"])), **q)


def load_demo(path: Path | None = None) -> dict | None:
    """The bundled snapshot, flagged ``meta.demo``; None if it is missing."""
    path = path or DEMO_SNAPSHOT
    if not path.exists():
        return None
    with np.load(path) as z:
        snap = {k: np.where(z[k] == -32768, np.nan, z[k] * DEMO_SCALE).astype(np.float32)
                for k in ("no2", "age_h", "u", "v")}
        meta = json.loads(str(z["meta"]))
    snap["u"] = np.nan_to_num(snap["u"])
    snap["v"] = np.nan_to_num(snap["v"])
    snap["meta"] = {**meta, "demo": True, "stale": True}
    return snap


_refreshing = threading.Event()


def _fetch_with_timeout(hours: int, res: float, timeout_s: float = 45.0) -> dict:
    """Earth Engine fetch that gives up after ``timeout_s`` (the thread is left to finish on its own)."""
    from concurrent.futures import ThreadPoolExecutor

    pool = ThreadPoolExecutor(max_workers=1)
    try:
        return pool.submit(_fetch, hours, res).result(timeout=timeout_s)
    finally:
        pool.shutdown(wait=False)


def _refresh_in_background(hours: int, res: float) -> None:
    """Fetch a new snapshot without blocking requests; at most one refresh at a time."""
    if _refreshing.is_set():
        return
    _refreshing.set()

    def run():
        try:
            _save(_fetch_with_timeout(hours, res, timeout_s=120.0), hours, res)
        except Exception:  # noqa: BLE001 - keep serving the stored snapshot
            log.exception("Background global NO2 refresh failed")
        finally:
            _refreshing.clear()

    threading.Thread(target=run, daemon=True).start()


def global_no2(hours: int = 24, res: float = RES_DEG) -> dict:
    """Latest global snapshot (arrays north-up, west-to-east from 180°W). Refreshed at most every
    ``CACHE_TTL_S``; if Earth Engine fails, the last stored snapshot is returned with ``meta.stale = True``.
    ``age_h`` is relative to ``meta.fetched_at``. In offline mode the stored snapshot is always used
    (``meta.frozen = True``)."""
    hours = int(min(max(hours, 3), 72))
    with _lock:
        cached = _load(hours, res)
        if offline():
            if cached:
                cached[0]["meta"]["frozen"] = True
                return cached[0]
            demo = load_demo()
            if demo is None:
                raise RuntimeError("offline mode and no stored global snapshot")
            return demo
        if cached and time.time() - cached[1] < CACHE_TTL_S:
            return cached[0]
        if cached:
            # stale-while-revalidate: never make the page wait on Earth Engine when a snapshot exists
            _refresh_in_background(hours, res)
            cached[0]["meta"]["stale"] = True
            return cached[0]
        try:
            snap = _fetch_with_timeout(hours, res)
        except Exception:  # noqa: BLE001 - Earth Engine quota / outage: serve the last snapshot
            if cached is None:
                demo = load_demo()
                if demo is None:
                    raise
                log.exception("Global NO2 fetch failed and nothing is cached; serving the bundled demo snapshot")
                return demo
            log.exception("Global NO2 refresh failed; serving the snapshot from %s", cached[0]["meta"]["fetched_at"])
            cached[0]["meta"]["stale"] = True
            return cached[0]
        _save(snap, hours, res)
        return snap


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Global NO2 snapshot tools")
    ap.add_argument("--save-demo", action="store_true", help="store the latest snapshot as the bundled fallback")
    args = ap.parse_args()
    if args.save_demo:
        logging.basicConfig(level=logging.INFO)
        latest = global_no2(24)
        save_demo(latest)
        print(f"saved {DEMO_SNAPSHOT} ({DEMO_SNAPSHOT.stat().st_size / 1e6:.2f} MB) from {latest['meta']['fetched_at']}")
