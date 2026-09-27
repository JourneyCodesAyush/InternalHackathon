from typing import List

from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.core.config import get_supabase
from app.dependencies import require_admin
from app.models.admin import BlockUserRequest, BlockUserResponse, UploadResponse, UserListItem
from app.services import admin_service

router = APIRouter()


@router.get(
    "/users",
    response_model=List[UserListItem],
    summary="List all registered users",
    tags=["admin"],
)
async def list_users(
    current_user: dict = Depends(require_admin),
) -> List[UserListItem]:
    """
    Retrieve all user profiles. Restricted to ADMIN role.
    """
    supabase = get_supabase()
    return await admin_service.list_users(supabase)


@router.post(
    "/users/block",
    response_model=BlockUserResponse,
    summary="Block or unblock a user account",
    tags=["admin"],
)
async def block_user(
    body: BlockUserRequest,
    current_user: dict = Depends(require_admin),
) -> BlockUserResponse:
    """
    Set the blocked status of a target user. Restricted to ADMIN role.

    - **user_id**: UUID of the user to modify
    - **block**: True to block, False to unblock
    """
    supabase = get_supabase()
    admin_id = str(current_user["id"])
    return await admin_service.block_user(supabase, admin_id, body.user_id, body.block)


@router.post(
    "/data/upload",
    response_model=UploadResponse,
    summary="Upload a geospatial or sensor dataset",
    tags=["admin"],
)
async def upload_dataset(
    file: UploadFile = File(...),
    dataset_type: str = Form(...),
    current_user: dict = Depends(require_admin),
) -> UploadResponse:
    """
    Upload a dataset file to Supabase Storage and register it in raster_catalog.

    - **file**: The dataset file (.nc, .tif, .csv, or .geojson)
    - **dataset_type**: One of 'satellite', 'ground_station', or 'poi'
    """
    supabase = get_supabase()
    admin_id = str(current_user["id"])
    return await admin_service.upload_dataset(supabase, admin_id, file, dataset_type)
