"""Automated area air-quality reports: standards comparison, hotspots, population exposure, forecast
alerts and weather-adjusted trends, in English, Hindi or Marathi, with an optional Gemini narrative.

    from ml_engine.report import generate_report
    pdf_bytes, meta = generate_report(city="Mumbai", date="2025-12-31", language="hi")
    facts = analyse_area(city="Mumbai", date="2025-12-31")   # same analysis as JSON, for the web page
"""

from __future__ import annotations

import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout

from .. import service
from ..cities import city_bbox
from ..env import offline, setting
from .analysis import analyse_run
from .llm import generate_narrative
from .pdf import build_pdf, build_unavailable_pdf, resolve_fonts
from .texts import (BAND, LANGUAGES, SOURCE, STATUS, forecast_texts, notice_text, recommendations, summary_text,
                    trend_texts)

log = logging.getLogger(__name__)

# A report is due within REPORT_TIME_BUDGET_S. A new area/date takes minutes (Earth Engine download + model
# fitting), so after RUN_WAIT_S the report uses the latest stored map of the area; the run keeps going in the
# background and serves later requests. Whatever time is left (minus the PDF layout) is Gemini's.
REPORT_TIME_BUDGET_S = float(os.environ.get("REPORT_TIME_BUDGET_S", "15"))
RUN_WAIT_S = float(os.environ.get("REPORT_RUN_WAIT_S", "5"))
PDF_RESERVE_S = 3.0
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="report-run")


def build_facts(bbox=None, date=None, city=None, area_name=None, ee_project=None, source="gee") -> dict:
    """Run (or reuse) the pipeline for the 30 days up to ``date`` and compute all report facts."""
    if (bbox is None) == (city is None):
        raise ValueError("Pass exactly one of bbox or city")
    bbox = city_bbox(city) if city else tuple(bbox)
    day = service._parse_date(date)
    run_dir = service._run(bbox, day, ee_project or setting("EE_PROJECT"), source)
    return analyse_run(run_dir, str(day.date()), area_name or city or "Selected area")


_REASONS = (  # technical error text -> reason code, worded per language in texts.REASON (details stay in the log)
    (("offline mode",), "offline"),
    (("quota", "restricted mode", "too many", "429", "rate limit"), "quota"),
    (("no project", "ee_project", "credentials", "authenticate", "permission"), "config"),
    (("timed out", "timeout", "connection", "unreachable", "ssl"), "network"),
    (("no images", "empty", "no data", "not in this run"), "no_data"),
)


def _short_reason(exc: BaseException) -> str:
    if isinstance(exc, FutureTimeout):
        return "processing"
    text = str(exc).lower()
    for keys, reason in _REASONS:
        if any(k in text for k in keys):
            return reason
    return "error"


def gather_facts(bbox=None, date=None, city=None, area_name=None, ee_project=None,
                 source="gee") -> tuple[dict | None, dict | None]:
    """``(facts, notice)`` that degrade instead of failing: a fresh run for ``date``; if that fails or takes
    longer than ``RUN_WAIT_S`` (it then continues in the background and is cached for later requests), the
    most recent stored model map of the area; if there is none, ``facts`` is None. ``notice`` says why."""
    if (bbox is None) == (city is None):
        raise ValueError("Pass exactly one of bbox or city")
    bbox = city_bbox(city) if city else tuple(bbox)
    day = service._parse_date(date)
    name = area_name or city or "Selected area"
    if offline() and source == "gee":  # no new runs: go straight to stored maps (no 5 s wait)
        run_dir = service.stored_run(bbox, day, source)
        if run_dir is not None:
            return analyse_run(run_dir, str(day.date()), name), None
        reason = "offline"
    else:
        try:
            future = _executor.submit(service._run, bbox, day, ee_project or setting("EE_PROJECT"), source)
            return analyse_run(future.result(timeout=RUN_WAIT_S), str(day.date()), name), None
        except Exception as exc:  # noqa: BLE001 - Earth Engine quota/outage, missing data, timeouts
            log.warning("Fresh run for %s on %s failed (%s); looking for a stored map", bbox, day.date(), exc)
            reason = _short_reason(exc)
    for run_dir, use_day in service.cached_runs(bbox, day):
        try:
            facts = analyse_run(run_dir, use_day, name)
        except Exception:  # noqa: BLE001
            log.exception("Stored run %s could not be analysed", run_dir)
            continue
        if use_day == str(day.date()):  # the model's own map for the requested day (e.g. of an overlapping area)
            return facts, None
        facts["notice"] = {"code": "cached", "reason": reason, "requested_date": str(day.date()), "used_date": use_day}
        return facts, facts["notice"]
    return None, {"code": "unavailable", "reason": reason, "requested_date": str(day.date()), "used_date": None}


def generate_report(bbox=None, date=None, city=None, area_name=None, language="en", use_ai=True,
                    ee_project=None, source="gee", gemini_api_key=None) -> tuple[bytes, dict]:
    """PDF bytes + metadata (status, narrative source, language actually used, notice). Always returns a
    document: with the model's map for the date, else its latest stored map of the area, else the standards
    and health guidance; the Gemini narrative is optional on top of the built-in templates."""
    if language not in LANGUAGES:
        raise ValueError(f"language must be one of {sorted(LANGUAGES)}")
    started = time.monotonic()
    facts, notice = gather_facts(bbox=bbox, date=date, city=city, area_name=area_name, ee_project=ee_project,
                                 source=source)
    used_language, fallback = language, False
    if language != "en" and not resolve_fonts()[2]:
        log.warning("No Devanagari font found; producing the report in English")
        used_language, fallback = "en", True
    name = area_name or city or "Selected area"
    meta = {"status": "unavailable", "area_mean": None, "date": notice["requested_date"] if notice else None,
            "language": used_language, "narrative": "template", "narrative_model": None,
            "notice": notice["code"] if notice else None}
    if facts is None:
        return build_unavailable_pdf(name, notice["requested_date"], used_language, notice), meta

    meta.update(status=facts["current"]["status"], area_mean=facts["current"]["mean"], date=facts["date"])
    narrative = None
    if use_ai:
        try:
            narrative = generate_narrative(facts, used_language, gemini_api_key,
                                           deadline=started + REPORT_TIME_BUDGET_S - PDF_RESERVE_S)
        except Exception:  # noqa: BLE001 - the templates cover every section
            log.exception("Narrative failed; using templates")
    try:
        pdf = build_pdf(facts, used_language, narrative, language_fallback=fallback)
    except Exception:  # noqa: BLE001
        log.exception("Report layout failed in %s; retrying in English with templates", used_language)
        narrative = None
        try:
            pdf = build_pdf(facts, "en", None, language_fallback=used_language != "en")
            meta["language"] = "en"
        except Exception as exc:  # noqa: BLE001
            log.exception("Report layout failed; producing the standards document")
            pdf = build_unavailable_pdf(name, facts["date"], used_language, {
                "code": "unavailable", "reason": _short_reason(exc), "requested_date": facts["date"]})
            meta.update(status="unavailable", area_mean=None, notice="unavailable")
    meta.update(narrative="ai" if narrative else "template", narrative_model=(narrative or {}).get("model"))
    return pdf, meta


_NON_JSON = ("surface_map", "water_mask", "grid")


def _plain(text: str) -> str:
    """Report markup -> plain text for the web page ("NO<sub>2</sub>" -> "NO₂")."""
    return re.sub(r"<[^>]+>", "", text.replace("<sub>2</sub>", "₂"))


def public_facts(facts: dict, language: str = "en") -> dict:
    """JSON-safe facts plus labels and sentences in ``language`` (the PDF's template texts)."""
    out = {k: v for k, v in facts.items() if k not in _NON_JSON}
    out["language"] = language
    out["labels"] = {
        "status": STATUS[language][facts["current"]["status"]],
        "band": BAND[language][facts["current"]["band"]],
        "hotspot_sources": [[SOURCE[language][s] for s in h["sources"]] for h in facts["hotspots"]],
    }
    out["texts"] = {
        "summary": _plain(summary_text(facts, language)),
        "forecast": [_plain(t) for t in forecast_texts(facts, language)],
        "trend": [_plain(t) for t in trend_texts(facts, language)],
        "recommendations": [_plain(t) for t in recommendations(facts, language)],
        "notice": notice_text(facts["notice"], language) if facts.get("notice") else None,
    }
    return out


def analyse_area(bbox=None, date=None, city=None, area_name=None, language="en", ee_project=None,
                 source="gee") -> dict:
    """The report's analysis as JSON (no PDF, no Gemini call): standards comparison, hotspots, exposure,
    forecast alerts and trend."""
    if language not in LANGUAGES:
        raise ValueError(f"language must be one of {sorted(LANGUAGES)}")
    facts, notice = gather_facts(bbox=bbox, date=date, city=city, area_name=area_name, ee_project=ee_project,
                                 source=source)
    if facts is None:
        raise RuntimeError(f"No model output for this area yet: {notice['reason']}")
    return public_facts(facts, language)


__all__ = ["analyse_area", "build_facts", "gather_facts", "generate_report", "public_facts"]
