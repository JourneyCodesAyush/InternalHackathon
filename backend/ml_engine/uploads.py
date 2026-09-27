"""Uploaded satellite files -> ML engine run -> outputs for the web map.

    job = submit_upload([("no2_raw_coarse_2025-12-01.tif", data), ...])   # starts a background run
    job_status(job["job_id"])                                            # state, stage, progress, stats
    latest_output()                                                      # newest model map for the map page

Uploads are daily Sentinel-5P NO2 GeoTIFFs in the ``--source files`` format (see
``data/sample_inputs/README.md``). Identical uploads map to the same job, so re-uploading a processed set is
instant. Weather and land use for the area still come from Earth Engine, so a *new* upload needs it; when
Earth Engine is unavailable the job fails with a clear error and the map keeps showing the latest output.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .env import setting

log = logging.getLogger(__name__)

UPLOADS_ROOT = Path(setting("ML_ENGINE_UPLOADS_DIR", "outputs/uploads"))
MAX_FILES = 400
MAX_FILE_BYTES = 50 * 1024 * 1024
MIN_DAYS = 7  # gap-filling and downscaling learn from the other days of the series
JOB_TIMEOUT_S = 30 * 60  # a run still going after this is reported as failed (e.g. Earth Engine throttled)
TIFF_SUFFIXES = (".tif", ".tiff")

# Stage shown while a job runs, from the module that is logging (real pipeline progress, not a timer)
STAGES = (
    ("ml_engine.ingestion", "Loading inputs, weather and land use", 15),
    ("ml_engine.gapfill", "Filling cloud gaps", 40),
    ("ml_engine.downscaling", "Downscaling to 250 m", 65),
    ("ml_engine.surface", "Ground-level NO2 model", 80),
    ("ml_engine.dispersion", "Wind dispersion forecast", 88),
    ("ml_engine.export", "Writing maps", 95),
)

_threads: dict[str, threading.Thread] = {}
_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _job_dir(job_id: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{16}", job_id):
        raise KeyError(job_id)
    return UPLOADS_ROOT / job_id


def _write_status(job_id: str, **fields) -> dict:
    path = _job_dir(job_id) / "status.json"
    status = json.loads(path.read_text()) if path.exists() else {"job_id": job_id}
    status.update(fields, updated_at=_now())
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(status))
    tmp.replace(path)
    return status


def job_status(job_id: str) -> dict:
    """Status of a job: ``state`` (queued/running/done/failed), ``stage``, ``progress`` 0-100, ``stats``."""
    path = _job_dir(job_id) / "status.json"
    if not path.exists():
        raise KeyError(job_id)
    status = json.loads(path.read_text())
    # a job left "running" by a restarted server is not running any more
    if status.get("state") in ("queued", "running") and job_id not in _threads:
        status = _write_status(job_id, state="failed", error="Processing was interrupted (server restarted); upload again.")
    elif status.get("state") in ("queued", "running") and _age_s(status.get("created_at")) > JOB_TIMEOUT_S:
        status = _write_status(job_id, state="failed", error=(
            f"No result after {JOB_TIMEOUT_S // 60} minutes: {status.get('stage', 'processing')} is taking too long "
            "(Earth Engine may be throttled by its usage quota). Try again later."))
    return status


def _age_s(iso: str | None) -> float:
    if not iso:
        return 0.0
    started = datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - started).total_seconds()


class _StageHandler(logging.Handler):
    """Moves the job's stage forward as pipeline modules start logging in the job's thread."""

    def __init__(self, job_id: str, thread_id: int):
        super().__init__(logging.INFO)
        self.job_id, self.thread_id, self.reached = job_id, thread_id, 0

    def emit(self, record: logging.LogRecord) -> None:
        if record.thread != self.thread_id:
            return
        for prefix, label, progress in STAGES:
            if record.name.startswith(prefix) and progress > self.reached:
                self.reached = progress
                try:
                    _write_status(self.job_id, stage=label, progress=progress)
                except OSError:
                    pass


def _stats(run_dir: Path, seconds: float) -> dict:
    """Numbers for the upload page, from the run's own outputs."""
    import rasterio
    import xarray as xr

    report = json.loads((run_dir / "report.json").read_text())
    coarse, fine = report["grids"]["coarse"], report["grids"]["fine"]
    lat = np.radians(fine["north"] - fine["height"] * fine["res"] / 2)
    to_m = lambda deg: deg * 111_320 * np.cos(lat)  # noqa: E731
    days = sorted(p.name for p in (run_dir / "daily").iterdir() if p.is_dir())
    last = days[-1]
    with rasterio.open(run_dir / "daily" / last / "no2_surface_fine.tif") as src:
        surface = src.read(1, masked=True).astype(np.float64).filled(np.nan)
    raw = xr.load_dataset(run_dir / "coarse_raw.nc", engine="h5netcdf")["no2"].values
    raw_last = raw[-1]
    return {
        "days": len(days),
        "first_date": days[0],
        "last_date": last,
        "bbox": [round(fine["west"], 4), round(fine["north"] - fine["height"] * fine["res"], 4),
                 round(fine["west"] + fine["width"] * fine["res"], 4), round(fine["north"], 4)],
        "coarse_resolution_m": int(round(to_m(coarse["res"]), -1)),
        "fine_resolution_m": int(round(to_m(fine["res"]), -1)),
        "cloud_cover_input_pct": round(float(np.isnan(raw).mean() * 100), 1),
        "cloud_cover_last_day_pct": round(float(np.isnan(raw_last).mean() * 100), 1),
        "cloud_cover_output_pct": round(float(np.isnan(surface).mean() * 100), 1),
        "mean_no2_ugm3": round(float(np.nanmean(surface)), 1),
        "peak_no2_ugm3": round(float(np.nanmax(surface)), 1),
        "gapfill_r2": round(float(report["gapfill_holdout"]["all"]["r2"]), 2),
        "downscale_r2": round(float(report["downscaler"]["temporal_holdout_coarse"]["r2"]), 2),
        "processing_seconds": round(seconds, 1),
    }


def _run(job_id: str) -> None:
    from .pipeline import NO2Pipeline
    from .config import PRETRAINED_SURFACE_MODEL, PipelineConfig

    job = _job_dir(job_id)
    handler = _StageHandler(job_id, threading.get_ident())
    engine_log = logging.getLogger("ml_engine")
    engine_log.addHandler(handler)
    previous_level = engine_log.level
    if engine_log.getEffectiveLevel() > logging.INFO:
        engine_log.setLevel(logging.INFO)
    started = time.monotonic()
    try:
        _write_status(job_id, state="running", stage="Loading inputs, weather and land use", progress=5)
        cfg = PipelineConfig(output_dir=job / "run", model_dir=job / "run" / "models")
        cfg.output_dir.mkdir(parents=True, exist_ok=True)
        if PRETRAINED_SURFACE_MODEL.exists():
            cfg.surface_model_path = PRETRAINED_SURFACE_MODEL
        NO2Pipeline(cfg).run(source="files", input_dir=str(job / "input"))
        stats = _stats(job / "run", time.monotonic() - started)
        _write_status(job_id, state="done", stage="Done", progress=100, stats=stats, finished_at=_now())
        log.info("Upload job %s finished: %s", job_id, stats)
    except Exception as exc:  # noqa: BLE001 - reported to the user through the job status
        log.exception("Upload job %s failed", job_id)
        message = str(exc).strip().splitlines()[0] if str(exc).strip() else type(exc).__name__
        if "offline mode" in message:
            message = "Live processing is paused (offline mode); the map shows the latest stored output."
        elif any(k in message.lower() for k in ("quota", "earth engine", "ee.", "project")):
            message = f"Weather and land-use data could not be fetched: {message}"
        _write_status(job_id, state="failed", error=message[:300], finished_at=_now())
    finally:
        engine_log.removeHandler(handler)
        engine_log.setLevel(previous_level)
        with _lock:
            _threads.pop(job_id, None)


def _validate(files: list[tuple[str, bytes]]) -> None:
    if not files:
        raise ValueError("No files uploaded")
    if len(files) > MAX_FILES:
        raise ValueError(f"At most {MAX_FILES} files per upload")
    for name, data in files:
        if not name.lower().endswith(TIFF_SUFFIXES):
            raise ValueError(f"{name}: only daily NO2 GeoTIFFs (.tif) are supported")
        if len(data) > MAX_FILE_BYTES:
            raise ValueError(f"{name}: larger than {MAX_FILE_BYTES // 2**20} MB")
        if not re.search(r"\d{4}-?\d{2}-?\d{2}", name):
            raise ValueError(f"{name}: the file name must contain the date (YYYY-MM-DD)")


def submit_upload(files: list[tuple[str, bytes]]) -> dict:
    """Store the files and start (or reuse) the run; returns the job status."""
    _validate(files)
    digest = hashlib.sha256()
    for name, data in sorted(files):
        digest.update(Path(name).name.encode() + b"\0" + hashlib.sha256(data).digest())
    job_id = digest.hexdigest()[:16]
    job = _job_dir(job_id)
    with _lock:
        if (job / "status.json").exists():
            status = job_status(job_id)
            if status["state"] in ("done", "running", "queued"):
                return status  # same files: reuse the finished (or running) job
        (job / "input").mkdir(parents=True, exist_ok=True)
        for name, data in files:
            (job / "input" / Path(name).name).write_bytes(data)
        # check the files before starting (grid, CRS, dates) so format errors come back immediately
        from .ingestion.files import load_no2_geotiffs

        try:
            dates, stack, grid = load_no2_geotiffs(job / "input")
            observed = int(np.isfinite(stack).any(axis=(1, 2)).sum())
            if observed < MIN_DAYS:
                raise ValueError(f"Only {observed} day(s) with data; upload at least {MIN_DAYS} daily files of the same "
                                 "area (a folder of consecutive days) - the model learns cloud filling and downscaling "
                                 "from the other days of the series.")
        except Exception:
            import shutil

            shutil.rmtree(job, ignore_errors=True)  # nothing was started: do not leave a half job behind
            raise
        status = _write_status(job_id, state="queued", stage="Queued", progress=2, error=None, stats=None,
                               files=len(files), created_at=_now(), first_date=str(dates[0].date()),
                               last_date=str(dates[-1].date()))
        thread = threading.Thread(target=_run, args=(job_id,), name=f"upload-{job_id}", daemon=True)
        _threads[job_id] = thread
        thread.start()
    return status


def latest_output() -> dict | None:
    """The newest model map for the map page: the latest finished upload, else the newest stored run.
    Returns the last day's 250 m ground-level GeoTIFF (µg/m³) and where it came from."""
    from .service import RUNS_ROOT

    candidates: list[tuple[float, Path, dict]] = []
    for status_path in UPLOADS_ROOT.glob("*/status.json"):
        try:
            status = json.loads(status_path.read_text())
        except (OSError, ValueError):
            continue
        run = status_path.parent / "run"
        if status.get("state") == "done" and (run / "report.json").exists():
            candidates.append(((run / "report.json").stat().st_mtime, run,
                               {"source": "upload", "job_id": status["job_id"], "stats": status.get("stats")}))
    if not candidates:
        for report in RUNS_ROOT.glob("*/report.json"):
            candidates.append((report.stat().st_mtime, report.parent, {"source": "run", "job_id": None, "stats": None}))
    for _, run, info in sorted(candidates, key=lambda c: c[0], reverse=True):
        days = sorted(p for p in (run / "daily").glob("*/no2_surface_fine.tif"))
        if days:
            return {**info, "date": days[-1].parent.name, "surface_tif": str(days[-1]),
                    "raw_tif": str(days[-1].parent / "no2_raw_coarse.tif")}
    return None


def job_output(job_id: str, date: str | None = None) -> dict:
    """The job's 250 m ground-level GeoTIFF for ``date`` (default: its last day)."""
    status = job_status(job_id)
    if status.get("state") != "done":
        raise KeyError(job_id)
    daily = _job_dir(job_id) / "run" / "daily"
    days = sorted(p.parent.name for p in daily.glob("*/no2_surface_fine.tif"))
    day = date if date in days else days[-1]
    return {"source": "upload", "job_id": job_id, "stats": status.get("stats"), "date": day,
            "surface_tif": str(daily / day / "no2_surface_fine.tif"), "raw_tif": str(daily / day / "no2_raw_coarse.tif")}
