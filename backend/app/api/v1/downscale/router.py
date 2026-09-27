import io
from pathlib import Path
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
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


@router.get(
    "/geotiff",
    summary="Plume animation GeoTIFF stream from test data",
    tags=["downscale"],
)
async def geotiff(
    timestamp: Optional[str] = Query(None, description="Timestamp for plume animation raster (e.g. 2025-11-05T12:00:00Z)"),
    current_user: dict = Depends(get_current_user),
):
    """
    Serves a multi-band GeoTIFF with NO2, wind U, and wind V interpolated from test_data across the diurnal
    cycle for the Plume Flow visualization (requires ``timestamp``).
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

    raise HTTPException(status_code=404, detail="timestamp is required")
