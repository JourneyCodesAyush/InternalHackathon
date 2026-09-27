from typing import List
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
