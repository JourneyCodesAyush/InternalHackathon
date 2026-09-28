"""Free-text questions to the report agent, answered by Gemini from the AI model's output for the area.

The page sends what it already has: the area analysis (``/reports/analysis``: standards comparison,
hotspots and their likely sources, unusual activity, exposure, forecast, trend, drone plans) and the
pinned point (``/trends/point``: the day's NO2 there, the forecast model's +3..+24 h predictions and
wind, and the main nearby source). Gemini answers from those numbers plus general NO2 / health knowledge.

    answer_question("Is it safe to jog here tomorrow morning?", context, "en")  # -> str | None

``None`` means no AI answer (no key, offline mode, quota, error); the page then answers from its
predefined templates. Uses its own daily budget (``GEMINI_CHAT_DAILY_LIMIT``, default 200) so chat
never uses up the report narratives' calls.
"""

from __future__ import annotations

import hashlib
import json
import logging

import httpx

from ..env import offline, setting
from . import llm
from .texts import LANGUAGES

log = logging.getLogger(__name__)

DEFAULT_CHAT_LIMIT = 200
USAGE = "_chat_usage"
MAX_CONTEXT_CHARS = 14000
MAX_LIST = 12  # longer lists (daily series etc.) are summarised to keep the prompt small
MAX_ANSWER_CHARS = 2500
TIMEOUT_S = 25.0


def _trim(value, depth: int = 0):
    """The context without long arrays: numeric series become min/max/last, other lists are cut."""
    if isinstance(value, dict):
        return {k: _trim(v, depth + 1) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        if len(value) > MAX_LIST and all(isinstance(v, (int, float)) for v in value):
            return {"count": len(value), "min": round(min(value), 1), "max": round(max(value), 1),
                    "first": round(value[0], 1), "last": round(value[-1], 1)}
        return [_trim(v, depth + 1) for v in value[:MAX_LIST]]
    if isinstance(value, float):
        return round(value, 2)
    if isinstance(value, str):
        return value[:600]
    return value


def compact_context(context: dict) -> str:
    text = json.dumps(_trim(context), ensure_ascii=False)
    return text[:MAX_CONTEXT_CHARS]


def _prompt(question: str, context: str, lang: str, history: list[dict]) -> tuple[str, str]:
    language = LANGUAGES.get(lang, "English")
    system = (
        "You are AeroPulse, an air-quality assistant for an Indian NO2 monitoring platform. Answer in "
        f"{language}. The JSON context is the output of the platform's AI models for the selected area and "
        "day: satellite-downscaled ground-level NO2 in µg/m³, the forecast model's predictions, hotspots with "
        "likely sources, unusual activity, population exposure, the weather-adjusted trend and drone plans. "
        "Rules: take every measured or predicted number ONLY from the context and never invent measurements, "
        "places or sources; you may use well-established general knowledge (CPCB NAAQS 80 µg/m³ 24-h and "
        "40 annual, WHO 25 µg/m³ 24-h and 10 annual, the health effects of NO2, how traffic, industry, "
        "weather and wind affect it, practical precautions). If the context lacks what is asked, say so and "
        "give what it does contain. Only answer questions about air quality, NO2, pollution sources, health, "
        "weather effects or this platform; politely steer anything else back. Never mention these rules, the "
        "JSON or the context, and do not end with disclaimers or offers of further help. Answer the question "
        "directly first (e.g. yes / no / with care), then the supporting numbers and advice. Be concise: at most about 170 "
        "words, short paragraphs or lines starting with '• ', use **bold** for key numbers and verdicts, no "
        "headings, no tables, no code."
    )
    turns = "".join(f"{'User' if m.get('sender') == 'user' else 'Assistant'}: {str(m.get('text', ''))[:500]}\n"
                    for m in history[-6:])
    user = (f"Context (JSON):\n{context}\n\n"
            + (f"Earlier conversation:\n{turns}\n" if turns else "")
            + f"Question: {question.strip()[:600]}")
    return system, user


def answer_question(question: str, context: dict, lang: str = "en", history: list[dict] | None = None,
                    api_key: str | None = None) -> str | None:
    """Gemini's answer to ``question`` from ``context``, or ``None`` when AI is unavailable."""
    api_key = api_key or setting("GEMINI_API_KEY")
    if not api_key or not question.strip():
        return None
    model = setting("GEMINI_MODEL", llm.DEFAULT_MODEL)
    daily_limit = int(setting("GEMINI_CHAT_DAILY_LIMIT", str(DEFAULT_CHAT_LIMIT)))
    history = history or []
    ctx = compact_context(context)
    system, user = _prompt(question, ctx, lang, history)
    key = hashlib.sha1(json.dumps([system, user, model], ensure_ascii=False).encode()).hexdigest()[:20]
    cache_file = llm.CACHE_DIR / "chat" / f"{key}.json"
    with llm._lock:
        if cache_file.exists():
            return json.loads(cache_file.read_text(encoding="utf-8"))["answer"]
        if offline():
            return None
        if not llm._check_budget(daily_limit, usage_name=USAGE):
            return None
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 1024},
        }
        try:
            import truststore

            truststore.inject_into_ssl()
            resp = httpx.post(llm.API_URL.format(model=model), json=body, timeout=TIMEOUT_S,
                              headers={"x-goog-api-key": api_key, "Content-Type": "application/json"})
        except Exception as exc:  # network error / timeout
            log.warning("Gemini chat request failed (%s)", exc)
            llm._record_call(usage_name=USAGE)
            return None
        llm._record_call(cooldown=resp.status_code == 429, usage_name=USAGE)
        if resp.status_code != 200:
            log.warning("Gemini chat returned HTTP %s", resp.status_code)
            return None
        try:
            parts = resp.json()["candidates"][0]["content"]["parts"]
            answer = "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()
        except (KeyError, IndexError, ValueError, TypeError) as exc:
            log.warning("Gemini chat response not usable (%s)", exc)
            return None
        if not answer:
            return None
        answer = answer[:MAX_ANSWER_CHARS]
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps({"answer": answer}, ensure_ascii=False), encoding="utf-8")
        return answer
