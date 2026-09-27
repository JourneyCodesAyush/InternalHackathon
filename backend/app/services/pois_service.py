"""Emission point sources and corridors for any map area, from OpenStreetMap (Overpass API).

Industrial zones, works/factories and power plants come back as points; motorways, trunk roads and main
railways as simplified lines. Results are cached on disk per area (they change rarely), so repeated views
and demos do not depend on Overpass being reachable.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
import urllib.parse
import urllib.request
from pathlib import Path

log = logging.getLogger(__name__)

OVERPASS_URLS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
                 "https://lz4.overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter")
CACHE_DIR = Path("cache/pois")
MAX_SPAN_DEG = 1.0  # larger views would return tens of thousands of features: ask the user to zoom in
MAX_POINTS = 2000
MAX_CORRIDORS = 2000

# one request per area (Overpass rate-limits per client): points first, then the corridor lines
QUERY = """[out:json][timeout:60];
(
  way["landuse"="industrial"]({b}); relation["landuse"="industrial"]({b});
  nwr["man_made"="works"]({b});
  nwr["power"="plant"]({b});
  nwr["industrial"~"^(factory|refinery|chemical|oil|petroleum|gas|cement|steel|metal|metal_processing|brickyard|bricks|shipyard|port|textile|food_industry|mine|quarry|power)$"]({b});
);
out center tags {np};
(
  way["highway"~"^(motorway|trunk)$"]({b});
  way["railway"="rail"]["usage"~"^(main|branch)$"]({b});
);
out geom tags {nl};"""


def _overpass(query: str, attempts: int = 4) -> dict:
    try:
        import truststore

        truststore.inject_into_ssl()
    except ImportError:
        pass
    last = None
    for attempt in range(attempts):
        url = OVERPASS_URLS[attempt % len(OVERPASS_URLS)]
        req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": query}).encode(),
                                     headers={"User-Agent": "airq-insight/0.1 (air-quality research)"})
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                return json.load(resp)
        except Exception as exc:  # Overpass rate limits under load: try the mirror
            last = exc
            log.warning("Overpass request failed (%s)", exc)
            time.sleep(2)
    raise RuntimeError(f"OpenStreetMap (Overpass) unavailable: {last}")


def _point(el: dict) -> dict | None:
    tags = el.get("tags", {})
    lat = el.get("lat", (el.get("center") or {}).get("lat"))
    lon = el.get("lon", (el.get("center") or {}).get("lon"))
    if lat is None or lon is None:
        return None
    if tags.get("power") == "plant":
        category, factor = "POWER_PLANT", 0.9
        source = tags.get("plant:source") or tags.get("generator:source")
        details = f"Power plant{f' ({source})' if source else ''}{f', {tags['plant:output:electricity']}' if tags.get('plant:output:electricity') else ''}."
    elif tags.get("man_made") == "works":
        category, factor = "FACTORY", 0.7
        details = f"Factory / works{f': {tags['product']}' if tags.get('product') else ''}."
    else:
        category, factor = "FACTORY", 0.6
        kind = tags.get("industrial")
        details = f"Industrial area{f' ({kind.replace('_', ' ')})' if kind and kind != 'yes' else ''}."
    name = tags.get("name:en") or tags.get("name") or {"POWER_PLANT": "Power plant", "FACTORY": "Industrial site"}[category]
    return {"id": f"osm-{el['type']}-{el['id']}", "name": name, "category": category, "coordinates": [lat, lon],
            "emissionFactor": factor, "details": details + " Source: OpenStreetMap."}


def _line(el: dict) -> dict | None:
    geom = el.get("geometry") or []
    if len(geom) < 2:
        return None
    tags = el.get("tags", {})
    step = max(1, len(geom) // 20)  # simplify long ways
    path = [[round(p["lat"], 5), round(p["lon"], 5)] for p in geom[::step]]
    if path[-1] != [round(geom[-1]["lat"], 5), round(geom[-1]["lon"], 5)]:
        path.append([round(geom[-1]["lat"], 5), round(geom[-1]["lon"], 5)])
    if "railway" in tags:
        kind, factor = "railway", 0.5
    else:
        kind, factor = tags.get("highway", "road"), 0.85 if tags.get("highway") == "motorway" else 0.7
    name = tags.get("name:en") or tags.get("name") or tags.get("ref") or kind.title()
    return {"id": f"osm-way-{el['id']}", "name": name, "kind": kind, "emissionFactor": factor, "path": path}


def get_pois(bbox: tuple[float, float, float, float]) -> dict:
    """Point sources and corridors inside ``bbox`` (west, south, east, north)."""
    w, s, e, n = bbox
    if e - w > MAX_SPAN_DEG or n - s > MAX_SPAN_DEG:
        raise ValueError(f"Area too large for point sources (max {MAX_SPAN_DEG}° across); zoom in")
    # snap to a 0.05° grid so nearby views share one cached answer
    snap = lambda v, f: round(f(v / 0.05) * 0.05, 2)  # noqa: E731
    import math

    # (tolerance: 72.80 / 0.05 is 1455.999..., which must not floor to 72.75)
    w, s = snap(w + 1e-9, math.floor), snap(s + 1e-9, math.floor)
    e, n = snap(e - 1e-9, math.ceil), snap(n - 1e-9, math.ceil)
    key = hashlib.sha1(json.dumps([w, s, e, n, 3]).encode()).hexdigest()[:16]
    cache = CACHE_DIR / f"{key}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    b = f"{s},{w},{n},{e}"
    elements = _overpass(QUERY.format(b=b, np=MAX_POINTS, nl=MAX_CORRIDORS))["elements"]
    lines = [el for el in elements if "geometry" in el]
    points = [p for p in (_point(el) for el in elements if "geometry" not in el) if p]
    corridors = [c for c in (_line(el) for el in lines) if c]
    result = {"bbox": [w, s, e, n], "points": points, "corridors": corridors, "source": "OpenStreetMap"}
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(result))
    return result
