"""DOCX form ingestion — parse structured NO2 analysis request forms into agent state fields."""

from __future__ import annotations

import io
import logging
import re
from typing import Any

from app.agent.parser import CITY_BBOXES

log = logging.getLogger("agent.docx_parser")

# Field label → state key mapping
FIELD_MAP: dict[str, str] = {
    "organization": "organization",
    "organisation": "organization",
    "department": "organization",
    "department/division": "organization",
    "contact person": "contact_person",
    "role": "role",
    "designation": "role",
    "position": "role",
    "city/region": "location",
    "city": "location",
    "region": "location",
    "area": "location",
    "country": "country",
    "state/province": "state",
    "bounding box": "bbox",
    "bbox": "bbox",
    "coordinates": "bbox",
    "observation date": "observation_date",
    "date": "observation_date",
    "analysis date": "observation_date",
    "forecast duration": "forecast_duration",
    "duration": "forecast_duration",
    "priority": "priority",
    "special areas of interest": "additional_notes",
    "additional instructions": "additional_notes",
    "notes": "additional_notes",
    "language": "language",
}

# Task checkboxes recognition
CHECKED_CHARS = r"[☑✔✓🗹xX]|\[[xX]\]"
TASK_PATTERNS = [
    (re.compile(rf"(?:{CHECKED_CHARS})\s*Generate\s+Fine-Resolution\s+NO₂?\s+Map", re.IGNORECASE), "downscale"),
    (re.compile(rf"(?:{CHECKED_CHARS})\s*Forecast\s+NO₂?\s+Plume", re.IGNORECASE), "forecast"),
    (re.compile(rf"(?:{CHECKED_CHARS})\s*Identify\s+Hotspots", re.IGNORECASE), "hotspot"),
    (re.compile(rf"(?:{CHECKED_CHARS})\s*Compare\s+with\s+Previous", re.IGNORECASE), "analysis"),
    (re.compile(rf"(?:{CHECKED_CHARS})\s*Generate\s+PDF\s+Report", re.IGNORECASE), "report"),
]

# Forecast duration checkboxes
DURATION_PATTERNS = [
    (re.compile(rf"(?:{CHECKED_CHARS})\s*30\s*min", re.IGNORECASE), 30),
    (re.compile(rf"(?:{CHECKED_CHARS})\s*60\s*min", re.IGNORECASE), 60),
    (re.compile(rf"(?:{CHECKED_CHARS})\s*90\s*min", re.IGNORECASE), 90),
    (re.compile(rf"(?:{CHECKED_CHARS})\s*120\s*min", re.IGNORECASE), 120),
]


def _clean_value(raw: str) -> str:
    """Strip underline placeholders, slashes, and template boilerplate."""
    val = raw.strip()
    if re.fullmatch(r"[_/\s-]+", val):
        return ""
    # Reject unselected multiple-choice prompts
    lower = val.lower()
    if "researcher" in lower and "government officer" in lower:
        return ""
    if "☐" in val or "yes / no" in lower:
        return ""
    val = re.sub(r"^[_\s]+|[_\s]+$", "", val)
    return val.strip()


def parse_docx(file_bytes: bytes) -> dict[str, Any]:
    """Extract key→value pairs from a .docx form.

    Supports:
    - Key-value lines: 'Organization: CPCB', 'City/Region: Mumbai'
    - Placeholder stripping ('____', '____/____/________')
    - Min Lon / Min Lat / Max Lon / Max Lat bounding box formats
    - Checkbox extraction (☑ / [x] / ✓) for analysis tasks and durations
    - Table-based and paragraph-based layouts
    """
    from docx import Document

    doc = Document(io.BytesIO(file_bytes))
    extracted: dict[str, Any] = {}
    all_text_lines: list[str] = []

    # 1. Process tables
    for table in doc.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells]
            all_text_lines.append(" | ".join(cells))
            if len(cells) >= 2 and cells[0]:
                label = cells[0].rstrip(":").strip().lower()
                clean = _clean_value(cells[1])
                if not clean:
                    continue
                for pattern, key in FIELD_MAP.items():
                    if pattern in label:
                        extracted[key] = clean
                        break

    # 2. Process paragraphs
    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            continue
        all_text_lines.append(text)

        # Match "Label: Value"
        m = re.match(r"^([^:–—]+)[:\-–—]\s*(.*)$", text)
        if m:
            label = m.group(1).strip().lower()
            val_raw = m.group(2).strip()
            clean = _clean_value(val_raw)
            if clean:
                for pattern, key in FIELD_MAP.items():
                    if pattern in label and key not in extracted:
                        extracted[key] = clean
                        break

    full_document_text = "\n".join(all_text_lines)

    # 3. Bounding box coordinates pattern: Min Lon <num> Min Lat <num>
    bbox_match = re.search(
        r"min\s*lon[:\s]*([-+]?\d+(?:\.\d+)?).*?min\s*lat[:\s]*([-+]?\d+(?:\.\d+)?).*?max\s*lon[:\s]*([-+]?\d+(?:\.\d+)?).*?max\s*lat[:\s]*([-+]?\d+(?:\.\d+)?)",
        full_document_text,
        re.IGNORECASE,
    )
    if bbox_match:
        extracted["bbox"] = f"{bbox_match.group(1)},{bbox_match.group(2)},{bbox_match.group(3)},{bbox_match.group(4)}"

    # 4. Extract checked analysis tasks
    checked_tasks: list[str] = []
    for pat, task_name in TASK_PATTERNS:
        if pat.search(full_document_text) and task_name not in checked_tasks:
            checked_tasks.append(task_name)
    if checked_tasks:
        extracted["requested_tasks"] = checked_tasks

    # 5. Extract checked forecast duration
    for pat, dur in DURATION_PATTERNS:
        if pat.search(full_document_text):
            extracted["forecast_duration"] = dur
            break

    # 6. Normalize date
    if "observation_date" in extracted:
        date_str = extracted["observation_date"]
        # Match YYYY-MM-DD or DD/MM/YYYY or MM/DD/YYYY
        iso_m = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", date_str)
        if iso_m:
            extracted["observation_date"] = iso_m.group(1)
        else:
            slash_m = re.search(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b", date_str)
            if slash_m:
                extracted["observation_date"] = f"{slash_m.group(3)}-{int(slash_m.group(1)):02d}-{int(slash_m.group(2)):02d}"

    # 7. Auto-fill bbox from city if bbox was not specified
    if "location" in extracted and "bbox" not in extracted:
        loc_lower = extracted["location"].lower()
        for city, meta in CITY_BBOXES.items():
            if city in loc_lower:
                extracted["bbox"] = meta["bbox"]
                break

    # 8. Forecast duration numeric parse if string
    if "forecast_duration" in extracted and isinstance(extracted["forecast_duration"], str):
        try:
            extracted["forecast_duration"] = int(re.sub(r"[^\d]", "", extracted["forecast_duration"]))
        except ValueError:
            del extracted["forecast_duration"]

    log.info("DOCX parsed fields: %s", list(extracted.keys()))
    return extracted
