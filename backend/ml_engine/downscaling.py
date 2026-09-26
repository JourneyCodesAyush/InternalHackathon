"""Stage 2 - fine spatial downscaling (~3.9 km -> ~270 m) of gap-filled S5P NO2.

Method (scale-invariant regression + mass-conserving residual correction):
1. Aggregate fine covariates (DEM elevation/slope, NDVI, built-up fraction, road density) to the
   coarse satellite grid and pair them with meteorology (ERA5 wind, pressure, temperature, BLH),
   seasonality and regional NO2 context. Train an XGBoost regressor coarse-covariates -> coarse column.
2. Apply the trained relationship at the fine grid using the native-resolution covariates, which
   injects sub-pixel structure (roads, built-up land, terrain) the satellite cannot resolve.
3. Iterative back-projection: the fine field is corrected so its block means reproduce the observed
   coarse column exactly, keeping the product faithful to the satellite measurement.
4. The downscaled column is converted to ground-level concentration (ug/m^3) by distributing it through
   the boundary layer, and optionally calibrated against training ground stations.
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import xarray as xr
import xgboost as xgb
from sklearn.linear_model import HuberRegressor

from .config import NO2_MOLAR_MASS_G, DownscaleConfig
from .grid import block_mean, nan_neighbourhood_mean, upsample_bilinear

log = logging.getLogger(__name__)

MET_FEATURES = ("u10", "v10", "wind_speed", "blh", "sp", "t2m")
CONTEXT_FEATURES = ("no2_ring", "no2_day_mean", "doy_sin", "doy_cos")
STATIC_CANDIDATES = ("elevation", "slope", "ndvi", "built_up", "road_density")

MODEL_FILE = "xgb_downscaler.json"
META_FILE = "metadata.json"
CALIBRATOR_FILE = "surface_calibrator.joblib"


def column_to_surface(column_umol_m2: np.ndarray, blh_m: np.ndarray) -> np.ndarray:
    """Tropospheric column (umol/m^2) -> boundary-layer mean concentration (ug/m^3).

    Assumes the tropospheric NO2 burden is well mixed within the planetary boundary layer:
    C = column[mol/m^2] * M[g/mol] * 1e6[ug/g] / BLH[m]. The station calibrator then absorbs the
    near-surface profile shape factor and regional background.
    """
    return column_umol_m2 * 1e-6 * NO2_MOLAR_MASS_G * 1e6 / np.clip(blh_m, 50.0, None)


class FeatureBuilder:
    """Builds identical feature sets at the coarse (training) and fine (inference) scales."""

    def __init__(self, static_fine: xr.Dataset, factor: int, static_features: list[str] | None = None):
        self.factor = factor
        self.static_features = static_features or [v for v in STATIC_CANDIDATES if v in static_fine]
        self.static_fine = {v: static_fine[v].values.astype(np.float32) for v in self.static_features}
        self.static_coarse = {v: block_mean(a, factor) for v, a in self.static_fine.items()}

    @property
    def feature_names(self) -> list[str]:
        return [*self.static_features, *MET_FEATURES, *CONTEXT_FEATURES]

    def _day_context(self, coarse: xr.Dataset, t: int, no2_coarse: np.ndarray) -> dict[str, np.ndarray]:
        day = pd.Timestamp(coarse["time"].values[t])
        ang = 2 * np.pi * day.dayofyear / 365.25
        ring = nan_neighbourhood_mean(no2_coarse, 3, exclude_centre=True)
        ring = np.where(np.isfinite(ring), ring, np.nanmean(no2_coarse))
        met = {k: coarse[k].values[t].astype(np.float32) for k in ("u10", "v10", "blh", "sp", "t2m")}
        met["wind_speed"] = np.hypot(met["u10"], met["v10"])
        return {"met": met, "ring": ring, "day_mean": float(np.nanmean(no2_coarse)), "sin": np.sin(ang), "cos": np.cos(ang)}

    def coarse_features(self, coarse: xr.Dataset, t: int, no2_coarse: np.ndarray) -> np.ndarray:
        ctx = self._day_context(coarse, t, no2_coarse)
        shape = no2_coarse.shape
        cols = [self.static_coarse[v] for v in self.static_features]
        cols += [ctx["met"][k] for k in MET_FEATURES]
        cols += [ctx["ring"], np.full(shape, ctx["day_mean"]), np.full(shape, ctx["sin"]), np.full(shape, ctx["cos"])]
        return np.stack([np.asarray(c, dtype=np.float32).ravel() for c in cols], axis=1)

    def fine_features(self, coarse: xr.Dataset, t: int, no2_coarse: np.ndarray) -> np.ndarray:
        ctx = self._day_context(coarse, t, no2_coarse)
        f = self.factor
        shape = self.static_fine[self.static_features[0]].shape if self.static_features else (
            no2_coarse.shape[0] * f, no2_coarse.shape[1] * f)
        cols = [self.static_fine[v] for v in self.static_features]
        cols += [upsample_bilinear(ctx["met"][k], f) for k in MET_FEATURES]
        cols += [upsample_bilinear(ctx["ring"], f), np.full(shape, ctx["day_mean"]),
                 np.full(shape, ctx["sin"]), np.full(shape, ctx["cos"])]
        return np.stack([np.asarray(c, dtype=np.float32).ravel() for c in cols], axis=1)


class NO2Downscaler:
    def __init__(self, cfg: DownscaleConfig | None = None):
        self.cfg = cfg or DownscaleConfig()
        self.model: xgb.XGBRegressor | None = None
        self.features: FeatureBuilder | None = None
        self.metadata: dict = {}

    # ---------------------------------------------------------------------------------------------
    def fit(self, coarse: xr.Dataset, no2_filled: xr.DataArray, fill_flag: xr.DataArray | None,
            static_fine: xr.Dataset, factor: int) -> dict:
        """Train on coarse-scale samples. Only genuinely observed pixels are used as targets."""
        from .validation import regression_metrics

        cfg = self.cfg
        self.features = FeatureBuilder(static_fine, factor)
        n_t = coarse.sizes["time"]
        X_days, y_days = [], []
        for t in range(n_t):
            field = no2_filled.values[t]
            X = self.features.coarse_features(coarse, t, field)
            y = field.ravel()
            keep = np.isfinite(y)
            if fill_flag is not None:
                keep &= fill_flag.values[t].ravel() == 0
            X_days.append(X[keep])
            y_days.append(y[keep])
        n_obs = sum(len(y) for y in y_days)
        if n_obs < 200 and fill_flag is not None:
            log.warning("Only %d observed coarse pixels; training on gap-filled values too", n_obs)
            return self.fit(coarse, no2_filled, None, static_fine, factor)

        n_val = max(1, int(round(n_t * cfg.validation_fraction)))
        X_tr, y_tr = np.concatenate(X_days[:-n_val]), np.concatenate(y_days[:-n_val])
        X_va, y_va = np.concatenate(X_days[-n_val:]), np.concatenate(y_days[-n_val:])
        params = dict(
            max_depth=cfg.max_depth, learning_rate=cfg.learning_rate, subsample=cfg.subsample,
            colsample_bytree=cfg.colsample_bytree, min_child_weight=cfg.min_child_weight,
            tree_method="hist", random_state=cfg.random_state, n_jobs=-1,
        )
        probe = xgb.XGBRegressor(n_estimators=cfg.n_estimators, early_stopping_rounds=cfg.early_stopping_rounds,
                                 eval_metric="rmse", **params)
        probe.fit(X_tr, y_tr, eval_set=[(X_va, y_va)], verbose=False)
        best = int(probe.best_iteration) + 1
        holdout = regression_metrics(y_va, probe.predict(X_va))
        log.info("Downscaler temporal hold-out (coarse scale): R2=%.3f RMSE=%.2f umol/m2, %d trees",
                 holdout["r2"], holdout["rmse"], best)

        # Refit on every day with the early-stopped tree count.
        self.model = xgb.XGBRegressor(n_estimators=best, **params)
        self.model.fit(np.concatenate([X_tr, X_va]), np.concatenate([y_tr, y_va]), verbose=False)

        importance = dict(sorted(zip(self.features.feature_names, map(float, self.model.feature_importances_)),
                                 key=lambda kv: -kv[1]))
        self.metadata = {
            "feature_names": self.features.feature_names,
            "static_features": self.features.static_features,
            "refine_factor": factor,
            "n_trees": best,
            "n_train_samples": int(len(y_tr) + len(y_va)),
            "trained_period": [str(pd.Timestamp(coarse.time.values[0]).date()), str(pd.Timestamp(coarse.time.values[-1]).date())],
            "temporal_holdout_coarse": holdout,
            "feature_importance": importance,
            "config": asdict(cfg),
            "target_units": "umol m-2",
        }
        return self.metadata

    # ---------------------------------------------------------------------------------------------
    def predict_day(self, coarse: xr.Dataset, no2_filled: xr.DataArray, t: int) -> np.ndarray:
        """Fine-grid column (umol/m^2) for day ``t`` whose block means match the coarse observation."""
        self._require_fitted()
        f = self.features.factor
        field = no2_filled.values[t].astype(np.float64)
        X = self.features.fine_features(coarse, t, field)
        fine_shape = (field.shape[0] * f, field.shape[1] * f)
        pred = self.model.predict(X).reshape(fine_shape).astype(np.float64)
        for _ in range(self.cfg.backprojection_iterations):
            residual = field - block_mean(pred, f)
            pred += upsample_bilinear(residual, f)
        return pred.astype(np.float32)

    def predict(self, coarse: xr.Dataset, no2_filled: xr.DataArray, fine_x: np.ndarray, fine_y: np.ndarray) -> xr.DataArray:
        days = [self.predict_day(coarse, no2_filled, t) for t in range(coarse.sizes["time"])]
        return xr.DataArray(
            np.stack(days), coords={"time": coarse.time.values, "y": fine_y, "x": fine_x}, dims=("time", "y", "x"),
            name="no2_column_fine", attrs={"units": "umol m-2", "long_name": "Downscaled tropospheric NO2 column"},
        )

    def to_surface(self, column_fine: xr.DataArray, coarse: xr.Dataset, calibrator: "SurfaceCalibrator | None" = None) -> xr.DataArray:
        """Convert the downscaled column to ground-level ug/m^3 using BLH (and station calibration if given)."""
        f = self.features.factor if self.features else self.metadata["refine_factor"]
        blh_fine = upsample_bilinear(coarse["blh"].values.astype(np.float64), f)
        conc = column_to_surface(column_fine.values.astype(np.float64), blh_fine)
        if calibrator is not None and calibrator.is_fitted:
            conc = calibrator.transform(conc)
        return xr.DataArray(
            np.clip(conc, 0, None).astype(np.float32), coords=column_fine.coords, dims=column_fine.dims,
            name="no2_surface", attrs={"units": "ug m-3", "long_name": "Ground-level NO2 concentration",
                                       "calibrated": int(calibrator is not None and calibrator.is_fitted)},
        )

    # ---------------------------------------------------------------------------------------------
    def save(self, model_dir: str | Path, static_fine: xr.Dataset | None = None) -> Path:
        self._require_fitted()
        model_dir = Path(model_dir)
        model_dir.mkdir(parents=True, exist_ok=True)
        self.model.save_model(model_dir / MODEL_FILE)
        (model_dir / META_FILE).write_text(json.dumps(self.metadata, indent=2))
        return model_dir

    @classmethod
    def load(cls, model_dir: str | Path, static_fine: xr.Dataset) -> "NO2Downscaler":
        """Load weights + metadata; ``static_fine`` must contain the covariates the model was trained on."""
        model_dir = Path(model_dir)
        meta = json.loads((model_dir / META_FILE).read_text())
        cfg = DownscaleConfig(**meta["config"])
        obj = cls(cfg)
        obj.model = xgb.XGBRegressor()
        obj.model.load_model(model_dir / MODEL_FILE)
        missing = [v for v in meta["static_features"] if v not in static_fine]
        if missing:
            raise ValueError(f"static covariates missing for loaded model: {missing}")
        obj.features = FeatureBuilder(static_fine, meta["refine_factor"], meta["static_features"])
        obj.metadata = meta
        return obj

    def _require_fitted(self):
        if self.model is None or self.features is None:
            raise RuntimeError("Downscaler is not trained - call fit() or load() first")


class SurfaceCalibrator:
    """Robust linear map from BLH-mixed concentration to station-measured surface NO2 (ug/m^3).

    Fitted on *training* stations only; the held-out stations remain unseen for validation.
    """

    def __init__(self):
        self.model: HuberRegressor | None = None
        self.info: dict = {}

    @property
    def is_fitted(self) -> bool:
        return self.model is not None

    def fit(self, pbl_conc: np.ndarray, station_no2: np.ndarray) -> "SurfaceCalibrator":
        x, y = np.asarray(pbl_conc, float), np.asarray(station_no2, float)
        ok = np.isfinite(x) & np.isfinite(y)
        if ok.sum() < 10:
            raise ValueError(f"Need >=10 station-day pairs to calibrate, got {int(ok.sum())}")
        self.model = HuberRegressor(epsilon=1.5, max_iter=500).fit(x[ok, None], y[ok])
        self.info = {"slope": float(self.model.coef_[0]), "intercept": float(self.model.intercept_), "n_pairs": int(ok.sum())}
        return self

    def transform(self, pbl_conc: np.ndarray) -> np.ndarray:
        return self.model.coef_[0] * pbl_conc + self.model.intercept_

    def save(self, path: str | Path) -> None:
        joblib.dump({"model": self.model, "info": self.info}, path)

    @classmethod
    def load(cls, path: str | Path) -> "SurfaceCalibrator":
        obj = cls()
        payload = joblib.load(path)
        obj.model, obj.info = payload["model"], payload["info"]
        return obj
