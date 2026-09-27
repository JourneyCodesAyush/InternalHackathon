from pydantic_settings import BaseSettings
from supabase import create_client, Client


class Settings(BaseSettings):
    SUPABASE_URL: str
    SUPABASE_KEY: str
    SUPABASE_JWT_SECRET: str
    # ML engine: Google Cloud project registered for Earth Engine (maps are generated on demand).
    EE_PROJECT: str | None = None
    # Reports: optional Gemini key for the narrative sections (read by ml_engine.report from .env too).
    GEMINI_API_KEY: str | None = None
    # Local demo only: let requests from this machine use the app without logging in (never enable on a server).
    LOCAL_DEMO_MODE: bool = False

    # "ignore" lets backend/.env also hold variables used by other tools (e.g. OPENAQ_API_KEY).
    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()  # type: ignore[call-arg]
# Will raise a ValidationError with a clear message if any required env var is missing.


def get_supabase() -> Client:
    """Instantiate and return a Supabase client using settings credentials."""
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
