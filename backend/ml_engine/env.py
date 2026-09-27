"""Settings from the environment or ``backend/.env`` (read at call time, so edits apply without a restart)."""

from __future__ import annotations

import os
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


def setting(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    if value:
        return value
    if ENV_FILE.exists():
        from dotenv import dotenv_values

        value = dotenv_values(ENV_FILE).get(name)
    return value or default


def offline() -> bool:
    """``ML_ENGINE_OFFLINE=true``: never call Earth Engine (e.g. during a presentation). Everything is served
    from stored results: pre-computed runs for reports, the last global snapshot for the globe."""
    return (setting("ML_ENGINE_OFFLINE", "false") or "").strip().lower() in ("1", "true", "yes", "on")
