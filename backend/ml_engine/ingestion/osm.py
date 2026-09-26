"""OpenStreetMap major-road download (Overpass API) for the road-density covariate."""

from __future__ import annotations

import json
import logging
import time
import urllib.parse
import urllib.request
from pathlib import Path

log = logging.getLogger(__name__)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
ROAD_CLASSES = "motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary"


def fetch_major_roads(bbox: tuple[float, float, float, float], cache_dir: str | Path, retries: int = 3) -> Path:
    """Download OSM motorway..tertiary roads inside ``bbox`` as GeoJSON (cached) and return its path."""
    import truststore

    truststore.inject_into_ssl()
    west, south, east, north = bbox
    path = Path(cache_dir) / f"osm_roads_{west:.3f}_{south:.3f}_{east:.3f}_{north:.3f}.geojson"
    if path.exists():
        log.info("Using cached OSM roads %s", path)
        return path

    query = (f'[out:json][timeout:120];way["highway"~"^({ROAD_CLASSES})$"]'
             f"({south},{west},{north},{east});out geom;")
    request = urllib.request.Request(
        OVERPASS_URL, data=urllib.parse.urlencode({"data": query}).encode(),
        headers={"User-Agent": "no2-ml-engine/0.1 (air-quality research)"},
    )
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=180) as resp:
                payload = json.load(resp)
            break
        except Exception as exc:  # Overpass rate-limits (429/504) under load
            if attempt == retries - 1:
                raise
            log.warning("Overpass request failed (%s); retrying in %ss", exc, 10 * (attempt + 1))
            time.sleep(10 * (attempt + 1))

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
    return path
