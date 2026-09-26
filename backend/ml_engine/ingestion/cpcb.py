"""Convert CPCB CCR "Advanced Search" NO2 reports (RealTimeReport_*.xlsx) into the station CSV.

Each report holds one station: a metadata block (State, City, Station, Parameter, AvgPeriod, From, To)
followed by a ``From Date | To Date | NO2`` table. Coordinates come from a separate lookup CSV with
``station_name,lat,lon`` because CPCB reports do not include them.

    uv run python -m ml_engine.ingestion.cpcb data/cpcb_raw data/cpcb_stations.csv -o data/cpcb_mumbai.csv
"""

from __future__ import annotations

import argparse
import logging
import re
import warnings
from pathlib import Path

import pandas as pd

log = logging.getLogger(__name__)


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(name).lower())


def _slug(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", str(name)).strip("_").upper()


def parse_report(path: str | Path, parameter: str = "NO2") -> tuple[dict, pd.DataFrame]:
    """Return (metadata, DataFrame[date, no2]) for one CPCB report."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)  # CPCB workbooks ship without a default style
        raw = pd.read_excel(path, header=None, dtype=object)
    labels = raw.iloc[:, 0].astype(str).str.strip()

    meta = {}
    for key in ("State", "City", "Station", "Parameter", "AvgPeriod", "From", "To"):
        hit = raw[labels == key]
        if len(hit):
            value = next((v for v in hit.iloc[0, 1:] if pd.notna(v) and str(v).strip()), None)
            meta[key.lower()] = str(value).strip() if value is not None else None
    if not meta.get("station"):
        raise ValueError(f"{path}: no 'Station' row - not a CPCB Advanced Search report")

    header_rows = raw.index[labels == "From Date"]
    if not len(header_rows):
        raise ValueError(f"{path}: no 'From Date' table header")
    header_idx = header_rows[0]
    header = [str(v).strip() for v in raw.iloc[header_idx]]
    value_cols = [i for i, h in enumerate(header) if h.upper() == parameter.upper()]
    if len(value_cols) != 1:
        raise ValueError(f"{path}: expected exactly one '{parameter}' column, found {len(value_cols)} "
                         "(download one station per report)")

    table = raw.iloc[header_idx + 1 :, [0, value_cols[0]]]
    table.columns = ["from", "value"]
    table = table[table["from"].notna()]
    dates = pd.to_datetime(table["from"].astype(str).str.strip(), format="%d-%m-%Y %H:%M", errors="coerce")
    values = pd.to_numeric(table["value"], errors="coerce")  # 'NA' / blanks -> NaN
    df = pd.DataFrame({"date": dates, "no2": values}).dropna()
    return meta, df


def convert(raw_dir: str | Path, coords_csv: str | Path, out_csv: str | Path, parameter: str = "NO2") -> pd.DataFrame:
    coords = pd.read_csv(coords_csv)
    lookup = {_norm(r.station_name): r for r in coords.itertuples()}
    frames, skipped = [], []
    for path in sorted(Path(raw_dir).rglob("*.xls*")):  # sub-folders per city / year are fine
        try:
            meta, df = parse_report(path, parameter)
        except ValueError as exc:
            log.warning("Skipping %s: %s", path.name, exc)
            skipped.append((path.name, str(exc)))
            continue
        station = meta["station"]
        match = lookup.get(_norm(station))
        if match is None:
            log.warning("Skipping %s: station %r is not in %s", path.name, station, coords_csv)
            skipped.append((path.name, f"no coordinates for {station!r}"))
            continue
        if meta.get("parameter", parameter).upper() != parameter.upper():
            log.warning("%s: report parameter is %s, expected %s", path.name, meta.get("parameter"), parameter)
        df = df.assign(station_id=_slug(station), name=station, lat=match.lat, lon=match.lon)
        frames.append(df)
        log.info("%-55s %4d rows  (%s, %s .. %s)", station, len(df), meta.get("avgperiod"), meta.get("from"), meta.get("to"))

    if not frames:
        raise RuntimeError(f"No usable reports in {raw_dir}")
    out = pd.concat(frames, ignore_index=True)[["station_id", "name", "lat", "lon", "date", "no2"]]
    # The same station downloaded twice (e.g. overlapping ranges) must not be double-counted.
    out = out.drop_duplicates(subset=["station_id", "date"]).sort_values(["station_id", "date"])
    out["date"] = out["date"].dt.strftime("%Y-%m-%d %H:%M")
    Path(out_csv).parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(out_csv, index=False)
    log.info("Wrote %d rows for %d stations to %s (%d files skipped)", len(out), out.station_id.nunique(), out_csv, len(skipped))
    return out


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Convert CPCB NO2 reports to the pipeline's station CSV")
    p.add_argument("raw_dir", help="folder with RealTimeReport_*.xlsx files")
    p.add_argument("coords_csv", help="CSV with station_name,lat,lon")
    p.add_argument("-o", "--out", default="data/cpcb_mumbai.csv")
    p.add_argument("--parameter", default="NO2")
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(message)s")
    convert(args.raw_dir, args.coords_csv, args.out, args.parameter)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
