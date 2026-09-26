from fastapi import HTTPException
from supabase import Client

from app.models.analyze import PinpointResponse, PollutionSource
from app.services.activity_service import log_activity


async def pinpoint_sources(
    supabase: Client,
    user_id: str,
    lat: float,
    lon: float,
    radius_km: float,
) -> PinpointResponse:
    """
    Identify the top pollution sources near a given coordinate.

    Currently fetches all pollution_sources rows from Supabase and returns the
    top 3 with stubbed attribution weights and distances.

    Args:
        supabase: Active Supabase client.
        user_id: UUID of the requesting user.
        lat: Latitude of the point of interest.
        lon: Longitude of the point of interest.
        radius_km: Search radius in kilometres (stored but not yet used for filtering).

    Returns:
        A PinpointResponse with top sources and a human-readable summary.
    """
    try:
        response = supabase.table("pollution_sources").select("name, category").execute()
        rows = response.data or []
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to query pollution sources")

    # TODO: replace with real PostGIS ST_DWithin query

    # Stub: assign realistic fake attribution weights and distances to top 3
    stub_weights = [0.65, 0.25, 0.10]
    stub_distances = [1.2, 2.8, 4.1]
    category_defaults = [
        {"name": "Mumbai Industrial Cluster", "category": "FACTORY"},
        {"name": "Western Express Highway", "category": "TRAFFIC_CORRIDOR"},
        {"name": "Trombay Power Station", "category": "POWER_PLANT"},
    ]

    top_rows = rows[:3] if len(rows) >= 3 else rows
    # Pad with defaults if database has fewer than 3 rows
    while len(top_rows) < 3:
        top_rows.append(category_defaults[len(top_rows)])

    sources = [
        PollutionSource(
            name=row.get("name", category_defaults[idx]["name"]),
            category=row.get("category", category_defaults[idx]["category"]),
            attribution_weight=stub_weights[idx],
            distance_km=stub_distances[idx],
        )
        for idx, row in enumerate(top_rows[:3])
    ]

    await log_activity(
        supabase,
        user_id,
        "ANALYZE_PINPOINT",
        {"lat": lat, "lon": lon, "radius_km": radius_km},
    )

    return PinpointResponse(
        location={"lat": lat, "lon": lon},
        radius_km=radius_km,
        sources=sources,
        summary=(
            "Elevated NO\u2082 attributed 65% to vehicular emissions "
            "and 35% to industrial activity."
        ),
    )
