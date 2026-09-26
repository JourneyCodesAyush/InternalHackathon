from fastapi import APIRouter, Depends, HTTPException

from app.core.config import get_supabase
from app.dependencies import get_current_user
from app.models.trends import TrendsResponse
from app.services import trends_service

router = APIRouter()

_ALLOWED_HOURS = {3, 6, 12, 24}


@router.get(
    "/predict",
    response_model=TrendsResponse,
    summary="Get NO2 trend predictions for a location",
    tags=["trends"],
)
async def get_predictions(
    lat: float,
    lon: float,
    hours: int,
    current_user: dict = Depends(get_current_user),
) -> TrendsResponse:
    """
    Return NO₂ concentration predictions for the given coordinates and time horizon.

    - **lat**: Latitude of the target location
    - **lon**: Longitude of the target location
    - **hours**: Forecast horizon in hours — must be one of 3, 6, 12, or 24
    """
    if hours not in _ALLOWED_HOURS:
        raise HTTPException(
            status_code=422,
            detail=f"'hours' must be one of {sorted(_ALLOWED_HOURS)}, got {hours}",
        )
    supabase = get_supabase()
    user_id = str(current_user["id"])
    return await trends_service.get_predictions(supabase, user_id, lat, lon, hours)
