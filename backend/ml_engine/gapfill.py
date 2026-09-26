"""Stage 1 - cloud gap-filling of daily coarse S5P NO2 rasters.

Tier 1 (days with enough clear sky): iterative spatiotemporal Random Forest imputation, missForest
style. Each pixel-day is described by its location, season, the column at t-1 / t-2, neighbourhood
means on the same day, the pixel's clear-sky climatology, the domain mean, and boundary-layer /
wind / pressure / temperature. The forest is trained on clear pixels, predicts cloudy ones, and the
filled field is fed back to rebuild lag and neighbourhood features for the next pass.

Tier 2 (prolonged overcast days): centred rolling median mosaic of clear observations with expanding
windows (7 -> 15 -> 31 days), then pixel climatology, then nearest-neighbour spatial fill. The output
is guaranteed to contain no NaNs, and a per-pixel flag records which method produced each value.
"""

from __future__ import annotations

import logging
import warnings
from dataclasses import dataclass

import numpy as np
import xarray as xr
from sklearn.ensemble import RandomForestRegressor

from .config import GapFillConfig
from .grid import fill_nan_nearest, nan_neighbourhood_mean

log = logging.getLogger(__name__)

FLAG_OBSERVED, FLAG_RF, FLAG_MOSAIC, FLAG_SPATIAL = 0, 1, 2, 3
FLAG_MEANINGS = "observed rf_imputed median_mosaic climatology_or_spatial"
MET_VARS = ("blh", "u10", "v10", "sp", "t2m")
FEATURES = (
    "lat", "lon", "doy_sin", "doy_cos", "lag1", "lag2", "ring3", "ring5", "climatology", "day_mean",
    "blh", "u10", "v10", "wind_speed", "sp", "t2m",
)


@dataclass
class GapFillResult:
    filled: xr.DataArray
    flag: xr.DataArray
    report: dict

    def to_dataset(self) -> xr.Dataset:
        return xr.Dataset({"no2": self.filled, "fill_flag": self.flag})


class SpatioTemporalGapFiller:
    def __init__(self, cfg: GapFillConfig | None = None):
        self.cfg = cfg or GapFillConfig()
        self.model: RandomForestRegressor | None = None

    # ---------------------------------------------------------------------------------------------
    def fill(self, ds: xr.Dataset, var: str = "no2") -> GapFillResult:
        obs = ds[var].values.astype(np.float64)
        filled, flag, report = self._fill_array(obs, ds)
        attrs = dict(ds[var].attrs)
        return GapFillResult(
            filled=xr.DataArray(filled.astype(np.float32), coords=ds[var].coords, dims=ds[var].dims, name=var, attrs=attrs),
            flag=xr.DataArray(flag, coords=ds[var].coords, dims=ds[var].dims, name="fill_flag",
                              attrs={"flag_values": [0, 1, 2, 3], "flag_meanings": FLAG_MEANINGS}),
            report=report,
        )

    def evaluate(self, ds: xr.Dataset, var: str = "no2") -> dict:
        """Hide a random share of clear pixels, refill, and score the imputation against them."""
        rng = np.random.default_rng(self.cfg.random_state)
        obs = ds[var].values.astype(np.float64)
        clear = np.isfinite(obs)
        holdout = clear & (rng.random(obs.shape) < self.cfg.holdout_fraction)
        masked = obs.copy()
        masked[holdout] = np.nan
        filled, flag, _ = self._fill_array(masked, ds)
        truth, pred, fl = obs[holdout], filled[holdout], flag[holdout]
        from .validation import regression_metrics

        out = {"all": regression_metrics(truth, pred), "n_holdout": int(holdout.sum())}
        for code, name in ((FLAG_RF, "rf"), (FLAG_MOSAIC, "median_mosaic"), (FLAG_SPATIAL, "spatial")):
            sel = fl == code
            if sel.sum() >= 5:
                out[name] = regression_metrics(truth[sel], pred[sel])
        return out

    # ---------------------------------------------------------------------------------------------
    def _fill_array(self, obs: np.ndarray, ds: xr.Dataset):
        cfg = self.cfg
        n_t, h, w = obs.shape
        clear = np.isfinite(obs)
        coverage = clear.reshape(n_t, -1).mean(axis=1)
        rf_days = coverage >= cfg.min_day_coverage
        flag = np.full(obs.shape, FLAG_OBSERVED, dtype=np.uint8)
        field = obs.copy()

        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            climatology = np.nanmean(obs, axis=0)
        climatology = fill_nan_nearest(climatology) if np.isfinite(climatology).any() else climatology
        static = self._static_features(ds, h, w, n_t)
        met = {k: ds[k].values.astype(np.float64) for k in MET_VARS if k in ds}

        train_mask = clear & rf_days[:, None, None]
        target_mask = ~clear & rf_days[:, None, None]
        n_rf_train = int(train_mask.sum())
        if n_rf_train >= 50 and target_mask.any():
            for it in range(cfg.iterations):
                X = self._feature_matrix(field, climatology, static, met)
                self.model = RandomForestRegressor(
                    n_estimators=cfg.rf_estimators, max_depth=cfg.rf_max_depth,
                    min_samples_leaf=cfg.rf_min_samples_leaf, n_jobs=-1, random_state=cfg.random_state,
                )
                self.model.fit(X[train_mask.ravel()], obs[train_mask])
                field[target_mask] = self.model.predict(X[target_mask.ravel()])
                log.info("Gap-fill RF pass %d/%d: filled %d cloudy pixels", it + 1, cfg.iterations, int(target_mask.sum()))
            flag[target_mask] = FLAG_RF
        elif target_mask.any():
            log.warning("Too few clear pixels (%d) for RF imputation; using fallback for all days", n_rf_train)
            rf_days[:] = False

        # Tier 2: rolling median mosaic of *clear observations* for overcast days (and any residual NaN).
        for t in range(n_t):
            todo = ~np.isfinite(field[t])
            if not todo.any():
                continue
            for win in cfg.mosaic_windows_days:
                half = win // 2
                lo, hi = max(0, t - half), min(n_t, t + half + 1)
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", RuntimeWarning)
                    med = np.nanmedian(obs[lo:hi], axis=0)
                take = todo & np.isfinite(med)
                field[t][take] = med[take]
                flag[t][take] = FLAG_MOSAIC
                todo &= ~take
                if not todo.any():
                    break
            if todo.any():
                take = todo & np.isfinite(climatology)
                field[t][take] = climatology[take]
                flag[t][take] = FLAG_SPATIAL
                todo &= ~take
            if todo.any():
                field[t] = fill_nan_nearest(field[t])
                flag[t][todo] = FLAG_SPATIAL
        if not np.isfinite(field).all():
            raise RuntimeError("Gap filling left NaNs - input contains no clear observations at all")

        report = {
            "days": int(n_t),
            "rf_days": int(rf_days.sum()),
            "fallback_days": int((~rf_days).sum()),
            "cloudy_fraction_in": float(1 - clear.mean()),
            "nan_fraction_out": float((~np.isfinite(field)).mean()),
            "pixels_by_method": {
                "observed": int((flag == FLAG_OBSERVED).sum()),
                "rf_imputed": int((flag == FLAG_RF).sum()),
                "median_mosaic": int((flag == FLAG_MOSAIC).sum()),
                "climatology_or_spatial": int((flag == FLAG_SPATIAL).sum()),
            },
        }
        if self.model is not None:
            report["rf_feature_importance"] = dict(
                sorted(zip(FEATURES, map(float, self.model.feature_importances_)), key=lambda kv: -kv[1])
            )
        return field, flag, report

    @staticmethod
    def _static_features(ds: xr.Dataset, h: int, w: int, n_t: int) -> dict[str, np.ndarray]:
        lon, lat = np.meshgrid(ds["x"].values, ds["y"].values)
        doy = ds["time"].dt.dayofyear.values.astype(np.float64)
        ang = 2 * np.pi * doy / 365.25
        return {
            "lat": np.broadcast_to(lat, (n_t, h, w)),
            "lon": np.broadcast_to(lon, (n_t, h, w)),
            "doy_sin": np.broadcast_to(np.sin(ang)[:, None, None], (n_t, h, w)),
            "doy_cos": np.broadcast_to(np.cos(ang)[:, None, None], (n_t, h, w)),
        }

    @staticmethod
    def _feature_matrix(field, climatology, static, met) -> np.ndarray:
        n_t, h, w = field.shape
        lag1 = np.full_like(field, np.nan)
        lag2 = np.full_like(field, np.nan)
        lag1[1:] = field[:-1]
        lag2[2:] = field[:-2]
        ring3 = np.stack([nan_neighbourhood_mean(field[t], 3) for t in range(n_t)])
        ring5 = np.stack([nan_neighbourhood_mean(field[t], 5) for t in range(n_t)])
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            day_mean = np.nanmean(field.reshape(n_t, -1), axis=1)
        nan = np.full_like(field, np.nan)
        cols = {
            **static,
            "lag1": lag1, "lag2": lag2, "ring3": ring3, "ring5": ring5,
            "climatology": np.broadcast_to(climatology, field.shape),
            "day_mean": np.broadcast_to(day_mean[:, None, None], field.shape),
            "blh": met.get("blh", nan), "u10": met.get("u10", nan), "v10": met.get("v10", nan),
            "wind_speed": np.hypot(met["u10"], met["v10"]) if "u10" in met and "v10" in met else nan,
            "sp": met.get("sp", nan), "t2m": met.get("t2m", nan),
        }
        return np.stack([np.asarray(cols[f], dtype=np.float32).ravel() for f in FEATURES], axis=1)
