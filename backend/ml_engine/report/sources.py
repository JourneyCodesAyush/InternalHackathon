"""Where a report's numbers come from, in order of preference.

1. **The AI model's output** covering the point: the newest finished upload (Model Upload page), else the newest
   stored pipeline run. Same data as the Geospatial Map heatmap.
2. **Google Air Quality API** current conditions at the point (hourly NO2), when no model output covers it.
   Needs ``GOOGLE_MAPS_API_KEY`` (or ``NEXT_PUBLIC_GOOGLE_MAPS_API_KEY``) with the Air Quality API enabled.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path

from ..env import offline, setting

log = logging.getLogger(__name__)

AIR_QUALITY_URL = "https://airquality.googleapis.com/v1/currentConditions:lookup"
PPB_TO_UGM3_NO2 = 1.88  # 46.0055 g/mol / 24.45 L/mol (25 °C, 1 atm)
GOOGLE_TIMEOUT_S = 8.0


@dataclass
class ModelRun:
    run_dir: Path
    date: str  # day of the run to report on
    kind: str  # "upload" | "run"
    job_id: str | None


def _fine_bbox(run_dir: Path) -> tuple[float, float, float, float] | None:
    try:
        fine = json.loads((run_dir / "report.json").read_text())["grids"]["fine"]
    except (OSError, KeyError, ValueError):
        return None
    return (fine["west"], fine["north"] - fine["height"] * fine["res"],
            fine["west"] + fine["width"] * fine["res"], fine["north"])


def _days(run_dir: Path) -> list[str]:
    return sorted(p.parent.name for p in (run_dir / "daily").glob("*/no2_surface_fine.tif"))


def find_model_run(lat: float, lon: float, date: str | None = None) -> ModelRun | None:
    """Newest model output whose map contains the point: finished uploads first, then stored runs. Reports on
    ``date`` when the run has it, else on the run's last day."""
    from .. import uploads
    from ..service import RUNS_ROOT

    candidates: list[tuple[int, float, Path, str, str | None]] = []
    for status_path in uploads.UPLOADS_ROOT.glob("*/status.json"):
        try:
            status = json.loads(status_path.read_text())
        except (OSError, ValueError):
            continue
        run = status_path.parent / "run"
        if status.get("state") == "done" and (run / "report.json").exists():
            candidates.append((0, -(run / "report.json").stat().st_mtime, run, "upload", status.get("job_id")))
    for report in RUNS_ROOT.glob("*/report.json"):
        candidates.append((1, -report.stat().st_mtime, report.parent, "run", None))
    for _, _, run_dir, kind, job_id in sorted(candidates, key=lambda c: c[:2]):
        bbox = _fine_bbox(run_dir)
        days = _days(run_dir)
        if bbox and days and bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]:
            return ModelRun(run_dir, date if date in days else days[-1], kind, job_id)
    return None


def google_point(lat: float, lon: float) -> dict:
    """Current NO2 at the point from the Google Air Quality API, in µg/m³ (raises on any failure)."""
    import httpx

    if offline():
        raise RuntimeError("offline mode")
    key = setting("GOOGLE_MAPS_API_KEY") or setting("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY")
    if not key:
        raise RuntimeError("no Google Maps API key configured")
    try:
        import truststore

        truststore.inject_into_ssl()
    except ImportError:
        pass
    res = httpx.post(AIR_QUALITY_URL, params={"key": key}, timeout=GOOGLE_TIMEOUT_S,
                     json={"location": {"latitude": lat, "longitude": lon},
                           "extraComputations": ["POLLUTANT_CONCENTRATION"], "languageCode": "en"})
    if res.status_code != 200:
        status = (res.json().get("error") or {}).get("status", "") if res.headers.get("content-type", "").startswith("application/json") else ""
        raise RuntimeError(f"Google Air Quality API HTTP {res.status_code} {status}".strip())
    body = res.json()
    no2 = next((p for p in body.get("pollutants", []) if p.get("code") == "no2"), None)
    if not no2 or "concentration" not in no2:
        raise RuntimeError("Google Air Quality API returned no NO2 value here")
    conc = no2["concentration"]
    value, units = float(conc["value"]), conc.get("units", "")
    ugm3 = value * PPB_TO_UGM3_NO2 if units == "PARTS_PER_BILLION" else value
    return {"no2_ugm3": round(ugm3, 1), "raw_value": value, "raw_units": units,
            "date_time": body.get("dateTime"), "region_code": body.get("regionCode")}
