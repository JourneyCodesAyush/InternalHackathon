from fastapi import APIRouter, Depends

from app.core.config import get_supabase
from app.dependencies import get_current_user
from app.models.analyze import PinpointRequest, PinpointResponse
from app.services import analyze_service

router = APIRouter()


@router.post(
    "/pinpoint",
    response_model=PinpointResponse,
    summary="Identify top pollution sources near a location",
    tags=["analyze"],
)
async def pinpoint(
    body: PinpointRequest,
    current_user: dict = Depends(get_current_user),
) -> PinpointResponse:
    """
    Analyse the top pollution contributors around a given coordinate within a radius.

    - **lat**: Latitude of the point of interest
    - **lon**: Longitude of the point of interest
    - **radius_km**: Search radius in kilometres (default 5.0)
    """
    supabase = get_supabase()
    user_id = str(current_user["id"])
    return await analyze_service.pinpoint_sources(
        supabase, user_id, body.lat, body.lon, body.radius_km
    )
