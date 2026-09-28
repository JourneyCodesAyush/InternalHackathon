"""LangGraph workflow — the multi-agent environmental intelligence system.

Evolution of the original single-assistant chatbot into a collaborative multi-agent
architecture.  The original nodes (parse_intent, validate, execute_tools) are KEPT;
specialist agents and the mission controller are ADDED downstream.

Nodes:
  1. parse_intent       → extract intent + params (rule-based, Gemini fallback)
  2. validate           → check required fields
  3. execute_tools      → call backend services (downscale, forecast, report, hotspot)
  4. analysis_agent     → interpret hotspots, anomalies, severity
  5. forecast_agent     → interpret plume movement, trend, alerts
  6. compliance_agent   → classify against CPCB/WHO, recommend actions
  7. drone_agent        → evaluate drone deployment feasibility
  8. report_agent       → auto-generate reports for hazardous events
  9. mission_controller → fuse everything into a unified intelligence product
  10. build_response    → compose the final answer (legacy path for simple queries)

Edges:
  parse_intent ─┬─ (greeting/help/general) → build_response → END
                └─ (action intent) → validate ─┬─ (missing) → END (ask follow-up)
                                                └─ (ok)     → execute_tools
                                                              → specialist_pipeline
                                                              → mission_controller → END
"""

from __future__ import annotations

import logging
from typing import Any

from langgraph.graph import END, StateGraph

from app.agent.memory import session_store
from app.agent.mission_controller import mission_controller
from app.agent.parser import parse_intent
from app.agent.specialists import (
    analysis_agent,
    compliance_agent,
    drone_agent,
    forecast_agent,
    report_agent,
)
from app.agent.state import AgentState
from app.agent.tools import execute_tools
from app.agent.validators import validate_fields

log = logging.getLogger("agent.graph")


# ── Response builder node (simple queries — greeting / help / general) ────────

GREETING_RESPONSES = {
    "en": (
        "Hello! I'm the **AirQ Insight Agent** — your environmental intelligence command center.\n\n"
        "I coordinate a team of specialist AI agents:\n"
        "• 🔍 **Analysis Agent** — hotspot detection, anomaly investigation, source attribution\n"
        "• 📈 **Forecast Agent** — spatiotemporal plume forecasting and movement analysis\n"
        "• 📋 **Compliance Agent** — CPCB & WHO regulatory cross-checking and classification\n"
        "• 🛩️ **Drone Mission Agent** — automated flight planning with VLOS, airspace & weather checks\n"
        "• 📄 **Report Agent** — PDF regulatory report generation (English, Hindi, Marathi)\n\n"
        "You can type a request like *\"Analyze Mumbai for today\"* or use the **Request Form** for structured input."
    ),
    "hi": (
        "नमस्ते! मैं **AirQ Insight Agent** हूं — आपका पर्यावरण विश्लेषण कमांड सेंटर।\n\n"
        "मैं विशेषज्ञ AI एजेंटों की एक टीम का समन्वय करता हूं:\n"
        "• 🔍 **विश्लेषण एजेंट** — हॉटस्पॉट, विसंगतियां, स्रोत पहचान\n"
        "• 📈 **पूर्वानुमान एजेंट** — प्रदूषण गति विश्लेषण\n"
        "• 📋 **अनुपालन एजेंट** — CPCB और WHO मानक जांच\n"
        "• 🛩️ **ड्रोन एजेंट** — उड़ान योजना और मौसम जांच\n"
        "• 📄 **रिपोर्ट एजेंट** — PDF नियामक रिपोर्ट\n\n"
        "अनुरोध फ़ॉर्म का उपयोग करें या टाइप करें।"
    ),
}

HELP_RESPONSE = (
    "## How to Use AirQ Environmental Intelligence Center\n\n"
    "**Natural Language:** Just describe what you need.\n"
    "- *\"Generate a NO₂ map for Delhi on 2025-11-05\"*\n"
    "- *\"Forecast air quality in Mumbai for 6 hours\"*\n"
    "- *\"Create a report for Pune\"*\n"
    "- *\"Find pollution hotspots near 19.07, 72.87\"*\n"
    "- *\"Analyze Kolkata\"* — triggers all specialists automatically\n\n"
    "**What happens behind the scenes:**\n"
    "1. Your request is parsed and validated\n"
    "2. Backend ML models execute the analysis\n"
    "3. **Five specialist agents** interpret the results\n"
    "4. A **Mission Controller** fuses everything into a unified intelligence briefing\n"
    "5. You receive mission cards with risk level, actions, and evidence\n\n"
    "**DOCX Upload:** Upload a `.docx` request form and the agent will auto-fill the parameters.\n\n"
    "**Supported Tasks:** downscale, forecast, report, hotspot analysis, area analysis."
)


async def build_response(state: AgentState) -> AgentState:
    """LangGraph node: compose the final human-readable answer for SIMPLE queries only.

    Action-intent queries go through the specialist pipeline → mission controller instead.
    """
    intent = state.get("intent", "")
    language = state.get("language", "en")

    # Greeting
    if intent == "greeting":
        return {
            **state,
            "response": GREETING_RESPONSES.get(language, GREETING_RESPONSES["en"]),
            "status": "done",
        }

    # Help
    if intent == "help":
        return {**state, "response": HELP_RESPONSE, "status": "done"}

    # General question — pass-through
    if intent == "general_question":
        return {
            **state,
            "response": (
                "I'm designed to help with NO₂ air quality analysis. "
                "Try asking me to *forecast*, *downscale*, *generate a report*, "
                "or *find pollution hotspots* for a location.\n\n"
                "I coordinate a team of specialist AI agents that will automatically "
                "investigate anomalies, check regulatory compliance, assess drone deployment, "
                "and generate reports when needed."
            ),
            "status": "done",
        }

    # Fallback (should not reach here for action intents)
    return {**state, "status": "done"}


# ── Automatic workflow triggers ───────────────────────────────────────────────

async def detect_triggers(state: AgentState) -> AgentState:
    """LangGraph node: inspect tool results and fire autonomous workflow triggers.

    This runs AFTER execute_tools but BEFORE the specialist pipeline, scanning raw
    results for events that should automatically invoke additional specialists.
    """
    tool_results = state.get("tool_results", {})
    triggers: list[str] = []
    requested = list(state.get("requested_tasks", []))

    for name, result in tool_results.items():
        if not isinstance(result, dict) or result.get("status") != "success":
            continue
        data = result.get("data", {})

        # Check for CPCB exceedance
        current = data.get("current", {})
        if isinstance(current, dict):
            pct = current.get("pct_vs_naaqs")
            if pct is not None and pct > 0:
                triggers.append("cpcb_exceedance")

            status = current.get("status", "")
            if status in ("critical", "critical_spike"):
                triggers.append("hazardous_hotspot")

        # Check for anomalies
        anomalies = data.get("anomalies", [])
        if anomalies:
            triggers.append("anomaly_detected")

        # Check forecast alerts
        fc = data.get("forecast", {})
        if isinstance(fc, dict):
            for alert in fc.get("alerts", []):
                if alert.get("level") == "critical":
                    triggers.append("critical_forecast")
                elif alert.get("code") == "exceedance_expected":
                    triggers.append("exceedance_forecast")

    # Auto-add tasks based on triggers
    if "cpcb_exceedance" in triggers or "hazardous_hotspot" in triggers:
        if "report" not in requested:
            requested.append("report")
            triggers.append("auto_report_triggered")

    return {
        **state,
        "autonomous_triggers": list(set(triggers)),
        "requested_tasks": requested,
    }


# ── Routing functions ─────────────────────────────────────────────────────────

def route_after_validation(state: AgentState) -> str:
    """Conditional edge: if fields are missing → END (send follow-up), else → execute."""
    missing = state.get("missing_fields", [])
    if missing:
        return "need_info"
    return "execute"


def route_after_parse(state: AgentState) -> str:
    """Conditional edge: greetings/help skip validation entirely."""
    intent = state.get("intent", "")
    if intent in ("greeting", "help", "general_question"):
        return "respond"
    return "validate"


# ── Graph construction ────────────────────────────────────────────────────────

def build_graph() -> StateGraph:
    """Construct the multi-agent LangGraph workflow."""
    graph = StateGraph(AgentState)

    # ── Add nodes ──────────────────────────────────────────────────────────
    # Original nodes (kept)
    graph.add_node("parse_intent", parse_intent)
    graph.add_node("validate", validate_fields)
    graph.add_node("execute_tools", execute_tools)
    graph.add_node("build_response", build_response)

    # New: automatic trigger detection
    graph.add_node("detect_triggers", detect_triggers)

    # New: specialist agents
    graph.add_node("analysis_agent", analysis_agent)
    graph.add_node("forecast_agent", forecast_agent)
    graph.add_node("compliance_agent", compliance_agent)
    graph.add_node("drone_agent", drone_agent)
    graph.add_node("report_agent", report_agent)

    # New: mission controller
    graph.add_node("mission_controller", mission_controller)

    # ── Entry point ────────────────────────────────────────────────────────
    graph.set_entry_point("parse_intent")

    # ── Conditional edges ──────────────────────────────────────────────────
    graph.add_conditional_edges(
        "parse_intent",
        route_after_parse,
        {"validate": "validate", "respond": "build_response"},
    )

    graph.add_conditional_edges(
        "validate",
        route_after_validation,
        {"execute": "execute_tools", "need_info": END},
    )

    # ── Linear edges: the multi-agent pipeline ─────────────────────────────
    # After tools execute → detect autonomous triggers
    graph.add_edge("execute_tools", "detect_triggers")

    # Trigger detection → specialist pipeline (sequential for data dependency)
    graph.add_edge("detect_triggers", "analysis_agent")
    graph.add_edge("analysis_agent", "forecast_agent")
    graph.add_edge("forecast_agent", "compliance_agent")
    graph.add_edge("compliance_agent", "drone_agent")
    graph.add_edge("drone_agent", "report_agent")

    # All specialists done → mission controller fuses the result
    graph.add_edge("report_agent", "mission_controller")
    graph.add_edge("mission_controller", END)

    # Simple responses (greeting/help/general) → END
    graph.add_edge("build_response", END)

    return graph


# Compiled graph (singleton)
_compiled_graph = None


def get_graph():
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = build_graph().compile()
    return _compiled_graph


async def run_agent(user_query: str, session_id: str, extra_state: dict[str, Any] | None = None) -> dict[str, Any]:
    """Main entry point: run the full agent loop for a user message.

    Returns the final state dict with ``response``, ``executed_tools``, ``artifacts``,
    ``mission_brief``, ``mission_cards``, etc.
    """
    # Load session
    session = session_store.get(session_id)
    history = session.get("history", [])
    prev_state = session.get("state", {})

    # Build initial state — merge previous session state (accumulated fields)
    initial_state: dict[str, Any] = {
        **prev_state,         # carry over previously-extracted fields
        "user_query": user_query,
        "session_id": session_id,
        "history": history,
        "tool_results": {},
        "executed_tools": [],
        "artifacts": [],
        "autonomous_triggers": [],
        "active_specialists": [],
        "mission_cards": [],
        "analysis_result": None,
        "forecast_result": None,
        "compliance_result": None,
        "drone_result": None,
        "report_result": None,
        "mission_brief": None,
        "status": "thinking",
    }

    # Override with any extra state (e.g. from form submission or docx)
    if extra_state:
        initial_state.update(extra_state)

    # Run graph — invalidate cache so re-compilation picks up new nodes
    global _compiled_graph
    _compiled_graph = None
    graph = get_graph()
    final_state = await graph.ainvoke(initial_state)

    # Save to session memory
    session_store.add_message(session_id, "user", user_query)

    response = final_state.get("response") or final_state.get("follow_up_question", "")
    session_store.add_message(session_id, "assistant", response)

    # Persist extracted fields for next turn
    persistent_keys = [
        "organization", "role", "location", "bbox", "observation_date",
        "forecast_duration", "language", "intent",
    ]
    persist = {k: final_state[k] for k in persistent_keys if final_state.get(k)}
    session_store.update(session_id, state=persist)

    return dict(final_state)
