import math
from typing import List
from supabase import Client

from app.models.trends import TrendPrediction, TrendsResponse
from app.services.activity_service import log_activity

# Realistic base values used to generate fake predictions
_BASE_NO2 = 85.0       # µg/m³
_BASE_WIND_SPEED = 6.5  # m/s
_BASE_WIND_DIR = 220.0  # degrees


async def get_predictions(
    supabase: Client,
    user_id: str,
    lat: float,
    lon: float,
    hours: int,
) -> TrendsResponse:
    """
    Return NO₂ trend predictions for a given location and time horizon.

    Predictions are generated as realistic fake data. The number of prediction
    objects is hours / 3 (one per 3-hour interval).

    Args:
        supabase: Active Supabase client.
        user_id: UUID of the requesting user.
        lat: Latitude of the target location.
        lon: Longitude of the target location.
        hours: Forecast horizon — must be one of 3, 6, 12, 24.

    Returns:
        A TrendsResponse with a list of TrendPrediction objects.
    """
    await log_activity(
        supabase,
        user_id,
        "RUN_PREDICTION",
        {"lat": lat, "lon": lon, "hours": hours},
    )

    num_intervals = hours // 3
    predictions: List[TrendPrediction] = []

    for i in range(num_intervals):
        interval_hour = (i + 1) * 3
        # Introduce a realistic diurnal-like variation using a sine wave
        phase = (interval_hour / 24.0) * 2 * math.pi
        no2 = round(_BASE_NO2 + 35.0 * math.sin(phase), 2)
        wind_speed = round(_BASE_WIND_SPEED + 3.0 * math.cos(phase), 2)
        wind_direction = round((_BASE_WIND_DIR + interval_hour * 5) % 360, 1)
        confidence = round(max(0.72, 0.95 - i * 0.03), 2)

        predictions.append(
            TrendPrediction(
                hour=interval_hour,
                no2_concentration=no2,
                wind_speed=wind_speed,
                wind_direction=wind_direction,
                confidence=confidence,
            )
        )

    # TODO: integrate ML engine
    return TrendsResponse(lat=lat, lon=lon, hours=hours, predictions=predictions)
