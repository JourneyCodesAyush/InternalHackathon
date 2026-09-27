"""City name -> bounding box, derived from CPCB monitoring-station locations (no internet needed).

Each city's box spans all of its monitoring stations plus a margin, and is at least ``MIN_HALF_SIZE_DEG``
around the station centroid, so the map covers the urban area the network was sited for.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

import pandas as pd

STATIONS_CSV = Path(__file__).resolve().parents[1] / "data" / "cpcb_stations.csv"
MARGIN_DEG = 0.06
MIN_HALF_SIZE_DEG = 0.15
MAX_HALF_SIZE_DEG = 0.45
ALIASES = {
    "bombay": "mumbai", "bangalore": "bengaluru", "gurgaon": "gurugram", "calcutta": "kolkata",
    "madras": "chennai", "poona": "pune", "trivandrum": "thiruvananthapuram", "new delhi": "delhi",
    "navimumbai": "navi mumbai", "mysore": "mysuru", "baroda": "vadodara", "benares": "varanasi",
}


def _norm(name: str) -> str:
    return re.sub(r"\s+", " ", str(name).strip().lower())


def city_of(station_name: str) -> str:
    """CPCB station name -> city.

    'Bandra, Mumbai - MPCB' -> 'Mumbai'; 'Sector - 125, Noida - UPPCB' -> 'Noida';
    'Collectorate - Gaya - BSPCB' -> 'Gaya'. The last ' - ' part is the operating agency.
    """
    parts = [p.strip() for p in str(station_name).split(" - ")]
    body = parts[:-1] if len(parts) > 1 else parts
    for part in reversed(body):
        if "," in part:
            return part.split(",")[-1].strip()
    return body[-1]


@lru_cache(maxsize=1)
def city_table() -> pd.DataFrame:
    st = pd.read_csv(STATIONS_CSV)
    st["city"] = st["station_name"].map(city_of)
    g = st.groupby("city").agg(lat=("lat", "mean"), lon=("lon", "mean"), lat_min=("lat", "min"),
                              lat_max=("lat", "max"), lon_min=("lon", "min"), lon_max=("lon", "max"),
                              stations=("station_name", "count")).reset_index()
    g["key"] = g["city"].map(_norm)
    return g


def city_bbox(name: str) -> tuple[float, float, float, float]:
    """(west, south, east, north) for a city name; raises ``KeyError`` with suggestions if unknown."""
    table = city_table()
    key = ALIASES.get(_norm(name), _norm(name))
    hit = table[table["key"] == key]
    if hit.empty:
        close = table[table["key"].str.contains(key[:4], regex=False)]["city"].head(8).tolist()
        raise KeyError(f"Unknown city {name!r}." + (f" Did you mean: {', '.join(close)}?" if close else ""))
    r = hit.iloc[0]

    def half(lo, hi, centre):
        spread = max(centre - lo, hi - centre) + MARGIN_DEG
        return min(max(spread, MIN_HALF_SIZE_DEG), MAX_HALF_SIZE_DEG)

    hy, hx = half(r.lat_min, r.lat_max, r.lat), half(r.lon_min, r.lon_max, r.lon)
    return tuple(round(float(v), 3) for v in (r.lon - hx, r.lat - hy, r.lon + hx, r.lat + hy))


def list_cities(min_stations: int = 1) -> list[str]:
    t = city_table()
    return sorted(t[t["stations"] >= min_stations]["city"].tolist())
