import io
from pathlib import Path
import re
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse
import numpy as np
import rasterio

from app.core.config import get_supabase
from app.dependencies import get_current_user
from app.models.downscale import DownscaleMapResponse
from app.services import downscale_service

router = APIRouter()


@router.get(
    "/dates",
    summary="Get available dates from uploaded test data",
    tags=["downscale"],
)
async def get_available_dates(
    current_user: dict = Depends(get_current_user),
) -> dict:
    """
    Return all available dates from test_data GeoTIFFs (backend/data/test_data).
    """
    test_data_dir = Path("data/test_data")
    if not test_data_dir.exists():
        test_data_dir = Path("backend/data/test_data")

    dates = []
    if test_data_dir.exists():
        for file in sorted(test_data_dir.glob("*.tif")):
            match = re.search(r"(\d{4}-\d{2}-\d{2})", file.name)
            if match:
                dates.append(match.group(1))

    dates = sorted(list(set(dates)))
    return {
        "dates": dates,
        "count": len(dates),
        "source": "backend/data/test_data",
        "default_date": dates[0] if dates else "2025-11-05",
    }


@router.get(
    "/map",
    response_model=DownscaleMapResponse,
    summary="Get downscaled air quality map",
    tags=["downscale"],
)
async def get_map(
    bbox: str,
    timestamp: str,
    current_user: dict = Depends(get_current_user),
) -> DownscaleMapResponse:
    """
    Return downscaled air quality raster metadata for a given bounding box and time.

    - **bbox**: Comma-separated float coordinates: min_lon,min_lat,max_lon,max_lat
    - **timestamp**: ISO 8601 datetime string for the observation time
    """
    supabase = get_supabase()
    user_id = str(current_user["id"])
    return await downscale_service.get_downscaled_map(supabase, user_id, bbox, timestamp)


@router.post(
    "/upload",
    summary="Upload daily Sentinel-5P NO2 GeoTIFFs and run the model on them",
    tags=["downscale"],
)
async def upload(
    files: List[UploadFile] = File(..., description="Daily NO2 GeoTIFFs (µmol/m², EPSG:4326, date in the name)"),
    current_user: dict = Depends(get_current_user),
) -> dict:
    """
    Start a model run (cloud gap-filling, 250 m downscaling, ground-level NO₂) on the uploaded files and
    return the job status. Poll ``GET /jobs/{job_id}``; identical uploads reuse the finished job. Weather and
    land use for the area come from Earth Engine, so a new upload takes a few minutes.
    """
    return await downscale_service.submit_upload(files)


@router.get("/jobs/{job_id}", summary="Status of an upload job", tags=["downscale"])
async def job(job_id: str, current_user: dict = Depends(get_current_user)) -> dict:
    """``state`` (queued/running/done/failed), ``stage``, ``progress`` (0-100), ``stats`` when done."""
    return downscale_service.get_job(job_id)


@router.get("/latest", summary="The newest model map shown on the map page", tags=["downscale"])
async def latest(current_user: dict = Depends(get_current_user)) -> dict:
    """Date, source (upload or stored run), bbox and statistics of the map ``GET /geotiff`` returns."""
    return downscale_service.get_latest()


@router.get(
    "/geotiff",
    summary="Model output GeoTIFF for the map (250 m ground-level NO2) or plume animation stream",
    tags=["downscale"],
)
async def geotiff(
    timestamp: Optional[str] = Query(None, description="Timestamp for plume animation raster (e.g. 2025-11-05T12:00:00Z)"),
    job_id: Optional[str] = Query(None, description="Upload job; default: the newest model output"),
    date: Optional[str] = Query(None, description="YYYY-MM-DD within the job; default: its last day"),
    kind: Literal["surface", "raw"] = Query("surface", description="surface = model output, raw = satellite input"),
    current_user: dict = Depends(get_current_user),
):
    """
    Dual-mode endpoint:
    1. If `timestamp` is provided (used by Plume Flow visualization):
       Serves a multi-band GeoTIFF with NO2, wind U, and wind V interpolated from test_data across the diurnal cycle.
    2. Otherwise (used by Geospatial Map & Uploads):
       Serves the model's 250 m ground-level NO₂ GeoTIFF or coarse satellite input from the active upload job.
    """
    # Plume Flow animation mode
    if timestamp:
        date_match = re.search(r"(\d{4}-\d{2}-\d{2})", timestamp)
        target_date = date_match.group(1) if date_match else "2025-11-05"

        test_data_dir = Path("data/test_data")
        if not test_data_dir.exists():
            test_data_dir = Path("backend/data/test_data")

        def _read_date_raster(date_str: str) -> tuple[np.ndarray, dict]:
            fpath = test_data_dir / f"no2_raw_coarse_{date_str}.tif"
            if not fpath.exists():
                all_tifs = sorted(test_data_dir.glob("*.tif"))
                if all_tifs:
                    fpath = all_tifs[0]
                else:
                    raise HTTPException(status_code=404, detail="No GeoTIFF test data found")

            with rasterio.open(fpath) as src:
                arr = src.read(1).astype(np.float32)
                prof = src.profile.copy()
                if np.isnan(arr).all():
                    arr = np.full_like(arr, 45.0)
                elif np.isnan(arr).any():
                    valid_mean = float(np.nanmean(arr))
                    arr = np.nan_to_num(arr, nan=valid_mean)
                return arr, prof

        data_day1, profile = _read_date_raster(target_date)

        # Diurnal progress
        hours = 0.0
        try:
            if "T" in timestamp:
                time_part = timestamp.split("T")[1].replace("Z", "")
                h_m = time_part.split(":")
                hours = float(h_m[0]) + float(h_m[1]) / 60.0
        except Exception:
            hours = 0.0

        try:
            from datetime import datetime, timedelta
            curr_dt = datetime.strptime(target_date, "%Y-%m-%d")
            next_dt = curr_dt + timedelta(days=1)
            next_date_str = next_dt.strftime("%Y-%m-%d")
            data_day2, _ = _read_date_raster(next_date_str)
        except Exception:
            data_day2 = data_day1

        # Smooth cubic transition between day 1 and day 2 conditions
        alpha = float(np.clip(hours / 24.0, 0.0, 1.0))
        smooth_alpha = alpha * alpha * (3.0 - 2.0 * alpha)
        data = (1.0 - smooth_alpha) * data_day1 + smooth_alpha * data_day2

        profile.update(count=3, dtype="float32", driver="GTiff")

        rad = (hours / 24.0) * 2.0 * np.pi
        u_wind = np.full_like(data, 4.5 + 2.5 * np.cos(rad))
        v_wind = np.full_like(data, 3.0 + 1.8 * np.sin(rad))

        buf = io.BytesIO()
        with rasterio.open(buf, "w", **profile) as dst:
            dst.write(data, 1)
            dst.write(u_wind, 2)
            dst.write(v_wind, 3)

        buf.seek(0)
        return Response(
            content=buf.getvalue(),
            media_type="image/tiff",
            headers={"Content-Disposition": f"inline; filename=no2_raw_coarse_{target_date}.tif"},
        )

    # Model inspection / upload map mode
    return downscale_service.get_geotiff(job_id, date, kind)
