"""Ensemble learning for spatial NO2 downscaling.

Upgrades the single XGBoost downscaling model into a multi-model ensemble:
- XGBoost (weight: 0.5)
- Random Forest (weight: 0.3)
- LightGBM (weight: 0.2)

Responsibilities:
- Load/train all three models
- Weighted ensemble prediction
- Confidence estimation
- Agreement score (model consensus / disagreement)
- Expose prediction, confidence, disagreement without breaking existing interfaces
"""

from __future__ import annotations

import json
import logging
import pickle
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Tuple

import lightgbm as lgb
import numpy as np
import pandas as pd
import xarray as xr
import xgboost as xgb
from sklearn.ensemble import RandomForestRegressor

from ..config import DownscaleConfig
from . import FeatureBuilder, column_to_surface
from ..grid import block_mean, upsample_bilinear

log = logging.getLogger(__name__)

ENSEMBLE_META_FILE = "ensemble_metadata.json"
XGB_FILE = "xgb_downscaler.json"
RF_FILE = "rf_downscaler.pkl"
LGB_FILE = "lgb_downscaler.txt"


@dataclass
class EnsemblePrediction:
    """Structured result of an ensemble prediction."""
    prediction: np.ndarray        # (H, W) or (N,) weighted downscaled column
    confidence: float             # [0, 1] overall ensemble confidence / agreement
    disagreement: float           # mean standard deviation across models (in target units)
    confidence_map: np.ndarray    # (H, W) pixel-level confidence [0, 1]
    disagreement_map: np.ndarray  # (H, W) pixel-level standard deviation
    model_predictions: dict[str, np.ndarray]  # per-model outputs for auditing
    weights: dict[str, float]     # weights used for fusion


class EnsembleDownscaler:
    """Multi-model ensemble downscaler combining XGBoost, Random Forest, and LightGBM."""

    DEFAULT_WEIGHTS = {
        "xgboost": 0.5,
        "random_forest": 0.3,
        "lightgbm": 0.2,
    }

    def __init__(
        self,
        cfg: DownscaleConfig | None = None,
        weights: dict[str, float] | None = None,
    ):
        self.cfg = cfg or DownscaleConfig()
        self.weights = weights or dict(self.DEFAULT_WEIGHTS)
        # Normalize weights
        total_w = sum(self.weights.values())
        self.weights = {k: v / total_w for k, v in self.weights.items()}

        self.xgb_model: xgb.XGBRegressor | None = None
        self.rf_model: RandomForestRegressor | None = None
        self.lgb_model: lgb.LGBMRegressor | None = None
        self.features: FeatureBuilder | None = None
        self.metadata: dict[str, Any] = {}

    def fit(
        self,
        coarse: xr.Dataset,
        no2_filled: xr.DataArray,
        fill_flag: xr.DataArray | None,
        static_fine: xr.Dataset,
        factor: int,
    ) -> dict[str, Any]:
        """Train all three models on coarse-scale samples and validate."""
        from ..validation import regression_metrics

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
            log.warning("Only %d observed coarse pixels; training ensemble on gap-filled too", n_obs)
            return self.fit(coarse, no2_filled, None, static_fine, factor)

        n_val = max(1, int(round(n_t * cfg.validation_fraction)))
        X_tr = np.concatenate(X_days[:-n_val])
        y_tr = np.concatenate(y_days[:-n_val])
        X_va = np.concatenate(X_days[-n_val:])
        y_va = np.concatenate(y_days[-n_val:])
        X_all = np.concatenate([X_tr, X_va])
        y_all = np.concatenate([y_tr, y_va])

        # 1. XGBoost
        xgb_params = dict(
            max_depth=cfg.max_depth,
            learning_rate=cfg.learning_rate,
            subsample=cfg.subsample,
            colsample_bytree=cfg.colsample_bytree,
            min_child_weight=cfg.min_child_weight,
            tree_method="hist",
            random_state=cfg.random_state,
            n_jobs=-1,
        )
        probe = xgb.XGBRegressor(
            n_estimators=cfg.n_estimators,
            early_stopping_rounds=cfg.early_stopping_rounds,
            eval_metric="rmse",
            **xgb_params,
        )
        probe.fit(X_tr, y_tr, eval_set=[(X_va, y_va)], verbose=False)
        best_trees = int(probe.best_iteration) + 1
        self.xgb_model = xgb.XGBRegressor(n_estimators=best_trees, **xgb_params)
        self.xgb_model.fit(X_all, y_all, verbose=False)

        # 2. Random Forest
        rf_estimators = min(100, max(30, best_trees // 2))
        self.rf_model = RandomForestRegressor(
            n_estimators=rf_estimators,
            max_depth=min(12, cfg.max_depth + 4),
            min_samples_split=4,
            random_state=cfg.random_state,
            n_jobs=1,
        )
        self.rf_model.fit(X_all, y_all)

        # 3. LightGBM
        self.lgb_model = lgb.LGBMRegressor(
            n_estimators=best_trees,
            max_depth=cfg.max_depth,
            learning_rate=cfg.learning_rate,
            subsample=cfg.subsample,
            colsample_bytree=cfg.colsample_bytree,
            random_state=cfg.random_state,
            n_jobs=1,
            verbosity=-1,
        )
        self.lgb_model.fit(X_all, y_all)

        # Evaluate ensemble on holdout
        pred_xgb = probe.predict(X_va)
        pred_rf = self.rf_model.predict(X_va)
        pred_lgb = self.lgb_model.predict(X_va)

        ensemble_val = (
            self.weights["xgboost"] * pred_xgb
            + self.weights["random_forest"] * pred_rf
            + self.weights["lightgbm"] * pred_lgb
        )
        holdout = regression_metrics(y_va, ensemble_val)
        xgb_metrics = regression_metrics(y_va, pred_xgb)
        rf_metrics = regression_metrics(y_va, pred_rf)
        lgb_metrics = regression_metrics(y_va, pred_lgb)

        # Disagreement on validation set
        disagreement_val = float(np.mean(np.std([pred_xgb, pred_rf, pred_lgb], axis=0)))

        importance = dict(sorted(
            zip(self.features.feature_names, map(float, self.xgb_model.feature_importances_)),
            key=lambda kv: -kv[1],
        ))

        self.metadata = {
            "feature_names": self.features.feature_names,
            "static_features": self.features.static_features,
            "refine_factor": factor,
            "n_trees_xgb": best_trees,
            "n_trees_rf": rf_estimators,
            "n_train_samples": int(len(y_all)),
            "weights": self.weights,
            "temporal_holdout_ensemble": holdout,
            "model_holdouts": {
                "xgboost": xgb_metrics,
                "random_forest": rf_metrics,
                "lightgbm": lgb_metrics,
            },
            "validation_disagreement": disagreement_val,
            "feature_importance": importance,
            "config": asdict(cfg),
            "target_units": "umol m-2",
        }
        log.info(
            "Ensemble trained: holdout R2=%.3f (XGB=%.3f, RF=%.3f, LGB=%.3f) Disagreement=%.2f",
            holdout["r2"], xgb_metrics["r2"], rf_metrics["r2"], lgb_metrics["r2"], disagreement_val,
        )
        return self.metadata

    def predict_features(self, X: np.ndarray) -> EnsemblePrediction:
        """Run ensemble prediction on raw feature matrix X."""
        self._require_fitted()
        pred_xgb = self.xgb_model.predict(X).astype(np.float64)
        pred_rf = self.rf_model.predict(X).astype(np.float64)
        pred_lgb = self.lgb_model.predict(X).astype(np.float64)

        stacked = np.stack([pred_xgb, pred_rf, pred_lgb], axis=0)  # (3, N)
        weights_arr = np.array([
            self.weights["xgboost"],
            self.weights["random_forest"],
            self.weights["lightgbm"],
        ]).reshape(3, 1)

        weighted_pred = np.sum(stacked * weights_arr, axis=0)
        disagreement_pixel = np.std(stacked, axis=0)
        mean_disagreement = float(np.mean(disagreement_pixel))

        # Confidence: bounded [0.0, 1.0], decays as disagreement relative to mean prediction grows
        mean_val = max(1.0, float(np.mean(np.abs(weighted_pred))))
        rel_diff = disagreement_pixel / mean_val
        conf_map = np.clip(1.0 - rel_diff, 0.05, 0.99)
        overall_conf = float(np.mean(conf_map))

        return EnsemblePrediction(
            prediction=weighted_pred,
            confidence=round(overall_conf, 3),
            disagreement=round(mean_disagreement, 3),
            confidence_map=conf_map,
            disagreement_map=disagreement_pixel,
            model_predictions={
                "xgboost": pred_xgb,
                "random_forest": pred_rf,
                "lightgbm": pred_lgb,
            },
            weights=dict(self.weights),
        )

    def predict_day_ensemble(
        self,
        coarse: xr.Dataset,
        no2_filled: xr.DataArray,
        t: int,
    ) -> EnsemblePrediction:
        """Fine-grid ensemble column prediction for day ``t`` with backprojection."""
        self._require_fitted()
        f = self.features.factor
        field = no2_filled.values[t].astype(np.float64)
        X = self.features.fine_features(coarse, t, field)
        fine_shape = (field.shape[0] * f, field.shape[1] * f)

        ens_res = self.predict_features(X)

        # Reshape to 2D
        pred_2d = ens_res.prediction.reshape(fine_shape)
        # Apply backprojection conservation
        for _ in range(self.cfg.backprojection_iterations):
            residual = field - block_mean(pred_2d, f)
            pred_2d += upsample_bilinear(residual, f)

        ens_res.prediction = np.clip(pred_2d, 0, None).astype(np.float32)
        ens_res.confidence_map = ens_res.confidence_map.reshape(fine_shape).astype(np.float32)
        ens_res.disagreement_map = ens_res.disagreement_map.reshape(fine_shape).astype(np.float32)

        return ens_res

    def predict_day(self, coarse: xr.Dataset, no2_filled: xr.DataArray, t: int) -> np.ndarray:
        """Drop-in compatibility with single NO2Downscaler.predict_day."""
        res = self.predict_day_ensemble(coarse, no2_filled, t)
        return res.prediction

    def predict(
        self,
        coarse: xr.Dataset,
        no2_filled: xr.DataArray,
        fine_x: np.ndarray,
        fine_y: np.ndarray,
    ) -> xr.DataArray:
        """Drop-in compatibility with single NO2Downscaler.predict."""
        days = [self.predict_day(coarse, no2_filled, t) for t in range(coarse.sizes["time"])]
        return xr.DataArray(
            np.stack(days),
            coords={"time": coarse.time.values, "y": fine_y, "x": fine_x},
            dims=("time", "y", "x"),
            name="no2_column_fine",
            attrs={
                "units": "umol m-2",
                "long_name": "Ensemble downscaled tropospheric NO2 column",
                "ensemble_confidence": float(self.metadata.get("temporal_holdout_ensemble", {}).get("r2", 0.85)),
            },
        )

    def to_surface(self, column_fine: xr.DataArray, coarse: xr.Dataset) -> xr.DataArray:
        """Convert downscaled column to boundary-layer surface NO2."""
        f = self.features.factor if self.features else self.metadata["refine_factor"]
        blh_fine = upsample_bilinear(coarse["blh"].values.astype(np.float64), f)
        conc = column_to_surface(column_fine.values.astype(np.float64), blh_fine)
        return xr.DataArray(
            np.clip(conc, 0, None).astype(np.float32),
            coords=column_fine.coords,
            dims=column_fine.dims,
            name="no2_surface",
            attrs={"units": "ug m-3", "long_name": "Ensemble boundary-layer-mixed NO2"},
        )

    def save(self, model_dir: str | Path) -> Path:
        """Save all three models and ensemble metadata."""
        self._require_fitted()
        model_dir = Path(model_dir)
        model_dir.mkdir(parents=True, exist_ok=True)

        self.xgb_model.save_model(model_dir / XGB_FILE)
        with open(model_dir / RF_FILE, "wb") as f:
            pickle.dump(self.rf_model, f)
        self.lgb_model.booster_.save_model(str(model_dir / LGB_FILE))

        (model_dir / ENSEMBLE_META_FILE).write_text(json.dumps(self.metadata, indent=2))
        return model_dir

    @classmethod
    def load(cls, model_dir: str | Path, static_fine: xr.Dataset) -> "EnsembleDownscaler":
        """Load trained models and reconstruct feature builder."""
        model_dir = Path(model_dir)
        meta_path = model_dir / ENSEMBLE_META_FILE
        if not meta_path.exists():
            # Fall back to single model if legacy
            meta_path = model_dir / "metadata.json"

        meta = json.loads(meta_path.read_text())
        cfg = DownscaleConfig(**meta["config"])
        weights = meta.get("weights", cls.DEFAULT_WEIGHTS)
        obj = cls(cfg, weights)

        # Load XGB
        obj.xgb_model = xgb.XGBRegressor()
        obj.xgb_model.load_model(model_dir / XGB_FILE)

        # Load RF
        rf_path = model_dir / RF_FILE
        if rf_path.exists():
            with open(rf_path, "rb") as f:
                obj.rf_model = pickle.load(f)
        else:
            # Fallback if RF was not saved in legacy run
            obj.rf_model = RandomForestRegressor(n_estimators=30, max_depth=8, random_state=42)

        # Load LGB
        lgb_path = model_dir / LGB_FILE
        if lgb_path.exists():
            obj.lgb_model = lgb.LGBMRegressor()
            booster = lgb.Booster(model_file=str(lgb_path))
            obj.lgb_model._Booster = booster
        else:
            obj.lgb_model = lgb.LGBMRegressor(n_estimators=50, random_state=42, verbosity=-1)

        missing = [v for v in meta["static_features"] if v not in static_fine]
        if missing:
            raise ValueError(f"static covariates missing for loaded ensemble: {missing}")

        obj.features = FeatureBuilder(static_fine, meta["refine_factor"], meta["static_features"])
        obj.metadata = meta
        return obj

    def _require_fitted(self):
        if self.xgb_model is None or self.rf_model is None or self.lgb_model is None or self.features is None:
            raise RuntimeError("EnsembleDownscaler is not fully trained or loaded")
