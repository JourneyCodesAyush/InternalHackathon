from fastapi import APIRouter
from app.services.drone_service import check_msp_connection, get_cloud_covered_zones

router = APIRouter(prefix="/drone", tags=["drone"])

@router.get("/status")
def get_drone_status():
    """
    Check if the SpeedyBee FC is connected over USB.
    """
    connected = check_msp_connection()
    return {"connected": connected}

@router.get("/cloud_zones")
def get_cloud_zones():
    """
    Get cloud-covered zones pulled from satellite data/coarse GeoTIFFs.
    """
    zones = get_cloud_covered_zones()
    return {"zones": zones}

@router.get("/target")
def get_target():
    """
    Get the nearest primary cloud-occluded target coordinate for the simulation.
    """
    zones = get_cloud_covered_zones()
    if zones:
        return {"lat": zones[0]["lat"], "lon": zones[0]["lng"]}
    return {"lat": 19.0760, "lon": 72.8777}

