import asyncio
import json
import math
import os
from datetime import date as date_cls
from pathlib import Path
from typing import List

import numpy as np
import xarray as xr
from fastapi import HTTPException
from supabase import Client

from app.core.config import settings
from app.models.trends import (
    TrendPrediction,
    TrendsResponse,
    ForecastFrame,
    ForecastResponse,
)
from app.services.activity_service import log_activity
from ml_engine.service import forecast_point, _run, _parse_date, _area_for_point, RUNS_ROOT
from ml_engine.config import DispersionConfig, PRETRAINED_SURFACE_MODEL
from ml_engine.grid import GridSpec, upsample_bilinear




async def get_predictions(
    supabase: Client,
    user_id: str,
    lat: float,
    lon: float,
    hours: int,
) -> TrendsResponse:
    """
    Return NO2 predictions every 3 hours up to ``hours`` ahead for a location.

    The ML engine's latest 250 m ground-level NO2 map around the point is advected with ERA5 winds by
    its advection-diffusion solver. ``wind_direction`` is the meteorological direction the wind blows
    from; ``confidence`` is indicative (model day-to-day skill, decaying with lead time).

    Args:
        supabase: Active Supabase client.
        user_id: UUID of the requesting user.
        lat: Latitude of the target location.
        lon: Longitude of the target location.
        hours: Forecast horizon - must be one of 3, 6, 12, 24.
    """
    await log_activity(
        supabase,
        user_id,
        "RUN_PREDICTION",
        {"lat": lat, "lon": lon, "hours": hours},
    )

    try:
        result = await asyncio.to_thread(forecast_point, lat, lon, hours, ee_project=settings.EE_PROJECT)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:  # Earth Engine outages, quota, missing satellite data
        raise HTTPException(status_code=503, detail=f"Forecast failed: {exc}")

    predictions: List[TrendPrediction] = [TrendPrediction(**p) for p in result["predictions"]]
    return TrendsResponse(lat=lat, lon=lon, hours=hours, predictions=predictions)


# ---------------------------------------------------------------------------
# NEW: Spatial 30-minute forecast for a bounding box
# ---------------------------------------------------------------------------

def _run_spatial_forecast(
    bbox: tuple,
    timestamp: str | None,
    interval: int,
    ee_project: str | None,
) -> dict:
    """Run the spatiotemporal forecast engine and return file paths + metadata.

    This function runs in a thread (called via asyncio.to_thread).
    """
    from ml_engine.forecasting.engine import ForecastEngine
    from ml_engine.forecasting.config import ForecastConfig, PhysicsConfig

    day = _parse_date(timestamp)
    run_dir = _run(bbox, day, ee_project, source="gee" if ee_project else "synthetic")
    report = json.loads((run_dir / "report.json").read_text())

    # Load the fine-grid NO₂ surface map
    fine = GridSpec(**report["grids"]["fine"])
    surface = xr.load_dataset(
        run_dir / "no2_surface_fine.nc", engine="h5netcdf"
    )["no2_surface"].sel(time=str(day.date())).squeeze()

    # Load winds (coarse → fine)
    factor = report["config"]["refine_factor"]
    coarse = xr.load_dataset(run_dir / "coarse_raw.nc", engine="h5netcdf").sel(
        time=str(day.date())
    ).squeeze()
    u = upsample_bilinear(coarse["u10"].values.astype(np.float64), factor).astype(np.float32)
    v = upsample_bilinear(coarse["v10"].values.astype(np.float64), factor).astype(np.float32)

    # Configure forecasting engine
    pc = PhysicsConfig(
        export_interval_min=interval,
        max_horizon_min=120,
    )
    cfg = ForecastConfig.physics_only()
    cfg.physics = pc

    engine = ForecastEngine(cfg)
    output_dir = run_dir / "forecasts" / f"interval_{interval:03d}"

    result, file_paths = engine.predict_and_export(
        c0=surface.values.astype(np.float32),
        wind_u=u,
        wind_v=v,
        y=fine.y.astype(np.float32),
        x=fine.x.astype(np.float32),
        output_dir=output_dir,
    )

    # Build per-frame metadata
    frames = []
    for i, h_min in enumerate(result.horizons_min):
        fname = f"forecast_{h_min:04d}.tif"
        tif_path = output_dir / fname
        conf_mean = float(np.mean(result.confidence[i]))
        me = result.mass_error[i] if i < len(result.mass_error) else 0.0
        frames.append({
            "horizon_min": h_min,
            "tif_abs": str(tif_path),
            "confidence_mean": conf_mean,
            "mass_error": float(me),
        })

    return {
        "frames": frames,
        "wind_geojson": str(output_dir / "wind_vectors.geojson"),
        "netcdf": str(output_dir / "no2_forecast.nc"),
        "run_dir": str(run_dir),
        "timestamp": str(day.date()),
    }


def _path_to_url(abs_path: str, base: str = "/files") -> str:
    """Convert an absolute output path to a /files/ URL served by the backend."""
    # RUNS_ROOT is backend/outputs/runs; files are served from /files/…
    try:
        rel = Path(abs_path).relative_to(Path(RUNS_ROOT).parent)
        return f"{base}/{rel}"
    except ValueError:
        return f"{base}/{Path(abs_path).name}"


async def get_spatial_forecast(
    supabase: Client,
    user_id: str,
    bbox: tuple,
    timestamp: str | None,
    interval: int,
) -> ForecastResponse:
    """Drive the spatiotemporal 30-min forecasting engine for a bounding box.

    Returns GeoTIFF URLs (one per horizon), wind GeoJSON and a full NetCDF.
    """
    await log_activity(
        supabase,
        user_id,
        "RUN_SPATIAL_FORECAST",
        {"bbox": list(bbox), "timestamp": timestamp, "interval_min": interval},
    )

    try:
        data = await asyncio.to_thread(
            _run_spatial_forecast,
            bbox,
            timestamp,
            interval,
            settings.EE_PROJECT,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Spatial forecast failed: {exc}")

    frames = [
        ForecastFrame(
            horizon_min=f["horizon_min"],
            geotiff_url=_path_to_url(f["tif_abs"]),
            confidence_mean=round(f["confidence_mean"], 3),
            mass_error=round(f["mass_error"], 5),
        )
        for f in data["frames"]
    ]

    return ForecastResponse(
        bbox=list(bbox),
        timestamp=data["timestamp"],
        interval_min=interval,
        frames=frames,
        wind_geojson_url=_path_to_url(data["wind_geojson"]),
        netcdf_url=_path_to_url(data["netcdf"]),
        units="ug m-3",
        physics_only=True,
    )
