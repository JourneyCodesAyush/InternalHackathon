"""Agent conversation state — the single shared TypedDict that flows through every node."""

from __future__ import annotations

from typing import Any, Literal, TypedDict


class AgentState(TypedDict, total=False):
    """Persistent state across every LangGraph node invocation.

    Fields marked ``total=False`` are optional: the graph starts with only ``user_query``
    and gradually fills the rest.
    """

    # ── Input ──────────────────────────────────────────────────────────────
    user_query: str                       # raw text from the chat or form submission
    session_id: str                       # links a conversation thread

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

    # ── Tool execution ─────────────────────────────────────────────────────
    tool_results: dict[str, Any]          # tool_name → result payload
    executed_tools: list[str]             # ordered list of tool names that ran
    artifacts: list[dict[str, str]]       # [{type: "map" | "report" | "forecast", url: ...}]
    current_tool: str                     # which tool is executing right now

    # ── Output ─────────────────────────────────────────────────────────────
    response: str                         # final human-readable answer
    status: str                           # "thinking" | "executing" | "done" | "need_info"

    # ── Conversation memory (session-only) ─────────────────────────────────
    history: list[dict[str, str]]         # [{role: "user"|"assistant", content: ...}]
