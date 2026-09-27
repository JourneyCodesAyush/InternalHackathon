from datetime import datetime, timezone
from typing import List

from fastapi import HTTPException, UploadFile
from supabase import Client

from app.models.admin import BlockUserResponse, UploadResponse, UserListItem
from app.services.activity_service import log_activity

_ALLOWED_EXTENSIONS = {".nc", ".tif", ".csv", ".geojson"}


async def list_users(supabase: Client) -> List[UserListItem]:
    """
    Retrieve all user profiles from the profiles table.

    Args:
        supabase: Active Supabase client.

    Returns:
        A list of UserListItem objects.

    Raises:
        HTTPException(500): If the database query fails.
    """
    try:
        response = (
            supabase.table("profiles")
            .select("id, email, full_name, role, is_blocked, created_at")
            .execute()
        )
        rows = response.data or []
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to retrieve users")

    return [
        UserListItem(
            id=str(row.get("id", "")),
            email=row.get("email", ""),
            full_name=row.get("full_name", ""),
            role=row.get("role", "NORMAL_USER"),
            is_blocked=bool(row.get("is_blocked", False)),
            created_at=str(row.get("created_at", "")),
        )
        for row in rows
    ]


async def block_user(
    supabase: Client,
    admin_user_id: str,
    target_user_id: str,
    block: bool,
) -> BlockUserResponse:
    """
    Set the is_blocked flag on a target user's profile.

    Args:
        supabase: Active Supabase client.
        admin_user_id: UUID of the admin performing the action.
        target_user_id: UUID of the user to block or unblock.
        block: True to block, False to unblock.

    Returns:
        A BlockUserResponse indicating success.

    Raises:
        HTTPException(404): If the target user does not exist.
        HTTPException(500): If the update fails.
    """
    # Verify the target user exists
    try:
        check = (
            supabase.table("profiles").select("id").eq("id", target_user_id).single().execute()
        )
        if not check.data:
            raise HTTPException(status_code=404, detail="User not found")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=404, detail="User not found")

    try:
        supabase.table("profiles").update({"is_blocked": block}).eq("id", target_user_id).execute()
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to update user status")

    action = "BLOCK_USER" if block else "UNBLOCK_USER"
    await log_activity(supabase, admin_user_id, action, {"target_user_id": target_user_id})

    return BlockUserResponse(success=True, user_id=target_user_id, is_blocked=block)


async def upload_dataset(
    supabase: Client,
    admin_user_id: str,
    file: UploadFile,
    dataset_type: str,
) -> UploadResponse:
    """
    Validate, upload a dataset file to Supabase Storage, and catalog it.

    Allowed extensions: .nc, .tif, .csv, .geojson.

    Args:
        supabase: Active Supabase client.
        admin_user_id: UUID of the admin uploading the file.
        file: The uploaded file object.
        dataset_type: One of 'satellite', 'ground_station', or 'poi'.

    Returns:
        An UploadResponse with storage path details.

    Raises:
        HTTPException(400): If the file extension is not allowed.
        HTTPException(500): If the upload or catalog insert fails.
    """
    filename = file.filename or "unknown"
    extension = ""
    if "." in filename:
        extension = "." + filename.rsplit(".", 1)[-1].lower()

    if extension not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File type '{extension}' is not allowed. Accepted: {', '.join(_ALLOWED_EXTENSIONS)}",
        )

    file_content = await file.read()
    storage_path = f"{dataset_type}/{filename}"

    try:
        supabase.storage.from_("datasets").upload(
            path=storage_path,
            file=file_content,
            file_options={"content-type": file.content_type or "application/octet-stream"},
        )
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to upload file to storage")

    try:
        supabase.table("raster_catalog").insert(
            {
                "title": filename,
                "resolution_type": "COARSE",
                "storage_path": storage_path,
                "uploaded_by": admin_user_id,
                "observation_date": datetime.now(timezone.utc).isoformat(),
            }
        ).execute()
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to catalog uploaded dataset")

    await log_activity(
        supabase,
        admin_user_id,
        "UPLOAD_DATASET",
        {"filename": filename, "dataset_type": dataset_type, "storage_path": storage_path},
    )

    return UploadResponse(
        success=True,
        filename=filename,
        storage_path=storage_path,
        dataset_type=dataset_type,
    )
