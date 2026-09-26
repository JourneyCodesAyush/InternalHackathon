from typing import List
from supabase import Client

from app.models.downscale import DownscaleMapResponse
from app.services.activity_service import log_activity


async def get_downscaled_map(
    supabase: Client,
    user_id: str,
    bbox: str,
    timestamp: str,
) -> DownscaleMapResponse:
    """
    Return downscaled air quality map metadata for a given bounding box and timestamp.

    The bbox string is expected as comma-separated floats: "min_lon,min_lat,max_lon,max_lat".

    Args:
        supabase: Active Supabase client.
        user_id: UUID of the requesting user (for activity logging).
        bbox: Bounding box string e.g. "72.8,18.9,73.1,19.2".
        timestamp: ISO 8601 datetime string.

    Returns:
        A DownscaleMapResponse with stub map metadata.
    """
    parsed_bbox: List[float] = [float(v.strip()) for v in bbox.split(",")]

    await log_activity(
        supabase,
        user_id,
        "VIEW_DOWNSCALED_MAP",
        {"bbox": bbox, "timestamp": timestamp},
    )

    # TODO: integrate ML engine
    return DownscaleMapResponse(
        resolution="1km",
        bbox=parsed_bbox,
        timestamp=timestamp,
        grid_url="https://storage.example.com/downscaled/stub.tif",
        format="GeoTIFF",
    )
