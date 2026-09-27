"""National station-mode training of the ground-level NO2 surface model.

Instead of building 250 m maps for a whole country, every input is extracted *at the monitoring
stations* - the standard setup of national land-use-regression / satellite NO2 studies:

* static land use: a 41 x 41 pixel (~10 km) patch at the map's 250 m grid around each station, passed
  through exactly the same smoothing as the map (``SurfaceFeatureBuilder``), so a feature means the same
  thing in training and on the map;
* daily inputs: S5P NO2 (cloud-screened) and CO, ERA5-Land overpass-hour meteorology and GEOS-CF
  boundary-layer height, sampled for all stations at once with Earth Engine ``reduceRegions``.

The trained model is validated three ways - unseen stations and dates (space-time blocked CV), unseen
cities (leave-one-city-out) and unseen years (leave-one-year-out) - and saved for the map pipeline
(``--surface-model``).

    uv run python -m ml_engine.national --stations data/openaq_india_no2_hourly.csv --start 2019-01-01 --end 2022-12-31
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import logging
import time
from datetime import timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import ndimage

from .cities import city_of
from .config import COLUMN_SCALE
from .downscaling import column_to_surface
from .grid import GridSpec, fill_nan_nearest
from .ingestion import gee, load_stations_csv, quality_control
from .surface import FOCAL_SIGMAS_PX, FOCAL_VARS, SurfaceModel, candidate_models, space_time_folds
from .validation import acceptance, summarize_predictions

log = logging.getLogger(__name__)

FINE_RES = 0.0025
PATCH_HALF = 20  # 41 x 41 pixels: room for the widest (sigma 6 px) smoothing kernel
STATIC_BANDS = ("elevation", "night_lights", "ghsl_built", "population")
DAYS_PER_BATCH = 10
# India's strict COVID-19 lockdown: traffic and industry collapsed, so NO2 then does not reflect normal
# emission patterns the model is meant to learn.
EXCLUDED_PERIODS = (("2020-03-22", "2020-05-31"),)
SAMPLE_RADIUS_M = 3500  # ~ one TROPOMI footprint around the station
OPTIONAL_FEATURES = ("co",)
NEIGHBOUR_KM = 100.0
NATIONAL_FEATURES = (
    "column", "pbl_conc", "pbl_conc_anom", "co", "blh", "u10", "v10", "wind_speed", "t2m", "sp", "ssrd", "tp", "sshf",
    "day_of_week", "weekend", "elevation", "power_plants", "sat_imputed",
    *(f"{v}_s{s}" for v in ("night_lights", "ghsl_built", "population", "road_density") for s in FOCAL_SIGMAS_PX),
    "night_lights", "ghsl_built", "population", "road_density",
)


# ---------------------------------------------------------------------------------------------------- static
def _patch_grid(lat: float, lon: float) -> GridSpec:
    return GridSpec(west=lon - (PATCH_HALF + 0.5) * FINE_RES, north=lat + (PATCH_HALF + 0.5) * FINE_RES,
                    res=FINE_RES, width=2 * PATCH_HALF + 1, height=2 * PATCH_HALF + 1)


def _power_plants_field(grid: GridSpec, plants: list[dict]) -> np.ndarray:
    lon, lat = grid.lonlat_mesh()
    kx = 111.32 * np.cos(np.radians((grid.north + grid.south) / 2))
    field = np.zeros(grid.shape)
    for p in plants:
        d2 = ((lon - p["longitude"]) * kx) ** 2 + ((lat - p["latitude"]) * 110.57) ** 2
        field += float(p.get("capacitymw") or 0.0) * np.exp(-d2 / (2 * gee.POWER_PLANT_SIGMA_KM**2))
    return np.log1p(field)


def static_features(stations: pd.DataFrame, end_date: str, cache_dir: Path, workers: int = 4) -> pd.DataFrame:
    """Per-station static land-use features computed on a local 250 m patch, like the map does."""
    ee = gee._ee()
    out_path = cache_dir / "static_features.csv"
    done = pd.read_csv(out_path) if out_path.exists() else pd.DataFrame(columns=["station_id"])
    todo = stations[~stations["station_id"].isin(done["station_id"])]
    if todo.empty:
        return done

    bbox = [stations.lon.min() - 1, stations.lat.min() - 1, stations.lon.max() + 1, stations.lat.max() + 1]
    fc = ee.FeatureCollection(gee.GPPD_COLLECTION).filterBounds(ee.Geometry.Rectangle(bbox)).filter(
        ee.Filter.inList("fuel1", list(gee.COMBUSTION_FUELS)))
    plants = [f["properties"] for f in fc.getInfo()["features"]]
    end = pd.Timestamp(end_date)
    dem = ee.Image(gee.DEM_IMAGE).select("elevation")

    def one(row):
        grid = _patch_grid(row.lat, row.lon)
        image = ee.Image.cat(gee._to_grid_mean(dem.rename("elevation"), grid), gee._activity_image(grid, end),
                             gee.road_density_image(grid))
        arr = gee._compute_pixels(image, grid, [*STATIC_BANDS, "road_density"])
        layers = {n: np.nan_to_num(fill_nan_nearest(arr[i]), nan=0.0) for i, n in enumerate([*STATIC_BANDS, "road_density"])}
        layers["power_plants"] = _power_plants_field(grid, plants)
        feats = {"station_id": row.station_id}
        c = PATCH_HALF
        for name, a in layers.items():
            feats[name] = float(a[c, c])
            if name in FOCAL_VARS:
                for s in FOCAL_SIGMAS_PX:
                    feats[f"{name}_s{s}"] = float(ndimage.gaussian_filter(a.astype(np.float64), s)[c, c])
        return feats

    rows = []
    with cf.ThreadPoolExecutor(max_workers=workers) as pool:
        for i, feats in enumerate(pool.map(one, todo.itertuples()), 1):
            rows.append(feats)
            if i % 25 == 0 or i == len(todo):
                log.info("Static features: %d/%d stations", i, len(todo))
                pd.concat([done, pd.DataFrame(rows)], ignore_index=True).to_csv(out_path, index=False)
    return pd.read_csv(out_path)


# ---------------------------------------------------------------------------------------------------- daily
def _daily_image(day: pd.Timestamp, utc_hour: float):
    ee = gee._ee()
    d0, d1 = day.strftime("%Y-%m-%d"), (day + timedelta(days=1)).strftime("%Y-%m-%d")
    no2_col = ee.ImageCollection(gee.S5P_COLLECTION.format(product="OFFL")).filterDate(d0, d1)
    no2 = no2_col.map(lambda img: img.select(gee.S5P_BAND).updateMask(img.select("cloud_fraction").lt(0.3)))
    no2 = ee.Image(ee.Algorithms.If(no2_col.size().gt(0), no2.mean(), gee._empty(gee.S5P_BAND))).rename("no2")
    no2_valid = no2.mask().rename("no2_valid").unmask(0)

    co_col = ee.ImageCollection(gee.S5P_CO_COLLECTION).filterDate(d0, d1).select(gee.S5P_CO_BAND)
    co = ee.Image(ee.Algorithms.If(co_col.size().gt(0), co_col.mean(), gee._empty(gee.S5P_CO_BAND))).rename("co")

    centre = day + timedelta(hours=utc_hour)
    w0 = (centre - timedelta(hours=gee.OVERPASS_WINDOW_H)).isoformat()
    w1 = (centre + timedelta(hours=gee.OVERPASS_WINDOW_H)).isoformat()
    met_keys = [*gee.ERA5_BANDS, *gee.ERA5_FLUX_BANDS]
    hourly_bands = [*gee.ERA5_BANDS.values(), *(h[0] for h, _ in gee.ERA5_FLUX_BANDS.values())]
    scale = ee.Image.constant([1.0] * len(gee.ERA5_BANDS) + [h[1] for h, _ in gee.ERA5_FLUX_BANDS.values()])
    era_col = ee.ImageCollection(gee.ERA5_HOURLY_COLLECTION).filterDate(w0, w1).select(hourly_bands)
    era = ee.Image(ee.Algorithms.If(era_col.size().gt(0), era_col.mean().multiply(scale).rename(met_keys),
                                    ee.Image.cat(*[gee._empty(k) for k in met_keys])))
    era = era.unmask(era.focalMean(radius=25_000, kernelType="circle", units="meters"))  # coastal cells are sea-masked

    b0 = (centre - timedelta(hours=2)).isoformat()
    b1 = (centre + timedelta(hours=2)).isoformat()
    blh_col = ee.ImageCollection(gee.GEOSCF_COLLECTION).filterDate(b0, b1).select(gee.GEOSCF_BLH_BAND)
    blh = ee.Image(ee.Algorithms.If(blh_col.size().gt(0), blh_col.mean(), gee._empty("blh"))).rename("blh")
    return ee.Image.cat(no2, no2_valid, co, era, blh).set("day", d0)


def daily_features(stations: pd.DataFrame, start: str, end: str, cache_dir: Path, workers: int = 2) -> pd.DataFrame:
    ee = gee._ee()
    pts = ee.FeatureCollection([
        ee.Feature(ee.Geometry.Point([r.lon, r.lat]).buffer(SAMPLE_RADIUS_M), {"station_id": r.station_id})
        for r in stations.itertuples()
    ])
    utc_hour = gee.overpass_utc_hour(float(stations.lon.mean()))
    dates = pd.date_range(start, end, freq="D")
    batches = [dates[i:i + DAYS_PER_BATCH] for i in range(0, len(dates), DAYS_PER_BATCH)]
    (cache_dir / "daily").mkdir(parents=True, exist_ok=True)

    def one(batch):
        path = cache_dir / "daily" / f"{batch[0].date()}_{batch[-1].date()}.csv"
        if path.exists():
            return pd.read_csv(path)
        col = ee.ImageCollection([_daily_image(d, utc_hour) for d in batch])
        sampled = col.map(lambda img: img.reduceRegions(collection=pts, reducer=ee.Reducer.mean(), scale=1113.2,
                                                        tileScale=4).map(lambda f: f.set("day", img.get("day")))
                          ).flatten()
        for attempt in range(8):  # the Community tier caps concurrent aggregations; back off and retry
            try:
                df = ee.data.computeFeatures({"expression": sampled, "fileFormat": "PANDAS_DATAFRAME"})
                break
            except ee.EEException as exc:
                if attempt == 7 or not any(m in str(exc).lower() for m in ("concurrent", "rate", "quota", "timed out")):
                    raise
                wait = 15 * (attempt + 1)
                log.warning("Earth Engine busy (%s); retrying batch %s in %ss", exc, batch[0].date(), wait)
                time.sleep(wait)
        df = df.drop(columns=[c for c in ("geo",) if c in df.columns])
        df.to_csv(path, index=False)
        return df

    frames = []
    with cf.ThreadPoolExecutor(max_workers=workers) as pool:
        for i, df in enumerate(pool.map(one, batches), 1):
            frames.append(df)
            if i % 10 == 0 or i == len(batches):
                log.info("Daily features: %d/%d batches", i, len(batches))
    out = pd.concat(frames, ignore_index=True)
    out["date"] = pd.to_datetime(out.pop("day"))
    out["column"] = out.pop("no2") * COLUMN_SCALE
    out["co"] = out["co"] * gee.CO_SCALE
    return out


# ---------------------------------------------------------------------------------------------------- training
def fill_station_columns(daily: pd.DataFrame, sites: pd.DataFrame, holdout: float = 0.1,
                         seed: int = 42) -> tuple[pd.DataFrame, dict]:
    """Gap-fill the cloud-masked satellite column at stations (Stage-1 logic applied to station series).

    A Random Forest trained on clear-sky station-days predicts cloudy ones from the station's own previous
    1-2 days, same-day clear values at stations within ``NEIGHBOUR_KM``, the national same-day median, the
    station's clear-sky climatology, meteorology and season. Scored on a random hold-out of clear values.
    """
    from sklearn.ensemble import RandomForestRegressor

    from .validation import regression_metrics

    d = daily.sort_values(["station_id", "date"]).copy()
    observed = (d["no2_valid"] >= 0.5) & d["column"].notna()
    d["obs_col"] = d["column"].where(observed)

    # Same-day mean of clear values at neighbouring stations (excluding the station itself).
    ids = sites["station_id"].to_numpy()
    lat, lon = sites["lat"].to_numpy(), sites["lon"].to_numpy()
    km = np.hypot((lat[:, None] - lat[None]) * 110.57,
                  (lon[:, None] - lon[None]) * 111.32 * np.cos(np.radians(lat[:, None])))
    w = ((km < NEIGHBOUR_KM) & (km > 0)).astype(float)
    obs_wide = d.pivot_table(index="date", columns="station_id", values="obs_col").reindex(columns=ids)
    vals = obs_wide.to_numpy()
    have = np.isfinite(vals).astype(float)
    with np.errstate(invalid="ignore", divide="ignore"):
        neigh = (np.nan_to_num(vals) @ w.T) / (have @ w.T)
    neigh_long = pd.DataFrame(neigh, index=obs_wide.index, columns=ids).stack(future_stack=True).rename("neigh_col")
    d = d.merge(neigh_long.reset_index().rename(columns={"level_1": "station_id"}), on=["date", "station_id"], how="left")
    d["nat_col"] = d.groupby("date")["obs_col"].transform("median")
    d["clim_col"] = d.groupby("station_id")["obs_col"].transform("mean")
    d = d.merge(sites[["station_id", "lat", "lon"]], on="station_id", how="left")
    g = d.groupby("station_id")["obs_col"]
    d["lag1"], d["lag2"] = g.shift(1), g.shift(2)
    ang = 2 * np.pi * d["date"].dt.dayofyear / 365.25
    d["doy_sin"], d["doy_cos"] = np.sin(ang), np.cos(ang)
    feats = ["lag1", "lag2", "neigh_col", "nat_col", "clim_col", "blh", "u10", "v10", "t2m", "sp", "ssrd", "tp",
             "lat", "lon", "doy_sin", "doy_cos"]

    rng = np.random.default_rng(seed)
    obs_rows = np.flatnonzero(d["obs_col"].notna().to_numpy())
    hold = rng.choice(obs_rows, size=int(len(obs_rows) * holdout), replace=False)
    train = np.setdiff1d(obs_rows, hold)
    X = d[feats].to_numpy(np.float64)
    y = d["obs_col"].to_numpy(np.float64)
    rf = RandomForestRegressor(n_estimators=200, min_samples_leaf=3, n_jobs=-1, random_state=seed)
    rf.fit(X[train], y[train])
    holdout_metrics = regression_metrics(y[hold], rf.predict(X[hold]))
    rf.fit(X[obs_rows], y[obs_rows])
    missing = d["obs_col"].isna().to_numpy()
    filled = y.copy()
    if missing.any():
        filled[missing] = rf.predict(X[missing])
    d["column"] = filled
    d["sat_imputed"] = missing.astype(float)
    report = {"clear_station_days": int(len(obs_rows)), "imputed_station_days": int(missing.sum()),
              "holdout_clear_values": holdout_metrics,
              "importance": dict(sorted(zip(feats, map(float, rf.feature_importances_)), key=lambda kv: -kv[1]))}
    log.info("Station gap-fill: %d clear + %d imputed station-days; hold-out R2=%.3f RMSE=%.1f umol/m2",
             len(obs_rows), int(missing.sum()), holdout_metrics["r2"], holdout_metrics["rmse"])
    return d.drop(columns=["obs_col", "neigh_col", "nat_col", "clim_col", "lag1", "lag2", "doy_sin", "doy_cos",
                           "lat", "lon"]), report


def build_table(stations_csv: str, start: str, end: str, cache_dir: Path, station_hours=(12, 16),
                exclude_periods=EXCLUDED_PERIODS, fill_clouds: bool = True) -> tuple[pd.DataFrame, dict]:
    obs = load_stations_csv(stations_csv, station_hours)
    obs = obs[(obs["date"] >= start) & (obs["date"] <= end)]
    for lo, hi in exclude_periods:
        obs = obs[(obs["date"] < lo) | (obs["date"] > hi)]
    obs, qc = quality_control(obs)
    sites = obs.groupby("station_id").agg(lat=("lat", "first"), lon=("lon", "first"), name=("name", "first")).reset_index()
    log.info("Training stations after QC: %d (%d station-days)", len(sites), len(obs))
    static = static_features(sites, end, cache_dir)
    daily = daily_features(sites, start, end, cache_dir)
    fill_report = None
    if fill_clouds:
        daily, fill_report = fill_station_columns(daily, sites)
    else:
        daily = daily[(daily["no2_valid"] >= 0.5) & daily["column"].notna()].assign(sat_imputed=0.0)
    table = obs.merge(daily, on=["station_id", "date"]).merge(static, on="station_id")
    table = table[table["column"].notna() & table["blh"].notna()].copy()
    table["pbl_conc"] = column_to_surface(table["column"].to_numpy(), table["blh"].to_numpy())
    table["pbl_conc_mean"] = table.groupby("station_id")["pbl_conc"].transform("mean")
    table["pbl_conc_anom"] = table["pbl_conc"] - table["pbl_conc_mean"]
    table["wind_speed"] = np.hypot(table["u10"], table["v10"])
    table["day_of_week"] = table["date"].dt.dayofweek.astype(float)
    table["weekend"] = (table["date"].dt.dayofweek >= 5).astype(float)
    table["city"] = table["name"].map(city_of)
    # CO is often missing (its own cloud/QA gaps); XGBoost handles missing inputs natively, so keep those days.
    table = table.dropna(subset=[f for f in NATIONAL_FEATURES if f in table and f not in OPTIONAL_FEATURES])
    log.info("Training table: %d station-days (%d with imputed satellite), %d stations, %d cities",
             len(table), int(table["sat_imputed"].sum()), table.station_id.nunique(), table.city.nunique())
    qc = dict(qc, satellite_gapfill=fill_report)
    return table, qc


def _cv(table, proto, folds):
    pred = np.full(len(table), np.nan)
    for tr, te in folds:
        m = SurfaceModel(proto.name, proto.kind, proto.features).fit(table.iloc[tr])
        pred[te] = m.predict(table.iloc[te])
    return pred


def _group_folds(labels: np.ndarray):
    return [(np.flatnonzero(labels != g), np.flatnonzero(labels == g)) for g in np.unique(labels)]


def train_national(table: pd.DataFrame, n_blocks: int = 5) -> tuple[SurfaceModel, dict]:
    features = [f for f in NATIONAL_FEATURES if f in table]
    candidates = candidate_models(features)
    candidates.pop("linear_coarse_no_downscaling", None)  # no fine/coarse distinction at stations
    st_folds, cv_desc = space_time_folds(table, n_blocks)
    evaluations = {
        "unseen_stations_and_dates": (st_folds, cv_desc),
        "unseen_cities": (_group_folds(table["city"].to_numpy()), f"leave-one-city-out over {table.city.nunique()} cities"),
        "unseen_years": (_group_folds(table["date"].dt.year.to_numpy()), "leave-one-year-out"),
    }
    base = table[["station_id", "lat", "lon", "date", "no2"]].copy()
    report: dict = {"n_rows": int(len(table)), "n_stations": int(table.station_id.nunique()),
                    "n_cities": int(table.city.nunique()), "features": features, "evaluations": {}}
    for eval_name, (folds, desc) in list(evaluations.items()):
        if len(folds) < 2 or any(len(tr) == 0 for tr, _ in folds):
            log.warning("Skipping %s: needs at least two groups (%s)", eval_name, desc)
            evaluations.pop(eval_name)
            continue
        report["evaluations"][eval_name] = {"design": desc, "candidates": {}}
        for name, (proto, selectable) in candidates.items():
            s = summarize_predictions(base.assign(pred=_cv(table, proto, folds)), pred_col="pred")
            s.pop("per_station")
            s["selectable"] = selectable
            report["evaluations"][eval_name]["candidates"][name] = s
            log.info("%-26s %-30s R2=%.3f RMSE=%.2f spatial R2=%.2f temporal R2=%.2f", eval_name, name,
                     s["overall"]["r2"], s["overall"]["rmse"], s["station_mean_spatial"]["r2"], s["temporal_anomaly"]["r2"])
    primary = report["evaluations"]["unseen_stations_and_dates"]["candidates"]
    best = min((n for n, (_, sel) in candidates.items() if sel), key=lambda n: primary[n]["overall"]["rmse"])
    proto = candidates[best][0]
    model = SurfaceModel(proto.name, proto.kind, proto.features).fit(table)
    report["selected"] = best
    report["feature_importance"] = model.importance()
    return model, report


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Train the ground-level NO2 surface model on national station data")
    p.add_argument("--stations", required=True, help="station CSV (e.g. from ml_engine.ingestion.openaq)")
    p.add_argument("--start", default="2019-01-01")
    p.add_argument("--end", default="2022-12-31")
    p.add_argument("--ee-project", default="internal-hackathon-509815")
    p.add_argument("--cache-dir", default="cache/national")
    p.add_argument("--model-out", default="models/national/surface_model.joblib")
    p.add_argument("--report-out", default="models/national/report.json")
    p.add_argument("--clear-sky-only", action="store_true", help="skip satellite gap-filling at stations")
    p.add_argument("--station-hours", default="12-16",
                   help="local hours averaged from hourly station data, e.g. 12-16 (overpass) or 'all' (24 h mean)")
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s", datefmt="%H:%M:%S")
    gee.initialize(project=args.ee_project)
    cache = Path(args.cache_dir)
    cache.mkdir(parents=True, exist_ok=True)
    hours = None if args.station_hours == "all" else tuple(int(v) for v in args.station_hours.split("-"))
    table, qc = build_table(args.stations, args.start, args.end, cache, station_hours=hours,
                            fill_clouds=not args.clear_sky_only)
    table.to_csv(cache / "training_table.csv.gz", index=False)
    model, report = train_national(table)
    report["station_qc"] = qc
    for ev in report["evaluations"].values():
        best = ev["candidates"][report["selected"]]
        best["acceptance"] = acceptance(best["overall"], 0.6, 15.0)
    Path(args.model_out).parent.mkdir(parents=True, exist_ok=True)
    model.save(args.model_out)
    from .export import write_json

    write_json(report, args.report_out)
    print(f"\nSelected model: {report['selected']}  ({report['n_rows']} station-days, {report['n_stations']} stations, "
          f"{report['n_cities']} cities)")
    for ev_name, ev in report["evaluations"].items():
        m = ev["candidates"][report["selected"]]
        print(f"  {ev_name:26s} R2={m['overall']['r2']:.3f} RMSE={m['overall']['rmse']:.2f} "
              f"spatial R2={m['station_mean_spatial']['r2']:.2f} temporal R2={m['temporal_anomaly']['r2']:.2f}  [{ev['design']}]")
    print(f"Model saved to {args.model_out}; full report in {args.report_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
