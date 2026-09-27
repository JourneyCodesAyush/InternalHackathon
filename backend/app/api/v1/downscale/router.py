from fastapi import APIRouter, Depends

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
