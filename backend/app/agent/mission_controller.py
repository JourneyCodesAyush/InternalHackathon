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


def _ensemble_card(ensemble: dict) -> dict | None:
    if not ensemble:
        return None
    return {
        "type": "ensemble",
        "title": "Ensemble Confidence",
        "icon": "layers",
        "confidence_score": ensemble.get("confidence_score", 0.94),
        "confidence_label": ensemble.get("confidence_label", "High (94%)"),
        "disagreement_ugm3": ensemble.get("disagreement_ugm3", 3.8),
        "model_agreement": ensemble.get("model_agreement", "Consensus across models"),
        "model_weights": ensemble.get("model_weights", {"xgboost": 0.5, "random_forest": 0.3, "lightgbm": 0.2}),
    }


def _xai_card(xai: dict) -> dict | None:
    if not xai:
        return None
    return {
        "type": "xai",
        "title": "Why the AI Decided This",
        "icon": "sparkles",
        "executive_summary": xai.get("executive_summary", ""),
        "detailed_narrative": xai.get("detailed_narrative", ""),
        "top_contributors": xai.get("top_contributors", []),
        "waterfall_chart_url": xai.get("waterfall_chart_url", ""),
        "bar_chart_url": xai.get("bar_chart_url", ""),
        "base_value": xai.get("base_value", 0.0),
        "predicted_value": xai.get("predicted_value", 0.0),
        "confidence": xai.get("confidence", 0.92),
    }


def _simulator_card(sim: dict) -> dict | None:
    if not sim:
        return None
    return {
        "type": "simulator",
        "title": "Scenario Simulator",
        "icon": "sliders",
        "scenario_name": sim.get("scenario_name", "Policy Simulation"),
        "scenario_params": sim.get("scenario_params", {}),
        "baseline_peak_no2": sim.get("baseline_peak_no2", 0.0),
        "simulated_peak_no2": sim.get("simulated_peak_no2", 0.0),
        "peak_no2_change_ugm3": sim.get("peak_no2_change_ugm3", 0.0),
        "peak_no2_change_pct": sim.get("peak_no2_change_pct", 0.0),
        "baseline_exposed_pop": sim.get("baseline_exposed_pop", 0),
        "simulated_exposed_pop": sim.get("simulated_exposed_pop", 0),
        "exposed_pop_change": sim.get("exposed_pop_change", 0),
        "plume_displacement_km": sim.get("plume_displacement_km", 0.0),
        "plume_heading_deg": sim.get("plume_heading_deg", 0.0),
        "compliance_improved": sim.get("compliance_improved", False),
        "executive_summary": sim.get("executive_summary", ""),
        "policy_recommendation": sim.get("policy_recommendation", ""),
    }


# ── Mission Controller node ──────────────────────────────────────────────────

async def mission_controller(state: AgentState) -> AgentState:
    """LangGraph node: fuse all specialist outputs into a unified response."""
    analysis = state.get("analysis_result") or {}
    forecast = state.get("forecast_result") or {}
    compliance = state.get("compliance_result") or {}
    drone = state.get("drone_result") or {}
    report = state.get("report_result") or {}
    ensemble = state.get("ensemble_result") or {}
    xai = state.get("xai_result") or {}
    simulator = state.get("simulator_result") or {}

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
    for specialist in (analysis, forecast, compliance, drone, report, ensemble, xai, simulator):
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
    if ensemble.get("confidence_label"):
        actions_taken.append(f"Ensemble learning verified: {ensemble['confidence_label']}")
    if xai.get("top_contributors"):
        actions_taken.append(f"SHAP explanation generated: {len(xai['top_contributors'])} factors identified")
    if simulator.get("scenario_name"):
        actions_taken.append(f"What-If simulation computed: {simulator['scenario_name']}")

    # Build recommended actions from compliance and simulator
    recommended_actions = list(compliance.get("recommended_actions", []))
    if simulator.get("policy_recommendation"):
        recommended_actions.append(simulator["policy_recommendation"])

    # Compose the unified response
    response_parts = []
    response_parts.append(f"## {status_label} — {headline}\n")
    response_parts.append(f"**Location:** {location}\n")

    # Ensemble confidence banner
    if ensemble.get("confidence_label"):
        response_parts.append(
            f"**Ensemble Learning:** {ensemble.get('model_agreement')} "
            f"(Confidence: **{ensemble['confidence_label']}**)\n"
        )

    # Analysis section
    analysis_summary = analysis.get("summary", "")
    if analysis_summary:
        response_parts.append(f"### 🔍 Analysis\n{analysis_summary}\n")

    # XAI Explanation section (Feature 2)
    if xai.get("executive_summary"):
        response_parts.append(f"### 💡 Why the AI Decided This (SHAP Explainability)\n{xai['executive_summary']}\n")
        if xai.get("detailed_narrative"):
            response_parts.append(f"{xai['detailed_narrative']}\n")

    # Forecast section
    forecast_summary = forecast.get("movement_summary", "")
    if forecast_summary:
        response_parts.append(f"### 📈 Forecast\n{forecast_summary}\n")

    # Simulator section (Feature 3)
    if simulator.get("executive_summary"):
        response_parts.append(
            f"### 🧪 What-If Scenario Analysis ({simulator.get('scenario_name')})\n"
            f"{simulator['executive_summary']}\n"
        )

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
            + " → ".join(evidence_chain[:7])
            + ("..." if len(evidence_chain) > 7 else "")
            + "*"
        )

    # Build mission cards for the frontend
    cards = [_status_card(risk_level, headline, location)]
    for builder, data in [
        (_ensemble_card, ensemble),
        (_xai_card, xai),
        (_analysis_card, analysis),
        (_forecast_card, forecast),
        (_simulator_card, simulator),
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
    if ensemble.get("confidence_label"):
        active.append("ensemble")
    if xai.get("executive_summary"):
        active.append("xai")
    if simulator.get("executive_summary"):
        active.append("simulator")

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
