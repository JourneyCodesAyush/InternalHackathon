from fastapi import APIRouter

from app.api.v1.auth.router import router as auth_router
from app.api.v1.downscale.router import router as downscale_router
from app.api.v1.trends.router import router as trends_router
from app.api.v1.analyze.router import router as analyze_router
from app.api.v1.reports.router import router as reports_router
from app.api.v1.admin.router import router as admin_router

v1_router = APIRouter()

v1_router.include_router(auth_router, prefix="/auth")
v1_router.include_router(downscale_router, prefix="/downscale")
v1_router.include_router(trends_router, prefix="/trends")
v1_router.include_router(analyze_router, prefix="/analyze")
v1_router.include_router(reports_router, prefix="/reports")
v1_router.include_router(admin_router, prefix="/admin")
