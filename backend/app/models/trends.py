from typing import List, Optional, Dict, Any
from pydantic import BaseModel


class TrendPrediction(BaseModel):
    hour: int
    no2_concentration: float
    wind_speed: float
    wind_direction: float
    confidence: float


class TrendsResponse(BaseModel):
    lat: float
    lon: float
    hours: int
    predictions: List[TrendPrediction]


# ── New forecasting endpoint models ──────────────────────────────────────────

class ForecastFrame(BaseModel):
    horizon_min: int
    geotiff_url: str
    confidence_mean: float
    mass_error: float


class ForecastResponse(BaseModel):
    bbox: List[float]
    timestamp: str
    interval_min: int
    frames: List[ForecastFrame]
    wind_geojson_url: str
    netcdf_url: str
    units: str
    physics_only: bool


