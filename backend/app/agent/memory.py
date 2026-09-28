"""Session memory — in-memory conversation store (no vector DB, no persistence)."""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

log = logging.getLogger("agent.memory")

# TTL for idle sessions (1 hour)
SESSION_TTL_SEC = 3600
MAX_HISTORY = 50


class SessionStore:
    """Thread-safe, in-memory conversation store keyed by session_id."""

    def __init__(self) -> None:
        self._store: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    def get(self, session_id: str) -> dict[str, Any]:
        with self._lock:
            entry = self._store.get(session_id)
            if entry is None:
                entry = {"history": [], "state": {}, "updated_at": time.time()}
                self._store[session_id] = entry
            entry["updated_at"] = time.time()
            return entry

    def update(self, session_id: str, *, history: list[dict] | None = None, state: dict | None = None) -> None:
        with self._lock:
            entry = self._store.setdefault(
                session_id,
                {"history": [], "state": {}, "updated_at": time.time()},
            )
            if history is not None:
                entry["history"] = history[-MAX_HISTORY:]
            if state is not None:
                # Merge — keep previously-extracted fields across turns
                entry["state"].update(state)
            entry["updated_at"] = time.time()

    def add_message(self, session_id: str, role: str, content: str) -> None:
        with self._lock:
            entry = self._store.setdefault(
                session_id,
                {"history": [], "state": {}, "updated_at": time.time()},
            )
            entry["history"].append({"role": role, "content": content})
            if len(entry["history"]) > MAX_HISTORY:
                entry["history"] = entry["history"][-MAX_HISTORY:]
            entry["updated_at"] = time.time()

    def cleanup(self) -> int:
        """Remove expired sessions. Returns how many were purged."""
        now = time.time()
        with self._lock:
            expired = [
                sid for sid, e in self._store.items()
                if now - e["updated_at"] > SESSION_TTL_SEC
            ]
            for sid in expired:
                del self._store[sid]
        if expired:
            log.info("Purged %d expired sessions", len(expired))
        return len(expired)


# Singleton
session_store = SessionStore()
