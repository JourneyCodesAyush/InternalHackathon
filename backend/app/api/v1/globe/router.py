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
