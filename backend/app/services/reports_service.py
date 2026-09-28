import asyncio
import io
import re
from typing import List, Optional

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from supabase import Client

from app.core.config import settings
from app.services.activity_service import log_activity
from app.services import upload_data
from ml_engine.report import analyse_area as build_analysis
from ml_engine.report import analyse_upload, generate_upload_report
from ml_engine.report.chat import answer_question
from ml_engine.report import generate_report as build_report


def _parse_bbox(bbox: str) -> List[float]:
    try:
        values = [float(v.strip()) for v in bbox.split(",")]
    except ValueError:
        raise HTTPException(status_code=422, detail="bbox must be four comma-separated numbers")
    if len(values) != 4 or not (values[0] < values[2] and values[1] < values[3]):
        raise HTTPException(status_code=422, detail="bbox must be min_lon,min_lat,max_lon,max_lat")
    return values


def _filename(region_name: str, date: str, language: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "_", region_name).strip("_")[:40] or "area"
    return f"no2_report_{slug}_{date}_{language}.pdf"


async def _call_engine(fn, bbox: str, city: Optional[str], **kwargs):
    """Run an ML engine report function off the event loop for a known city (falling back to the bbox for
    an unknown name) and map engine errors to HTTP errors."""
    parsed_bbox = tuple(_parse_bbox(bbox))
    kwargs["ee_project"] = settings.EE_PROJECT
    try:
        try:
            return await asyncio.to_thread(fn, **({"city": city} if city else {"bbox": parsed_bbox}), **kwargs)
        except KeyError:  # unknown city name: fall back to the bounding box
            return await asyncio.to_thread(fn, bbox=parsed_bbox, **kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:  # Earth Engine outage / quota, missing satellite data
        raise HTTPException(status_code=503, detail=f"Report generation failed: {exc}") from exc


async def analyse_area(
    region_name: str,
    bbox: str,
    end_date: str,
    language: str = "en",
    city: Optional[str] = None,
    data_source: Optional[str] = None,
) -> dict:
    """
    The report's analysis as JSON for the web page: the area's NO2 on ``end_date`` against the CPCB NAAQS
    and WHO standards, hotspots, population exposure, forecast alerts and the weather-adjusted trend.
    Uses the same cached pipeline run as the PDF and never calls Gemini.
    """
    if data_source == "upload":
        try:
            return await asyncio.to_thread(analyse_upload, upload_data.data_dir(), end_date[:10], region_name, language,
                                           settings.EE_PROJECT)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        except Exception as exc:  # no model output for the uploaded data yet
            raise HTTPException(status_code=503, detail=f"Report generation failed: {exc}") from exc
    return await _call_engine(build_analysis, bbox, city, date=end_date[:10], area_name=region_name,
                              language=language)


async def generate_report(
    supabase: Client,
    user_id: str,
    region_name: str,
    bbox: str,
    start_date: str,
    end_date: str,
    language: str = "en",
    use_ai: bool = True,
    city: Optional[str] = None,
    data_source: Optional[str] = None,
) -> StreamingResponse:
    """
    Generate the area NO2 report as a PDF.

    The ML engine maps the area for the 30 days up to ``end_date`` (cached after the first request),
    compares the report day with the CPCB NAAQS / WHO standards and adds hotspots, population
    exposure, forecast alerts and the weather-adjusted trend. The narrative sections come from Gemini
    when a key is configured (one call per report, cached) and from built-in templates otherwise.

    Args:
        supabase: Active Supabase client.
        user_id: UUID of the requesting user.
        region_name: Display name for the area (shown in the report).
        bbox: "min_lon,min_lat,max_lon,max_lat".
        start_date: Start of the requested period (informational; trends use 30 days up to end_date).
        end_date: The day the report describes.
        language: "en", "hi" or "mr".
        use_ai: Whether to try the Gemini narrative.
        city: Optional known city name; overrides bbox.
    """
    if data_source == "upload":
        try:
            pdf_bytes, meta = await asyncio.to_thread(
                generate_upload_report, upload_data.data_dir(), end_date[:10], region_name, language, use_ai,
                settings.EE_PROJECT, settings.GEMINI_API_KEY)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        except Exception as exc:  # e.g. no uploaded files
            raise HTTPException(status_code=503, detail=f"Report generation failed: {exc}") from exc
    else:
        pdf_bytes, meta = await _call_engine(
            build_report, bbox, city, date=end_date[:10], area_name=region_name, language=language, use_ai=use_ai,
            gemini_api_key=settings.GEMINI_API_KEY,
        )

    await log_activity(
        supabase,
        user_id,
        "EXPORT_REPORT",
        {"region_name": region_name, "bbox": bbox, "start_date": start_date, "end_date": end_date,
         "language": meta["language"], "narrative": meta["narrative"]},
    )

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{_filename(region_name, meta["date"], meta["language"])}"',
            "X-Report-Status": meta["status"],
            "X-Report-Narrative": meta["narrative"],
            "X-Report-Language": meta["language"],
            "X-Report-Notice": meta.get("notice") or "",
        },
    )


async def chat_answer(question: str, context: dict, language: str = "en", history: Optional[list] = None) -> dict:
    """Gemini's answer to a typed question from the AI model's output for the area (``answer`` is None when
    AI is unavailable; the page then answers from its templates; ``source`` is ai / guardrail / none)."""
    answer, source = await asyncio.to_thread(answer_question, question, context, language, history or [],
                                             settings.GEMINI_API_KEY)
    return {"answer": answer, "source": source}
