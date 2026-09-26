from fastapi import HTTPException
from jose import jwt, JWTError

from app.core.config import settings


def decode_supabase_jwt(token: str) -> dict:
    """
    Decode and validate a Supabase-issued JWT.

    Args:
        token: The raw JWT string from the Authorization header.

    Returns:
        The decoded payload as a dictionary.

    Raises:
        HTTPException(401): If the token is missing, expired, or invalid for any reason.
    """
    try:
        payload = jwt.decode(
            token,
            settings.SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            options={"verify_aud": False},
        )
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
