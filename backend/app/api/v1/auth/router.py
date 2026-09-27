from fastapi import APIRouter

from app.core.config import get_supabase
from app.models.user import LoginRequest, LoginResponse
from app.services import auth_service

router = APIRouter()


@router.post(
    "/login",
    response_model=LoginResponse,
    summary="Login with email and password",
    tags=["auth"],
)
async def login(body: LoginRequest) -> LoginResponse:
    """
    Authenticate a user with their email and password via Supabase Auth.

    Returns a bearer access token and basic user profile information.
    Logs a LOGIN activity entry on success.
    """
    supabase = get_supabase()
    return await auth_service.login(supabase, body.email, body.password)
