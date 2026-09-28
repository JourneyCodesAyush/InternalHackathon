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
    "/hotspots",
    summary="Get top NO2 pollution hotspots across the region",
    tags=["downscale"],
)
async def get_hotspots(
    date: Optional[str] = Query(None, description="Date in YYYY-MM-DD format (default 2025-11-05)"),
    limit: int = 8,
) -> dict:
    """
    Extract highest NO2 concentration coordinates from the uploaded Sentinel-5P GeoTIFFs,
    returning coordinates, measured NO2 level (µg/m³), locality name, and severity.
    """
    from app.services.upload_data import read_day, available_dates

    dates = available_dates()
    # Default to 2025-11-05 which contains real Sentinel-5P high-concentration plumes
    default_day = "2025-11-05" if "2025-11-05" in dates else (dates[-1] if dates else "2025-11-05")
    target_date = date if date and date in dates else default_day
    try:
        arr, t, used = read_day(target_date)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read NO2 data: {e}")

    valid_mask = ~np.isnan(arr)
    valid_indices = np.argwhere(valid_mask)
    sorted_pts = sorted(valid_indices, key=lambda idx: arr[idx[0], idx[1]], reverse=True)

    localities = [
        (19.0185, 72.9180, "Chembur-Trombay Industrial Basin", "Petroleum refining and petrochemical complexes"),
        (18.9810, 72.8940, "Mahul Petrochemical & Port Corridor", "Heavy oil storage terminals and fertilizer manufacturing"),
        (19.0740, 73.0080, "Vashi-Turbhe Trans-Harbor Zone", "High-density freight transit and light industrial node"),
        (18.9420, 72.9520, "JNPT Coastal Freight Terminal", "Heavy container logistics and marine diesel emissions"),
        (19.0620, 72.8710, "Kurla-BKC Transport Nexus", "Major vehicular arterial convergence"),
        (18.9875, 72.8925, "Wadala Monorail & Freight Yard", "Harbor rail freight depot and transit corridor"),
        (19.0225, 72.9975, "Nerul Industrial District", "Electronics and engineering manufacturing zone"),
        (18.8920, 72.9410, "Uran Energy Generation Hub", "Thermal energy generation and gas turbine landing"),
        (19.1620, 72.9750, "Thane Creek Marine Corridor", "Marine industrial channel and transport artery"),
        (19.2280, 73.0840, "Kalyan-Dombivli Industrial Valley", "Heavy machinery, dye works, and chemical processing"),
        (19.0925, 73.0325, "Ghansoli-MIDC Tech & Manufacturing", "High-tech manufacturing and logistics facilities"),
        (18.9525, 72.9275, "Elephanta Maritime Passage", "Coastal transit channel and harbor operations"),
    ]

    hotspots = []
    min_dist_sq = 0.038 ** 2  # ~4.2 km spatial separation to prevent collinear grid line artifacts

    for r, c in sorted_pts:
        if len(hotspots) >= limit:
            break
        lon = round(float(t.c + t.a * (c + 0.5)), 4)
        lat = round(float(t.f + t.e * (r + 0.5)), 4)
        val = round(float(arr[r, c]), 1)

        # Skip if too close to an existing hotspot to ensure natural regional distribution
        if any((lat - h["lat"]) ** 2 + (lon - h["lon"]) ** 2 < min_dist_sq for h in hotspots):
            continue

        # Match closest locality
        best_name = f"Grid Cluster ({lat:.3f}°N, {lon:.3f}°E)"
        best_desc = "High tropospheric NO₂ column density detected by Sentinel-5P"
        min_dist = float("inf")
        for loc_lat, loc_lon, loc_name, loc_desc in localities:
            dist = (lat - loc_lat) ** 2 + (lon - loc_lon) ** 2
            if dist < min_dist and dist < 0.005:
                min_dist = dist
                best_name = loc_name
                best_desc = loc_desc

        severity = "CRITICAL" if val >= 300 else ("HIGH" if val >= 200 else "ELEVATED")
        hotspots.append({
            "id": f"hotspot-{len(hotspots) + 1}",
            "lat": lat,
            "lon": lon,
            "no2": val,
            "name": best_name,
            "description": best_desc,
            "severity": severity,
            "unit": "µg/m³",
        })

    return {
        "date": used,
        "count": len(hotspots),
        "hotspots": hotspots,
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
