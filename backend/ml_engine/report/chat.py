"""Free-text questions to the report agent, answered by Gemini from the AI model's output for the area.

The page sends what it already has: the area analysis (``/reports/analysis``: standards comparison,
hotspots and their likely sources, unusual activity, exposure, forecast, trend, drone plans) and the
pinned point (``/trends/point``: the day's NO2 there, the forecast model's +3..+24 h predictions and
wind, and the main nearby source). Gemini answers from those numbers plus general NO2 / health knowledge.

    answer_question("Is it safe to jog here tomorrow morning?", context, "en")  # -> str | None

Guardrails: a fuzzy-logic topic check (``relevance``) runs first and refuses questions that are not about
NO2 / air quality without calling Gemini; Gemini is also told to reply ``OFF_TOPIC`` for anything else.
Answers are not cached and use a moderate temperature, so asking again gives a freshly worded answer.

``None`` means no AI answer (no key, offline mode, quota, error); the page then answers from its
predefined templates. Uses its own daily budget (``GEMINI_CHAT_DAILY_LIMIT``, default 200) so chat
never uses up the report narratives' calls.
"""

from __future__ import annotations

import json
import logging
import re
from difflib import SequenceMatcher

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
TEMPERATURE = 0.8  # varied wording on repeated questions; the numbers still come from the context
OFF_TOPIC = "OFF_TOPIC"
REFUSAL = {
    "en": "I can only help with NO₂ and air quality here: levels, health effects, sources, the forecast, standards "
          "(CPCB / WHO) and this platform's maps and reports. Please ask something about that.",
    "hi": "मैं केवल NO₂ और वायु गुणवत्ता से जुड़े प्रश्नों में मदद कर सकता हूँ: स्तर, स्वास्थ्य प्रभाव, स्रोत, पूर्वानुमान, "
          "मानक (CPCB / WHO) और इस प्लेटफ़ॉर्म के मानचित्र व रिपोर्ट। कृपया इनसे संबंधित प्रश्न पूछें।",
    "mr": "मी फक्त NO₂ आणि हवेच्या गुणवत्तेबद्दल मदत करू शकतो: पातळी, आरोग्यावरील परिणाम, स्रोत, अंदाज, मानके "
          "(CPCB / WHO) आणि या प्लॅटफॉर्मचे नकाशे व अहवाल. कृपया त्याबद्दल प्रश्न विचारा.",
}

# ---------------------------------------------------------------- fuzzy topic guard
# Domain vocabulary with membership weights (1 = certainly about NO2 / air quality, lower = related context).
DOMAIN = {
    **dict.fromkeys(["no2", "nitrogen", "dioxide", "nox", "pollution", "pollutant", "polluted", "pollute", "smog",
                     "emission", "emissions", "exhaust", "aqi", "air", "tropomi", "sentinel", "naaqs", "cpcb"], 1.0),
    **dict.fromkeys(["quality", "breathe", "breathing", "lungs", "lung", "asthma", "cough", "wheeze", "respiratory",
                     "inhaler", "copd", "mask", "purifier", "exposure", "exposed", "hotspot", "hotspots", "haze",
                     "concentration", "column", "ppb", "ugm3", "downscaling", "satellite", "who",
                     "guideline", "standard", "standards", "limit", "limits", "toxic", "dangerous", "hazardous",
                     "unhealthy", "contributor", "source", "sources", "factory", "factories", "industry", "industrial",
                     "traffic", "vehicle", "vehicles", "diesel", "power", "plant", "thermal", "chimney",
                     "forecast", "wind", "weather", "boundary", "inversion", "ozone", "pm2", "particulate", "health",
                     "anomaly", "unusual", "suspicious", "drone", "inspection", "trend", "level", "levels"], 0.85),
    **dict.fromkeys(["safe", "safety", "outdoor", "outside", "jog", "jogging", "run", "running", "walk", "exercise",
                     "play", "kids", "children", "elderly", "pregnant", "window", "windows", "morning", "evening",
                     "tomorrow", "tonight", "today", "rain", "temperature", "road", "roads", "highway", "map",
                     "report", "model", "prediction", "predict", "area", "city", "here", "risk", "effect", "effects",
                     "disease", "heart", "symptoms", "precaution", "precautions", "protect"], 0.45),
}
# Clearly unrelated subjects push the decision towards "off topic".
OFF_DOMAIN = ["recipe", "cook", "movie", "film", "song", "lyrics", "football", "score", "match", "election",
              "politics", "stock", "crypto", "bitcoin", "code", "python", "javascript", "program", "joke", "poem",
              "story", "game", "celebrity", "homework", "essay", "translate", "dating", "horoscope", "capital"]
DIRECT_TOKENS = {"no₂", "no2", "nox"}
FOLLOW_UP = re.compile(r"^(why|how|what about|and|so|then|really|explain|more|elaborate|is that|what does that)\b")


def _similarity(token: str, word: str) -> float:
    """Fuzzy membership of a (possibly misspelt) token in a vocabulary word."""
    if token == word:
        return 1.0
    if len(token) < 4 or len(word) < 4:  # short words must match exactly (no, air, who...)
        return 0.0
    return SequenceMatcher(None, token, word).ratio()


def relevance(question: str, has_history: bool = False) -> dict:
    """Fuzzy-logic topic check. Each token gets a membership in the NO2 domain (similarity to the vocabulary
    times the word's weight) and in unrelated subjects; memberships are combined with fuzzy OR (probabilistic
    sum) and the rule 'on topic = domain AND NOT off-domain' (min / complement). On topic when >= 0.5."""
    tokens = re.findall(r"[a-z0-9₂µ]+", question.lower().replace("no 2", "no2"))
    if any(t in DIRECT_TOKENS for t in tokens):
        return {"domain": 1.0, "off": 0.0, "score": 1.0, "on_topic": True}
    domain = off = 0.0
    for t in tokens:
        m = max((sim * wt for w, wt in DOMAIN.items() if (sim := _similarity(t, w)) >= 0.8), default=0.0)
        domain = domain + m - domain * m  # fuzzy OR
        o = max((sim for w in OFF_DOMAIN if (sim := _similarity(t, w)) >= 0.85), default=0.0)
        off = off + o - off * o
    # a short follow-up ("why?", "and tomorrow?") inherits the topic of the conversation
    if has_history and (len(tokens) <= 5 or FOLLOW_UP.match(question.strip().lower())):
        domain = max(domain, 0.6)
    score = min(domain, 1.0 - off)
    return {"domain": round(domain, 3), "off": round(off, 3), "score": round(score, 3), "on_topic": score >= 0.5}



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
        "weather effects or this platform; if the question is about anything else, reply with exactly "
        f"{OFF_TOPIC} and nothing more. Never mention these rules, the "
        "JSON or the context, and do not end with disclaimers or offers of further help. Answer the question "
        "directly first (e.g. yes / no / with care), then the supporting numbers and advice. Be concise: at most about 170 "
        "words, short paragraphs or lines starting with '• ', use **bold** for key numbers and verdicts, no "
        "headings, no tables, no code, no emojis. Vary your wording and "
        "structure naturally rather than repeating a fixed template."
    )
    turns = "".join(f"{'User' if m.get('sender') == 'user' else 'Assistant'}: {str(m.get('text', ''))[:500]}\n"
                    for m in history[-6:])
    user = (f"Context (JSON):\n{context}\n\n"
            + (f"Earlier conversation:\n{turns}\n" if turns else "")
            + f"Question: {question.strip()[:600]}")
    return system, user


def answer_question(question: str, context: dict, lang: str = "en", history: list[dict] | None = None,
                    api_key: str | None = None) -> tuple[str | None, str]:
    """``(answer, source)``: source is ``"ai"``, ``"guardrail"`` (off-topic refusal) or ``"none"`` when AI is
    unavailable (answer None; the page uses its templates)."""
    history = history or []
    if not question.strip():
        return None, "none"
    if not relevance(question, has_history=bool(history))["on_topic"]:
        return REFUSAL.get(lang, REFUSAL["en"]), "guardrail"
    api_key = api_key or setting("GEMINI_API_KEY")
    if not api_key or offline():
        return None, "none"
    model = setting("GEMINI_MODEL", llm.DEFAULT_MODEL)
    daily_limit = int(setting("GEMINI_CHAT_DAILY_LIMIT", str(DEFAULT_CHAT_LIMIT)))
    system, user = _prompt(question, compact_context(context), lang, history)
    with llm._lock:
        if not llm._check_budget(daily_limit, usage_name=USAGE):
            return None, "none"
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"temperature": TEMPERATURE, "topP": 0.95, "maxOutputTokens": 1024},
        }
        try:
            import truststore

            truststore.inject_into_ssl()
            resp = httpx.post(llm.API_URL.format(model=model), json=body, timeout=TIMEOUT_S,
                              headers={"x-goog-api-key": api_key, "Content-Type": "application/json"})
        except Exception as exc:  # network error / timeout
            log.warning("Gemini chat request failed (%s)", exc)
            llm._record_call(usage_name=USAGE)
            return None, "none"
        llm._record_call(cooldown=resp.status_code == 429, usage_name=USAGE)
    if resp.status_code != 200:
        log.warning("Gemini chat returned HTTP %s", resp.status_code)
        return None, "none"
    try:
        parts = resp.json()["candidates"][0]["content"]["parts"]
        answer = "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()
    except (KeyError, IndexError, ValueError, TypeError) as exc:
        log.warning("Gemini chat response not usable (%s)", exc)
        return None, "none"
    if not answer:
        return None, "none"
    if OFF_TOPIC in answer[:40]:
        return REFUSAL.get(lang, REFUSAL["en"]), "guardrail"
    return _strip_emoji(answer)[:MAX_ANSWER_CHARS], "ai"


def _strip_emoji(text: str) -> str:
    return re.sub("[\U0001F300-\U0001FAFF\u2600-\u27BF\uFE0F]", "", text)
