"""Automated area air-quality reports: standards comparison, hotspots, population exposure, forecast
alerts and weather-adjusted trends, in English, Hindi or Marathi, with an optional Gemini narrative.

    from ml_engine.report import generate_report
    pdf_bytes, meta = generate_report(city="Mumbai", date="2025-12-31", language="hi")
"""

from __future__ import annotations

import logging
import os

from .. import service
from ..cities import city_bbox
from .analysis import analyse_run
from .llm import generate_narrative
from .pdf import build_pdf, resolve_fonts
from .texts import LANGUAGES

log = logging.getLogger(__name__)


def build_facts(bbox=None, date=None, city=None, area_name=None, ee_project=None, source="gee") -> dict:
    """Run (or reuse) the pipeline for the 30 days up to ``date`` and compute all report facts."""
    if (bbox is None) == (city is None):
        raise ValueError("Pass exactly one of bbox or city")
    bbox = city_bbox(city) if city else tuple(bbox)
    day = service._parse_date(date)
    run_dir = service._run(bbox, day, ee_project or os.environ.get("EE_PROJECT"), source)
    return analyse_run(run_dir, str(day.date()), area_name or city or "Selected area")


def generate_report(bbox=None, date=None, city=None, area_name=None, language="en", use_ai=True,
                    ee_project=None, source="gee", gemini_api_key=None) -> tuple[bytes, dict]:
    """PDF bytes + metadata (status, narrative source, language actually used)."""
    if language not in LANGUAGES:
        raise ValueError(f"language must be one of {sorted(LANGUAGES)}")
    facts = build_facts(bbox=bbox, date=date, city=city, area_name=area_name, ee_project=ee_project, source=source)
    used_language, fallback = language, False
    if language != "en" and not resolve_fonts()[2]:
        log.warning("No Devanagari font found; producing the report in English")
        used_language, fallback = "en", True
    narrative = generate_narrative(facts, used_language, gemini_api_key) if use_ai else None
    pdf = build_pdf(facts, used_language, narrative, language_fallback=fallback)
    meta = {"status": facts["current"]["status"], "area_mean": facts["current"]["mean"], "date": facts["date"],
            "language": used_language, "narrative": "ai" if narrative else "template",
            "narrative_model": (narrative or {}).get("model")}
    return pdf, meta


__all__ = ["build_facts", "generate_report"]
