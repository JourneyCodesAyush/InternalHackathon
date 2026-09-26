from typing import List
from pydantic import BaseModel


class DownscaleMapResponse(BaseModel):
    resolution: str
    bbox: List[float]
    timestamp: str
    grid_url: str
    format: str
