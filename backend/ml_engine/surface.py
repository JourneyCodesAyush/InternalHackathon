"""Stage 4 - station-trained ground-level NO2 model with leave-stations-out validation.

The downscaled satellite column captures *when* NO2 is high (synoptic, day-to-day variability), but
station-to-station differences are dominated by local emissions (roads, activity density) that a
3.9 km sensor cannot see. Following land-use-regression practice, the surface model therefore combines:

* satellite: downscaled column and its boundary-layer-mixed concentration (column / BLH);
* meteorology: BLH, wind, temperature, pressure;
* land use at the station pixel and in ~0.5 km / ~1.6 km neighbourhoods: built-up, roads,
  night lights, population;
* calendar: season and day of week (traffic cycle).

Candidate models are compared with grouped K-fold cross-validation where every fold holds out whole
stations, so each score is measured on stations the model never saw. The best selectable candidate is
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
from sklearn.model_selection import GroupKFold

from .downscaling import column_to_surface
from .grid import GridSpec, upsample_bilinear
from .validation import summarize_predictions

log = logging.getLogger(__name__)

MET_VARS = ("blh", "u10", "v10", "t2m", "sp")
FOCAL_VARS = ("built_up", "road_density", "night_lights", "ghsl_built", "population")
FOCAL_SIGMAS_PX = (2, 6)  # ~0.5 km and ~1.6 km neighbourhoods at 270 m pixels
SATELLITE_FEATURES = ("column", "pbl_conc", "pbl_conc_mean")
ANOMALY_SATELLITE = ("pbl_conc_anom",)
# Drivers of day-to-day change: satellite anomaly, meteorology and calendar (static land use cannot vary in time).
ANOMALY_FEATURES = ("pbl_conc_anom", "pbl_conc", "blh", "u10", "v10", "wind_speed", "t2m", "sp",
                    "doy_sin", "doy_cos", "day_of_week", "weekend")
BASELINE_ONLY = ("pbl_conc_coarse",)

XGB_PARAMS = dict(n_estimators=400, max_depth=3, learning_rate=0.03, subsample=0.8, colsample_bytree=0.7,
                  min_child_weight=10, reg_lambda=5.0, tree_method="hist", n_jobs=-1, random_state=42)


class SurfaceFeatureBuilder:
    def __init__(self, static_fine: xr.Dataset, coarse: xr.Dataset, no2_coarse_filled: xr.DataArray,
                 column_fine: xr.DataArray, factor: int):
        self.factor = factor
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
        met = {k: upsample_bilinear(self.coarse[k].values[t].astype(np.float64), f) for k in MET_VARS}
        col = self.column.values[t].astype(np.float64)
        shape = col.shape
        day = self.times[t]
        ang = 2 * np.pi * day.dayofyear / 365.25
        out = dict(self.static)
        out.update(met)
        out["wind_speed"] = np.hypot(met["u10"], met["v10"])
        out["column"] = col
        out["pbl_conc"] = column_to_surface(col, met["blh"])
        out["pbl_conc_anom"] = out["pbl_conc"] - self.static["pbl_conc_mean"]
        out["pbl_conc_coarse"] = column_to_surface(upsample_bilinear(self.no2_coarse[t], f), met["blh"])
        out["doy_sin"] = np.full(shape, np.sin(ang))
        out["doy_cos"] = np.full(shape, np.cos(ang))
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


def select_surface_model(table: pd.DataFrame, feature_names: list[str], n_folds: int = 5) -> tuple[SurfaceModel, dict, pd.DataFrame]:
    """Leave-stations-out CV of every candidate; returns (best model refitted on all data, report, OOF table)."""
    groups = table["station_id"].values
    n_folds = max(2, min(n_folds, len(np.unique(groups))))
    folds = list(GroupKFold(n_splits=n_folds).split(table, groups=groups))
    oof = table[["station_id", "name", "lat", "lon", "date", "no2"]].copy() if "name" in table else \
        table[["station_id", "lat", "lon", "date", "no2"]].copy()
    report: dict = {"cv": f"GroupKFold({n_folds}) over {len(np.unique(groups))} stations", "candidates": {}}
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
    return model, report, oof
