"""Mission Controller — the decision node that fuses all specialist outputs into
a single unified intelligence product (MissionBrief + mission cards).

The controller:
1. Reads every specialist's result from shared state
2. Determines the overall risk level
3. Builds an evidence chain connecting all findings
4. Composes mission cards for the frontend command-center UI
5. Writes the final human-readable response
"""

from __future__ import annotations

import logging
from typing import Any

from app.agent.state import AgentState, MissionBrief

log = logging.getLogger("agent.mission_controller")


# ── Risk level matrix ─────────────────────────────────────────────────────────

def _compute_risk_level(
    compliance_class: str,
    severity: str,
    trend: str,
    deploy_drone: bool,
) -> str:
    """Fuse signals into a single risk level."""
    if compliance_class == "hazardous":
        return "critical"
    if compliance_class == "investigation":
        if trend == "rising":
            return "high"
        return "high"
    if severity in ("critical", "hazardous"):
        return "high"
    if severity == "elevated" or trend == "rising":
        return "moderate"
    return "low"


RISK_LABELS = {
    "critical": "🔴 CRITICAL",
    "high": "🟠 HIGH",
    "moderate": "🟡 MODERATE",
    "low": "🟢 LOW",
}

RISK_HEADLINES = {
    "critical": "Hazardous conditions detected — immediate action required",
    "high": "Significant pollution event — investigation recommended",
    "moderate": "Elevated levels detected — enhanced monitoring advised",
    "low": "Conditions within acceptable parameters",
}


# ── Mission card builders ─────────────────────────────────────────────────────

def _status_card(risk_level: str, headline: str, location: str) -> dict:
    return {
        "type": "status",
        "title": "Mission Status",
        "risk_level": risk_level,
        "icon": "shield",
        "headline": headline,
        "location": location,
        "label": RISK_LABELS.get(risk_level, risk_level),
    }


def _analysis_card(analysis: dict) -> dict | None:
    if not analysis or analysis.get("severity") == "normal" and not analysis.get("anomalies"):
        return None
    return {
        "type": "analysis",
        "title": "Anomaly Intelligence",
        "icon": "alert-triangle",
        "severity": analysis.get("severity", "normal"),
        "anomaly_count": len(analysis.get("anomalies", [])),
        "hotspot_count": len(analysis.get("hotspots", [])),
        "affected_area_km2": analysis.get("affected_area_km2", 0),
        "population_exposed": analysis.get("population_exposed"),
        "sources": analysis.get("sources", []),
        "summary": analysis.get("summary", ""),
    }


def _forecast_card(forecast: dict) -> dict | None:
    if not forecast or forecast.get("trend_direction") == "unknown":
        return None
    return {
        "type": "forecast",
        "title": "Forecast Intelligence",
        "icon": "trending-up",
        "trend": forecast.get("trend_direction", "unknown"),
        "wind_speed": forecast.get("wind_speed"),
        "wind_from_deg": forecast.get("wind_from_deg"),
        "alert_count": len(forecast.get("alerts", [])),
        "summary": forecast.get("movement_summary", ""),
    }


def _compliance_card(compliance: dict) -> dict | None:
    if not compliance:
        return None
    return {
        "type": "compliance",
        "title": "Regulatory Compliance",
        "icon": "shield-check",
        "classification": compliance.get("classification", "advisory"),
        "cpcb_status": compliance.get("cpcb_status", "UNKNOWN"),
        "who_status": compliance.get("who_status", "UNKNOWN"),
        "exceedance_pct": compliance.get("exceedance_pct"),
        "recommended_actions": compliance.get("recommended_actions", []),
        "summary": compliance.get("regulatory_summary", ""),
    }


def _drone_card(drone: dict) -> dict | None:
    if not drone:
        return None
    return {
        "type": "drone",
        "title": "Drone Reconnaissance",
        "icon": "plane",
        "deploy": drone.get("deploy", False),
        "flight_plan_count": len(drone.get("flight_plans", [])),
        "vlos_ok": drone.get("vlos_ok", True),
        "airspace_ok": drone.get("airspace_ok", True),
        "battery_ok": drone.get("battery_ok", True),
        "weather_ok": drone.get("weather_ok", True),
        "decision_reason": drone.get("decision_reason", ""),
        "summary": drone.get("decision_reason", ""),
    }


def _report_card(report: dict) -> dict | None:
    if not report or not report.get("generated"):
        return None
    return {
        "type": "report",
        "title": "Documentation",
        "icon": "file-text",
        "generated": report.get("generated", False),
        "report_type": report.get("report_type", ""),
        "language": report.get("language", "en"),
        "summary": report.get("summary", ""),
    }


# ── Mission Controller node ──────────────────────────────────────────────────

async def mission_controller(state: AgentState) -> AgentState:
    """LangGraph node: fuse all specialist outputs into a unified response."""
    analysis = state.get("analysis_result") or {}
    forecast = state.get("forecast_result") or {}
    compliance = state.get("compliance_result") or {}
    drone = state.get("drone_result") or {}
    report = state.get("report_result") or {}
    location = state.get("location", "Study Area")
    intent = state.get("intent", "")

    # Determine overall risk
    risk_level = _compute_risk_level(
        compliance.get("classification", "advisory"),
        analysis.get("severity", "normal"),
        forecast.get("trend_direction", "unknown"),
        drone.get("deploy", False),
    )

    headline = RISK_HEADLINES.get(risk_level, "Assessment complete")
    status_label = RISK_LABELS.get(risk_level, risk_level)

    # Build the evidence chain
    evidence_chain = []
    for specialist in (analysis, forecast, compliance, drone, report):
        evidence_chain.extend(specialist.get("evidence", []))

    # Build actions taken (autonomous workflows that fired)
    actions_taken = list(state.get("autonomous_triggers", []))
    if analysis.get("anomalies"):
        actions_taken.append(f"Detected {len(analysis['anomalies'])} anomalous zone(s)")
    if compliance.get("classification") == "hazardous":
        actions_taken.append("Classified as HAZARDOUS — escalation protocol activated")
    if drone.get("deploy"):
        actions_taken.append(f"Generated {len(drone.get('flight_plans', []))} drone flight plan(s)")
    if report.get("generated"):
        actions_taken.append("Auto-generated regulatory PDF report")

    # Build recommended actions from compliance
    recommended_actions = compliance.get("recommended_actions", [])

    # Compose the unified response
    response_parts = []
    response_parts.append(f"## {status_label} — {headline}\n")
    response_parts.append(f"**Location:** {location}\n")

    # Analysis section
    analysis_summary = analysis.get("summary", "")
    if analysis_summary:
        response_parts.append(f"### 🔍 Analysis\n{analysis_summary}\n")

    # Forecast section
    forecast_summary = forecast.get("movement_summary", "")
    if forecast_summary:
        response_parts.append(f"### 📈 Forecast\n{forecast_summary}\n")

    # Compliance section
    compliance_summary = compliance.get("regulatory_summary", "")
    if compliance_summary:
        response_parts.append(f"### 📋 Regulatory Compliance\n{compliance_summary}\n")

    # Drone section
    if drone.get("decision_reason"):
        response_parts.append(f"### 🛩️ Drone Assessment\n{drone['decision_reason']}\n")

    # Report section
    if report.get("generated"):
        response_parts.append(f"### 📄 Report\n{report.get('summary', 'Report generated.')}\n")

    # Recommended actions
    if recommended_actions:
        response_parts.append("### ⚡ Recommended Actions")
        for action in recommended_actions:
            response_parts.append(f"- {action}")
        response_parts.append("")

    # Evidence footer
    if evidence_chain:
        response_parts.append(
            "\n---\n*Evidence trail: "
            + " → ".join(evidence_chain[:6])
            + ("..." if len(evidence_chain) > 6 else "")
            + "*"
        )

    # Build mission cards for the frontend
    cards = [_status_card(risk_level, headline, location)]
    for builder, data in [
        (_analysis_card, analysis),
        (_forecast_card, forecast),
        (_compliance_card, compliance),
        (_drone_card, drone),
        (_report_card, report),
    ]:
        card = builder(data)
        if card:
            cards.append(card)

    # Active specialists list
    active = []
    if analysis.get("summary"):
        active.append("analysis")
    if forecast.get("movement_summary"):
        active.append("forecast")
    if compliance.get("classification"):
        active.append("compliance")
    if drone.get("decision_reason"):
        active.append("drone")
    if report.get("generated"):
        active.append("report")

    mission_brief = MissionBrief(
        risk_level=risk_level,
        status_label=status_label,
        headline=headline,
        situation="\n".join(response_parts),
        actions_taken=actions_taken,
        recommended_actions=recommended_actions,
        evidence_chain=evidence_chain,
        artifacts=state.get("artifacts", []),
    )

    return {
        **state,
        "mission_brief": mission_brief,
        "mission_cards": cards,
        "active_specialists": active,
        "response": "\n".join(response_parts),
        "status": "done",
    }
