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


def test_answer_uses_context_and_caches(gemini):
    assert chat.answer_question("Is it safe?", CONTEXT) == "NO₂ is **141 µg/m³**."
    prompt = gemini[0]["contents"][0]["parts"][0]["text"]
    assert "141" in prompt and "Is it safe?" in prompt
    assert '"observed": {"count": 30' in prompt  # long series summarised
    assert chat.answer_question("Is it safe?", CONTEXT) == "NO₂ is **141 µg/m³**."
    assert len(gemini) == 1  # second answer from the cache


def test_no_key_or_error_returns_none(gemini, monkeypatch):
    monkeypatch.setattr(chat.httpx, "post", lambda *a, **k: _Resp(429, {}))
    assert chat.answer_question("Why so high?", CONTEXT) is None
    usage = json.loads((llm.CACHE_DIR / "_chat_usage.json").read_text())
    assert usage["cooldown_until"] > 0  # chat has its own budget file
    assert not (llm.CACHE_DIR / "_usage.json").exists()
    monkeypatch.setattr(chat, "setting", lambda name, default=None: default)
    assert chat.answer_question("Why?", CONTEXT) is None
