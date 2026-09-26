from fastapi import HTTPException
from supabase import Client

from app.models.user import LoginResponse, UserProfile
from app.services.activity_service import log_activity


async def login(supabase: Client, email: str, password: str) -> LoginResponse:
    """
    Authenticate a user via Supabase Auth and return tokens + profile.

    Args:
        supabase: Active Supabase client.
        email: The user's email address.
        password: The user's plain-text password.

    Returns:
        A LoginResponse containing the access token and user profile.

    Raises:
        HTTPException(401): If Supabase rejects the credentials.
        HTTPException(500): If an unexpected error occurs.
    """
    try:
        auth_response = supabase.auth.sign_in_with_password(
            {"email": email, "password": password}
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if auth_response is None or auth_response.user is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user_id = str(auth_response.user.id)
    access_token = auth_response.session.access_token

    # Fetch role from profiles table
    try:
        profile_response = (
            supabase.table("profiles").select("id, email, role").eq("id", user_id).single().execute()
        )
        profile_data = profile_response.data
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to retrieve user profile")

    if not profile_data:
        raise HTTPException(status_code=401, detail="User profile not found")

    await log_activity(supabase, user_id, "LOGIN", {"email": email})

    return LoginResponse(
        access_token=access_token,
        token_type="bearer",
        user=UserProfile(
            id=user_id,
            email=profile_data["email"],
            role=profile_data["role"],
        ),
    )
