"""Validators — check that required fields for each tool are present."""

from __future__ import annotations

from app.agent.state import AgentState

# Which fields each intent requires before we can call the tool
REQUIRED_FIELDS: dict[str, list[str]] = {
    "downscale":  ["bbox", "observation_date"],
    "forecast":   ["bbox", "observation_date"],
    "report":     ["bbox", "observation_date", "location"],
    "hotspot":    ["bbox"],
    "analysis":   ["bbox", "observation_date", "location"],
}

# Human-readable names for follow-up questions
FIELD_LABELS: dict[str, str] = {
    "bbox": "bounding box (or city/region name)",
    "observation_date": "observation date (YYYY-MM-DD)",
    "location": "location or region name",
    "lat": "latitude",
    "lon": "longitude",
    "forecast_duration": "forecast duration in hours",
}


def validate_fields(state: AgentState) -> AgentState:
    """LangGraph node: check all required fields are present for the detected intent.

    Populates ``missing_fields`` so the router can decide whether to ask a follow-up
    or proceed to tool execution.
    """
    intent = state.get("intent", "general_question")

    # Clean any invalid placeholder bbox left from templates
    bbox_val = state.get("bbox")
    if bbox_val and ("____" in str(bbox_val) or "Min Lon" in str(bbox_val)):
        state["bbox"] = ""

    # If bbox is missing but location is known, try to auto-resolve from CITY_BBOXES
    if not state.get("bbox") and state.get("location"):
        from app.agent.parser import CITY_BBOXES
        loc_lower = state["location"].lower()
        for city, meta in CITY_BBOXES.items():
            if city in loc_lower or loc_lower in city:
                state["bbox"] = meta["bbox"]
                if "lat" not in state:
                    state["lat"] = meta["lat"]
                if "lon" not in state:
                    state["lon"] = meta["lon"]
                break

    required = REQUIRED_FIELDS.get(intent, [])
    missing = [f for f in required if not state.get(f)]  # type: ignore[arg-type]

    updates: dict = {"missing_fields": missing}

    if missing:
        labels = [FIELD_LABELS.get(f, f) for f in missing]
        updates["status"] = "need_info"
        question = (
            f"To proceed with **{intent}**, I still need: {', '.join(labels)}. "
            "Could you provide those details?"
        )
        updates["follow_up_question"] = question
        updates["response"] = question
    else:
        updates["status"] = "executing"

    return {**state, **updates}
