"""Report agent chat: Gemini answers typed questions from the model output (mocked), with fallbacks."""

import json

import pytest

from ml_engine.report import chat, llm

CONTEXT = {
    "area": "Shivaji Park, Mumbai", "date": "2025-11-12",
    "point": {"no2_ugm3": 141, "forecast": [{"hours": 3, "no2": 79}, {"hours": 24, "no2": 79}]},
    "analysis": {"trend": {"observed": list(range(30))}},
}


class _Resp:
    def __init__(self, status, payload):
        self.status_code, self._payload = status, payload

    def json(self):
        return self._payload


@pytest.fixture
def gemini(monkeypatch, tmp_path):
    monkeypatch.setattr(llm, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(llm, "MIN_INTERVAL_S", 0)
    monkeypatch.setattr(chat, "setting", lambda name, default=None: {"GEMINI_API_KEY": "k"}.get(name, default))
    monkeypatch.setattr(chat, "offline", lambda: False)
    calls = []

    def post(url, json=None, **kw):
        calls.append(json)
        return _Resp(200, {"candidates": [{"content": {"parts": [{"text": "NO₂ is **141 µg/m³**."}]}}]})

    monkeypatch.setattr(chat.httpx, "post", post)
    return calls


def test_answer_uses_context_not_cached(gemini):
    assert chat.answer_question("Is the NO2 here safe?", CONTEXT) == ("NO₂ is **141 µg/m³**.", "ai")
    prompt = gemini[0]["contents"][0]["parts"][0]["text"]
    assert "141" in prompt and "Is the NO2 here safe?" in prompt
    assert '"observed": {"count": 30' in prompt  # long series summarised
    chat.answer_question("Is the NO2 here safe?", CONTEXT)
    assert len(gemini) == 2  # asked again -> a fresh answer, not a cached one
    assert gemini[0]["generationConfig"]["temperature"] >= 0.7


@pytest.mark.parametrize("q", ["give me a pasta recipe", "write python code for sorting", "tell me a joke",
                               "what is the capital of France"])
def test_off_topic_refused_without_gemini(gemini, q):
    answer, source = chat.answer_question(q, CONTEXT)
    assert source == "guardrail" and "NO₂" in answer
    assert gemini == []


@pytest.mark.parametrize("q", ["is the polution bad today", "how dangerus is this for asthama",
                               "can I go jogging in the morning", "Which factory is causing this?"])
def test_fuzzy_on_topic_with_typos(q):
    assert chat.relevance(q)["on_topic"]


def test_follow_up_and_model_refusal(gemini, monkeypatch):
    assert chat.relevance("why?", has_history=True)["on_topic"]
    assert not chat.relevance("why?")["on_topic"]
    monkeypatch.setattr(chat.httpx, "post", lambda *a, **k: _Resp(
        200, {"candidates": [{"content": {"parts": [{"text": "OFF_TOPIC"}]}}]}))
    answer, source = chat.answer_question("What is the weather like in Paris", CONTEXT)
    assert source == "guardrail"


def test_no_key_or_error_returns_none(gemini, monkeypatch):
    monkeypatch.setattr(chat.httpx, "post", lambda *a, **k: _Resp(429, {}))
    assert chat.answer_question("Why is NO2 so high?", CONTEXT) == (None, "none")
    usage = json.loads((llm.CACHE_DIR / "_chat_usage.json").read_text())
    assert usage["cooldown_until"] > 0  # chat has its own budget file
    assert not (llm.CACHE_DIR / "_usage.json").exists()
    monkeypatch.setattr(chat, "setting", lambda name, default=None: default)
    assert chat.answer_question("Why is NO2 high?", CONTEXT) == (None, "none")
