from pydantic import BaseModel


class UserListItem(BaseModel):
    id: str
    email: str
    full_name: str
    role: str
    is_blocked: bool
    created_at: str


class BlockUserRequest(BaseModel):
    user_id: str
    block: bool


class BlockUserResponse(BaseModel):
    success: bool
    user_id: str
    is_blocked: bool


class UploadResponse(BaseModel):
    success: bool
    filename: str
    storage_path: str
    dataset_type: str
