"""Stage 4 - validation of downscaled surface NO2 against independent ground stations (e.g. CPCB)."""

from __future__ import annotations

import numpy as np
import pandas as pd
import xarray as xr

from .grid import GridSpec


def regression_metrics(y_true, y_pred) -> dict:
    """R^2, RMSE, MAE, MBE (mean bias error = mean(pred - obs)), Pearson r and N."""
    y_true = np.asarray(y_true, dtype=np.float64).ravel()
    y_pred = np.asarray(y_pred, dtype=np.float64).ravel()
    ok = np.isfinite(y_true) & np.isfinite(y_pred)
    y_true, y_pred = y_true[ok], y_pred[ok]
    n = int(ok.sum())
    if n < 2:
        return {"n": n, "r2": float("nan"), "rmse": float("nan"), "mae": float("nan"), "mbe": float("nan"), "pearson_r": float("nan")}
    err = y_pred - y_true
    ss_res = float(np.sum(err**2))
    ss_tot = float(np.sum((y_true - y_true.mean()) ** 2))
    r = float(np.corrcoef(y_true, y_pred)[0, 1]) if y_true.std() > 0 and y_pred.std() > 0 else float("nan")
    return {
        "n": n,
        "r2": 1.0 - ss_res / ss_tot if ss_tot > 0 else float("nan"),
        "rmse": float(np.sqrt(np.mean(err**2))),
        "mae": float(np.mean(np.abs(err))),
        "mbe": float(np.mean(err)),
        "pearson_r": r,
    }


def split_stations(stations: pd.DataFrame, test_fraction: float, random_state: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Split by *station* (not by row) so validation stations are spatially unseen."""
    ids = np.array(sorted(stations["station_id"].unique()))
    rng = np.random.default_rng(random_state)
    rng.shuffle(ids)
    n_test = max(1, int(round(len(ids) * test_fraction))) if len(ids) > 1 else 0
    test_ids = set(ids[:n_test])
    is_test = stations["station_id"].isin(test_ids)
    return stations[~is_test].copy(), stations[is_test].copy()


def sample_at_stations(field: xr.DataArray, stations: pd.DataFrame, grid: GridSpec) -> pd.DataFrame:
    """Attach the model value of the grid cell containing each station on the matching date."""
    df = stations.copy()
    rows, cols, inside = grid.index_of(df["lon"].values, df["lat"].values)
    times = pd.DatetimeIndex(field["time"].values).normalize()
    t_index = pd.Series(np.arange(len(times)), index=times)
    ti = t_index.reindex(pd.DatetimeIndex(df["date"]).normalize()).values
    valid = inside & np.isfinite(ti)
    pred = np.full(len(df), np.nan, dtype=np.float64)
    vals = field.values
    pred[valid] = vals[ti[valid].astype(int), rows[valid], cols[valid]]
    df["predicted"] = pred
    return df[np.isfinite(df["predicted"])]


class StationValidator:
    def __init__(self, grid: GridSpec, min_r2: float = 0.6, max_rmse: float = 15.0):
        self.grid = grid
        self.min_r2 = min_r2
        self.max_rmse = max_rmse

    def validate(self, surface: xr.DataArray, stations: pd.DataFrame) -> dict:
        matched = sample_at_stations(surface, stations, self.grid)
        overall = regression_metrics(matched["no2"], matched["predicted"])
        per_station = {
            sid: regression_metrics(g["no2"], g["predicted"]) | {"lat": float(g["lat"].iloc[0]), "lon": float(g["lon"].iloc[0])}
            for sid, g in matched.groupby("station_id")
        }
        # Spatial skill: station-mean observed vs predicted (removes day-to-day covariance).
        means = matched.groupby("station_id")[["no2", "predicted"]].mean()
        return {
            "overall": overall,
            "station_mean_spatial": regression_metrics(means["no2"], means["predicted"]),
            "per_station": per_station,
            "n_stations": int(matched["station_id"].nunique()),
            "acceptance": {
                "min_r2": self.min_r2, "max_rmse_ugm3": self.max_rmse,
                "passed": bool(overall["r2"] >= self.min_r2 and overall["rmse"] <= self.max_rmse),
            },
            "matched": matched,
        }
