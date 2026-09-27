"""Inference module for the hybrid physics + AI forecasting engine.

Integrates:
1. ImprovedPhysicsSolver  – 30-min frames from advection-diffusion-decay.
2. ConvLSTMResidualModel  – learned correction on top of physics.
3. Output export          – GeoTIFF / NetCDF / GeoJSON / confidence maps.

Entry points
------------
run_inference(c0, wind_sequence, dynamic_history, static_feat, cfg)
    → ForecastResult (numpy + xarray, no torch dependency at call site)

Both CPU (no torch) and GPU (torch + CUDA) are supported.  If torch is
unavailable, only the physics component runs.
"""

from __future__ import annotations

import json
import logging
import math
import os
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import xarray as xr

from .config import ForecastConfig
from .physics import ImprovedPhysicsSolver
from .convlstm import ConvLSTMResidualModel
from .metrics import ForecastMetrics

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result container
# ---------------------------------------------------------------------------

@dataclass
class ForecastResult:
    """Full output of one inference run.

    Attributes
    ----------
    horizons_min  : list of forecast horizons in minutes, e.g. [30, 60, 90, 120]
    no2_physics   : (horizons, H, W) float32 – physics-only prediction
    no2_residual  : (horizons, H, W) float32 – AI correction (zeros if no torch)
    no2_hybrid    : (horizons, H, W) float32 – physics + residual (clipped ≥0)
    confidence    : (horizons, H, W) float32 – per-pixel confidence 0–1
    mass_error    : list[float] – relative mass conservation error per horizon
    wind_u        : (H, W) float32 – last used ERA5 U wind
    wind_v        : (H, W) float32 – last used ERA5 V wind
    y             : (H,) latitude array
    x             : (W,) longitude array
    """
    horizons_min: list[int]
    no2_physics:  np.ndarray
    no2_residual: np.ndarray
    no2_hybrid:   np.ndarray
    confidence:   np.ndarray
    mass_error:   list[float]
    wind_u:       np.ndarray
    wind_v:       np.ndarray
    y:            np.ndarray
    x:            np.ndarray
    meta:         dict = field(default_factory=dict)

    def to_xarray(self) -> xr.Dataset:
        coords = {
            "horizon_min": self.horizons_min,
            "y": self.y,
            "x": self.x,
        }
        dims = ("horizon_min", "y", "x")
        attrs = {"creator": "ml_engine.forecasting"}
        for k, v in self.meta.items():
            if v is None:
                attrs[k] = ""
            elif isinstance(v, bool):
                attrs[k] = int(v)
            else:
                attrs[k] = v

        ds = xr.Dataset(
            {
                "no2_physics":  xr.DataArray(self.no2_physics,  coords=coords, dims=dims, attrs={"units": "ug m-3"}),
                "no2_residual": xr.DataArray(self.no2_residual, coords=coords, dims=dims, attrs={"units": "ug m-3"}),
                "no2_hybrid":   xr.DataArray(self.no2_hybrid,   coords=coords, dims=dims, attrs={"units": "ug m-3"}),
                "confidence":   xr.DataArray(self.confidence,   coords=coords, dims=dims, attrs={"units": "0-1"}),
                "mass_error":   xr.DataArray(
                    self.mass_error,
                    coords={"horizon_min": self.horizons_min},
                    dims=("horizon_min",),
                ),
                "wind_u": xr.DataArray(
                    self.wind_u[None],
                    coords={"horizon_min": [0], "y": self.y, "x": self.x},
                    dims=("horizon_min", "y", "x"),
                    attrs={"units": "m s-1"},
                ),
                "wind_v": xr.DataArray(
                    self.wind_v[None],
                    coords={"horizon_min": [0], "y": self.y, "x": self.x},
                    dims=("horizon_min", "y", "x"),
                    attrs={"units": "m s-1"},
                ),
            },
            attrs=attrs,
        )
        return ds


# ---------------------------------------------------------------------------
# Confidence estimation
# ---------------------------------------------------------------------------

def _compute_confidence(
    mass_error: list[float],
    base_skill: float = 0.63,
    e_fold_min: float = 90.0,
) -> np.ndarray:
    """Per-horizon spatially-uniform confidence map.

    Confidence = base_skill × exp(-t / e_fold) × (1 - mass_error)

    base_skill  : day-to-day temporal correlation from validation (0.63 default).
    e_fold_min  : e-folding timescale (minutes).

    Returns
    -------
    (horizons,) float32 array
    """
    conf = []
    for i, me in enumerate(mass_error):
        t_min = (i + 1) * 30.0
        c = base_skill * math.exp(-t_min / e_fold_min) * (1.0 - min(me, 1.0))
        conf.append(max(0.0, c))
    return np.array(conf, dtype=np.float32)


# ---------------------------------------------------------------------------
# Main inference function
# ---------------------------------------------------------------------------

def run_inference(
    c0: np.ndarray,
    wind_sequence: list[tuple[np.ndarray, np.ndarray]],
    dynamic_history: np.ndarray | None,
    static_feat: np.ndarray | None,
    y: np.ndarray,
    x: np.ndarray,
    cfg: ForecastConfig | None = None,
    checkpoint_path: str | Path | None = None,
    preserve_mass: bool = True,
    base_skill: float = 0.63,
) -> ForecastResult:
    """Run the full hybrid physics + AI forecasting pipeline.

    Parameters
    ----------
    c0              : (H, W) initial surface NO₂ field (µg m⁻³).
    wind_sequence   : list of (u, v) arrays, one per ERA5 hour.
    dynamic_history : (seq_len, dynamic_channels, H, W) feature sequence ending
                      at t0.  Pass None to skip AI correction.
    static_feat     : (static_channels, H, W) static features.
                      Pass None to skip AI correction.
    y, x            : latitude / longitude coordinate arrays.
    cfg             : ForecastConfig (defaults to ForecastConfig() if None).
    checkpoint_path : path to ConvLSTM checkpoint (.pt file).
    preserve_mass   : enforce mass conservation at each 30-min export.
    base_skill      : baseline temporal correlation for confidence map.

    Returns
    -------
    ForecastResult
    """
    if cfg is None:
        cfg = ForecastConfig()

    H, W = c0.shape

    # ------------------------------------------------------------------ #
    # 1. Physics solver
    # ------------------------------------------------------------------ #
    dx_m = float(np.mean(np.diff(x))) * 111_320.0 * math.cos(math.radians(float(np.mean(y))))
    dy_m = float(np.mean(np.abs(np.diff(y)))) * 110_574.0

    solver = ImprovedPhysicsSolver(H, W, abs(dx_m), abs(dy_m), cfg.physics)
    physics_ds = solver.forecast(c0, wind_sequence, y, x, preserve_mass=preserve_mass)

    physics_frames = physics_ds["no2_forecast"].values   # (horizons, H, W)
    mass_errors    = physics_ds["mass_error"].values.tolist()
    horizons_min   = physics_ds["horizon_min"].values.tolist()

    # ------------------------------------------------------------------ #
    # 2. AI residual (optional)
    # ------------------------------------------------------------------ #
    residual = np.zeros_like(physics_frames)

    if (
        cfg.use_ai_residual
        and dynamic_history is not None
        and static_feat is not None
        and checkpoint_path is not None
        and Path(checkpoint_path).exists()
    ):
        try:
            model = ConvLSTMResidualModel(cfg.convlstm, checkpoint_path=checkpoint_path)
            raw_residual = model.predict(dynamic_history, static_feat)  # (output_horizons, H, W)
            # Align horizons (model may predict fewer than physics solver)
            n_h = min(raw_residual.shape[0], len(horizons_min))
            residual[:n_h] = raw_residual[:n_h]
            log.info("AI residual applied from %s (%d horizons)", checkpoint_path, n_h)
        except Exception as exc:
            log.warning("AI residual skipped (%s) – using physics only", exc)

    # ------------------------------------------------------------------ #
    # 3. Hybrid output
    # ------------------------------------------------------------------ #
    hybrid = np.clip(physics_frames + residual, 0.0, None).astype(np.float32)

    # ------------------------------------------------------------------ #
    # 4. Confidence maps
    # ------------------------------------------------------------------ #
    conf_1d = _compute_confidence(mass_errors, base_skill=base_skill)
    # Broadcast to spatial dims
    conf = np.broadcast_to(conf_1d[:, None, None], hybrid.shape).copy().astype(np.float32)

    # Last wind used (first element of wind_sequence = overpass hour)
    u0, v0 = wind_sequence[0]

    return ForecastResult(
        horizons_min=[int(h) for h in horizons_min],
        no2_physics=physics_frames.astype(np.float32),
        no2_residual=residual.astype(np.float32),
        no2_hybrid=hybrid,
        confidence=conf,
        mass_error=mass_errors,
        wind_u=u0.astype(np.float32),
        wind_v=v0.astype(np.float32),
        y=y,
        x=x,
        meta={
            "physics_emission_mode": cfg.physics.emission_mode,
            "use_ai_residual": cfg.use_ai_residual,
            "checkpoint": str(checkpoint_path) if checkpoint_path else None,
        },
    )


# ---------------------------------------------------------------------------
# Export helpers
# ---------------------------------------------------------------------------

def export_geotiff(
    result: ForecastResult,
    output_dir: Path | str,
    field: str = "no2_hybrid",
) -> list[Path]:
    """Write one GeoTIFF per forecast horizon.

    Returns list of written file paths.
    """
    try:
        import rasterio
        from rasterio.transform import from_bounds
        from rasterio.crs import CRS
    except ImportError:
        log.warning("rasterio not available – skipping GeoTIFF export")
        return []

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    data = getattr(result, field)
    west  = float(result.x[0]) - (result.x[1] - result.x[0]) / 2.0
    east  = float(result.x[-1]) + (result.x[-1] - result.x[-2]) / 2.0
    south = float(result.y[-1]) - abs(result.y[-1] - result.y[-2]) / 2.0
    north = float(result.y[0])  + abs(result.y[0]  - result.y[1])  / 2.0
    H, W = data.shape[1:]
    transform = from_bounds(west, south, east, north, W, H)

    paths = []
    for i, h_min in enumerate(result.horizons_min):
        fname = output_dir / f"forecast_{h_min:04d}.tif"
        with rasterio.open(
            fname, "w",
            driver="GTiff",
            height=H, width=W,
            count=1, dtype="float32",
            crs=CRS.from_epsg(4326),
            transform=transform,
            compress="lzw",
            predictor=3,
        ) as dst:
            dst.write(data[i], 1)
            dst.update_tags(
                horizon_min=h_min,
                field=field,
                units="ug m-3",
            )
        paths.append(fname)
        log.debug("Wrote %s", fname)
    return paths


def export_netcdf(result: ForecastResult, output_dir: Path | str) -> Path:
    """Write full forecast Dataset as NetCDF."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    ds = result.to_xarray()
    path = output_dir / "no2_forecast.nc"
    ds.to_netcdf(path, engine="h5netcdf")
    log.info("Wrote NetCDF: %s", path)
    return path


def export_wind_geojson(
    result: ForecastResult,
    output_dir: Path | str,
    stride: int = 20,
) -> Path:
    """Write a GeoJSON FeatureCollection of wind vectors."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    features = []
    u, v = result.wind_u, result.wind_v
    for r in range(0, u.shape[0], stride):
        for c in range(0, u.shape[1], stride):
            lon = float(result.x[c])
            lat = float(result.y[r])
            speed = float(math.hypot(float(u[r, c]), float(v[r, c])))
            direction = float((math.degrees(math.atan2(float(u[r, c]), float(v[r, c]))) + 360) % 360)
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "u_ms": round(float(u[r, c]), 3),
                    "v_ms": round(float(v[r, c]), 3),
                    "speed_ms": round(speed, 3),
                    "direction_deg": round(direction, 1),
                },
            })

    path = output_dir / "wind_vectors.geojson"
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    log.info("Wrote wind GeoJSON: %s (%d arrows)", path, len(features))
    return path


def export_all(
    result: ForecastResult,
    output_dir: Path | str,
    cfg: ForecastConfig | None = None,
) -> dict[str, list]:
    """Run all exports and return a dict of file paths."""
    if cfg is None:
        cfg = ForecastConfig()
    ocfg = cfg.output
    out = {}

    if ocfg.write_geotiff:
        out["geotiff"] = [str(p) for p in export_geotiff(result, output_dir)]
    if ocfg.write_netcdf:
        out["netcdf"] = str(export_netcdf(result, output_dir))
    if ocfg.write_wind_geojson:
        out["wind_geojson"] = str(export_wind_geojson(result, output_dir, stride=ocfg.wind_arrow_stride))

    return out
