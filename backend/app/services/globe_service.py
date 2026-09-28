import asyncio
import base64

import numpy as np
from fastapi import HTTPException

from ml_engine.globe import global_no2

INT16_NODATA = -32768


def _int16(values: np.ndarray, scale: float) -> str:
    """Base64 little-endian int16 of ``values / scale`` (NaN -> -32768): 2 bytes per cell."""
    q = np.where(np.isfinite(values), np.clip(np.round(values / scale), -32767, 32767), INT16_NODATA)
    return base64.b64encode(q.astype("<i2").tobytes()).decode("ascii")


async def get_global_no2(hours: int = 24) -> dict:
    """
    Latest global Sentinel-5P NO2 mosaic and GFS wind for the globe page, as quantised int16 grids
    (north-up rows from 90°N, columns from 180°W). Decode: ``value = int16 * scale``; ``-32768`` = no data.
    """
    try:
        snap = await asyncio.to_thread(global_no2, hours)
    except Exception as exc:  # no snapshot yet and Earth Engine unavailable
        raise HTTPException(status_code=503, detail=f"Global NO2 data unavailable: {exc}") from exc
    return {
        **snap["meta"],
        "nodata": INT16_NODATA,
        "fields": {
            "no2": {"scale": 0.01, "data": _int16(snap["no2"], 0.01)},  # µmol/m²
            "age_h": {"scale": 0.01, "data": _int16(snap["age_h"], 0.01)},  # hours before fetched_at
            "u": {"scale": 0.01, "data": _int16(snap["u"], 0.01)},  # m/s, eastward
            "v": {"scale": 0.01, "data": _int16(snap["v"], 0.01)},  # m/s, northward
        },
    }


async def get_transboundary_flux(hours: int = 24, region: str = "delhi") -> dict:
    """Calculate cross-border NO2 mass transport fluxes and regional attribution."""
    from ml_engine.transboundary import calculate_transboundary_flux

    try:
        snap = await asyncio.to_thread(global_no2, hours)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Global NO2 data unavailable: {exc}") from exc
    return calculate_transboundary_flux(snap["no2"], snap["u"], snap["v"], snap["meta"], target_region=region)

