import asyncio

from fastapi import HTTPException

from ml_engine.globe import global_no2, payload


async def get_global_no2(hours: int = 24) -> dict:
    """
    Latest global Sentinel-5P NO2 mosaic and GFS wind for the globe page, as quantised int16 grids
    (north-up rows from 90°N, columns from 180°W). Decode: ``value = int16 * scale``; ``-32768`` = no data.
    """
    try:
        snap = await asyncio.to_thread(global_no2, hours)
    except Exception as exc:  # no snapshot yet and Earth Engine unavailable
        raise HTTPException(status_code=503, detail=f"Global NO2 data unavailable: {exc}") from exc
    return payload(snap)
