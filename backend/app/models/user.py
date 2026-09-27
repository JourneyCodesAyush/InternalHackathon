from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    email: str
    password: str


class UserProfile(BaseModel):
    id: str
    email: str
    role: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    user: UserProfile
