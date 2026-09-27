"""Report agent: analysis facts, templates (en/hi/mr), Gemini guard-rails (mocked) and PDF output."""

import json

import numpy as np
import pandas as pd
import pytest

from ml_engine import service
from ml_engine.report import analyse_area, analysis, build_facts, generate_report, llm, public_facts, texts
from ml_engine.report.pdf import build_pdf, resolve_fonts

SMALL_BBOX = (72.80, 18.95, 72.975, 19.125)


@pytest.fixture(scope="module")
def runs_root(tmp_path_factory):
    mp = pytest.MonkeyPatch()
    root = tmp_path_factory.mktemp("runs")
    mp.setattr(service, "RUNS_ROOT", root)
    mp.setattr(service, "WINDOW_DAYS", 12)
    yield root
    mp.undo()


@pytest.fixture(scope="module")
def facts(runs_root):
    return build_facts(bbox=SMALL_BBOX, date="2025-11-20", area_name="Test area", source="synthetic")


# ------------------------------------------------------------------------------------------------ analysis
@pytest.mark.parametrize("mean,share,expected", [
    (30, 0.0, "normal"), (30, 0.10, "elevated"), (55, 0.0, "elevated"), (95, 0.6, "critical"), (200, 1.0, "critical_spike"),
])
def test_classify_status(mean, share, expected):
    assert analysis.classify_status(mean, share) == expected


def test_facts_are_complete(facts):
    cur = facts["current"]
    assert cur["status"] in {"normal", "elevated", "critical", "critical_spike"}
    assert 0 <= cur["share_above_naaqs"] <= 1 and 0 <= cur["share_above_who"] <= 1
    assert abs(sum(cur["band_shares"].values()) - 1) < 1e-6
    assert cur["pct_vs_naaqs"] == pytest.approx((cur["mean"] - 80) / 80 * 100, abs=0.2)
    assert [h["hours"] for h in facts["forecast"]["horizons"]] == [3, 6, 12, 24]
    assert facts["forecast"]["alerts"] and 1 <= len(facts["hotspots"]) <= 3
    assert facts["trend"] is not None and facts["trend"]["days"] == 12
    plain = {k: v for k, v in facts.items() if k not in ("surface_map", "grid", "water_mask")}
    json.dumps(plain)  # everything handed to templates / the LLM is serialisable


def test_weather_adjusted_trend_separates_weather_from_emissions():
    rng = np.random.default_rng(0)
    n = 30
    dates = pd.date_range("2025-11-01", periods=n)
    blh = rng.normal(900, 200, n)
    wind = rng.normal(3, 1, n)
    emissions_trend = 0.5 * np.arange(n)  # +3.5 ug/m3 per week from emissions
    observed = 40 + emissions_trend - 0.03 * (blh - 900) - 2.0 * (wind - 3) + rng.normal(0, 0.5, n)
    tr = analysis.weather_adjusted_trend(dates, observed, {"blh": blh, "wind_speed": wind}, report_index=n - 1)
    assert tr["direction"] == "rising"
    assert tr["slope_adjusted_per_week"] == pytest.approx(3.5, abs=0.6)
    assert tr["weather_r2"] > 0.3


# ------------------------------------------------------------------------------------------------ templates
@pytest.mark.parametrize("lang", ["en", "hi", "mr"])
def test_templates_cover_every_section(facts, lang):
    assert texts.summary_text(facts, lang).strip()
    assert texts.risk_text(facts, lang).strip()
    assert len(texts.recommendations(facts, lang)) >= 3
    assert texts.forecast_texts(facts, lang) and texts.trend_texts(facts, lang)
    assert texts.method_text(facts, lang).strip()
    for key in texts.T["en"]:
        assert key in texts.T[lang]


def test_people_formatting():
    assert texts.fmt_people(20_500_000, "en") == "20.5 million"
    assert texts.fmt_people(23_000_000, "hi") == "2.3 करोड़"
    assert texts.fmt_people(820_000, "mr") == "8.2 लाख"


# ------------------------------------------------------------------------------------------------ Gemini guard-rails
class _Resp:
    def __init__(self, status, payload=None):
        self.status_code, self._payload = status, payload

    def json(self):
        return self._payload


def _gemini_payload(obj):
    return {"candidates": [{"content": {"parts": [{"text": json.dumps(obj, ensure_ascii=False)}]}}]}


@pytest.fixture
def isolated_llm(tmp_path, monkeypatch):
    monkeypatch.setattr(llm, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(llm, "MIN_INTERVAL_S", 0.0)
    monkeypatch.setattr(llm, "setting", lambda name, default=None: {"GEMINI_API_KEY": "test-key"}.get(name, default))
    calls = []
    return calls


def test_no_key_means_no_call(facts, monkeypatch, tmp_path):
    monkeypatch.setattr(llm, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(llm, "setting", lambda name, default=None: default)
    monkeypatch.setattr(llm.httpx, "post", lambda *a, **k: pytest.fail("no HTTP call expected without a key"))
    assert llm.generate_narrative(facts, "en") is None


def test_narrative_is_fact_checked_and_cached(facts, isolated_llm, monkeypatch):
    mean = round(facts["current"]["mean"])
    answer = {
        "executive_summary": f"The area average was {mean} ug/m3 against the 80 ug/m3 standard.",
        "risk_context": "About 999 schools are affected.",  # invented number -> must be rejected
        "recommendations": ["Increase monitoring at hotspots.", "Advise sensitive groups.", "Review daily."],
    }

    def fake_post(*args, **kwargs):
        isolated_llm.append(kwargs["json"])
        return _Resp(200, _gemini_payload(answer))

    monkeypatch.setattr(llm.httpx, "post", fake_post)
    out = llm.generate_narrative(facts, "hi")
    assert out["executive_summary"].startswith("The area average")
    assert "risk_context" not in out  # fell back to the template for that part
    assert len(out["recommendations"]) == 3
    assert llm.generate_narrative(facts, "hi") == out  # second report: served from cache
    assert len(isolated_llm) == 1
    body = isolated_llm[0]
    assert body["generationConfig"]["responseMimeType"] == "application/json"
    assert "Hindi" in body["systemInstruction"]["parts"][0]["text"]


def test_quota_error_falls_back_and_cools_down(facts, isolated_llm, monkeypatch):
    monkeypatch.setattr(llm.httpx, "post", lambda *a, **k: (isolated_llm.append(1), _Resp(429))[1])
    assert llm.generate_narrative(facts, "en") is None
    assert llm.generate_narrative(facts, "mr") is None  # cooldown: no second request
    assert len(isolated_llm) == 1


# ------------------------------------------------------------------------------------------------ PDF
def _pages(pdf: bytes) -> int:
    return pdf.count(b"/Type /Page") - pdf.count(b"/Type /Pages")


def test_pdf_english(facts):
    pdf = build_pdf(facts, "en", None)
    assert pdf[:4] == b"%PDF" and _pages(pdf) >= 2


@pytest.mark.skipif(not resolve_fonts()[2], reason="no Devanagari font on this machine")
@pytest.mark.parametrize("lang", ["hi", "mr"])
def test_pdf_devanagari(facts, lang):
    narrative = {"executive_summary": "सारांश NO2 80", "recommendations": ["पहला", "दूसरा"], "model": "test"}
    pdf = build_pdf(facts, lang, narrative)
    assert pdf[:4] == b"%PDF" and _pages(pdf) >= 2


def test_generate_report_end_to_end(runs_root, monkeypatch, tmp_path):
    monkeypatch.setattr(llm, "CACHE_DIR", tmp_path)
    pdf, meta = generate_report(bbox=SMALL_BBOX, date="2025-11-20", area_name="Test area", language="en",
                                use_ai=False, source="synthetic")
    assert pdf[:4] == b"%PDF"
    assert meta["narrative"] == "template" and meta["language"] == "en" and meta["date"] == "2025-11-20"
    with pytest.raises(ValueError):
        generate_report(bbox=SMALL_BBOX, date="2025-11-20", language="fr", source="synthetic")


def test_public_facts_are_json_with_plain_texts(facts):
    out = public_facts(facts, "mr")
    text = json.dumps(out, ensure_ascii=False)
    assert "surface_map" not in out and "grid" not in out and "<sub>" not in text
    assert out["labels"]["status"] == texts.STATUS["mr"][facts["current"]["status"]]
    assert len(out["labels"]["hotspot_sources"]) == len(facts["hotspots"])
    assert out["texts"]["summary"] and out["texts"]["forecast"] and out["texts"]["recommendations"]


def test_analyse_area_matches_report_facts(runs_root):
    out = analyse_area(bbox=SMALL_BBOX, date="2025-11-20", area_name="Test area", language="hi", source="synthetic")
    assert out["date"] == "2025-11-20" and out["language"] == "hi"
    with pytest.raises(ValueError):
        analyse_area(bbox=SMALL_BBOX, date="2025-11-20", language="fr", source="synthetic")


def test_dates_without_weather_move_back():
    assert service._parse_date("2099-01-01") == service.latest_date()
    assert service._parse_date(None) == service.latest_date()
    assert service._parse_date("2025-11-20") == pd.Timestamp("2025-11-20")


# ------------------------------------------------------------------------------------------------ fallbacks
def _fail_run(*args, **kwargs):
    raise RuntimeError("Earth Engine quota exceeded")


def test_failed_run_falls_back_to_stored_map(runs_root, facts, monkeypatch, tmp_path):
    monkeypatch.setattr(llm, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(service, "_run", _fail_run)
    pdf, meta = generate_report(bbox=SMALL_BBOX, date="2025-11-25", area_name="Test area", use_ai=False,
                                source="synthetic")
    assert pdf[:4] == b"%PDF"
    assert meta["notice"] == "cached" and meta["date"] == "2025-11-20" and meta["status"] != "unavailable"
    out = analyse_area(bbox=SMALL_BBOX, date="2025-11-25", area_name="Test area", source="synthetic")
    assert out["notice"]["reason"] == "quota" and "usage limit" in out["texts"]["notice"]


def test_no_stored_map_still_gives_a_document(runs_root, monkeypatch, tmp_path):
    monkeypatch.setattr(service, "_run", _fail_run)
    far_away = (88.0, 22.0, 88.2, 22.2)
    for lang in ("en", "hi"):
        pdf, meta = generate_report(bbox=far_away, date="2025-11-20", language=lang, use_ai=False, source="synthetic")
        assert pdf[:4] == b"%PDF" and meta["status"] == "unavailable" and meta["notice"] == "unavailable"
    with pytest.raises(RuntimeError):
        analyse_area(bbox=far_away, date="2025-11-20", source="synthetic")


def test_failed_section_is_left_out(runs_root, monkeypatch, tmp_path):
    monkeypatch.setattr(llm, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(analysis, "_forecast", _fail_run)
    monkeypatch.setattr(analysis, "weather_adjusted_trend", _fail_run)
    for cached in runs_root.glob("*/report_facts_*.pkl"):  # recompute instead of reusing earlier analyses
        cached.unlink()
    pdf, meta = generate_report(bbox=SMALL_BBOX, date="2025-11-20", use_ai=False, source="synthetic")
    assert pdf[:4] == b"%PDF" and meta["notice"] is None
    out = analyse_area(bbox=SMALL_BBOX, date="2025-11-20", language="mr", source="synthetic")
    assert out["forecast"]["alerts"] == [] and out["trend"] is None
    assert out["texts"]["forecast"] == [texts.T["mr"]["no_forecast"]]


def test_narrative_failure_uses_templates(runs_root, monkeypatch, tmp_path):
    from ml_engine import report as report_pkg

    monkeypatch.setattr(report_pkg, "generate_narrative", _fail_run)
    pdf, meta = generate_report(bbox=SMALL_BBOX, date="2025-11-20", use_ai=True, source="synthetic")
    assert pdf[:4] == b"%PDF" and meta["narrative"] == "template"


def test_slow_run_falls_back_within_the_time_budget(runs_root, facts, monkeypatch, tmp_path):
    import time as time_mod

    from ml_engine import report as report_pkg

    monkeypatch.setattr(llm, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(report_pkg, "RUN_WAIT_S", 0.5)
    monkeypatch.setattr(service, "_run", lambda *a, **k: time_mod.sleep(3))
    started = time_mod.monotonic()
    pdf, meta = generate_report(bbox=SMALL_BBOX, date="2025-11-25", use_ai=False, source="synthetic")
    assert time_mod.monotonic() - started < 3
    assert pdf[:4] == b"%PDF" and meta["notice"] == "cached"


def test_facts_are_cached_per_run_and_date(runs_root, monkeypatch):
    build_facts(bbox=SMALL_BBOX, date="2025-11-20", area_name="First", source="synthetic")
    monkeypatch.setattr(analysis, "_compute_facts", _fail_run)  # must not be needed a second time
    again = build_facts(bbox=SMALL_BBOX, date="2025-11-20", area_name="Second name", source="synthetic")
    assert again["area"]["name"] == "Second name"


def test_offline_mode_never_starts_a_run(runs_root, facts, monkeypatch, tmp_path):
    from ml_engine.ingestion import gee

    monkeypatch.setenv("ML_ENGINE_OFFLINE", "true")
    monkeypatch.setattr(llm, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(service, "_run", lambda *a, **k: pytest.fail("offline mode must not start a pipeline run"))
    with pytest.raises(RuntimeError, match="offline"):
        gee.initialize("some-project")
    # a stored run for the day is used as is; another day falls back to it with an "offline" notice
    monkeypatch.setattr(service, "stored_run", lambda bbox, day, source="gee": None)
    pdf, meta = generate_report(bbox=SMALL_BBOX, date="2025-11-25", use_ai=False, source="gee")
    assert pdf[:4] == b"%PDF" and meta["notice"] == "cached"
    out = analyse_area(bbox=SMALL_BBOX, date="2025-11-25", language="hi", source="gee")
    assert out["notice"]["reason"] == "offline" and texts.REASON["hi"]["offline"] in out["texts"]["notice"]


def test_offline_mode_uses_only_cached_narratives(facts, isolated_llm, monkeypatch):
    monkeypatch.setenv("ML_ENGINE_OFFLINE", "true")
    monkeypatch.setattr(llm.httpx, "post", lambda *a, **k: pytest.fail("offline mode must not call Gemini"))
    assert llm.generate_narrative(facts, "en") is None


# ------------------------------------------------------------------------------------------------ agent
@pytest.fixture
def agent_env(runs_root, facts, monkeypatch, tmp_path):
    from ml_engine import uploads
    from ml_engine.report import sources

    monkeypatch.setattr(uploads, "UPLOADS_ROOT", tmp_path / "uploads")
    monkeypatch.setattr(llm, "CACHE_DIR", tmp_path / "llm")
    return sources


def test_agent_reads_the_model_output_at_the_point(agent_env):
    from ml_engine.report import agent_analysis, agent_report

    lat, lon = (SMALL_BBOX[1] + SMALL_BBOX[3]) / 2, (SMALL_BBOX[0] + SMALL_BBOX[2]) / 2
    pdf, meta = agent_report(lat, lon, None, "Test point", "en", use_ai=False)
    assert pdf[:4] == b"%PDF" and meta["source"] == "run" and meta["notice"] is None
    out = agent_analysis(lat, lon, None, "Test point", "hi")
    assert out["point"]["value"] is not None and out["data_source"]["kind"] == "run" and out["texts"]["source"]


def test_agent_falls_back_to_google_then_standards(agent_env, monkeypatch):
    from ml_engine.report import agent_analysis, agent_report

    far = (28.61, 77.2)  # no model output covers Delhi in the test runs
    monkeypatch.setattr(agent_env, "google_point", lambda lat, lon: {
        "no2_ugm3": 94.0, "raw_value": 50.0, "raw_units": "PARTS_PER_BILLION", "date_time": "2026-09-27T16:00:00Z"})
    for lang in ("en", "hi", "mr"):
        pdf, meta = agent_report(*far, None, "Delhi", lang, use_ai=True)
        assert pdf[:4] == b"%PDF" and meta["source"] == "google" and meta["status"] == "critical"
    out = agent_analysis(*far, None, "Delhi", "en")
    assert out["current"]["mean"] == 94.0 and out["hotspots"] == [] and "Google" in out["texts"]["source"]

    def down(lat, lon):
        raise RuntimeError("Google Air Quality API HTTP 403 PERMISSION_DENIED")

    monkeypatch.setattr(agent_env, "google_point", down)
    pdf, meta = agent_report(*far, None, "Delhi", "mr", use_ai=True)
    assert pdf[:4] == b"%PDF" and meta["status"] == "unavailable" and meta["notice"] == "unavailable"
    with pytest.raises(RuntimeError, match="model output"):
        agent_analysis(*far, None, "Delhi", "en")


def test_agent_report_without_a_working_gemini_key(agent_env, monkeypatch):
    from ml_engine.report import agent_report

    monkeypatch.setattr(llm, "setting", lambda name, default=None: {"GEMINI_API_KEY": "invalid"}.get(name, default))

    class Denied:
        status_code = 403
        headers = {"content-type": "application/json"}
        text = '{"error": {"status": "PERMISSION_DENIED"}}'

        def json(self):
            return {"error": {"status": "PERMISSION_DENIED"}}

    monkeypatch.setattr(llm.httpx, "post", lambda *a, **k: Denied())
    lat, lon = (SMALL_BBOX[1] + SMALL_BBOX[3]) / 2, (SMALL_BBOX[0] + SMALL_BBOX[2]) / 2
    pdf, meta = agent_report(lat, lon, None, "Test point", "en", use_ai=True, gemini_api_key="invalid")
    assert pdf[:4] == b"%PDF" and meta["narrative"] == "template" and meta["status"] != "unavailable"
