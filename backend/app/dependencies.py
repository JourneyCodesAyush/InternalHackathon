from fastapi import Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordBearer

from app.core.config import get_supabase, settings
from app.core.security import decode_supabase_jwt

# auto_error=False so a missing token can fall through to local demo mode; otherwise it is still a 401.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)

LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost"}
DEMO_USER = {
    "id": "local-demo",
    "email": "demo@localhost",
    "full_name": "Local demo user",
    "role": "NORMAL_USER",  # never admin: admin endpoints stay protected
    "is_blocked": False,
    "created_at": None,
}


async def get_current_user(request: Request, token: str | None = Depends(oauth2_scheme)) -> dict:
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

    Local demo mode: when ``LOCAL_DEMO_MODE=true`` is set in backend/.env, a request WITHOUT a token that
    comes from this machine (localhost) is treated as a normal (non-admin) demo user, so the web app can
    be tried without Supabase login. Off by default; requests from other machines always need a token.
    """
    if not token:
        client_host = request.client.host if request.client else ""
        if settings.LOCAL_DEMO_MODE and client_host in LOCAL_HOSTS:
            return DEMO_USER
        raise HTTPException(status_code=401, detail="Not authenticated", headers={"WWW-Authenticate": "Bearer"})

    client_host = request.client.host if request.client else ""
    try:
        payload = decode_supabase_jwt(token)
        user_id: str = payload.get("sub", "")
    except Exception:
        if settings.LOCAL_DEMO_MODE and client_host in LOCAL_HOSTS:
            return DEMO_USER
        raise HTTPException(status_code=401, detail="Invalid token")

    if not user_id:
        if settings.LOCAL_DEMO_MODE and client_host in LOCAL_HOSTS:
            return DEMO_USER
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
