import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.services.drone_service import (
    check_msp_connection,
    get_cloud_covered_zones,
    get_drone_attitude,
    calibrate_drone_acc,
    calibrate_drone_mag,
)

router = APIRouter(prefix="/drone", tags=["drone"])

@router.get("/status")
def get_drone_status():
    """
    Check if the SpeedyBee FC is connected over USB.
    """
    connected = check_msp_connection()
    return {"connected": connected}

@router.get("/attitude")
def get_attitude():
    """
    Get live gyro / accelerometer attitude (roll, pitch, yaw) and mag heading directly from the flight controller.
    """
    return get_drone_attitude()

@router.post("/calibrate_acc")
def calibrate_acc():
    """
    Trigger hardware accelerometer calibration on the flight controller.
    """
    success = calibrate_drone_acc()
    return {"success": success}

@router.post("/calibrate_mag")
def calibrate_mag():
    """
    Trigger hardware 3D magnetometer calibration on the flight controller.
    """
    success = calibrate_drone_mag()
    return {"success": success}

@router.websocket("/ws/attitude")
async def websocket_attitude(websocket: WebSocket):
    """
    High-frequency WebSocket stream for live FC gyro attitude (25Hz).
    """
    await websocket.accept()
    try:
        while True:
            attitude = get_drone_attitude()
            await websocket.send_json(attitude)
            await asyncio.sleep(0.04)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass

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


