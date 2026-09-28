"""LangGraph workflow — the core agentic loop.

Nodes:
  1. parse_intent   → extract intent + params (rule-based, Gemini fallback)
  2. validate       → check required fields
  3. execute_tools  → call backend services
  4. build_response → compose the final answer

Edges route based on state: if fields are missing → ask follow-up;
otherwise → execute → respond.
"""

from __future__ import annotations

import logging
from typing import Any

from langgraph.graph import END, StateGraph

from app.agent.memory import session_store
from app.agent.parser import parse_intent
from app.agent.state import AgentState
from app.agent.tools import execute_tools
from app.agent.validators import validate_fields

log = logging.getLogger("agent.graph")


# ── Response builder node ─────────────────────────────────────────────────────

GREETING_RESPONSES = {
    "en": (
        "Hello! I'm the **AirQ Insight Agent** — your environmental intelligence assistant.\n\n"
        "I can help you with:\n"
        "• 🗺️ **Downscale** satellite NO₂ maps to high resolution\n"
        "• 📈 **Forecast** air quality for the next hours\n"
        "• 📄 **Generate reports** comparing your area against CPCB & WHO standards\n"
        "• 🔍 **Identify pollution hotspots** and source attribution\n\n"
        "You can type a request like *\"Forecast Mumbai for 6 hours\"* or use the **Request Form** for structured input."
    ),
    "hi": (
        "नमस्ते! मैं **AirQ Insight Agent** हूं — आपका पर्यावरण विश्लेषण सहायक।\n\n"
        "मैं आपकी मदद कर सकता हूं:\n"
        "• 🗺️ उपग्रह NO₂ मानचित्र को उच्च रिज़ॉल्यूशन में **डाउनस्केल** करना\n"
        "• 📈 आने वाले घंटों के लिए वायु गुणवत्ता का **पूर्वानुमान**\n"
        "• 📄 CPCB और WHO मानकों की तुलना में **रिपोर्ट बनाना**\n"
        "• 🔍 प्रदूषण **हॉटस्पॉट** की पहचान करना\n\n"
        "अनुरोध फ़ॉर्म का उपयोग करें या टाइप करें।"
    ),
}

HELP_RESPONSE = (
    "## How to Use AirQ Insight Agent\n\n"
    "**Natural Language:** Just describe what you need.\n"
    "- *\"Generate a NO₂ map for Delhi on 2025-11-05\"*\n"
    "- *\"Forecast air quality in Mumbai for 6 hours\"*\n"
    "- *\"Create a report for Pune\"*\n"
    "- *\"Find pollution hotspots near 19.07, 72.87\"*\n\n"
    "**Request Form:** Click *\"Use Request Form\"* for structured input with all fields.\n\n"
    "**DOCX Upload:** Upload a `.docx` request form and the agent will auto-fill the parameters.\n\n"
    "**Supported Tasks:** downscale, forecast, report, hotspot analysis, area analysis."
)


async def build_response(state: AgentState) -> AgentState:
    """LangGraph node: compose the final human-readable answer."""
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

    # General question — pass-through or Gemini answer
    if intent == "general_question":
        return {
            **state,
            "response": (
                "I'm designed to help with NO₂ air quality analysis. "
                "Try asking me to *forecast*, *downscale*, *generate a report*, "
                "or *find pollution hotspots* for a location."
            ),
            "status": "done",
        }

    # Build response from tool results
    tool_results = state.get("tool_results", {})
    executed = state.get("executed_tools", [])

    if not executed:
        return {
            **state,
            "response": "No tools were executed. Please specify a task (downscale, forecast, report, hotspot).",
            "status": "done",
        }

    # Build a professional response without calling Gemini
    parts: list[str] = []
    for tool_name in executed:
        result = tool_results.get(tool_name, {})
        status = result.get("status", "unknown")

        if status == "success":
            rtype = result.get("type", tool_name)

            if rtype == "map":
                data = result.get("data", {})
                parts.append(
                    f"### 🗺️ Downscaled Map\n"
                    f"Successfully generated high-resolution NO₂ map.\n"
                    f"- **Date:** {data.get('date', data.get('timestamp', 'N/A'))}\n"
                    f"- **Resolution:** {data.get('resolution', 'N/A')}\n"
                    f"- **Format:** {data.get('format', 'GeoTIFF')}"
                )
            elif rtype == "forecast":
                data = result.get("data", {})
                frames = data.get("frames", [])
                parts.append(
                    f"### 📈 Spatiotemporal Forecast\n"
                    f"Generated {len(frames)} forecast frame(s).\n"
                    f"- **Interval:** {data.get('interval_min', 30)} minutes\n"
                    f"- **Wind data:** Available"
                )
            elif rtype in ("report", "analysis"):
                data = result.get("data", {})
                current = data.get("current", {}) if isinstance(data, dict) else {}
                mean = current.get("mean")
                pct_naaqs = current.get("pct_vs_naaqs")
                status = current.get("status", "normal")
                max_near = current.get("max_near", "")
                max_val = current.get("max")
                hotspots = data.get("hotspots", []) if isinstance(data, dict) else []

                lines = ["### 📄 Area Analysis & Regulatory Report"]
                lines.append("Completed regulatory comparison against CPCB NAAQS and WHO standards.")
                if mean is not None:
                    status_badge = status.upper()
                    lines.append(f"- **Area Mean NO₂:** **{mean:.1f} µg/m³** (`{status_badge}`)")
                if pct_naaqs is not None:
                    comparison = f"{abs(pct_naaqs):.0f}% {'above' if pct_naaqs > 0 else 'below'} limit"
                    lines.append(f"- **CPCB 24-h Limit (80 µg/m³):** {comparison}")
                if max_val is not None:
                    lines.append(f"- **Peak Concentration:** **{max_val:.1f} µg/m³** (near *{max_near}*)")
                if hotspots:
                    top_spots = ", ".join(f"{h.get('near', 'Station')} ({h.get('value', 0):.0f} µg/m³)" for h in hotspots[:2])
                    lines.append(f"- **Top Hotspots:** {top_spots}")

                parts.append("\n".join(lines))
            else:
                parts.append(f"### ✅ {tool_name.title()}\nCompleted successfully.")
        else:
            error = result.get("error", "Unknown error")
            parts.append(f"### ⚠️ {tool_name.title()}\nEncountered an error: {error}")

    response = "\n\n".join(parts)
    location = state.get("location", "")
    if location:
        response = f"**Results for {location}:**\n\n" + response

    return {**state, "response": response, "status": "done"}


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
    """Construct the LangGraph workflow."""
    graph = StateGraph(AgentState)

    # Add nodes
    graph.add_node("parse_intent", parse_intent)
    graph.add_node("validate", validate_fields)
    graph.add_node("execute_tools", execute_tools)
    graph.add_node("build_response", build_response)

    # Entry point
    graph.set_entry_point("parse_intent")

    # Conditional edges
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

    # Linear edges
    graph.add_edge("execute_tools", "build_response")
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

    Returns the final state dict with ``response``, ``executed_tools``, ``artifacts``, etc.
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
        "status": "thinking",
    }

    # Override with any extra state (e.g. from form submission or docx)
    if extra_state:
        initial_state.update(extra_state)

    # Run graph
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
