from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import FileResponse

from app.core.config import get_supabase
from app.dependencies import get_current_user
from app.models.downscale import DownscaleMapResponse
from app.services import downscale_service

router = APIRouter()


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
    summary="Model output GeoTIFF for the map (250 m ground-level NO2, µg/m³)",
    tags=["downscale"],
    response_class=FileResponse,
)
async def geotiff(
    job_id: Optional[str] = Query(None, description="Upload job; default: the newest model output"),
    date: Optional[str] = Query(None, description="YYYY-MM-DD within the job; default: its last day"),
    kind: Literal["surface", "raw"] = Query("surface", description="surface = model output, raw = satellite input"),
    current_user: dict = Depends(get_current_user),
) -> FileResponse:
    """
    The model's 250 m ground-level NO₂ GeoTIFF (µg/m³, EPSG:4326) that the map heatmap draws, or the
    coarse satellite input it came from (``kind=raw``, µmol/m²). Headers: ``X-Model-Date``,
    ``X-Model-Source`` (upload/run), ``X-Model-Job``.
    """
    return downscale_service.get_geotiff(job_id, date, kind)
