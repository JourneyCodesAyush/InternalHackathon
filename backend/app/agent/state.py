"""Agent conversation state — the single shared TypedDict that flows through every node.

Extended for the multi-agent environmental intelligence system: each specialist writes
its findings into dedicated state slots, and the mission controller reads them all to
produce a unified response with explainability evidence.
"""

from __future__ import annotations

from typing import Any, Literal, TypedDict


# ── Specialist result containers ──────────────────────────────────────────────

class AnomalyResult(TypedDict, total=False):
    """Output of the Analysis Agent."""
    hotspots: list[dict[str, Any]]
    anomalies: list[dict[str, Any]]
    summary: str                              # human-readable explanation
    severity: Literal["normal", "elevated", "critical", "hazardous"]
    affected_area_km2: float
    population_exposed: int | None
    sources: list[str]                        # e.g. ["traffic", "power_plant"]
    evidence: list[str]                       # explainability citations


class ForecastResult(TypedDict, total=False):
    """Output of the Forecast Agent."""
    horizons: list[dict[str, Any]]
    alerts: list[dict[str, Any]]
    wind_speed: float | None
    wind_from_deg: float | None
    movement_summary: str                     # concise plume movement narrative
    trend_direction: Literal["rising", "falling", "stable", "unknown"]
    evidence: list[str]


class ComplianceResult(TypedDict, total=False):
    """Output of the Compliance Agent."""
    classification: Literal["advisory", "investigation", "hazardous"]
    cpcb_status: str
    who_status: str
    exceedance_pct: float | None
    recommended_actions: list[str]
    regulatory_summary: str
    evidence: list[str]


class DroneResult(TypedDict, total=False):
    """Output of the Drone Mission Agent."""
    deploy: bool
    flight_plans: list[dict[str, Any]]
    haze_summary: dict[str, Any] | None
    vlos_ok: bool
    airspace_ok: bool
    battery_ok: bool
    weather_ok: bool
    decision_reason: str
    evidence: list[str]


class ReportResult(TypedDict, total=False):
    """Output of the Report Agent."""
    generated: bool
    pdf_url: str | None
    report_type: str
    language: str
    summary: str
    evidence: list[str]


class XAIResult(TypedDict, total=False):
    """Output of the XAI Agent (SHAP Explainability)."""
    executive_summary: str                    # "Road density contributed 41%, low wind speed contributed 28%..."
    detailed_narrative: str
    top_contributors: list[dict[str, Any]]   # [{feature, percentage, direction, shap_value}]
    waterfall_chart_url: str                  # Base64 data URL
    bar_chart_url: str                        # Base64 data URL
    base_value: float
    predicted_value: float
    confidence: float
    evidence: list[str]


class SimulatorResult(TypedDict, total=False):
    """Output of the Simulator Agent (What-If Scenarios)."""
    scenario_name: str
    scenario_params: dict[str, Any]
    baseline_peak_no2: float
    simulated_peak_no2: float
    peak_no2_change_ugm3: float
    peak_no2_change_pct: float
    baseline_exposed_pop: int
    simulated_exposed_pop: int
    exposed_pop_change: int
    plume_displacement_km: float
    plume_heading_deg: float
    compliance_improved: bool
    executive_summary: str
    policy_recommendation: str
    evidence: list[str]


class EnsembleConfidenceResult(TypedDict, total=False):
    """Output of the Ensemble Confidence Node."""
    confidence_score: float                   # 0.0 - 1.0 (e.g. 0.94)
    confidence_label: str                     # "High (94%)" | "Moderate"
    disagreement_ugm3: float                  # Model standard deviation across models
    model_agreement: str                      # "High Agreement across XGBoost, RF, LightGBM"
    model_weights: dict[str, float]           # {"xgboost": 0.5, "random_forest": 0.3, "lightgbm": 0.2}
    evidence: list[str]


class MissionBrief(TypedDict, total=False):
    """Unified output of the Mission Controller — the final intelligence product."""
    risk_level: Literal["low", "moderate", "high", "critical"]
    status_label: str
    headline: str                             # one-line summary
    situation: str                            # detailed situation report
    actions_taken: list[str]                  # what the system did autonomously
    recommended_actions: list[str]            # what humans should do next
    evidence_chain: list[str]                 # full explainability trail
    artifacts: list[dict[str, Any]]


# ── Main agent state ──────────────────────────────────────────────────────────

class AgentState(TypedDict, total=False):
    """Persistent state across every LangGraph node invocation.

    Fields marked ``total=False`` are optional: the graph starts with only ``user_query``
    and gradually fills the rest.
    """

    # ── Input ──────────────────────────────────────────────────────────────
    user_query: str                       # raw text from the chat or form submission
    session_id: str                       # links a conversation thread
    uploaded_file: dict[str, Any] | None  # parsed DOCX metadata if uploaded

    # ── Extracted / validated parameters ───────────────────────────────────
    organization: str
    role: str
    location: str
    bbox: str                             # "west,south,east,north"
    observation_date: str                 # YYYY-MM-DD
    forecast_duration: int                # hours (3 | 6 | 12 | 24)
    requested_tasks: list[str]            # e.g. ["downscale", "forecast", "report"]
    additional_notes: str
    language: Literal["en", "hi", "mr"]

    # ── Routing ────────────────────────────────────────────────────────────
    intent: str                           # parsed intent name
    missing_fields: list[str]             # fields the validator still needs
    follow_up_question: str               # question to ask user for missing info

    # ── Tool execution (legacy — still used for backward compatibility) ────
    tool_results: dict[str, Any]          # tool_name → result payload
    executed_tools: list[str]             # ordered list of tool names that ran
    artifacts: list[dict[str, str]]       # [{type: "map" | "report" | "forecast", url: ...}]
    current_tool: str                     # which tool is executing right now

    # ── Multi-agent specialist results ─────────────────────────────────────
    analysis_result: AnomalyResult | None
    forecast_result: ForecastResult | None
    compliance_result: ComplianceResult | None
    drone_result: DroneResult | None
    report_result: ReportResult | None
    xai_result: XAIResult | None
    simulator_result: SimulatorResult | None
    ensemble_result: EnsembleConfidenceResult | None
    mission_brief: MissionBrief | None

    # ── Mission controller ─────────────────────────────────────────────────
    active_specialists: list[str]         # which specialist agents were invoked
    next_action: str | None               # orchestrator's decision on what to do next
    autonomous_triggers: list[str]        # events that fired (e.g. "cpcb_exceedance")
    mission_cards: list[dict[str, Any]]   # rendered cards for the frontend

    # ── Output ─────────────────────────────────────────────────────────────
    response: str                         # final human-readable answer
    status: str                           # "thinking" | "executing" | "done" | "need_info"

    # ── Conversation memory (session-only) ─────────────────────────────────
    history: list[dict[str, str]]         # [{role: "user"|"assistant", content: ...}]
