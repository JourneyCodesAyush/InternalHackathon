import asyncio
from typing import List

from fastapi import HTTPException
from supabase import Client

from app.core.config import settings
from app.models.trends import TrendPrediction, TrendsResponse
from app.services.activity_service import log_activity
from ml_engine.service import forecast_point


async def get_predictions(
    supabase: Client,
    user_id: str,
    lat: float,
    lon: float,
    hours: int,
) -> TrendsResponse:
    """
    Return NO2 predictions every 3 hours up to ``hours`` ahead for a location.

    The ML engine's latest 250 m ground-level NO2 map around the point is advected with ERA5 winds by
    its advection-diffusion solver. ``wind_direction`` is the meteorological direction the wind blows
    from; ``confidence`` is indicative (model day-to-day skill, decaying with lead time).

    Args:
        supabase: Active Supabase client.
        user_id: UUID of the requesting user.
        lat: Latitude of the target location.
        lon: Longitude of the target location.
        hours: Forecast horizon - must be one of 3, 6, 12, 24.
    """
    await log_activity(
        supabase,
        user_id,
        "RUN_PREDICTION",
        {"lat": lat, "lon": lon, "hours": hours},
    )

    try:
        result = await asyncio.to_thread(forecast_point, lat, lon, hours, ee_project=settings.EE_PROJECT)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:  # Earth Engine outages, quota, missing satellite data
        raise HTTPException(status_code=503, detail=f"Forecast failed: {exc}")

    predictions: List[TrendPrediction] = [TrendPrediction(**p) for p in result["predictions"]]
    return TrendsResponse(lat=lat, lon=lon, hours=hours, predictions=predictions)
