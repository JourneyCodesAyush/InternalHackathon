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

import base64
import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
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
RES_DEG = 0.5  # 720 x 360 cells: ~2 MB per snapshot
FINE_RES_DEG = 0.1  # fetched at this resolution and block-averaged to RES_DEG (true cell means)
STRIPS = 4  # parallel longitude strips (each within computePixels' size limit)
MIN_FINE_PIXELS = 3  # of 25 fine pixels per cell, so one stray pixel does not stand for 55 km
CACHE_TTL_S = 20 * 60  # new NRTI granules arrive every ~100 min (one orbit)
NODATA = -9999.0
CACHE_DIR = Path(setting("ML_ENGINE_GLOBE_CACHE", "cache/globe"))
DEMO_SNAPSHOT = PRETRAINED_SURFACE_MODEL.parent / "globe_demo_snapshot.npz"  # int16-quantised, ~0.7 MB
DEMO_SCALE = 0.02  # int16 * 0.02: ±655 µmol/m² (city peaks reach ~500)
INT16_NODATA = -32768
# the frontend's copy of the bundled snapshot, used when the backend cannot be reached
FRONTEND_FALLBACK = Path(__file__).resolve().parents[2] / "frontend" / "public" / "globe" / "fallback.json"
_lock = threading.Lock()


def _grid(res: float) -> dict:
    return {"dimensions": {"width": int(round(360 / res)), "height": int(round(180 / res))},
            "affineTransform": {"scaleX": res, "shearX": 0, "translateX": -180.0,
                                "shearY": 0, "scaleY": -res, "translateY": 90.0},
            "crsCode": "EPSG:4326"}


def _strip_grid(west: float, width_deg: float, res: float) -> dict:
    return {"dimensions": {"width": int(round(width_deg / res)), "height": int(round(180 / res))},
            "affineTransform": {"scaleX": res, "shearX": 0, "translateX": west,
                                "shearY": 0, "scaleY": -res, "translateY": 90.0},
            "crsCode": "EPSG:4326"}


def _block_mean(fine: np.ndarray, factor: int, min_valid: int) -> np.ndarray:
    """NaN-aware mean of ``factor`` x ``factor`` blocks; cells with fewer than ``min_valid`` values -> NaN."""
    h, w = fine.shape[0] // factor, fine.shape[1] // factor
    blocks = fine[: h * factor, : w * factor].reshape(h, factor, w, factor)
    count = np.isfinite(blocks).sum(axis=(1, 3))
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = np.nansum(blocks, axis=(1, 3)) / count
    return np.where(count >= min_valid, mean, np.nan).astype(np.float32)


def _fetch(hours: int, res: float) -> dict:
    """Latest-on-top mosaic of NRTI NO2 (+ sensing time) as true cell means, and the latest GFS 10 m wind.

    Asking Earth Engine for a 0.5° grid directly samples its coarse image pyramid (one ~35 km pixel per cell),
    which misses or dilutes sharp city plumes, and an exact server-side mean exceeds the free-tier memory
    limit. So the mosaic is fetched at ``FINE_RES_DEG`` in ``STRIPS`` longitude strips (in parallel) and
    averaged to ``res`` here, skipping cloud gaps (verified against Earth Engine's exact cell means: median
    difference ~1 µmol/m²). Wind is smooth and comes straight at ``res``.
    """
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

    mosaic = granules.map(prep).sort("system:time_start").mosaic().unmask(NODATA).toFloat()  # newest on top
    gfs = (ee.ImageCollection(GFS_COLLECTION).filter(ee.Filter.eq("forecast_hours", 0))
           .filterDate(now.advance(-2, "day"), now).sort("system:time_start", False).first())
    wind = gfs.select(["u_component_of_wind_10m_above_ground", "v_component_of_wind_10m_above_ground"],
                      ["u", "v"]).unmask(0).toFloat()

    strip_deg = 360 / STRIPS
    requests = [(mosaic, _strip_grid(-180 + k * strip_deg, strip_deg, FINE_RES_DEG)) for k in range(STRIPS)]
    requests.append((wind, _grid(res)))
    with ThreadPoolExecutor(len(requests)) as pool:
        results = list(pool.map(
            lambda r: ee.data.computePixels({"expression": r[0], "fileFormat": "NUMPY_NDARRAY", "grid": r[1]}),
            requests))
    gfs_ms = gfs.get("system:time_start").getInfo()

    fine_no2 = np.concatenate([np.where(r["no2"] > NODATA / 2, r["no2"], np.nan) for r in results[:STRIPS]], axis=1)
    fine_t = np.concatenate([np.where(r["t_min"] > NODATA / 2, r["t_min"], np.nan) for r in results[:STRIPS]], axis=1)
    factor = int(round(res / FINE_RES_DEG))
    no2 = _block_mean(fine_no2, factor, MIN_FINE_PIXELS)
    t_min = np.where(np.isfinite(no2), _block_mean(fine_t, factor, MIN_FINE_PIXELS), np.nan)
    age_h = ((now_ms / 60_000 - t_min) / 60.0).astype(np.float32)  # mean age of the cell's observations
    u = results[-1]["u"].astype(np.float32)
    v = results[-1]["v"].astype(np.float32)
    valid = np.isfinite(no2)
    seen_t = fine_t[np.isfinite(fine_t)]
    return {
        "no2": no2, "age_h": age_h, "u": u, "v": v,
        "meta": {
            "fetched_at": _iso(now_ms), "hours": hours, "res_deg": res,
            "width": int(no2.shape[1]), "height": int(no2.shape[0]), "west": -180.0, "north": 90.0,
            "units": "µmol/m²", "quantity": "Sentinel-5P tropospheric NO2 column (NRTI)",
            "newest_obs": _iso(float(seen_t.max()) * 60_000) if seen_t.size else None,
            "oldest_obs": _iso(float(seen_t.min()) * 60_000) if seen_t.size else None,
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
    np.savez_compressed(data, **{k: snap[k] for k in ("no2", "age_h", "u", "v")})
    meta.write_text(json.dumps(snap["meta"]))


def _load(hours: int, res: float) -> tuple[dict, float] | None:
    data, meta = _paths(hours, res)
    if not (data.exists() and meta.exists()):
        return None
    with np.load(data) as z:
        snap = {k: z[k] for k in ("no2", "age_h", "u", "v")}
    snap["meta"] = json.loads(meta.read_text())
    return snap, data.stat().st_mtime


def _int16(values: np.ndarray, scale: float) -> str:
    """Base64 little-endian int16 of ``values / scale`` (NaN -> -32768): 2 bytes per cell."""
    q = np.where(np.isfinite(values), np.clip(np.round(values / scale), -32767, 32767), INT16_NODATA)
    return base64.b64encode(q.astype("<i2").tobytes()).decode("ascii")


def payload(snap: dict) -> dict:
    """JSON form served by ``GET /api/v1/globe/no2`` (and stored as the frontend fallback): metadata plus
    quantised int16 grids, north-up rows from 90°N, columns from 180°W; ``value = int16 * scale``."""
    return {
        **snap["meta"],
        "nodata": INT16_NODATA,
        "fields": {
            "no2": {"scale": 0.02, "data": _int16(snap["no2"], 0.02)},  # µmol/m², up to ±655
            "age_h": {"scale": 0.01, "data": _int16(snap["age_h"], 0.01)},  # hours before fetched_at
            "u": {"scale": 0.01, "data": _int16(snap["u"], 0.01)},  # m/s, eastward
            "v": {"scale": 0.01, "data": _int16(snap["v"], 0.01)},  # m/s, northward
        },
    }


def save_demo(snap: dict, path: Path | None = None) -> None:
    """Store ``snap`` as the bundled fallback (int16 at 0.01 resolution, NaN -> -32768)."""
    path = path or DEMO_SNAPSHOT
    q = {k: np.where(np.isfinite(snap[k]), np.clip(np.round(snap[k] / DEMO_SCALE), -32767, 32767), -32768)
         .astype(np.int16) for k in ("no2", "age_h", "u", "v")}
    np.savez_compressed(path, meta=np.array(json.dumps(snap["meta"])), scale=np.array(DEMO_SCALE), **q)
    if path == DEMO_SNAPSHOT and FRONTEND_FALLBACK.parent.parent.exists():
        FRONTEND_FALLBACK.parent.mkdir(exist_ok=True)
        meta = {k: v for k, v in snap["meta"].items() if k not in ("stale", "frozen", "demo")}
        FRONTEND_FALLBACK.write_text(json.dumps(payload({**snap, "meta": meta}), separators=(",", ":")))


def load_demo(path: Path | None = None) -> dict | None:
    """The bundled snapshot, flagged ``meta.demo``; None if it is missing."""
    path = path or DEMO_SNAPSHOT
    if not path.exists():
        return None
    with np.load(path) as z:
        scale = float(z["scale"]) if "scale" in z.files else 0.01
        snap = {k: np.where(z[k] == -32768, np.nan, z[k] * scale).astype(np.float32)
                for k in ("no2", "age_h", "u", "v")}
        meta = json.loads(str(z["meta"]))
    snap["u"] = np.nan_to_num(snap["u"])
    snap["v"] = np.nan_to_num(snap["v"])
    snap["meta"] = {**meta, "demo": True, "stale": True}
    return snap


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
        try:
            snap = _fetch(hours, res)
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
    ap.add_argument("--save-demo", action="store_true",
                    help="store the latest snapshot as the bundled fallback (backend + frontend copies)")
    args = ap.parse_args()
    if args.save_demo:
        logging.basicConfig(level=logging.INFO)
        latest = global_no2(24)
        save_demo(latest)
        print(f"saved {DEMO_SNAPSHOT} ({DEMO_SNAPSHOT.stat().st_size / 1e6:.2f} MB) from {latest['meta']['fetched_at']}")
