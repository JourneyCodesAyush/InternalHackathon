from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.core.config import get_supabase
from app.dependencies import get_current_user
from app.models.reports import ReportRequest
from app.services import reports_service

router = APIRouter()


@router.post(
    "/generate",
    summary="Generate a PDF air quality report",
    tags=["reports"],
    response_class=StreamingResponse,
)
async def generate_report(
    body: ReportRequest,
    current_user: dict = Depends(get_current_user),
) -> StreamingResponse:
    """
    Generate and stream a PDF NO₂ report for an area (English, Hindi or Marathi).

    The PDF compares the area's ground-level NO₂ on ``end_date`` with the CPCB NAAQS and WHO standards
    and includes the map and hotspots, population exposure, forecast alerts, the weather-adjusted trend,
    risk context and recommendations. The first report for an area/date takes ~1-3 minutes.

    Response headers: ``X-Report-Status`` (normal/elevated/critical/critical_spike),
    ``X-Report-Narrative`` (ai/template), ``X-Report-Language``.
    """
    supabase = get_supabase()
    user_id = str(current_user["id"])
    return await reports_service.generate_report(
        supabase,
        user_id,
        body.region_name,
        body.bbox,
        body.start_date,
        body.end_date,
        language=body.language,
        use_ai=body.use_ai,
        city=body.city,
    )
