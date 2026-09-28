from typing import Literal, Optional

from pydantic import BaseModel


class ReportRequest(BaseModel):
    region_name: str
    bbox: str
    start_date: str
    end_date: str  # the report describes this day (the 30 days up to it are analysed for trends)
    language: Literal["en", "hi", "mr"] = "en"
    use_ai: bool = True  # Gemini narrative when a key is configured; the template is used otherwise
    city: Optional[str] = None  # a known city name overrides bbox (shared, cached city areas)
    # "upload": report on end_date of the uploaded daily data (backend/data/test_data), the data the map shows
    data_source: Optional[Literal["upload"]] = None
