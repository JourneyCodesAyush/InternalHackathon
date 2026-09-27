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
    Generate and stream a PDF report for the specified region and date range.

    The PDF includes:
    - Region metadata and bounding box
    - A table of NO₂ concentration readings
    - A health risk summary section

    Returns the PDF as a downloadable attachment.
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
    )
