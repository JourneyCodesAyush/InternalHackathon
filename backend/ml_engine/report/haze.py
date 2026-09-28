"""Dark Channel Prior (DCP) haze estimation for drone / webcam frames, and the store of recent readings.

He, Sun & Tang (2009): in haze-free outdoor images most local patches have a colour channel close to zero
(the *dark channel*); haze lifts it towards the atmospheric light A. With the transmission
``t(x) = 1 - omega * dark(I / A)``, the haze index reported here is ``1 - mean(t)`` (0 = clear, 1 = opaque).

    reading = analyse_frame(jpeg_bytes)          # {'haze_index', 'transmission_mean', 'airlight', 'class', ...}
    record_reading(reading, lat=19.07, lon=72.88)
    latest_reading(max_age_h=72)
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from ..env import setting

log = logging.getLogger(__name__)

STORE = Path(setting("ML_ENGINE_HAZE_DIR", "cache/drone"))
PATCH = 15  # dark-channel patch (pixels), as in the original paper
OMEGA = 0.95  # keep a little haze so distant objects still look distant
TOP_FRACTION = 0.001  # brightest 0.1% of the dark channel give the atmospheric light
MAX_SIDE = 480  # frames are resized for speed; DCP is scale-tolerant

# haze index -> class (visibility guidance for line-of-sight drone flights)
HAZE_CLASSES = ((0.30, "clear"), (0.45, "light"), (0.60, "moderate"), (1.01, "dense"))


def _guided_filter(guide: np.ndarray, src: np.ndarray, radius: int = 40, eps: float = 1e-3) -> np.ndarray:
    """He's guided filter (box-filter form) to refine the transmission map along image edges."""
    import cv2

    box = lambda x: cv2.boxFilter(x, cv2.CV_64F, (radius, radius))  # noqa: E731
    mean_i, mean_p = box(guide), box(src)
    cov_ip = box(guide * src) - mean_i * mean_p
    var_i = box(guide * guide) - mean_i * mean_i
    a = cov_ip / (var_i + eps)
    b = mean_p - a * mean_i
    return box(a) * guide + box(b)


def haze_class(index: float) -> str:
    return next(name for limit, name in HAZE_CLASSES if index < limit)


def analyse_image(bgr: np.ndarray) -> dict:
    """DCP on a BGR uint8 image."""
    import cv2

    h, w = bgr.shape[:2]
    scale = min(1.0, MAX_SIDE / max(h, w))
    if scale < 1.0:
        bgr = cv2.resize(bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    img = bgr.astype(np.float64) / 255.0
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (PATCH, PATCH))
    dark = cv2.erode(img.min(axis=2), kernel)

    # atmospheric light: brightest input pixel among the haziest (highest dark-channel) 0.1%
    n = max(1, int(dark.size * TOP_FRACTION))
    idx = np.argpartition(dark.ravel(), -n)[-n:]
    flat = img.reshape(-1, 3)
    airlight = flat[idx[np.argmax(flat[idx].sum(axis=1))]]
    airlight = np.maximum(airlight, 1e-3)

    transmission = 1.0 - OMEGA * cv2.erode((img / airlight).min(axis=2), kernel)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float64) / 255.0
    transmission = np.clip(_guided_filter(gray, transmission), 0.05, 1.0)

    t_mean = float(transmission.mean())
    index = float(np.clip(1.0 - t_mean, 0.0, 1.0))
    return {
        "haze_index": round(index, 3),
        "class": haze_class(index),
        "transmission_mean": round(t_mean, 3),
        "transmission_p10": round(float(np.percentile(transmission, 10)), 3),
        "dark_channel_mean": round(float(dark.mean()), 3),
        "airlight_rgb": [round(float(v) * 255) for v in airlight[::-1]],
        "hazy_share": round(float((transmission < 0.5).mean()), 3),
        "method": "Dark Channel Prior (OpenCV, patch 15, omega 0.95, guided filter)",
    }


def analyse_frame(data: bytes) -> dict:
    """DCP on an encoded image (JPEG/PNG bytes)."""
    import cv2

    bgr = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError("Could not decode the image")
    return analyse_image(bgr)


def record_reading(reading: dict, lat: float | None = None, lon: float | None = None, source: str = "drone") -> dict:
    """Append a reading (with position and time) to the store; returns what was stored."""
    entry = {**reading, "lat": lat, "lon": lon, "source": source,
             "time": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "ts": time.time()}
    STORE.mkdir(parents=True, exist_ok=True)
    with open(STORE / "haze_readings.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
    return entry


def recent_readings(max_age_h: float = 72.0, limit: int = 500) -> list[dict]:
    path = STORE / "haze_readings.jsonl"
    if not path.exists():
        return []
    cutoff = time.time() - max_age_h * 3600
    out = []
    for line in path.read_text(encoding="utf-8").splitlines()[-limit:]:
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if entry.get("ts", 0) >= cutoff:
            out.append(entry)
    return out


def summary(max_age_h: float = 72.0) -> dict | None:
    """Latest reading plus statistics over the recent ones, for the reports."""
    readings = recent_readings(max_age_h)
    if not readings:
        return None
    idx = np.array([r["haze_index"] for r in readings], dtype=float)
    latest = readings[-1]
    return {
        "latest": {k: latest.get(k) for k in ("haze_index", "class", "transmission_mean", "hazy_share", "airlight_rgb",
                                              "lat", "lon", "time", "source", "method")},
        "count": len(readings), "mean": round(float(idx.mean()), 3), "max": round(float(idx.max()), 3),
        "hours": max_age_h,
    }
