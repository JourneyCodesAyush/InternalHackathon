"""Agent API router — POST /api/v1/agent/chat (+ DOCX upload)."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.agent.graph import run_agent
from app.dependencies import get_current_user

log = logging.getLogger("agent.api")

router = APIRouter()


# ── Request / Response models ─────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    session_id: str | None = None
    # Optional pre-filled form fields (from the RequestForm component)
    organization: str | None = None
    role: str | None = None
    location: str | None = None
    bbox: str | None = None
    observation_date: str | None = None
    forecast_duration: int | None = None
    requested_tasks: list[str] | None = None
    additional_notes: str | None = None
    language: str | None = None


class ChatResponse(BaseModel):
    response: str
    session_id: str
    executed_tools: list[str] = []
    artifacts: list[dict[str, Any]] = []
    status: str = "done"
    intent: str | None = None
    missing_fields: list[str] = []
    follow_up_question: str | None = None


# ── Chat endpoint ─────────────────────────────────────────────────────────────

@router.post(
    "/chat",
    response_model=ChatResponse,
    summary="Send a message to the AirQ Insight Agent",
    tags=["agent"],
)
async def agent_chat(
    body: ChatRequest,
    current_user: dict = Depends(get_current_user),  # noqa: B008
) -> ChatResponse:
    """
    Converse with the agentic AI assistant.

    - **message**: Natural language query or structured form input
    - **session_id**: Optional session ID for conversation continuity (auto-generated if absent)
    - Form fields (organization, bbox, etc.) pre-populate the agent state
    """
    session_id = body.session_id or str(uuid.uuid4())

    # Build extra state from form fields
    extra: dict[str, Any] = {}
    for field in ("organization", "role", "location", "bbox", "observation_date",
                  "forecast_duration", "requested_tasks", "additional_notes", "language"):
        val = getattr(body, field, None)
        if val:
            extra[field] = val

    try:
        result = await run_agent(body.message, session_id, extra_state=extra or None)
    except Exception as exc:
        log.exception("Agent execution failed")
        raise HTTPException(status_code=500, detail=f"Agent error: {exc}")

    return ChatResponse(
        response=result.get("response") or result.get("follow_up_question", "Something went wrong."),
        session_id=session_id,
        executed_tools=result.get("executed_tools", []),
        artifacts=result.get("artifacts", []),
        status=result.get("status", "done"),
        intent=result.get("intent"),
        missing_fields=result.get("missing_fields", []),
        follow_up_question=result.get("follow_up_question"),
    )


# ── DOCX upload endpoint ─────────────────────────────────────────────────────

@router.post(
    "/upload-form",
    response_model=ChatResponse,
    summary="Upload a .docx request form",
    tags=["agent"],
)
async def upload_docx_form(
    file: UploadFile = File(...),  # noqa: B008
    session_id: str | None = Form(None),
    current_user: dict = Depends(get_current_user),  # noqa: B008
) -> ChatResponse:
    """
    Upload a structured .docx request form. The agent parses the document,
    extracts all fields, and begins processing the requested tasks.
    """
    if not file.filename or not file.filename.lower().endswith(".docx"):
        raise HTTPException(status_code=422, detail="Only .docx files are accepted")

    file_bytes = await file.read()
    if len(file_bytes) > 10 * 1024 * 1024:  # 10 MB limit
        raise HTTPException(status_code=413, detail="File too large (max 10 MB)")

    from app.agent.docx_parser import parse_docx

    try:
        parsed = parse_docx(file_bytes)
    except Exception as exc:
        log.exception("DOCX parsing failed")
        raise HTTPException(status_code=422, detail=f"Could not parse document: {exc}")

    sid = session_id or str(uuid.uuid4())

    if not parsed:
        return ChatResponse(
            response=(
                f"### 📄 Document Received: `{file.filename}`\n\n"
                "I have successfully ingested the **NO₂ Air Quality Analysis Request Form** template. "
                "The study area fields and requested analysis checkboxes are currently blank placeholders (`____`).\n\n"
                "**Please provide the target details:**\n"
                "- **City/Region** (e.g. *Mumbai*, *Delhi*, *Pune*)\n"
                "- **Observation Date** (e.g. *2025-11-05*)\n"
                "- **Requested Task** (*downscale*, *forecast*, *report*, or *hotspot*)"
            ),
            session_id=sid,
            status="need_info",
            intent="general_question",
            missing_fields=["location", "observation_date", "requested_tasks"],
            follow_up_question="Which city and observation date should I process for this request form?",
        )

    # Build a natural-language summary from the parsed fields
    summary_parts = [f"Request form uploaded ({file.filename})."]
    if "location" in parsed:
        summary_parts.append(f"Location: {parsed['location']}.")
    if "requested_tasks" in parsed:
        summary_parts.append(f"Tasks: {', '.join(parsed['requested_tasks'])}.")
    if "observation_date" in parsed:
        summary_parts.append(f"Date: {parsed['observation_date']}.")

    message = " ".join(summary_parts) + " Please proceed with the analysis."

    # Map city name to bbox if not already present
    if "location" in parsed and "bbox" not in parsed:
        from app.agent.parser import CITY_BBOXES
        city_key = parsed["location"].lower()
        city_info = CITY_BBOXES.get(city_key)
        if city_info:
            parsed["bbox"] = city_info["bbox"]

    try:
        result = await run_agent(message, sid, extra_state=parsed)
    except Exception as exc:
        log.exception("Agent execution after DOCX upload failed")
        raise HTTPException(status_code=500, detail=f"Agent error: {exc}")

    return ChatResponse(
        response=result.get("response") or result.get("follow_up_question", "Something went wrong."),
        session_id=sid,
        executed_tools=result.get("executed_tools", []),
        artifacts=result.get("artifacts", []),
        status=result.get("status", "done"),
        intent=result.get("intent"),
        missing_fields=result.get("missing_fields", []),
        follow_up_question=result.get("follow_up_question"),
    )


@router.post(
    "/load-server-form",
    response_model=ChatResponse,
    summary="Load the server-side NO2 Air Quality Analysis Request Form",
    tags=["agent"],
)
async def load_server_form(
    session_id: str | None = None,
    current_user: dict = Depends(get_current_user),  # noqa: B008
) -> ChatResponse:
    """Load and parse the official NO2_Air_Quality_Analysis_Request_Form.docx from backend/data."""
    from pathlib import Path

    from app.agent.docx_parser import parse_docx

    doc_path = Path("data/NO2_Air_Quality_Analysis_Request_Form.docx")
    if not doc_path.exists():
        doc_path = Path(__file__).resolve().parents[3] / "data" / "NO2_Air_Quality_Analysis_Request_Form.docx"
    if not doc_path.exists():
        raise HTTPException(status_code=404, detail="Server form document not found in backend/data")

    file_bytes = doc_path.read_bytes()
    try:
        parsed = parse_docx(file_bytes)
    except Exception as exc:
        log.exception("Server form parse failed")
        raise HTTPException(status_code=500, detail=f"Failed to parse server document: {exc}")

    sid = session_id or str(uuid.uuid4())

    if not parsed:
        return ChatResponse(
            response=(
                "### 📄 Form Attached: `NO2_Air_Quality_Analysis_Request_Form.docx`\n\n"
                "Loaded the official government **NO₂ Air Quality Analysis Request Form** from `backend/data`.\n\n"
                "The form template is ready. What study parameters would you like to run?\n"
                "- **City/Region** (e.g. *Mumbai*, *Delhi*, *Pune*)\n"
                "- **Observation Date** (e.g. *2025-11-05*)\n"
                "- **Analysis Task** (*downscale map*, *forecast plume*, *hotspot detection*, or *regulatory report*)"
            ),
            session_id=sid,
            status="need_info",
            intent="general_question",
            missing_fields=["location", "observation_date", "requested_tasks"],
            follow_up_question="Which city and date should I analyze using this request form?",
        )

    summary_parts = ["Loaded server form NO2_Air_Quality_Analysis_Request_Form.docx."]
    if "location" in parsed:
        summary_parts.append(f"Location: {parsed['location']}.")
    if "requested_tasks" in parsed:
        summary_parts.append(f"Tasks: {', '.join(parsed['requested_tasks'])}.")
    if "observation_date" in parsed:
        summary_parts.append(f"Date: {parsed['observation_date']}.")

    message = " ".join(summary_parts) + " Please proceed with the analysis."

    try:
        result = await run_agent(message, sid, extra_state=parsed)
    except Exception as exc:
        log.exception("Agent execution failed for server form")
        raise HTTPException(status_code=500, detail=f"Agent error: {exc}")

    return ChatResponse(
        response=result.get("response") or result.get("follow_up_question", "Something went wrong."),
        session_id=sid,
        executed_tools=result.get("executed_tools", []),
        artifacts=result.get("artifacts", []),
        status=result.get("status", "done"),
        intent=result.get("intent"),
        missing_fields=result.get("missing_fields", []),
        follow_up_question=result.get("follow_up_question"),
    )
