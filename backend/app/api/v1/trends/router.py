from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.core.config import get_supabase
from app.dependencies import get_current_user
from app.models.trends import (
    TrendsResponse,
    ForecastResponse,
)
from app.services import trends_service

router = APIRouter()

_ALLOWED_HOURS = {3, 6, 12, 24}
_ALLOWED_INTERVALS = {30, 60, 90, 120}



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


@router.get(
    "/forecast",
    response_model=ForecastResponse,
    summary="30-minute spatiotemporal NO₂ forecast for a bounding box",
    tags=["trends"],
)
async def get_spatial_forecast(
    bbox: str,
    timestamp: str | None = None,
    interval: int = 30,
    current_user: dict = Depends(get_current_user),
) -> ForecastResponse:
    """
    Return multi-horizon NO₂ forecast rasters for a bounding box.

    - **bbox**: Comma-separated `west,south,east,north` in degrees (EPSG:4326).
                Example: `72.77,18.88,73.12,19.32`
    - **timestamp**: ISO-8601 date string (default: yesterday's downscaled map).
    - **interval**: Export interval in minutes — must be 30, 60, 90, or 120.

    Returns GeoTIFF URLs for each forecast horizon (t+30, t+60, …), plus wind
    vectors as GeoJSON and a full NetCDF for research download.
    """
    if interval not in _ALLOWED_INTERVALS:
        raise HTTPException(
            status_code=422,
            detail=f"'interval' must be one of {sorted(_ALLOWED_INTERVALS)}, got {interval}",
        )
    try:
        parts = [float(v) for v in bbox.split(",")]
        if len(parts) != 4:
            raise ValueError
        bbox_tuple = tuple(parts)
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=422,
            detail="'bbox' must be 'west,south,east,north' (four comma-separated floats)",
        )

    supabase = get_supabase()
    user_id = str(current_user["id"])
    return await trends_service.get_spatial_forecast(
        supabase, user_id, bbox_tuple, timestamp, interval
    )


@router.get(
    "/point",
    summary="NO₂ at a point from the uploaded data for a date, with the forecast model's predictions",
    tags=["trends"],
)
async def get_point(
    lat: float,
    lon: float,
    date: str | None = None,
    current_user: dict = Depends(get_current_user),
) -> dict:
    """
    For the home page's pinpoint card: the value at the point in that day's uploaded GeoTIFF (the same data
    the map heatmap and Plume Flow show) and the forecasting model's +3/+6/+12/+24 h predictions from it.

    - **date**: YYYY-MM-DD from `GET /downscale/dates` (default: the first uploaded day)
    """
    import asyncio

    from app.services import upload_data

    dates = upload_data.available_dates()
    if not dates:
        raise HTTPException(status_code=404, detail="No uploaded data")
    try:
        return await asyncio.to_thread(upload_data.point_forecast, lat, lon, date or dates[0])
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
