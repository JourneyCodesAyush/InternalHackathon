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


def summarize_predictions(df: pd.DataFrame, obs_col: str = "no2", pred_col: str = "pred") -> dict:
    """Skill of station predictions, split into its spatial and temporal parts.

    * overall: every station-day pooled.
    * station_mean_spatial: station-mean observed vs predicted - can the model rank locations?
    * temporal_anomaly: departures from each station's own mean - does it track day-to-day changes?
    """
    d = df[[c for c in ("station_id", "lat", "lon", obs_col, pred_col) if c in df]].dropna()
    means = d.groupby("station_id")[[obs_col, pred_col]].transform("mean")
    station_means = d.groupby("station_id")[[obs_col, pred_col]].mean()
    within_r = d.groupby("station_id").apply(
        lambda g: np.corrcoef(g[obs_col], g[pred_col])[0, 1] if len(g) > 5 and g[pred_col].std() > 0 else np.nan)
    per_station = {
        sid: regression_metrics(g[obs_col], g[pred_col]) | {"lat": float(g["lat"].iloc[0]), "lon": float(g["lon"].iloc[0])}
        for sid, g in d.groupby("station_id")
    }
    return {
        "overall": regression_metrics(d[obs_col], d[pred_col]),
        "station_mean_spatial": regression_metrics(station_means[obs_col], station_means[pred_col]),
        "temporal_anomaly": regression_metrics(d[obs_col] - means[obs_col], d[pred_col] - means[pred_col]),
        "median_within_station_r": float(np.nanmedian(within_r)) if np.isfinite(within_r).any() else float("nan"),
        "n_stations": int(d["station_id"].nunique()),
        "per_station": per_station,
    }


def acceptance(metrics: dict, min_r2: float, max_rmse: float) -> dict:
    return {"min_r2": min_r2, "max_rmse_ugm3": max_rmse,
            "passed": bool(metrics["r2"] >= min_r2 and metrics["rmse"] <= max_rmse)}
