from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer

from app.core.config import get_supabase
from app.core.security import decode_supabase_jwt

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    """
    Resolve the current authenticated user from a Bearer JWT.

    Decodes the JWT, fetches the matching profile from Supabase, and validates
    that the account is not blocked.

    Args:
        token: The raw JWT extracted from the Authorization header.

    Returns:
        The user's profile row as a dict.

    Raises:
        HTTPException(401): If the token is invalid or the user is not found.
        HTTPException(403): If the account is blocked.
    """
    payload = decode_supabase_jwt(token)
    user_id: str = payload.get("sub", "")

    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token: missing subject")

    supabase = get_supabase()

    try:
        response = (
            supabase.table("profiles")
            .select("id, email, full_name, role, is_blocked, created_at")
            .eq("id", user_id)
            .single()
            .execute()
        )
        profile = response.data
    except Exception:
        raise HTTPException(status_code=401, detail="User not found")

    if not profile:
        raise HTTPException(status_code=401, detail="User not found")

    if profile.get("is_blocked", False):
        raise HTTPException(status_code=403, detail="Account is blocked")

    return profile


async def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """
    Enforce that the requesting user has the ADMIN role.

    Args:
        current_user: The resolved user profile dict from get_current_user.

    Returns:
        The same current_user dict if the role check passes.

    Raises:
        HTTPException(403): If the user does not have the ADMIN role.
    """
    if current_user.get("role") != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user
