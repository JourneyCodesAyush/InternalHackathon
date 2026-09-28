"""Specialist agent nodes — each wraps an existing backend module and produces
structured, explainable output for the mission controller.

Every specialist:
1. Calls existing business logic (analysis.py, flightplan.py, haze.py, etc.)
2. Interprets the raw data into a human-readable explanation
3. Attaches evidence citations so the mission controller can explain its reasoning
4. Writes its result into the shared AgentState

These nodes are designed to be composed inside the LangGraph workflow; they never
duplicate the underlying analysis — they only *interpret* it.
"""

from __future__ import annotations

import logging
import math
from typing import Any

from app.agent.state import (
    AgentState,
    AnomalyResult,
    ComplianceResult,
    DroneResult,
    ForecastResult,
    ReportResult,
)

log = logging.getLogger("agent.specialists")

# ── CPCB / WHO thresholds (mirror analysis.py) ───────────────────────────────
NAAQS_24H = 80.0   # µg/m³
WHO_24H = 25.0      # µg/m³


# ─────────────────────────────────────────────────────────────────────────────
# 1. ANALYSIS AGENT
# ─────────────────────────────────────────────────────────────────────────────

def _severity_label(mean: float) -> str:
    if mean > 180:
        return "hazardous"
    if mean > NAAQS_24H:
        return "critical"
    if mean > 40:
        return "elevated"
    return "normal"


def _explain_anomaly(a: dict) -> str:
    """One-sentence explanation of a single anomaly."""
    kinds = a.get("kinds", [])
    near = a.get("near", "unknown location")
    value = a.get("value", 0)
    reasons = a.get("reasons", [])

    kind_text = []
    if "exceedance" in kinds:
        kind_text.append(f"exceeds CPCB 24-h limit ({value:.0f} vs {NAAQS_24H:.0f} µg/m³)")
    if "spike" in kinds:
        baseline = a.get("baseline")
        bl_text = f" (baseline {baseline:.0f})" if baseline is not None else ""
        kind_text.append(f"unusual spike to {value:.0f} µg/m³{bl_text}")
    if "local_source" in kinds:
        kind_text.append("pollution produced locally (higher than upwind air)")

    reason_map = {
        "traffic": "heavy traffic corridor",
        "power_plant": "nearby power plant",
        "dense_urban": "dense urban activity",
        "unlisted": "possible unlisted emission source",
        "stagnant": "stagnant wind trapping pollutants",
        "low_mixing": "shallow boundary layer concentrating emissions",
    }
    reason_text = ", ".join(reason_map.get(r, r) for r in reasons)

    return (
        f"**{near}**: {'; '.join(kind_text) or f'{value:.0f} µg/m³'}. "
        f"Likely causes: {reason_text or 'under investigation'}."
    )


async def analysis_agent(state: AgentState) -> AgentState:
    """Interpret analysis.py results into structured explanations."""
    tool_results = state.get("tool_results", {})
    raw = tool_results.get("analysis", tool_results.get("report", {}))
    data = raw.get("data", {}) if isinstance(raw, dict) else {}

    if not data or raw.get("status") != "success":
        return {
            **state,
            "analysis_result": AnomalyResult(
                hotspots=[], anomalies=[], summary="No analysis data available.",
                severity="normal", affected_area_km2=0, population_exposed=None,
                sources=[], evidence=["analysis_agent: no raw data from analysis tool"],
            ),
        }

    current = data.get("current", {})
    hotspots = data.get("hotspots", [])
    anomalies = data.get("anomalies", [])
    population = data.get("population", {})
    mean_no2 = current.get("mean", 0)
    severity = _severity_label(mean_no2)

    # Build explanations
    explanations = [_explain_anomaly(a) for a in anomalies]
    hotspot_explanations = []
    for h in hotspots[:3]:
        sources = h.get("sources", [])
        source_text = ", ".join(sources) if sources else "background"
        hotspot_explanations.append(
            f"Hotspot #{h.get('rank', '?')} near **{h.get('near', '?')}**: "
            f"{h.get('value', 0):.0f} µg/m³ ({h.get('band', 'unknown')} band). Sources: {source_text}."
        )

    total_area = sum(a.get("area_km2", 0) for a in anomalies)
    all_sources = list({s for a in anomalies for s in a.get("reasons", [])})
    pop_exposed = None
    if population:
        pop_exposed = population.get("above_naaqs")

    summary_parts = [
        f"Area mean NO₂ is **{mean_no2:.1f} µg/m³** ({severity.upper()}).",
    ]
    pct = current.get("pct_vs_naaqs")
    if pct is not None:
        direction = "above" if pct > 0 else "below"
        summary_parts.append(f"This is {abs(pct):.0f}% {direction} the CPCB 24-h limit.")
    if anomalies:
        summary_parts.append(f"**{len(anomalies)} anomalous zone(s)** detected covering {total_area:.1f} km².")
    if hotspot_explanations:
        summary_parts.append("\n".join(hotspot_explanations))
    if explanations:
        summary_parts.append("**Anomaly details:**\n" + "\n".join(f"• {e}" for e in explanations))

    evidence = [
        f"analysis_agent: mean={mean_no2:.1f}, severity={severity}",
        f"analysis_agent: {len(anomalies)} anomalies, {len(hotspots)} hotspots",
        f"analysis_agent: sources={all_sources}",
    ]
    if pop_exposed is not None:
        evidence.append(f"analysis_agent: population_above_naaqs={pop_exposed}")

    return {
        **state,
        "analysis_result": AnomalyResult(
            hotspots=hotspots,
            anomalies=anomalies,
            summary="\n\n".join(summary_parts),
            severity=severity,
            affected_area_km2=round(total_area, 1),
            population_exposed=pop_exposed,
            sources=all_sources,
            evidence=evidence,
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# 2. FORECAST AGENT
# ─────────────────────────────────────────────────────────────────────────────

def _compass(deg: float) -> str:
    names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
             "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    return names[int(((deg % 360) + 11.25) // 22.5) % 16]


def _alert_text(alert: dict) -> str:
    code = alert.get("code", "")
    hours = alert.get("hours", "?")
    share = alert.get("share", 0)
    place = alert.get("place", "")
    texts = {
        "persisting": f"⚠️ CPCB exceedance **persists** through +{hours}h ({share*100:.0f}% of area above limit).",
        "exceedance_expected": f"⚠️ CPCB exceedance **expected** by +{hours}h ({share*100:.0f}% of area).",
        "improving": f"✅ Conditions **improving** — exceedance share dropping to {share*100:.0f}% by +{hours}h.",
        "localized_peak": f"⚠️ Localized peak expected near **{place}** by +{hours}h.",
        "no_exceedance": "✅ No CPCB exceedance expected in the forecast window.",
    }
    return texts.get(code, f"Alert: {code} at +{hours}h")


async def forecast_agent(state: AgentState) -> AgentState:
    """Interpret forecast data into movement summaries and alerts."""
    tool_results = state.get("tool_results", {})
    raw = tool_results.get("forecast", {})

    # Also check analysis result for forecast data embedded in report
    analysis_data = {}
    ar = tool_results.get("analysis", tool_results.get("report", {}))
    if isinstance(ar, dict) and ar.get("status") == "success":
        analysis_data = ar.get("data", {})

    forecast_data = {}
    if isinstance(raw, dict) and raw.get("status") == "success":
        forecast_data = raw.get("data", {})

    # Extract forecast info from analysis data if direct forecast is empty
    fc = analysis_data.get("forecast", forecast_data) or {}
    horizons = fc.get("horizons", [])
    alerts = fc.get("alerts", [])
    wind_speed = fc.get("wind_speed")
    wind_from = fc.get("wind_from_deg")

    if not horizons and not alerts:
        return {
            **state,
            "forecast_result": ForecastResult(
                horizons=[], alerts=[], wind_speed=None, wind_from_deg=None,
                movement_summary="No forecast data available.",
                trend_direction="unknown",
                evidence=["forecast_agent: no forecast data in tool results"],
            ),
        }

    # Build movement summary
    movement_parts = []
    if wind_speed is not None and wind_from is not None:
        compass = _compass(wind_from)
        movement_parts.append(
            f"Wind from {compass} ({wind_from:.0f}°) at {wind_speed:.1f} m/s."
        )
        if wind_speed < 1.5:
            movement_parts.append("**Stagnant conditions** — pollutants will accumulate locally.")
        elif wind_speed > 5:
            movement_parts.append("Moderate-to-strong wind — plume dispersal expected downwind.")

    if horizons:
        first = horizons[0]
        last = horizons[-1]
        if last["mean"] > first["mean"] + 5:
            trend = "rising"
            movement_parts.append(
                f"Mean NO₂ **rising** from {first['mean']:.0f} to {last['mean']:.0f} µg/m³ "
                f"over {last['hours']}h."
            )
        elif last["mean"] < first["mean"] - 5:
            trend = "falling"
            movement_parts.append(
                f"Mean NO₂ **falling** from {first['mean']:.0f} to {last['mean']:.0f} µg/m³ "
                f"over {last['hours']}h."
            )
        else:
            trend = "stable"
            movement_parts.append(
                f"Mean NO₂ **stable** around {first['mean']:.0f}–{last['mean']:.0f} µg/m³."
            )
    else:
        trend = "unknown"

    alert_texts = [_alert_text(a) for a in alerts]
    if alert_texts:
        movement_parts.append("\n".join(alert_texts))

    evidence = [
        f"forecast_agent: wind={wind_speed} m/s from {wind_from}°",
        f"forecast_agent: {len(horizons)} horizon(s), {len(alerts)} alert(s)",
        f"forecast_agent: trend={trend}",
    ]

    return {
        **state,
        "forecast_result": ForecastResult(
            horizons=horizons,
            alerts=alerts,
            wind_speed=wind_speed,
            wind_from_deg=wind_from,
            movement_summary="\n\n".join(movement_parts),
            trend_direction=trend,
            evidence=evidence,
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# 3. COMPLIANCE AGENT
# ─────────────────────────────────────────────────────────────────────────────

async def compliance_agent(state: AgentState) -> AgentState:
    """Classify the situation against CPCB & WHO guidelines and recommend actions."""
    analysis = state.get("analysis_result") or {}
    forecast = state.get("forecast_result") or {}

    severity = analysis.get("severity", "normal")
    anomalies = analysis.get("anomalies", [])
    hotspots = analysis.get("hotspots", [])
    alerts = forecast.get("alerts", [])
    trend = forecast.get("trend_direction", "unknown")
    wind_speed = forecast.get("wind_speed")

    # Classification logic
    has_exceedance = any("exceedance" in a.get("kinds", []) for a in anomalies)
    has_spike = any("spike" in a.get("kinds", []) for a in anomalies)
    persisting = any(a.get("code") == "persisting" for a in alerts)
    expected = any(a.get("code") == "exceedance_expected" for a in alerts)

    if severity == "hazardous" or (has_exceedance and persisting):
        classification = "hazardous"
    elif has_exceedance or has_spike or expected:
        classification = "investigation"
    else:
        classification = "advisory"

    # CPCB / WHO status strings
    cpcb_status = "EXCEEDED" if has_exceedance else ("AT RISK" if expected else "WITHIN LIMITS")
    who_status = "EXCEEDED" if severity in ("elevated", "critical", "hazardous") else "WITHIN LIMITS"

    # Exceedance percentage from analysis data
    tool_results = state.get("tool_results", {})
    ar = tool_results.get("analysis", tool_results.get("report", {}))
    current = ar.get("data", {}).get("current", {}) if isinstance(ar, dict) else {}
    exceedance_pct = current.get("pct_vs_naaqs")

    # Recommended actions
    actions = []
    if classification == "hazardous":
        actions.extend([
            "🚨 Issue public health advisory for the affected area immediately.",
            "📋 Notify CPCB/SPCB regional office of sustained exceedance.",
            "🚫 Consider temporary emission restrictions (construction, traffic diversions).",
            "🏥 Alert healthcare facilities for increased respiratory cases.",
        ])
    elif classification == "investigation":
        actions.extend([
            "🔍 Dispatch field inspection team to identified hotspot(s).",
            "📊 Cross-reference with industrial emission permits in the area.",
        ])
        if has_spike:
            actions.append("⚡ Investigate unlisted emission sources — spike detected against baseline.")
        if expected:
            actions.append("⏰ Pre-position monitoring equipment before forecast exceedance window.")
    else:
        actions.append("✅ Continue routine monitoring. No immediate action required.")
        if trend == "rising":
            actions.append("📈 Trend is rising — increase monitoring frequency.")

    # Regulatory summary
    summary_parts = [
        f"**Classification: {classification.upper()}**",
        f"CPCB NAAQS 24-h ({NAAQS_24H:.0f} µg/m³): **{cpcb_status}**",
        f"WHO 24-h ({WHO_24H:.0f} µg/m³): **{who_status}**",
    ]
    if exceedance_pct is not None:
        summary_parts.append(
            f"Current level is {abs(exceedance_pct):.0f}% {'above' if exceedance_pct > 0 else 'below'} CPCB limit."
        )

    evidence = [
        f"compliance_agent: classification={classification}",
        f"compliance_agent: cpcb={cpcb_status}, who={who_status}",
        f"compliance_agent: exceedance_anomalies={len([a for a in anomalies if 'exceedance' in a.get('kinds', [])])}",
        f"compliance_agent: forecast_trend={trend}",
    ]

    return {
        **state,
        "compliance_result": ComplianceResult(
            classification=classification,
            cpcb_status=cpcb_status,
            who_status=who_status,
            exceedance_pct=exceedance_pct,
            recommended_actions=actions,
            regulatory_summary="\n".join(summary_parts),
            evidence=evidence,
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# 4. DRONE MISSION AGENT
# ─────────────────────────────────────────────────────────────────────────────

async def drone_agent(state: AgentState) -> AgentState:
    """Determine whether drone deployment is warranted and summarise flight plans."""
    compliance = state.get("compliance_result") or {}
    analysis = state.get("analysis_result") or {}
    forecast = state.get("forecast_result") or {}
    tool_results = state.get("tool_results", {})

    classification = compliance.get("classification", "advisory")
    anomalies = analysis.get("anomalies", [])
    wind_speed = forecast.get("wind_speed")

    # Check if drone deployment is warranted
    needs_drone = classification in ("investigation", "hazardous") and len(anomalies) > 0
    if not needs_drone:
        return {
            **state,
            "drone_result": DroneResult(
                deploy=False,
                flight_plans=[],
                haze_summary=None,
                vlos_ok=True, airspace_ok=True, battery_ok=True, weather_ok=True,
                decision_reason="No anomalies requiring physical inspection detected.",
                evidence=["drone_agent: classification=advisory, no anomalies warrant deployment"],
            ),
        }

    # Extract flight plans from the analysis/report data
    ar = tool_results.get("analysis", tool_results.get("report", {}))
    data = ar.get("data", {}) if isinstance(ar, dict) else {}
    flight_plans = data.get("flight_plans", [])

    # Haze data
    haze = data.get("haze")

    # Weather check
    weather_ok = True
    if wind_speed is not None and wind_speed > 10:
        weather_ok = False

    # VLOS check from haze
    vlos_ok = True
    if haze and haze.get("latest", {}).get("class") in ("heavy", "severe"):
        vlos_ok = False

    # Airspace & battery from flight plans
    airspace_ok = all(
        fp.get("airspace", {}).get("zone") != "red"
        for fp in flight_plans
    )
    battery_ok = all(
        fp.get("battery", {}).get("remaining_pct", 100) >= 15
        for fp in flight_plans
    )

    # Build decision reason
    reasons = []
    if not weather_ok:
        reasons.append(f"wind speed {wind_speed:.1f} m/s exceeds 10 m/s limit")
    if not vlos_ok:
        reasons.append("heavy haze reduces visibility below VLOS minimum")
    if not airspace_ok:
        reasons.append("one or more targets in restricted airspace (red zone)")
    if not battery_ok:
        reasons.append("insufficient battery for round trip at one or more targets")

    deploy = weather_ok and vlos_ok and airspace_ok and battery_ok
    decision = "GO" if deploy else "NO-GO"

    if deploy:
        decision_reason = (
            f"Drone deployment **RECOMMENDED** ({decision}). "
            f"{len(flight_plans)} flight plan(s) generated for {len(anomalies)} anomalous site(s). "
            f"Wind {wind_speed:.1f} m/s (below 10 m/s limit), visibility suitable for VLOS."
        )
    else:
        decision_reason = (
            f"Drone deployment **NOT RECOMMENDED** ({decision}): {'; '.join(reasons)}. "
            f"Resolve conditions before dispatch."
        )

    evidence = [
        f"drone_agent: deploy={deploy}, decision={decision}",
        f"drone_agent: flight_plans={len(flight_plans)}",
        f"drone_agent: vlos={vlos_ok}, airspace={airspace_ok}, battery={battery_ok}, weather={weather_ok}",
    ]
    if reasons:
        evidence.append(f"drone_agent: no-go reasons={reasons}")

    return {
        **state,
        "drone_result": DroneResult(
            deploy=deploy,
            flight_plans=flight_plans,
            haze_summary=haze,
            vlos_ok=vlos_ok,
            airspace_ok=airspace_ok,
            battery_ok=battery_ok,
            weather_ok=weather_ok,
            decision_reason=decision_reason,
            evidence=evidence,
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# 5. REPORT AGENT
# ─────────────────────────────────────────────────────────────────────────────

async def report_agent(state: AgentState) -> AgentState:
    """Determine if a report should be auto-generated and summarise the outcome."""
    compliance = state.get("compliance_result") or {}
    tool_results = state.get("tool_results", {})
    intent = state.get("intent", "")
    requested_tasks = state.get("requested_tasks", [])

    classification = compliance.get("classification", "advisory")

    # Auto-generate report for hazardous events or explicit requests
    should_generate = (
        classification == "hazardous"
        or intent == "report"
        or "report" in requested_tasks
    )

    # Check if report was already generated by tools
    report_raw = tool_results.get("report", {})
    already_generated = isinstance(report_raw, dict) and report_raw.get("status") == "success"

    if not should_generate and not already_generated:
        return {
            **state,
            "report_result": ReportResult(
                generated=False,
                pdf_url=None,
                report_type="none",
                language=state.get("language", "en"),
                summary="No report generated — conditions within normal parameters.",
                evidence=["report_agent: no report trigger (classification=advisory, no explicit request)"],
            ),
        }

    # If report was already run by tools, just summarise
    if already_generated:
        data = report_raw.get("data", {})
        report_type = "regulatory_audit"
        summary = (
            f"PDF regulatory report generated for **{state.get('location', 'study area')}**. "
            f"Classification: **{classification.upper()}**. "
            f"Report includes hotspot analysis, CPCB/WHO compliance, forecast, "
            f"anomaly investigation, drone pre-inspection plans, and recommendations."
        )
    elif should_generate and not already_generated:
        # Auto-trigger report generation
        try:
            from app.agent.tools import run_report
            report_raw = await run_report(state)
            if report_raw.get("status") == "success":
                # Update tool results
                updated_results = dict(state.get("tool_results", {}))
                updated_results["report"] = report_raw
                state = {**state, "tool_results": updated_results}
                already_generated = True
        except Exception:
            log.exception("Auto-report generation failed")

        report_type = "auto_generated_hazardous"
        if already_generated:
            summary = (
                f"⚠️ **Automatic report generated** due to {classification.upper()} classification. "
                f"PDF includes full regulatory documentation for {state.get('location', 'the area')}."
            )
        else:
            summary = (
                f"Report generation was triggered (classification: {classification}) "
                f"but could not be completed. Check backend logs."
            )
    else:
        report_type = "none"
        summary = "No report generated."

    evidence = [
        f"report_agent: generated={already_generated}",
        f"report_agent: type={report_type}",
        f"report_agent: trigger={'auto' if classification == 'hazardous' else 'explicit'}",
    ]

    return {
        **state,
        "report_result": ReportResult(
            generated=already_generated,
            pdf_url=None,
            report_type=report_type,
            language=state.get("language", "en"),
            summary=summary,
            evidence=evidence,
        ),
    }
