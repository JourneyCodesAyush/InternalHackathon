import asyncio
from pathlib import Path
from typing import List

from fastapi import HTTPException
from supabase import Client

from app.core.config import settings
from app.models.downscale import DownscaleMapResponse
from app.services.activity_service import log_activity
from ml_engine.service import RUNS_ROOT, generate_map


def _parse_bbox(bbox: str) -> List[float]:
    try:
        values = [float(v.strip()) for v in bbox.split(",")]
    except ValueError:
        raise HTTPException(status_code=422, detail="bbox must be four comma-separated numbers")
    if len(values) != 4 or not (values[0] < values[2] and values[1] < values[3]):
        raise HTTPException(status_code=422, detail="bbox must be min_lon,min_lat,max_lon,max_lat")
    return values


def _file_url(path: str) -> str:
    """Public URL of an ML engine output under the /files static mount."""
    return "/files/" + Path(path).resolve().relative_to(RUNS_ROOT.resolve()).as_posix()


async def get_downscaled_map(
    supabase: Client,
    user_id: str,
    bbox: str,
    timestamp: str,
) -> DownscaleMapResponse:
    """
    Return the ML engine's 250 m ground-level NO2 map for a bounding box and date.

    The first request for an area/date runs the pipeline (Earth Engine download, cloud gap-filling,
    downscaling, ground-level model; ~1-3 minutes); later requests are served from the run cache.

    Args:
        supabase: Active Supabase client.
        user_id: UUID of the requesting user (for activity logging).
        bbox: Bounding box string "min_lon,min_lat,max_lon,max_lat", e.g. "72.8,18.9,73.1,19.2".
        timestamp: ISO 8601 date/datetime; the map for that calendar day is returned.
    """
    parsed_bbox = _parse_bbox(bbox)

    await log_activity(
        supabase,
        user_id,
        "VIEW_DOWNSCALED_MAP",
        {"bbox": bbox, "timestamp": timestamp},
    )

    try:
        result = await asyncio.to_thread(
            generate_map, bbox=tuple(parsed_bbox), date=timestamp[:10], ee_project=settings.EE_PROJECT
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:  # Earth Engine outages, quota, missing satellite data
        raise HTTPException(status_code=503, detail=f"Map generation failed: {exc}")

    return DownscaleMapResponse(
        resolution=f"{result['resolution_m']}m",
        bbox=result["bbox"],
        timestamp=timestamp,
        grid_url=_file_url(result["surface_tif"]),
        format="GeoTIFF",
        date=result["date"],
        units=result["units"],
        raw_url=_file_url(result["raw_tif"]),
        gapfilled_url=_file_url(result["gapfilled_tif"]),
        hazard_geojson_url=_file_url(result["hazard_geojson"]),
        netcdf_url=_file_url(result["surface_netcdf"]),
        metrics=result["metrics"],
    )
