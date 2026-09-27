from pydantic import BaseModel


class ReportRequest(BaseModel):
    region_name: str
    bbox: str
    start_date: str
    end_date: str
