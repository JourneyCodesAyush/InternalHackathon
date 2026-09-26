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
    p.add_argument("--s5p-product", choices=["OFFL", "NRTI"], default="OFFL",
                   help="OFFL = reprocessed (training); NRTI = near real time, for today's maps")
    p.add_argument("--station-hours", default="12-16",
                   help="local hours averaged from hourly station data, e.g. 12-16 (S5P overpass); 'all' = full day")
    p.add_argument("--surface-model", default=None,
                   help="pre-trained surface model (e.g. models/national/surface_model.joblib); --stations then "
                        "serve as an independent test instead of training data")
    p.add_argument("--osm-roads", action="store_true",
                   help="use OpenStreetMap roads instead of GRIP4 for road density (slow; not comparable with "
                        "a nationally trained surface model)")
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
    cfg.fetch_osm_roads = args.osm_roads
    cfg.surface_model_path = Path(args.surface_model) if args.surface_model else None
    cfg.s5p_product = args.s5p_product
    if args.station_hours == "all":
        cfg.station_hours = None
    else:
        h0, h1 = (int(v) for v in args.station_hours.split("-"))
        cfg.station_hours = (h0, h1)
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
    if "pretrained_surface_model" in r:
        pm = r["pretrained_surface_model"]
        print(f" Stage 4  pre-trained surface model {pm['model']} from {pm['source']}")
        if "independent_test" in pm:
            t = pm["independent_test"]
            print(f"          INDEPENDENT TEST ({t['n_stations']} stations; this period was not used in training - station locations may overlap):")
            print(f"            {_fmt(t['overall'])}")
            print(f"            spatial R2={t['station_mean_spatial']['r2']:.2f}  temporal R2={t['temporal_anomaly']['r2']:.2f}"
                  f"  median within-station r={t['median_within_station_r']:.2f}")
            acc = t["acceptance"]
            print(f"            acceptance (R2>={acc['min_r2']}, RMSE<={acc['max_rmse_ugm3']}): {'PASS' if acc['passed'] else 'FAIL'}")
    if "surface_model" in r:
        sm = r["surface_model"]
        print(f" Stage 4  surface model, {sm['cv']} - scored on stations AND dates unseen in training:")
        for name, c in sm["candidates"].items():
            mark = "*" if name == sm["selected"] else " "
            print(f"        {mark} {name:30s} {_fmt(c['overall'])}")
            print(f"          {'':30s} spatial R2={c['station_mean_spatial']['r2']:.2f}  temporal R2={c['temporal_anomaly']['r2']:.2f}"
                  f"  median within-station r={c['median_within_station_r']:.2f}")
        best = sm["candidates"][sm["selected"]]
        acc = best["acceptance"]
        print(f"          acceptance on UNSEEN STATIONS (R2>={acc['min_r2']}, RMSE<={acc['max_rmse_ugm3']}): "
              f"{'PASS' if acc['passed'] else 'FAIL'}")
        fut = sm["future_days_monitored_stations"]
        print(f"          future days at monitored stations: {fut['setup']}")
        print(f"            model    {_fmt(fut['model']['overall'])}  temporal R2={fut['model']['temporal_anomaly']['r2']:.2f}")
        print(f"            baseline {_fmt(fut['baseline_station_training_mean']['overall'])}  (station's own training mean)")
        facc = fut["model"]["acceptance"]
        print(f"            acceptance on FUTURE DAYS: {'PASS' if facc['passed'] else 'FAIL'}")
        top = ", ".join(f"{k}={v:.2f}" for k, v in list(sm["feature_importance"].items())[:6])
        print(f"          top features: {top}")
        if "validation_noise_ceiling_synthetic" in r:
            print(f"          truth ceiling (synthetic): {_fmt(r['validation_noise_ceiling_synthetic'])}")
    print(f" Stage 5  outputs  : {out_dir.resolve()}")
    print(f" Timings (s)       : {r['timings_s']}")
    print("=" * 78)


if __name__ == "__main__":
    sys.exit(main())
