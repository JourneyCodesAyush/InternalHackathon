from pydantic_settings import BaseSettings
from supabase import create_client, Client


class Settings(BaseSettings):
    SUPABASE_URL: str
    SUPABASE_KEY: str
    SUPABASE_JWT_SECRET: str

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()  # type: ignore[call-arg]
# Will raise a ValidationError with a clear message if any required env var is missing.


def get_supabase() -> Client:
    """Instantiate and return a Supabase client using settings credentials."""
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
