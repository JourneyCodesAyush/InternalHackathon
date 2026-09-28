import asyncio
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
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




@router.post("/haze", summary="Analyse a drone camera frame with the Dark Channel Prior and store the reading")
async def post_haze(
    image: UploadFile | None = File(None, description="JPEG/PNG camera frame (preferred: analysed server-side)"),
    haze_index: float | None = Form(None, description="Client-side haze index when no frame is sent"),
    lat: float | None = Form(None),
    lon: float | None = Form(None),
):
    """
    Runs OpenCV DCP (dark channel, atmospheric light, guided-filter transmission) on the frame and stores the
    reading with its position; reports use the readings of the last 72 hours. Without a frame, a client-side
    haze index is stored as is.
    """
    import asyncio

    from ml_engine.report import haze

    if image is not None:
        try:
            reading = await asyncio.to_thread(haze.analyse_frame, await image.read())
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        source = "drone camera (server DCP)"
    elif haze_index is not None:
        idx = max(0.0, min(1.0, haze_index))
        reading = {"haze_index": round(idx, 3), "class": haze.haze_class(idx), "transmission_mean": round(1 - idx, 3),
                   "hazy_share": None, "method": "Dark Channel Prior (client estimate)"}
        source = "drone camera (client DCP)"
    else:
        raise HTTPException(status_code=422, detail="Send an image or a haze_index")
    return haze.record_reading(reading, lat=lat, lon=lon, source=source)


@router.get("/haze", summary="Recent haze readings and their summary")
def get_haze(hours: float = 72.0):
    from ml_engine.report import haze

    return {"summary": haze.summary(hours), "readings": haze.recent_readings(hours)[-50:]}
