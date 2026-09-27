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


@router.get(
    "/pois",
    summary="Industrial / factory point sources and traffic corridors in an area (OpenStreetMap)",
    tags=["analyze"],
)
async def get_pois(
    bbox: str,
    current_user: dict = Depends(get_current_user),
) -> dict:
    """
    All mapped emission sources in ``bbox`` (``west,south,east,north``): industrial zones, works/factories and
    power plants as points; motorways, trunk roads and main railways as lines. Cached per area.
    """
    import asyncio

    from fastapi import HTTPException

    from app.services import pois_service

    try:
        west, south, east, north = (float(v) for v in bbox.split(","))
    except ValueError:
        raise HTTPException(status_code=422, detail="bbox must be west,south,east,north")
    try:
        return await asyncio.to_thread(pois_service.get_pois, (west, south, east, north))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
