"""OpenAQ v3 downloader: hourly NO2 (ug/m^3) for every government monitor in a country.

OpenAQ mirrors India's CPCB network (~420 NO2 monitors). Its Indian NO2 series end in 2022, so it is
the national *training* set (2019-2022); newer CPCB downloads serve as an independent test period.

The API key is read from the ``OPENAQ_API_KEY`` environment variable or ``backend/.env``. Downloads are
cached per sensor, so an interrupted run resumes where it stopped.

    uv run python -m ml_engine.ingestion.openaq --start 2019-01-01 --end 2022-12-31 -o data/openaq_india_no2_hourly.csv
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

log = logging.getLogger(__name__)

API = "https://api.openaq.org/v3"
NO2_UGM3_PARAMETER = 5
PAGE = 1000
MIN_HOUR_COMPLETENESS = 75.0  # % of the sub-hourly readings present for an hourly value to count


class OpenAQClient:
    def __init__(self, api_key: str | None = None):
        import truststore

        truststore.inject_into_ssl()
        self.key = api_key or _load_key()
        self._remaining, self._reset = 60, 0.0

    def get(self, path: str, params: dict | None = None, retries: int = 8) -> dict:
        url = f"{API}{path}" + (f"?{urllib.parse.urlencode(params)}" if params else "")
        for attempt in range(retries):
            if self._remaining <= 1:  # respect the per-minute quota before we get throttled
                time.sleep(max(self._reset, 1.0))
            req = urllib.request.Request(url, headers={"X-API-Key": self.key, "User-Agent": "no2-ml-engine/0.1"})
            try:
                with urllib.request.urlopen(req, timeout=180) as resp:
                    self._remaining = int(resp.headers.get("X-Ratelimit-Remaining", 60))
                    self._reset = float(resp.headers.get("X-Ratelimit-Reset", 60))
                    return json.load(resp)
            except urllib.error.HTTPError as exc:
                if exc.code in (408, 429, 500, 502, 503, 504) and attempt < retries - 1:
                    wait = 30 * (attempt + 1) if exc.code == 429 else 5 * (attempt + 1)
                    log.warning("OpenAQ %s on %s; retrying in %ss", exc.code, path, wait)
                    time.sleep(wait)
                    continue
                raise
            except (urllib.error.URLError, TimeoutError) as exc:
                if attempt < retries - 1:
                    time.sleep(5 * (attempt + 1))
                    continue
                raise RuntimeError(f"OpenAQ request failed: {path}") from exc
        raise RuntimeError(f"OpenAQ request failed after {retries} attempts: {path}")


def _load_key() -> str:
    key = os.environ.get("OPENAQ_API_KEY")
    if not key:
        from dotenv import dotenv_values

        env_file = Path(__file__).resolve().parents[2] / ".env"
        key = dotenv_values(env_file).get("OPENAQ_API_KEY") if env_file.exists() else None
    if not key:
        raise RuntimeError("OPENAQ_API_KEY not set - add it to backend/.env (see backend/.env.example)")
    return key


def list_no2_sensors(client: OpenAQClient, country_code: str = "IN") -> pd.DataFrame:
    """One row per NO2 (ug/m^3) sensor: location, sensor id, name and coordinates."""
    countries = client.get("/countries", {"limit": 300})["results"]
    country_id = next(c["id"] for c in countries if c["code"] == country_code)
    rows, page = [], 1
    while True:
        res = client.get("/locations", {"countries_id": country_id, "parameters_id": NO2_UGM3_PARAMETER,
                                        "limit": PAGE, "page": page})["results"]
        for loc in res:
            for s in loc["sensors"]:
                if s["parameter"]["id"] == NO2_UGM3_PARAMETER:
                    rows.append({"location_id": loc["id"], "sensor_id": s["id"], "name": loc["name"],
                                 "lat": loc["coordinates"]["latitude"], "lon": loc["coordinates"]["longitude"],
                                 "provider": loc["provider"]["name"]})
        if len(res) < PAGE:
            break
        page += 1
    return pd.DataFrame(rows)


def fetch_sensor_hours(client: OpenAQClient, sensor_id: int, start: str, end: str) -> pd.DataFrame:
    """Hourly values (local start-of-hour time) with at least MIN_HOUR_COMPLETENESS % sub-hourly coverage.

    Only the part of [start, end] where the sensor actually reported is requested, one quarter per query -
    long server-side queries time out (HTTP 408) under load.
    """
    meta = client.get(f"/sensors/{sensor_id}")["results"][0]
    first = (meta.get("datetimeFirst") or {}).get("utc", "")[:10]
    last = (meta.get("datetimeLast") or {}).get("utc", "")[:10]
    lo, hi = max(start, first or start), min(end, last or end)
    if not first or lo > hi:
        return pd.DataFrame(columns=["date", "no2"])
    frames = []
    for q_start in pd.date_range(pd.Timestamp(lo).to_period("Q").start_time, hi, freq="QS"):
        a = max(lo, q_start.strftime("%Y-%m-%d"))
        b = min(hi, (q_start + pd.offsets.QuarterEnd(0)).strftime("%Y-%m-%d"))
        try:
            frames.append(_fetch_hours_range(client, sensor_id, a, b))
        except Exception as exc:  # a persistently failing quarter must not abort a multi-hour download
            log.warning("Sensor %s: skipping %s..%s after repeated failures (%s)", sensor_id, a, b, exc)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=["date", "no2"])


def _fetch_hours_range(client: OpenAQClient, sensor_id: int, start: str, end: str) -> pd.DataFrame:
    rows, page = [], 1
    while True:
        res = client.get(f"/sensors/{sensor_id}/hours", {"datetime_from": f"{start}T00:00:00Z",
                                                          "datetime_to": f"{end}T23:59:59Z",
                                                          "limit": PAGE, "page": page})["results"]
        for r in res:
            if r.get("value") is None:
                continue
            complete = (r.get("coverage") or {}).get("percentComplete", 100.0)
            if complete is not None and complete < MIN_HOUR_COMPLETENESS:
                continue
            rows.append((r["period"]["datetimeFrom"]["local"][:16].replace("T", " "), float(r["value"])))
        if len(res) < PAGE:
            break
        page += 1
    return pd.DataFrame(rows, columns=["date", "no2"])


def download(start: str, end: str, out_csv: str | Path, cache_dir: str | Path = "cache/openaq",
             country_code: str = "IN") -> pd.DataFrame:
    client = OpenAQClient()
    cache = Path(cache_dir)
    cache.mkdir(parents=True, exist_ok=True)
    sensors_path = cache / f"sensors_{country_code}.csv"
    if sensors_path.exists():
        sensors = pd.read_csv(sensors_path)
    else:
        sensors = list_no2_sensors(client, country_code)
        sensors.to_csv(sensors_path, index=False)
    log.info("%d NO2 sensors in %s", len(sensors), country_code)

    frames = []
    for i, s in enumerate(sensors.itertuples(), 1):
        path = cache / f"sensor_{s.sensor_id}_{start}_{end}.csv.gz"
        wider = _covering_cache(cache, int(s.sensor_id), start, end)
        if path.exists():
            hours = pd.read_csv(path)
        elif wider is not None:  # an earlier download spans this period: trim it instead of re-downloading
            hours = pd.read_csv(wider)
            hours = hours[(hours["date"] >= start) & (hours["date"] <= f"{end} 23:59")]
            hours.to_csv(path, index=False)
        else:
            hours = fetch_sensor_hours(client, int(s.sensor_id), start, end)
            hours.to_csv(path, index=False)
        log.info("[%d/%d] %-55s %6d hourly values", i, len(sensors), s.name, len(hours))
        if len(hours):
            frames.append(hours.assign(station_id=f"OPENAQ_{s.location_id}_{s.sensor_id}", name=s.name,
                                       lat=s.lat, lon=s.lon))
    out = pd.concat(frames, ignore_index=True)[["station_id", "name", "lat", "lon", "date", "no2"]]
    Path(out_csv).parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(out_csv, index=False)
    log.info("Wrote %d hourly rows for %d stations to %s", len(out), out.station_id.nunique(), out_csv)
    return out


def _covering_cache(cache: Path, sensor_id: int, start: str, end: str) -> Path | None:
    for p in cache.glob(f"sensor_{sensor_id}_*_*.csv.gz"):
        _, _, lo, hi = p.name[: -len(".csv.gz")].split("_")
        if lo <= start and hi >= end:
            return p
    return None


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Download hourly NO2 from OpenAQ into the pipeline's station CSV")
    p.add_argument("--start", default="2019-01-01")
    p.add_argument("--end", default="2022-12-31")
    p.add_argument("--country", default="IN")
    p.add_argument("-o", "--out", default="data/openaq_india_no2_hourly.csv")
    p.add_argument("--cache-dir", default="cache/openaq")
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s", datefmt="%H:%M:%S")
    download(args.start, args.end, args.out, args.cache_dir, args.country)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
