"""Intent parser — the first node of the LangGraph.

Tries *rule-based* extraction first (fast, no LLM call).
Falls back to Gemini only when the rules can't determine the intent.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime, timedelta
from typing import Any

from app.agent.prompts import INTENT_PROMPT
from app.agent.state import AgentState

log = logging.getLogger("agent.parser")

# ── Well-known Indian city bounding boxes ────────────────────────────────────
CITY_BBOXES: dict[str, dict[str, Any]] = {
    "mumbai":    {"bbox": "72.77,18.88,73.12,19.32", "lat": 19.076, "lon": 72.8777},
    "shivaji park": {"bbox": "72.825,19.015,72.850,19.038", "lat": 19.0269, "lon": 72.8378},
    "dadar":        {"bbox": "72.825,19.015,72.850,19.038", "lat": 19.0269, "lon": 72.8378},
    "delhi":     {"bbox": "76.84,28.40,77.35,28.88", "lat": 28.6139, "lon": 77.2090},
    "bangalore": {"bbox": "77.46,12.83,77.78,13.14", "lat": 12.9716, "lon": 77.5946},
    "bengaluru": {"bbox": "77.46,12.83,77.78,13.14", "lat": 12.9716, "lon": 77.5946},
    "chennai":   {"bbox": "80.15,12.90,80.32,13.22", "lat": 13.0827, "lon": 80.2707},
    "hyderabad": {"bbox": "78.30,17.30,78.60,17.55", "lat": 17.3850, "lon": 78.4867},
    "kolkata":   {"bbox": "88.25,22.45,88.48,22.65", "lat": 22.5726, "lon": 88.3639},
    "pune":      {"bbox": "73.75,18.43,73.99,18.63", "lat": 18.5204, "lon": 73.8567},
    "ahmedabad": {"bbox": "72.50,22.95,72.70,23.12", "lat": 23.0225, "lon": 72.5714},
    "jaipur":    {"bbox": "75.70,26.80,75.92,27.00", "lat": 26.9124, "lon": 75.7873},
    "lucknow":   {"bbox": "80.85,26.77,81.05,26.95", "lat": 26.8467, "lon": 80.9462},
    "nagpur":    {"bbox": "79.00,21.08,79.18,21.22", "lat": 21.1458, "lon": 79.0882},
    "surat":     {"bbox": "72.75,21.12,72.92,21.25", "lat": 21.1702, "lon": 72.8311},
    "thane":     {"bbox": "72.94,19.14,73.08,19.30", "lat": 19.2183, "lon": 72.9781},
    "patna":     {"bbox": "85.07,25.57,85.25,25.67", "lat": 25.6093, "lon": 85.1376},
    "bhopal":    {"bbox": "77.30,23.17,77.50,23.32", "lat": 23.2599, "lon": 77.4126},
    "chandigarh":{"bbox": "76.72,30.68,76.82,30.78", "lat": 30.7333, "lon": 76.7794},
    "indore":    {"bbox": "75.80,22.65,75.95,22.78", "lat": 22.7196, "lon": 75.8577},
    "varanasi":  {"bbox": "82.95,25.27,83.05,25.37", "lat": 25.3176, "lon": 82.9739},
}

# ── Intent keyword mapping ───────────────────────────────────────────────────
INTENT_KEYWORDS: dict[str, list[str]] = {
    "downscale":  ["downscale", "downscaling", "map", "no2 map", "no₂ map", "satellite", "heatmap", "air quality map"],
    "forecast":   ["forecast", "predict", "prediction", "future", "trend", "upcoming", "next hour", "next day"],
    "report":     ["report", "pdf", "generate report", "analysis report", "document"],
    "hotspot":    ["hotspot", "source", "pinpoint", "attribution", "pollution source", "factory", "industrial"],
    "analysis":   ["analysis", "analyse", "analyze", "compare", "standard", "naaqs", "who standard"],
    "greeting":   ["hello", "hi", "hey", "good morning", "good afternoon", "good evening", "namaste"],
    "help":       ["help", "what can you do", "capabilities", "features", "how to use"],
}

# ── Duration parsing ─────────────────────────────────────────────────────────
HOUR_PATTERN = re.compile(
    r"(?:for\s+)?(\d+)\s*(?:hour|hr|h)\b", re.IGNORECASE
)
DAY_PATTERN = re.compile(
    r"(?:for\s+)?(\d+)\s*(?:day|d)\b", re.IGNORECASE
)


def _detect_city(text: str) -> dict[str, Any] | None:
    """Return city metadata if we recognise a city name in the text."""
    lower = text.lower()
    for city, meta in CITY_BBOXES.items():
        if city in lower:
            return {"location": city.title(), **meta}
    return None


def _detect_intent(text: str) -> str:
    """Keyword-based intent detection — fast path."""
    lower = text.lower()
    scores: dict[str, int] = {}
    for intent, keywords in INTENT_KEYWORDS.items():
        for kw in keywords:
            if kw in lower:
                scores[intent] = scores.get(intent, 0) + 1
    if not scores:
        return "general_question"

    # Action tasks take priority over conversational intents
    action_tasks = [t for t in ("downscale", "forecast", "report", "hotspot", "analysis") if t in scores]
    if len(action_tasks) > 1:
        return "multi_task"
    if len(action_tasks) == 1:
        return action_tasks[0]

    # Non-action conversational intents
    if "help" in scores:
        return "help"
    if "greeting" in scores:
        return "greeting"

    return "general_question"


def _detect_hours(text: str) -> int | None:
    m = HOUR_PATTERN.search(text)
    if m:
        return int(m.group(1))
    m = DAY_PATTERN.search(text)
    if m:
        return int(m.group(1)) * 24
    # Natural language shortcuts
    lower = text.lower()
    if "two hour" in lower:
        return 2
    if "three hour" in lower:
        return 3
    if "six hour" in lower:
        return 6
    if "twelve hour" in lower or "half day" in lower:
        return 12
    if "one day" in lower or "24 hour" in lower or "a day" in lower:
        return 24
    return None


def _detect_date(text: str) -> str | None:
    # ISO date YYYY-MM-DD
    m = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", text)
    if m:
        return m.group(1)
    # DD/MM/YYYY or DD-MM-YYYY
    m = re.search(r"\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b", text)
    if m:
        p1, p2, yr = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if p1 > 12:  # Day first (e.g. 25/11/2025)
            return f"{yr:04d}-{p2:02d}-{p1:02d}"
        # Standard Indian date format DD/MM/YYYY
        return f"{yr:04d}-{p2:02d}-{p1:02d}"
    lower = text.lower()
    today = datetime.now(UTC)
    if "today" in lower:
        return today.strftime("%Y-%m-%d")
    if "yesterday" in lower:
        return (today - timedelta(days=1)).strftime("%Y-%m-%d")
    if "tomorrow" in lower:
        return (today + timedelta(days=1)).strftime("%Y-%m-%d")
    return None


def _detect_language(text: str) -> str:
    lower = text.lower()
    if any(w in lower for w in ("hindi", "हिन्दी", "हिंदी")):
        return "hi"
    if any(w in lower for w in ("marathi", "मराठी")):
        return "mr"
    return "en"


def rule_based_parse(user_message: str, history: list[dict[str, str]] | None = None) -> dict[str, Any]:
    """Fast, deterministic extraction — no LLM call."""
    result: dict[str, Any] = {
        "intent": _detect_intent(user_message),
        "language": _detect_language(user_message),
    }

    city = _detect_city(user_message)
    if city:
        result["location"] = city["location"]
        result["bbox"] = city["bbox"]
        result["lat"] = city["lat"]
        result["lon"] = city["lon"]
        result["region_name"] = city["location"]

    hours = _detect_hours(user_message)
    if hours:
        result["forecast_hours"] = hours

    date = _detect_date(user_message)
    if date:
        result["observation_date"] = date
        result["end_date"] = date

    return result


async def gemini_parse(user_message: str, history: list[dict[str, str]] | None = None) -> dict[str, Any]:
    """Fallback: call Gemini to extract structured params from ambiguous input."""
    from langchain_google_genai import ChatGoogleGenerativeAI

    from app.core.config import settings

    if not settings.GEMINI_API_KEY:
        log.warning("No GEMINI_API_KEY — returning rule-based parse only")
        return rule_based_parse(user_message, history)

    llm = ChatGoogleGenerativeAI(
        model="gemini-3.8-flash",
        google_api_key=settings.GEMINI_API_KEY,
        temperature=0,
    )

    prompt_text = INTENT_PROMPT.format(
        user_message=user_message,
        history=json.dumps(history or [], ensure_ascii=False),
    )

    try:
        resp = await llm.ainvoke(prompt_text)
        raw = resp.content if hasattr(resp, "content") else str(resp)
        if isinstance(raw, list):
            content = "".join(
                item.get("text", "") if isinstance(item, dict) else getattr(item, "text", str(item))
                for item in raw
            )
        else:
            content = str(raw)
        # Strip markdown code fences if present
        content = re.sub(r"```json\s*", "", content)
        content = re.sub(r"```\s*$", "", content)
        parsed = json.loads(content.strip())
        return {k: v for k, v in parsed.items() if v is not None}
    except Exception as exc:  # noqa: BLE001
        log.error("Gemini parse failed: %s — falling back to rules", exc)
        return rule_based_parse(user_message, history)


async def parse_intent(state: AgentState) -> AgentState:
    """LangGraph node: parse user intent from the query.

    Uses rules first. Falls back to Gemini only when intent is ``general_question``
    (ambiguous) and a Gemini key is available.
    """
    query = state.get("user_query", "")
    history = state.get("history", [])

    parsed = rule_based_parse(query, history)

    if parsed["intent"] == "general_question":
        parsed = await gemini_parse(query, history)

    # Merge parsed fields into state
    updates: dict[str, Any] = {"intent": parsed.get("intent", "general_question")}

    if "location" in parsed:
        updates["location"] = parsed["location"]
    if "bbox" in parsed:
        updates["bbox"] = parsed["bbox"]
    if "observation_date" in parsed or "end_date" in parsed:
        updates["observation_date"] = parsed.get("observation_date") or parsed.get("end_date", "")
    if "forecast_hours" in parsed:
        updates["forecast_duration"] = parsed["forecast_hours"]
    if "language" in parsed:
        updates["language"] = parsed["language"]
    if "region_name" in parsed:
        updates["location"] = parsed["region_name"]
    if "organization" in parsed:
        updates["organization"] = parsed["organization"]
    if "role" in parsed:
        updates["role"] = parsed["role"]
    if "additional_notes" in parsed:
        updates["additional_notes"] = parsed["additional_notes"]
    if parsed.get("tasks"):
        updates["requested_tasks"] = parsed["tasks"]
    elif parsed.get("intent") not in ("greeting", "help", "general_question"):
        updates["requested_tasks"] = [parsed["intent"]]

    updates["status"] = "thinking"

    # If intent is ambiguous but we have a previous intent from session, carry it forward
    # This handles follow-up messages like "Use date 2025-11-05" after "Forecast Mumbai"
    if updates.get("intent") == "general_question":
        prev_intent = state.get("intent", "")
        if prev_intent and prev_intent not in ("greeting", "help", "general_question"):
            updates["intent"] = prev_intent
            if "requested_tasks" not in updates:
                updates["requested_tasks"] = [prev_intent]

    return {**state, **updates}
