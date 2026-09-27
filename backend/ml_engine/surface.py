"""Stage 4 - station-trained ground-level NO2 model with leave-stations-out validation.

The downscaled satellite column captures *when* NO2 is high (synoptic, day-to-day variability), but
station-to-station differences are dominated by local emissions (roads, activity density) that a
3.9 km sensor cannot see. Following land-use-regression practice, the surface model therefore combines:

* satellite: downscaled column and its boundary-layer-mixed concentration (column / BLH);
* meteorology: BLH, wind, temperature, pressure;
* land use at the station pixel and in ~0.5 km / ~1.6 km neighbourhoods: built-up, roads,
  night lights, population;
* calendar: day of week (traffic cycle). Day-of-year is deliberately excluded: over a few months each
  value identifies a single date, letting the model memorise citywide daily levels from other stations
  instead of predicting them from satellite and meteorology.

Candidate models are compared with space-time blocked cross-validation: every score is measured on
stations *and* dates the model never saw (see ``space_time_folds``). The best selectable candidate is
refitted on all stations and used for the map.
"""

from __future__ import annotations

import logging

import joblib
import numpy as np
import pandas as pd
import xarray as xr
import xgboost as xgb
from scipy import ndimage
from sklearn.linear_model import HuberRegressor

from .downscaling import column_to_surface
from .grid import GridSpec, upsample_bilinear
from .validation import summarize_predictions

log = logging.getLogger(__name__)

MET_VARS = ("blh", "u10", "v10", "t2m", "sp", "co", "ssrd", "tp", "sshf")  # "co" (S5P CO column) is used when ingested
FOCAL_VARS = ("built_up", "road_density", "night_lights", "ghsl_built", "population")
FOCAL_SIGMAS_PX = (2, 6)  # ~0.5 km and ~1.6 km neighbourhoods at 270 m pixels
SATELLITE_FEATURES = ("column", "pbl_conc", "pbl_conc_mean")
ANOMALY_SATELLITE = ("pbl_conc_anom",)
# Drivers of day-to-day change: satellite anomaly, meteorology and calendar (static land use cannot vary in time).
ANOMALY_FEATURES = ("pbl_conc_anom", "pbl_conc", "co", "blh", "u10", "v10", "wind_speed", "t2m", "sp",
                    "ssrd", "tp", "sshf", "day_of_week", "weekend")
BASELINE_ONLY = ("pbl_conc_coarse",)

XGB_PARAMS = dict(n_estimators=400, max_depth=3, learning_rate=0.03, subsample=0.8, colsample_bytree=0.7,
                  min_child_weight=10, reg_lambda=5.0, tree_method="hist", n_jobs=-1, random_state=42)


class SurfaceFeatureBuilder:
    def __init__(self, static_fine: xr.Dataset, coarse: xr.Dataset, no2_coarse_filled: xr.DataArray,
                 column_fine: xr.DataArray, factor: int, fill_flag: xr.DataArray | None = None):
        self.factor = factor
        # 1 where the coarse satellite value was gap-filled (cloud), matching the national model's flag.
        self.imputed = (fill_flag.values > 0).astype(np.float32) if fill_flag is not None else None
        self.coarse = coarse
        self.no2_coarse = no2_coarse_filled.values.astype(np.float64)
        self.column = column_fine
        self.times = pd.DatetimeIndex(column_fine["time"].values).normalize()
        self.static: dict[str, np.ndarray] = {v: static_fine[v].values.astype(np.float32) for v in static_fine.data_vars}
        for v in FOCAL_VARS:
            if v in self.static:
                for s in FOCAL_SIGMAS_PX:
                    self.static[f"{v}_s{s}"] = ndimage.gaussian_filter(self.static[v].astype(np.float64), s).astype(np.float32)
        blh_fine = upsample_bilinear(coarse["blh"].values.astype(np.float64), factor)
        pbl = column_to_surface(column_fine.values.astype(np.float64), blh_fine)
        self.static["pbl_conc_mean"] = pbl.mean(axis=0).astype(np.float32)  # period-mean satellite level per pixel
        self.names = [n for n in self.day_arrays(0) if n not in BASELINE_ONLY]

    def day_arrays(self, t: int) -> dict[str, np.ndarray]:
        f = self.factor
        met = {k: upsample_bilinear(self.coarse[k].values[t].astype(np.float64), f) for k in MET_VARS if k in self.coarse}
        col = self.column.values[t].astype(np.float64)
        shape = col.shape
        day = self.times[t]
        out = dict(self.static)
        out.update(met)
        out["wind_speed"] = np.hypot(met["u10"], met["v10"])
        out["column"] = col
        out["pbl_conc"] = column_to_surface(col, met["blh"])
        out["pbl_conc_anom"] = out["pbl_conc"] - self.static["pbl_conc_mean"]
        if self.imputed is not None:
            out["sat_imputed"] = np.repeat(np.repeat(self.imputed[t], f, axis=0), f, axis=1)
        out["pbl_conc_coarse"] = column_to_surface(upsample_bilinear(self.no2_coarse[t], f), met["blh"])
        out["day_of_week"] = np.full(shape, float(day.dayofweek))
        out["weekend"] = np.full(shape, float(day.dayofweek >= 5))
        return out

    def station_table(self, stations: pd.DataFrame, grid: GridSpec) -> pd.DataFrame:
        """One row per station-day with every feature sampled at the station's pixel."""
        df = stations.copy()
        df["date"] = pd.DatetimeIndex(df["date"]).normalize()
        rows, cols, inside = grid.index_of(df["lon"].values, df["lat"].values)
        t_idx = pd.Series(np.arange(len(self.times)), index=self.times).reindex(df["date"]).values
        keep = inside & np.isfinite(t_idx)
        df, rows, cols, t_idx = df[keep].copy(), rows[keep], cols[keep], t_idx[keep].astype(int)
        feats = {n: np.full(len(df), np.nan) for n in [*self.names, *BASELINE_ONLY]}
        for t in np.unique(t_idx):
            sel = t_idx == t
            arrays = self.day_arrays(int(t))
            for n in feats:
                feats[n][sel] = arrays[n][rows[sel], cols[sel]]
        return pd.concat([df.reset_index(drop=True), pd.DataFrame(feats)], axis=1)

    def predict_map(self, model: "SurfaceModel") -> xr.DataArray:
        days = []
        for t in range(len(self.times)):
            arrays = self.day_arrays(t)
            X = np.stack([arrays[n].ravel() for n in model.input_features], axis=1)
            days.append(np.clip(model.predict_matrix(X), 0, None).reshape(self.column.shape[1:]).astype(np.float32))
        return xr.DataArray(
            np.stack(days), coords=self.column.coords, dims=self.column.dims, name="no2_surface",
            attrs={"units": "ug m-3", "long_name": "Ground-level NO2 concentration", "surface_model": model.name},
        )


class SurfaceModel:
    """``linear`` / ``xgb`` regress station NO2 directly on ``features``.

    ``two_scale`` separates the two scales of variability, because station-to-station differences and
    day-to-day changes are driven by different things:
    * level: robust linear fit of station-mean NO2 on the pixel's period-mean satellite concentration
      (``LEVEL_FEATURE``) across stations - with no real spatial signal it collapses to the network mean
      instead of inventing spatial structure;
    * anomaly: XGBoost on each station's departure from its own mean, driven by the satellite anomaly,
      meteorology and calendar (``features``).
    """

    LEVEL_FEATURE = "pbl_conc_mean"

    def __init__(self, name: str, kind: str, features: list[str]):
        self.name, self.kind, self.features = name, kind, list(features)
        self.model = None
        self.level = None

    @property
    def input_features(self) -> list[str]:
        return [*self.features, self.LEVEL_FEATURE] if self.kind == "two_scale" else self.features

    def fit(self, df: pd.DataFrame, target: str = "no2") -> "SurfaceModel":
        X, y = df[self.features].to_numpy(np.float64), df[target].to_numpy(np.float64)
        if self.kind == "two_scale":
            station = df.groupby("station_id").agg(y=(target, "mean"), x=(self.LEVEL_FEATURE, "mean"))
            self.level = HuberRegressor(epsilon=1.35, alpha=1.0, max_iter=1000).fit(station[["x"]].values, station["y"].values)
            anomaly = y - df.groupby("station_id")[target].transform("mean").to_numpy(np.float64)
            self.model = xgb.XGBRegressor(**XGB_PARAMS).fit(X, anomaly)
            return self
        if self.kind == "linear":
            self.model = HuberRegressor(epsilon=1.5, max_iter=1000).fit(X, y)
        elif self.kind == "xgb":
            self.model = xgb.XGBRegressor(**XGB_PARAMS).fit(X, y)
        else:
            raise ValueError(f"unknown surface model kind {self.kind!r}")
        return self

    def predict(self, df: pd.DataFrame) -> np.ndarray:
        return self.predict_matrix(df[self.input_features].to_numpy(np.float64))

    def predict_matrix(self, X: np.ndarray) -> np.ndarray:
        """``X`` columns follow ``input_features``."""
        if self.kind == "two_scale":
            return self.level.predict(X[:, -1:]) + self.model.predict(X[:, :-1])
        return self.model.predict(X)

    def importance(self) -> dict[str, float]:
        if self.kind in ("xgb", "two_scale"):
            imp = self.model.feature_importances_
        else:
            imp = np.abs(self.model.coef_)
        return dict(sorted(zip(self.features, map(float, imp)), key=lambda kv: -kv[1]))

    def save(self, path) -> None:
        joblib.dump(self, path)

    @staticmethod
    def load(path) -> "SurfaceModel":
        return joblib.load(path)


def candidate_models(feature_names: list[str]) -> dict[str, tuple[SurfaceModel, bool]]:
    """name -> (model, selectable). Non-selectable candidates are diagnostics / baselines."""
    no_sat = [n for n in feature_names if n not in SATELLITE_FEATURES and n not in ANOMALY_SATELLITE]
    dynamic = [n for n in feature_names if n in ANOMALY_FEATURES]
    return {
        "linear_coarse_no_downscaling": (SurfaceModel("linear_coarse_no_downscaling", "linear", ["pbl_conc_coarse"]), False),
        "linear_satellite": (SurfaceModel("linear_satellite", "linear", ["pbl_conc"]), True),
        "xgb_landuse_met_no_satellite": (SurfaceModel("xgb_landuse_met_no_satellite", "xgb", no_sat), False),
        "xgb_full": (SurfaceModel("xgb_full", "xgb", feature_names), True),
        "two_scale": (SurfaceModel("two_scale", "two_scale", dynamic), True),
    }


def space_time_folds(table: pd.DataFrame, n_blocks: int = 5) -> tuple[list[tuple[np.ndarray, np.ndarray]], str]:
    """Space-time blocked CV: every fold tests one station group x one contiguous date block and trains
    only on the *other* stations on the *other* dates.

    Plain leave-stations-out CV leaks: other stations' readings on the same dates stay in training, and
    date-specific inputs (citywide meteorology) let a model memorise each day's citywide level. Blocking
    both space and time reproduces the real use of the map - an unmonitored place on an unseen day.
    """
    stations = np.array(sorted(table["station_id"].unique()))
    n_s = max(2, min(n_blocks, len(stations)))
    station_group = {sid: i % n_s for i, sid in enumerate(np.random.default_rng(0).permutation(stations))}
    dates = np.sort(table["date"].unique())
    n_t = max(2, min(n_blocks, len(dates)))
    date_block = {d: i for i, chunk in enumerate(np.array_split(dates, n_t)) for d in chunk}
    sg = table["station_id"].map(station_group).to_numpy()
    tb = table["date"].map(date_block).to_numpy()
    folds = []
    for i in range(n_s):
        for j in range(n_t):
            te = np.flatnonzero((sg == i) & (tb == j))
            tr = np.flatnonzero((sg != i) & (tb != j))
            if len(te) and len(tr):
                folds.append((tr, te))
    return folds, f"space-time blocked CV: {n_s} station groups x {n_t} date blocks over {len(stations)} stations"


def evaluate_future_days(table: pd.DataFrame, proto: SurfaceModel, test_fraction: float = 0.2) -> dict:
    """Skill on *future days at monitored stations* - the operational forecasting use case.

    The last ``test_fraction`` of dates is held out. The model is trained on earlier days of every
    station, and each station's mean training residual is applied as a bias correction (standard for
    monitored sites, and it absorbs inter-network calibration offsets). Compared against the naive
    baseline of predicting each station's own training-period mean.
    """
    dates = np.sort(table["date"].unique())
    cutoff = dates[int(np.floor(len(dates) * (1 - test_fraction)))]
    train, test = table[table["date"] < cutoff], table[table["date"] >= cutoff].copy()
    test = test[test["station_id"].isin(train["station_id"].unique())]
    model = SurfaceModel(proto.name, proto.kind, proto.features).fit(train)
    offset = (train["no2"] - model.predict(train)).groupby(train["station_id"]).mean()
    test["pred"] = model.predict(test) + test["station_id"].map(offset).to_numpy()
    test["baseline"] = test["station_id"].map(train.groupby("station_id")["no2"].mean()).to_numpy()
    model_summary = summarize_predictions(test, pred_col="pred")
    return {
        "setup": (f"train on dates < {pd.Timestamp(cutoff).date()} ({len(dates) - len(test['date'].unique())} days), "
                  f"test on the last {test['date'].nunique()} days at the same {test['station_id'].nunique()} stations, "
                  "with per-station bias correction from the training period"),
        "model": model_summary,
        "baseline_station_training_mean": summarize_predictions(test, pred_col="baseline"),
    }


def select_surface_model(table: pd.DataFrame, feature_names: list[str], n_folds: int = 5,
                         future_fraction: float = 0.2) -> tuple[SurfaceModel, dict, pd.DataFrame]:
    """Leave-stations-out CV of every candidate; returns (best model refitted on all data, report, OOF table)."""
    folds, cv_desc = space_time_folds(table, n_folds)
    oof = table[["station_id", "name", "lat", "lon", "date", "no2"]].copy() if "name" in table else \
        table[["station_id", "lat", "lon", "date", "no2"]].copy()
    report: dict = {"cv": cv_desc, "candidates": {}}
    candidates = candidate_models(feature_names)
    for name, (proto, selectable) in candidates.items():
        pred = np.full(len(table), np.nan)
        for tr, te in folds:
            m = SurfaceModel(proto.name, proto.kind, proto.features).fit(table.iloc[tr])
            pred[te] = m.predict(table.iloc[te])
        oof[name] = pred
        summary = summarize_predictions(oof.assign(pred=pred), pred_col="pred")
        summary["selectable"] = selectable
        report["candidates"][name] = summary
        log.info("Surface candidate %-30s unseen-station R2=%.3f RMSE=%.2f (spatial R2=%.3f, temporal R2=%.3f)",
                 name, summary["overall"]["r2"], summary["overall"]["rmse"],
                 summary["station_mean_spatial"]["r2"], summary["temporal_anomaly"]["r2"])
    best = min((n for n, (_, sel) in candidates.items() if sel),
               key=lambda n: report["candidates"][n]["overall"]["rmse"])
    proto = candidates[best][0]
    model = SurfaceModel(proto.name, proto.kind, proto.features).fit(table)
    report["selected"] = best
    report["feature_importance"] = model.importance()
    report["future_days_monitored_stations"] = evaluate_future_days(table, proto, future_fraction)
    return model, report, oof
