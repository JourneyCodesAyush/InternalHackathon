from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import v1_router

app = FastAPI(
    title="Air Quality Downscaling & Analysis API",
    description=(
        "Backend API for the AI/ML Satellite-Based Air Quality Downscaling & Analysis System. "
        "Provides endpoints for map downscaling, trend prediction, source attribution, "
        "PDF report generation, and administrative user management."
    ),
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# Allow all origins for development — tighten to specific domains in production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(v1_router, prefix="/api/v1")


@app.get("/health", summary="Health check", tags=["system"])
async def health_check() -> dict:
    """Return a simple status payload to confirm the API is running."""
    return {"status": "ok"}
