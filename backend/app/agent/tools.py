"""LangChain tool wrappers around existing FastAPI endpoint logic.

Each tool calls the underlying *service* function directly (same code the endpoint uses)
so we never duplicate business logic — we just skip the HTTP layer.
"""

from __future__ import annotations

import logging
from typing import Any

from app.agent.state import AgentState

log = logging.getLogger("agent.tools")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _supabase():
    from app.core.config import get_supabase
    return get_supabase()


def _demo_user() -> dict:
    """Agent tool calls run as the demo user (server-side, no browser token)."""
    return {
        "id": "00000000-0000-0000-0000-000000000000",
        "email": "agent@airqinsight.local",
        "full_name": "AirQ Agent",
        "role": "NORMAL_USER",
        "is_blocked": False,
    }


DEFAULT_BBOX = (72.825, 19.015, 72.850, 19.038)  # Shivaji Park, Dadar, Mumbai default


def _bbox_parts(bbox_str: Any) -> tuple[float, float, float, float]:
    """Safely parse comma-separated bbox into a 4-tuple of floats with default fallback."""
    if not bbox_str:
        return DEFAULT_BBOX
    try:
        parts = [float(v.strip()) for v in str(bbox_str).split(",")]
        if len(parts) == 4:
            return (parts[0], parts[1], parts[2], parts[3])
    except (ValueError, AttributeError):
        pass
    return DEFAULT_BBOX


# ── Tool implementations ─────────────────────────────────────────────────────

async def run_downscale(state: AgentState) -> dict[str, Any]:
    """Call the downscale service to produce a high-res NO₂ map."""
    from app.services import downscale_service

    bbox_tuple = _bbox_parts(state.get("bbox"))
    bbox = f"{bbox_tuple[0]},{bbox_tuple[1]},{bbox_tuple[2]},{bbox_tuple[3]}"
    timestamp = state.get("observation_date", "")
    if timestamp and "T" not in timestamp:
        timestamp += "T12:00:00Z"

    try:
        result = await downscale_service.get_downscaled_map(
            _supabase(), _demo_user()["id"], bbox, timestamp
        )
        return {
            "status": "success",
            "type": "map",
            "data": result.model_dump() if hasattr(result, "model_dump") else dict(result),
        }
    except Exception as exc:  # noqa: BLE001
        log.error("Downscale tool error: %s", exc)
        return {"status": "error", "error": str(exc)}


async def run_forecast(state: AgentState) -> dict[str, Any]:
    """Call the trends service for spatiotemporal forecast."""
    from app.services import trends_service

    bbox_tuple = _bbox_parts(state.get("bbox"))
    timestamp = state.get("observation_date", "")
    interval = 30  # default 30-min intervals

    duration = state.get("forecast_duration")
    if duration and duration in (60, 90, 120):
        interval = duration

    try:
        result = await trends_service.get_spatial_forecast(
            _supabase(), _demo_user()["id"], bbox_tuple, timestamp or None, interval
        )
        return {
            "status": "success",
            "type": "forecast",
            "data": result.model_dump() if hasattr(result, "model_dump") else dict(result),
        }
    except Exception as exc:  # noqa: BLE001
        log.error("Forecast tool error: %s", exc)
        return {"status": "error", "error": str(exc)}


async def run_report(state: AgentState) -> dict[str, Any]:
    """Call the reports service to generate a PDF report."""
    from app.services import reports_service

    bbox_tuple = _bbox_parts(state.get("bbox"))
    bbox = f"{bbox_tuple[0]},{bbox_tuple[1]},{bbox_tuple[2]},{bbox_tuple[3]}"
    end_date = state.get("observation_date", "")
    location = state.get("location", "Region")
    language = state.get("language", "en")

    try:
        # Use the analysis endpoint (returns JSON, not streaming PDF)
        result = await reports_service.analyse_area(
            location, bbox, end_date, language=language, city=location,
        )
        return {
            "status": "success",
            "type": "report",
            "data": result,
            "message": f"Report analysis complete for {location}. PDF can be downloaded from the Reports panel.",
        }
    except Exception as exc:  # noqa: BLE001
        log.error("Report tool error: %s", exc)
        return {"status": "error", "error": str(exc)}


async def run_hotspot(state: AgentState) -> dict[str, Any]:
    """Call the analyze service for pollution source attribution."""
    from app.services import analyze_service

    lat = state.get("lat")
    lon = state.get("lon")
    if not (lat and lon):
        parts = _bbox_parts(state.get("bbox"))
        lat = (parts[1] + parts[3]) / 2
        lon = (parts[0] + parts[2]) / 2

    try:
        result = await analyze_service.pinpoint_sources(
            _supabase(), _demo_user()["id"], float(lat), float(lon), radius_km=5.0
        )
        return {
            "status": "success",
            "type": "hotspot",
            "data": result.model_dump() if hasattr(result, "model_dump") else dict(result),
        }
    except Exception as exc:  # noqa: BLE001
        log.error("Hotspot tool error: %s", exc)
        return {"status": "error", "error": str(exc)}


async def run_analysis(state: AgentState) -> dict[str, Any]:
    """Run area analysis vs regulatory standards."""
    from app.services import reports_service

    bbox_tuple = _bbox_parts(state.get("bbox"))
    bbox = f"{bbox_tuple[0]},{bbox_tuple[1]},{bbox_tuple[2]},{bbox_tuple[3]}"
    end_date = state.get("observation_date", "")
    location = state.get("location", "Region")
    language = state.get("language", "en")

    try:
        result = await reports_service.analyse_area(
            location, bbox, end_date, language=language, city=location,
        )
        return {
            "status": "success",
            "type": "analysis",
            "data": result,
        }
    except Exception as exc:  # noqa: BLE001
        log.error("Analysis tool error: %s", exc)
        return {"status": "error", "error": str(exc)}


# ── Tool router (the LangGraph node) ─────────────────────────────────────────

TOOL_MAP = {
    "downscale": run_downscale,
    "forecast":  run_forecast,
    "report":    run_report,
    "hotspot":   run_hotspot,
    "analysis":  run_analysis,
}


async def execute_tools(state: AgentState) -> AgentState:
    """LangGraph node: run the appropriate tool(s) based on requested_tasks."""
    tasks = state.get("requested_tasks", [])
    if not tasks:
        intent = state.get("intent", "")
        tasks = [intent] if intent in TOOL_MAP else []

    tool_results: dict[str, Any] = state.get("tool_results", {})
    executed: list[str] = list(state.get("executed_tools", []))
    artifacts: list[dict[str, str]] = list(state.get("artifacts", []))

    for task_name in tasks:
        tool_fn = TOOL_MAP.get(task_name)
        if not tool_fn:
            continue

        result = await tool_fn(state)
        tool_results[task_name] = result
        executed.append(task_name)

        if result.get("status") == "success":
            artifact: dict[str, Any] = {
                "type": result.get("type", task_name),
                "location": state.get("location", "Region"),
                "date": state.get("observation_date", ""),
                "bbox": state.get("bbox", ""),
            }
            data = result.get("data", {})
            if isinstance(data, dict):
                artifact["data"] = data
                for url_key in ("grid_url", "netcdf_url", "geotiff_url"):
                    if url_key in data:
                        artifact["url"] = data[url_key]
                        break
            artifacts.append(artifact)

    return {
        **state,
        "tool_results": tool_results,
        "executed_tools": executed,
        "artifacts": artifacts,
        "status": "done",
    }
