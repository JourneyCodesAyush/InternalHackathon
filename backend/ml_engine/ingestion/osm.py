"""OpenStreetMap major-road download (Overpass API) for the road-density covariate."""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

log = logging.getLogger(__name__)

OVERPASS_URLS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter")
_LOCK = threading.Lock()  # Overpass rejects parallel clients; callers may be threaded
ROAD_CLASSES = "motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary"


def fetch_major_roads(bbox: tuple[float, float, float, float], cache_dir: str | Path, retries: int = 6) -> Path:
    """Download OSM motorway..tertiary roads inside ``bbox`` as GeoJSON (cached) and return its path."""
    import truststore

    truststore.inject_into_ssl()
    west, south, east, north = bbox
    path = Path(cache_dir) / f"osm_roads_{west:.3f}_{south:.3f}_{east:.3f}_{north:.3f}.geojson"
    if path.exists():
        log.info("Using cached OSM roads %s", path)
        return path
    with _LOCK:
        if path.exists():  # another thread fetched the same box meanwhile
            return path
        query = (f'[out:json][timeout:120];way["highway"~"^({ROAD_CLASSES})$"]'
                 f"({south},{west},{north},{east});out geom;")
        payload = _overpass(query, retries)
        features = []
        for el in payload.get("elements", []):
            geom = el.get("geometry")
            if el.get("type") != "way" or not geom or len(geom) < 2:
                continue
            highway = el.get("tags", {}).get("highway", "").replace("_link", "")
            features.append({
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [[p["lon"], p["lat"]] for p in geom]},
                "properties": {"highway": highway},
            })
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
        log.info("Downloaded %d OSM road segments to %s", len(features), path)
        time.sleep(1.0)  # be polite between queries
    return path


def _overpass(query: str, retries: int) -> dict:
    for attempt in range(retries):
        url = OVERPASS_URLS[attempt % len(OVERPASS_URLS)]  # alternate with a mirror under load
        request = urllib.request.Request(
            url, data=urllib.parse.urlencode({"data": query}).encode(),
            headers={"User-Agent": "no2-ml-engine/0.1 (air-quality research)"},
        )
        try:
            with urllib.request.urlopen(request, timeout=180) as resp:
                return json.load(resp)
        except Exception as exc:  # Overpass rate-limits (429/504) under load
            if attempt == retries - 1:
                raise
            log.warning("Overpass request failed (%s); retrying in %ss", exc, 10 * (attempt + 1))
            time.sleep(10 * (attempt + 1))
    raise RuntimeError("unreachable")
