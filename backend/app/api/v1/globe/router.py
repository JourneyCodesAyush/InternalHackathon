from fastapi import APIRouter, Depends, Query

from app.dependencies import get_current_user
from app.services import globe_service

router = APIRouter()


@router.get(
    "/no2",
    summary="Latest global Sentinel-5P NO2 and wind for the 3-D globe",
    tags=["globe"],
)
async def get_global_no2(
    hours: int = Query(24, ge=3, le=72, description="Look-back window for the latest-observation mosaic"),
    current_user: dict = Depends(get_current_user),
) -> dict:
    """
    Global 0.5° grid (720 × 360) of the most recent cloud-free Sentinel-5P NRTI tropospheric NO₂ column
    per cell within ``hours``, with each cell's observation age and the latest NOAA GFS 10 m wind.

    Sentinel-5P covers the sunlit globe once a day and near-real-time data arrives ~3 h after sensing, so
    the newest cells are typically 3-5 h old. Refreshed at most every 20 minutes; if Earth Engine is
    unavailable the last snapshot is returned with ``stale: true``.
    """
    return await globe_service.get_global_no2(hours)


@router.get(
    "/transboundary-flux",
    summary="Transboundary atmospheric NO2 flux and regional source attribution",
    tags=["globe"],
)
async def get_transboundary_flux(
    hours: int = Query(24, ge=3, le=72, description="Look-back window for snapshot"),
    region: str = Query("delhi", description="Target region for attribution, e.g. 'delhi'"),
    current_user: dict = Depends(get_current_user),
) -> dict:
    """
    Computes cross-border atmospheric NO₂ transport fluxes across state and international boundaries
    (e.g., Punjab (PK) -> Punjab (IN), Haryana -> Delhi, UP -> Delhi).

    Returns:
    - Summary headline ("38% of Delhi's NO₂ today arrived from outside the city.")
    - Inflow, outflow, and net transport rates in metric tonnes/day
    - Source jurisdiction breakdown table for CAQM, state boards, and courts
    - Vector arrows for 3D globe and 2D map visualization
    """
    return await globe_service.get_transboundary_flux(hours=hours, region=region)

