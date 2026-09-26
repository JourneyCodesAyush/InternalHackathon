import io
from datetime import datetime, timezone

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from supabase import Client

from app.services.activity_service import log_activity

# Fake NO₂ readings used to populate the report table
_FAKE_READINGS = [
    ("2024-01-15", "08:00", "112.4", "Moderate"),
    ("2024-01-15", "14:00", "148.7", "High"),
    ("2024-01-15", "20:00", "98.2", "Moderate"),
    ("2024-01-16", "08:00", "87.5", "Moderate"),
    ("2024-01-16", "14:00", "163.1", "Very High"),
    ("2024-01-16", "20:00", "75.3", "Low"),
    ("2024-01-17", "08:00", "101.8", "Moderate"),
    ("2024-01-17", "14:00", "134.2", "High"),
    ("2024-01-17", "20:00", "88.9", "Moderate"),
]


def _build_pdf(region_name: str, bbox: str, start_date: str, end_date: str) -> bytes:
    """
    Build a PDF report in memory using ReportLab and return raw bytes.

    Args:
        region_name: Human-readable name of the analysed region.
        bbox: Bounding box string (stored as metadata in the report).
        start_date: ISO date string for the start of the analysis window.
        end_date: ISO date string for the end of the analysis window.

    Returns:
        PDF content as a bytes object.
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=2 * cm, bottomMargin=2 * cm)
    styles = getSampleStyleSheet()
    story = []

    # Title
    title_style = styles["Title"]
    story.append(Paragraph("Air Quality Analysis Report", title_style))
    story.append(Spacer(1, 0.5 * cm))

    # Metadata section
    meta_style = styles["Normal"]
    story.append(Paragraph(f"<b>Region:</b> {region_name}", meta_style))
    story.append(Paragraph(f"<b>Bounding Box:</b> {bbox}", meta_style))
    story.append(Paragraph(f"<b>Period:</b> {start_date} to {end_date}", meta_style))
    story.append(
        Paragraph(
            f"<b>Generated:</b> {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
            meta_style,
        )
    )
    story.append(Spacer(1, 0.8 * cm))

    # NO₂ readings table
    story.append(Paragraph("NO\u2082 Concentration Readings (\u00b5g/m\u00b3)", styles["Heading2"]))
    story.append(Spacer(1, 0.3 * cm))

    table_data = [["Date", "Time (UTC)", "NO\u2082 (\u00b5g/m\u00b3)", "Risk Level"]]
    table_data.extend(list(row) for row in _FAKE_READINGS)

    no2_table = Table(table_data, colWidths=[4 * cm, 4 * cm, 5 * cm, 4 * cm])
    no2_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a73e8")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, 0), 11),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.whitesmoke, colors.white]),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("FONTSIZE", (0, 1), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(no2_table)
    story.append(Spacer(1, 0.8 * cm))

    # Health risk summary
    story.append(Paragraph("Health Risk Summary", styles["Heading2"]))
    story.append(Spacer(1, 0.3 * cm))
    summary_text = (
        "Analysis of the selected region indicates elevated NO\u2082 levels during afternoon "
        "hours, consistent with peak vehicular and industrial activity. "
        "Concentrations exceeding 140\u00a0\u00b5g/m\u00b3 were recorded on multiple occasions, "
        "posing a <b>High</b> health risk to sensitive populations including children, "
        "the elderly, and individuals with respiratory conditions. "
        "It is recommended to limit outdoor activity during 12:00\u201318:00 local time and to "
        "consider policy interventions targeting traffic density and industrial emissions during "
        "peak hours."
    )
    story.append(Paragraph(summary_text, meta_style))

    doc.build(story)
    return buffer.getvalue()


async def generate_report(
    supabase: Client,
    user_id: str,
    region_name: str,
    bbox: str,
    start_date: str,
    end_date: str,
) -> StreamingResponse:
    """
    Generate a PDF air quality report and return it as a streaming response.

    Args:
        supabase: Active Supabase client.
        user_id: UUID of the requesting user.
        region_name: Display name for the analysed region.
        bbox: Bounding box string.
        start_date: Report start date.
        end_date: Report end date.

    Returns:
        A StreamingResponse delivering the PDF bytes.

    Raises:
        HTTPException(500): If PDF generation fails unexpectedly.
    """
    try:
        pdf_bytes = _build_pdf(region_name, bbox, start_date, end_date)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to generate report") from exc

    await log_activity(
        supabase,
        user_id,
        "EXPORT_REPORT",
        {"region_name": region_name, "bbox": bbox, "start_date": start_date, "end_date": end_date},
    )

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="report.pdf"'},
    )
