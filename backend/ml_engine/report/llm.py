"""Optional Gemini narrative for reports — one call per report, cached, rate-limited, fact-checked.

The model receives only numbers already computed by ``analysis`` and returns three short narrative
parts (executive summary, risk context, recommendations) in the requested language. Anything that
fails — no key, quota, timeout, bad JSON, or a number that is not in the facts — falls back to the
predefined template for that part, so a report is always complete.

Configuration (environment or ``backend/.env``): ``GEMINI_API_KEY`` (required to use AI),
``GEMINI_MODEL`` (default ``gemini-3.5-flash-lite``), ``GEMINI_DAILY_LIMIT`` (default 40 calls/day).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
from datetime import date
from pathlib import Path

import httpx

from ..env import setting
from .texts import LANGUAGES, fmt_date, fmt_people

log = logging.getLogger(__name__)

API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_MODEL = "gemini-3.5-flash-lite"
DEFAULT_DAILY_LIMIT = 40
MIN_INTERVAL_S = 5.0  # between calls, well under free-tier per-minute limits
COOLDOWN_S = 120.0  # after a 429/quota error, don't call again for a while
TIMEOUT_S = 30.0
MIN_CALL_S = 3.0  # skip the call when less time than this is left in the caller's budget
CACHE_DIR = Path(os.environ.get("ML_ENGINE_LLM_CACHE", "cache/report_llm"))
_lock = threading.Lock()

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "executive_summary": {"type": "STRING"},
        "risk_context": {"type": "STRING"},
        "recommendations": {"type": "ARRAY", "items": {"type": "STRING"}},
    },
    "required": ["executive_summary", "risk_context", "recommendations"],
}
LIMITS = {"executive_summary": 1200, "risk_context": 1000, "recommendation": 240}
DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")


def compact_facts(facts: dict, lang: str = "en") -> dict:
    """The subset of facts the model needs, rounded, without arrays or large objects. Dates and people
    counts also come pre-formatted for the report language (e.g. "31 दिसंबर 2025", "2.2 करोड़")."""
    cur, pop, fc, tr = facts["current"], facts.get("population"), facts["forecast"], facts.get("trend")
    return {
        "area": facts["area"]["name"], "date": facts["date"], "date_display": fmt_date(facts["date"], lang),
        "standards_ugm3": {"cpcb_naaqs_24h": 80, "cpcb_naaqs_annual": 40, "who_24h": 25, "hazardous_above": 180},
        "status": cur["status"], "area_band": cur["band"],
        "area_average_ugm3": round(cur["mean"]), "percent_vs_24h_standard": round(cur["pct_vs_naaqs"]),
        "highest_cell_ugm3": round(cur["max"]), "highest_cell_near": cur["max_near"],
        "percent_area_above_80": round(cur["share_above_naaqs"] * 100),
        "percent_area_above_who_25": round(cur["share_above_who"] * 100),
        "period_average_ugm3": round(facts["window_stats"]["mean"]),
        "hotspots": [{"near": h["near"], "no2_ugm3": round(h["value"]), "likely_sources": h["sources"]}
                     for h in facts["hotspots"]],
        "population": None if not pop else {
            "total": pop["total"], "total_display": fmt_people(pop["total"], lang),
            "people_above_80": pop["above_naaqs"], "people_above_80_display": fmt_people(pop["above_naaqs"], lang),
            "percent_people_above_80": round(pop["share_above_naaqs"] * 100),
            "population_weighted_average_ugm3": round(pop["weighted_mean"])},
        "forecast_alerts": [{"type": a["code"], "within_hours": a["hours"], "percent_area": round(a["share"] * 100)}
                            for a in fc["alerts"]],
        "wind_m_per_s": fc["wind_speed"],
        "weather_adjusted_trend": None if not tr else {
            "direction": tr["direction"], "change_ugm3_per_week": tr["slope_adjusted_per_week"],
            "weather_effect_today_ugm3": round(tr["weather_effect_today"]), "days": tr["days"]},
        "model_accuracy_note": "Ground-level values are indicative (typical error about ±23 ug/m3 per station-day).",
    }


def _prompt(cf: dict, lang: str) -> tuple[str, str]:
    language = LANGUAGES[lang]
    system = (
        "You are an environmental data analyst writing an official air-quality report for Indian government "
        f"officials and researchers. Write in {language}. Use ONLY the facts given as JSON: never invent numbers, "
        "places, dates or pollution sources, and never state a number that is not in the facts. Write numbers "
        "with Western digits (0-9). Write dates and population counts exactly as the *_display fields give them. "
        "Plain, formal language; no markdown, no bullet symbols."
    )
    user = (
        "Facts (JSON):\n" + json.dumps(cf, ensure_ascii=False) + "\n\n"
        f"Return JSON with: executive_summary (3-4 sentences, max 110 words, in {language}), "
        f"risk_context (2-3 sentences, max 90 words: health implications and likely sources, in {language}), "
        f"recommendations (3-5 short actionable items for authorities, each max 25 words, in {language}). "
        "Base the recommendations on the status, hotspots, forecast alerts and trend."
    )
    return system, user


def _numbers(text: str) -> list[float]:
    return [float(x) for x in re.findall(r"\d+(?:\.\d+)?", text.translate(DEVANAGARI_DIGITS).replace(",", ""))]


def _allowed_numbers(cf: dict) -> set[float]:
    allowed = {0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 12.0, 24.0, 25.0, 40.0, 80.0, 100.0, 180.0, 250.0, 2.5, 7.0, 30.0}
    for x in _numbers(json.dumps(cf, ensure_ascii=False)):
        allowed.update({x, float(round(x)), round(x, 1)})
    for key in ("population",):
        p = cf.get(key) or {}
        for v in (p.get("total"), p.get("people_above_80")):
            if v:  # the model may write people in millions / lakh / crore
                for unit in (1e6, 1e5, 1e7):
                    allowed.update({round(v / unit, 1), float(round(v / unit))})
    return allowed


def _grounded(text: str, allowed: set[float]) -> bool:
    """True when every number in ``text`` appears in the facts (within rounding)."""
    for x in _numbers(text):
        if not any(abs(x - a) <= max(1.0, 0.02 * abs(a)) for a in allowed):
            return False
    return True


def _usage_path() -> Path:
    return CACHE_DIR / "_usage.json"


def _check_budget(daily_limit: int, time_left: float | None = None) -> bool:
    try:
        usage = json.loads(_usage_path().read_text())
    except (OSError, ValueError):
        usage = {}
    now = time.time()
    if usage.get("cooldown_until", 0) > now:
        log.warning("Gemini in cooldown after a quota error; using template text")
        return False
    if usage.get("day") == str(date.today()) and usage.get("count", 0) >= daily_limit:
        log.warning("Gemini daily limit (%d) reached; using template text", daily_limit)
        return False
    wait = max(0.0, MIN_INTERVAL_S - (now - usage.get("last_call", 0)))
    if time_left is not None and wait + MIN_CALL_S > time_left:
        log.info("Not enough time left for a Gemini call; using template text")
        return False
    if wait > 0:
        time.sleep(wait)
    return True


def _record_call(cooldown: bool = False) -> None:
    try:
        usage = json.loads(_usage_path().read_text())
    except (OSError, ValueError):
        usage = {}
    today = str(date.today())
    if usage.get("day") != today:
        usage = {"day": today, "count": 0}
    usage["count"] = usage.get("count", 0) + 1
    usage["last_call"] = time.time()
    if cooldown:
        usage["cooldown_until"] = time.time() + COOLDOWN_S
    _usage_path().parent.mkdir(parents=True, exist_ok=True)
    _usage_path().write_text(json.dumps(usage))


def generate_narrative(facts: dict, lang: str, api_key: str | None = None,
                       deadline: float | None = None) -> dict | None:
    """AI-written narrative parts, or ``None`` when AI is unavailable. Parts failing the fact check are
    dropped individually (the caller uses the template for any missing part). ``deadline`` (a
    ``time.monotonic()`` value) caps the waiting and the request, so the report stays within its time budget."""
    api_key = api_key or setting("GEMINI_API_KEY")
    if not api_key:
        return None
    model = setting("GEMINI_MODEL", DEFAULT_MODEL)
    daily_limit = int(setting("GEMINI_DAILY_LIMIT", str(DEFAULT_DAILY_LIMIT)))
    cf = compact_facts(facts, lang)
    key = hashlib.sha1(json.dumps([cf, lang, model], sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:20]
    cache_file = CACHE_DIR / f"{key}.json"
    with _lock:
        if cache_file.exists():
            log.info("Gemini narrative from cache (%s)", cache_file.name)
            return json.loads(cache_file.read_text(encoding="utf-8"))
        time_left = None if deadline is None else deadline - time.monotonic()
        if not _check_budget(daily_limit, time_left):
            return None
        timeout = TIMEOUT_S if deadline is None else max(1.0, min(TIMEOUT_S, deadline - time.monotonic()))
        system, user = _prompt(cf, lang)
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 2048, "responseMimeType": "application/json",
                                 "responseSchema": SCHEMA},
        }
        try:
            import truststore

            truststore.inject_into_ssl()
            resp = httpx.post(API_URL.format(model=model), json=body, timeout=timeout,
                              headers={"x-goog-api-key": api_key, "Content-Type": "application/json"})
        except Exception as exc:  # network error / timeout
            log.warning("Gemini request failed (%s); using template text", exc)
            _record_call()
            return None
        _record_call(cooldown=resp.status_code == 429)
        if resp.status_code != 200:
            log.warning("Gemini returned HTTP %s; using template text", resp.status_code)
            return None
        try:
            parts = resp.json()["candidates"][0]["content"]["parts"]
            raw = json.loads("".join(p.get("text", "") for p in parts if not p.get("thought")))
        except (KeyError, IndexError, ValueError, TypeError) as exc:
            log.warning("Gemini response not usable (%s); using template text", exc)
            return None

        allowed = _allowed_numbers(cf)
        result: dict = {"model": model}
        for field in ("executive_summary", "risk_context"):
            text = str(raw.get(field, "")).strip()[:LIMITS[field]]
            if text and _grounded(text, allowed):
                result[field] = text
            elif text:
                log.warning("Gemini %s contained numbers not in the facts; using template", field)
        recos = [str(r).strip()[:LIMITS["recommendation"]] for r in raw.get("recommendations", []) if str(r).strip()]
        recos = [r for r in recos if _grounded(r, allowed)][:5]
        if len(recos) >= 2:
            result["recommendations"] = recos
        if len(result) == 1:
            return None
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        return result
