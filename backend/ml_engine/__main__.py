"""Standalone runner:  uv run python -m ml_engine --source synthetic

Examples
  uv run python -m ml_engine --source synthetic
  uv run python -m ml_engine --source gee --ee-project my-gcp-project --stations data/cpcb_mumbai.csv \
      --start 2025-11-01 --end 2025-12-31 --bbox 72.77 18.88 73.12 19.32
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime
from pathlib import Path

from .config import DEFAULT_BBOX, PipelineConfig
from .pipeline import NO2Pipeline


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="ml_engine", description="NO2 gap-fill / downscale / dispersion pipeline")
    p.add_argument("--source", choices=["synthetic", "gee"], default="synthetic")
    p.add_argument("--bbox", nargs=4, type=float, metavar=("WEST", "SOUTH", "EAST", "NORTH"), default=DEFAULT_BBOX)
    p.add_argument("--start", default=None, help="YYYY-MM-DD (default: config)")
    p.add_argument("--end", default=None, help="YYYY-MM-DD inclusive (default: config)")
    p.add_argument("--stations", default=None, help="CSV with station_id,lat,lon,date,no2 (ug/m3)")
    p.add_argument("--roads", default=None, help="GeoJSON of road lines (e.g. OSM export) for road density")
    p.add_argument("--ee-project", default=None, help="Google Cloud project registered for Earth Engine")
    p.add_argument("--qa", type=float, default=0.75, help="qa_value threshold when the collection has one")
    p.add_argument("--horizons", nargs="+", type=float, default=[1, 3, 6], help="forecast horizons in hours")
    p.add_argument("--out", default=None, help="output directory (default outputs/<timestamp>)")
    p.add_argument("--model-dir", default="models/downscaler")
    p.add_argument("--seed", type=int, default=0, help="synthetic scene seed")
    p.add_argument("--no-export", action="store_true")
    p.add_argument("-v", "--verbose", action="store_true")
    return p.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s", datefmt="%H:%M:%S")
    cfg = PipelineConfig(bbox=tuple(args.bbox), qa_threshold=args.qa, model_dir=Path(args.model_dir))
    if args.start:
        cfg.start_date = args.start
    if args.end:
        cfg.end_date = args.end
    cfg.dispersion.horizons_h = tuple(args.horizons)
    cfg.output_dir = Path(args.out) if args.out else Path("outputs") / f"{args.source}_{datetime.now():%Y%m%d_%H%M%S}"
    cfg.output_dir.mkdir(parents=True, exist_ok=True)

    res = NO2Pipeline(cfg).run(source=args.source, stations_csv=args.stations, roads_geojson=args.roads,
                               ee_project=args.ee_project, seed=args.seed, export_outputs=not args.no_export)
    print_summary(res.report, cfg.output_dir)
    return 0


def _fmt(m: dict | None) -> str:
    if not m:
        return "n/a"
    return f"R2={m['r2']:.3f}  RMSE={m['rmse']:.2f}  MAE={m['mae']:.2f}  MBE={m['mbe']:+.2f}  (n={m['n']})"


def print_summary(r: dict, out_dir: Path) -> None:
    g = r["gapfill"]
    print("\n" + "=" * 78)
    print(" NO2 ENGINE RUN SUMMARY")
    print("=" * 78)
    print(f" Stage 1  gap-fill : {g['cloudy_fraction_in']:.1%} cloudy in -> {g['nan_fraction_out']:.1%} NaN out | "
          f"RF days {g['rf_days']}, fallback days {g['fallback_days']}")
    print(f"          hold-out : {_fmt(r['gapfill_holdout']['all'])}  [umol/m2]")
    d = r["downscaler"]
    print(f" Stage 2  downscale: temporal hold-out (coarse) {_fmt(d['temporal_holdout_coarse'])}  [umol/m2]")
    top = ", ".join(f"{k}={v:.2f}" for k, v in list(d["feature_importance"].items())[:5])
    print(f"          top features: {top}")
    if "synthetic_fine_truth" in r:
        s = r["synthetic_fine_truth"]
        print(f"          vs 250 m truth : downscaled {_fmt(s['column_downscaled_vs_truth'])}")
        print(f"                           bilinear   {_fmt(s['column_bilinear_vs_truth'])}")
    disp = r["dispersion"]
    print(f" Stage 3  dispersion: wind {disp['mean_speed_ms']:.1f} m/s heading {disp['plume_heading_deg']:.0f} deg; "
          f"domain mean by horizon {', '.join(f'+{k}h={v:.1f}' for k, v in disp['horizon_domain_mean_ugm3'].items())} ug/m3")
    if "validation_unseen_stations" in r:
        v = r["validation_unseen_stations"]
        print(f" Stage 4  unseen stations ({v['n_stations']}): {_fmt(v['overall'])}  [ug/m3]")
        print(f"          coarse baseline     : {_fmt(r['validation_baseline_coarse_no_downscaling'])}")
        if "validation_noise_ceiling_synthetic" in r:
            print(f"          truth ceiling       : {_fmt(r['validation_noise_ceiling_synthetic'])}")
        print(f"          acceptance (R2>={v['acceptance']['min_r2']}, RMSE<={v['acceptance']['max_rmse_ugm3']}): "
              f"{'PASS' if v['acceptance']['passed'] else 'FAIL'}")
    print(f" Stage 5  outputs  : {out_dir.resolve()}")
    print(f" Timings (s)       : {r['timings_s']}")
    print("=" * 78)


if __name__ == "__main__":
    sys.exit(main())
