from typing import List
from pydantic import BaseModel


class PinpointRequest(BaseModel):
    lat: float
    lon: float
    radius_km: float = 5.0


class PollutionSource(BaseModel):
    name: str
    category: str
    attribution_weight: float
    distance_km: float


class PinpointResponse(BaseModel):
    location: dict
    radius_km: float
    sources: List[PollutionSource]
    summary: str
