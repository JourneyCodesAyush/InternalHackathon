from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class ReportRequest(BaseModel):
    region_name: str
    bbox: str
    start_date: Optional[str] = None
    end_date: str  # the report describes this day (the 30 days up to it are analysed for trends)
    language: Literal["en", "hi", "mr"] = "en"
    use_ai: bool = True  # Gemini narrative when a key is configured; the template is used otherwise
    city: Optional[str] = None  # a known city name overrides bbox (shared, cached city areas)
    # "upload": report on end_date of the uploaded daily data (backend/data/test_data), the data the map shows
    data_source: Optional[Literal["upload"]] = None


class ChatMessage(BaseModel):
    sender: Literal["user", "agent"]
    text: str


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=600)
    language: Literal["en", "hi", "mr"] = "en"
    # what the page already has from the AI models: the area analysis and the pinned point's value/forecast
    context: dict[str, Any] = Field(default_factory=dict)
    history: list[ChatMessage] = Field(default_factory=list, max_length=20)
