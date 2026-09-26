import io
import pytest
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# GET /api/v1/admin/users — happy path (admin)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_users_success(admin_client):
    """Admin can retrieve all users."""
    mock_supabase = MagicMock()
    mock_supabase.table.return_value.select.return_value.execute.return_value.data = [
        {
            "id": "user-uuid-1",
            "email": "alice@example.com",
            "full_name": "Alice Smith",
            "role": "NORMAL_USER",
            "is_blocked": False,
            "created_at": "2024-01-01T00:00:00+00:00",
        },
        {
            "id": "user-uuid-2",
            "email": "bob@example.com",
            "full_name": "Bob Jones",
            "role": "ADMIN",
            "is_blocked": False,
            "created_at": "2024-01-02T00:00:00+00:00",
        },
    ]

    with patch("app.api.v1.admin.router.get_supabase", return_value=mock_supabase):
        response = await admin_client.get("/api/v1/admin/users")

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 2
    assert data[0]["email"] == "alice@example.com"
    assert "role" in data[0]
    assert "is_blocked" in data[0]


# ---------------------------------------------------------------------------
# GET /api/v1/admin/users — unauthenticated → 401
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_users_unauthenticated(client):
    """Unauthenticated request to admin endpoint returns 401."""
    response = await client.get("/api/v1/admin/users")
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/v1/admin/users — normal user (non-admin) → 403
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_users_forbidden_for_normal_user(auth_client):
    """Non-admin authenticated user receives 403."""
    response = await auth_client.get("/api/v1/admin/users")
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# POST /api/v1/admin/users/block — happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_block_user_success(admin_client):
    """Admin can block a user by their UUID."""
    mock_supabase = MagicMock()
    # Simulate user found
    (
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data
    ) = {"id": "target-user-uuid"}
    mock_supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock()

    with patch("app.services.activity_service.log_activity"):
        with patch("app.api.v1.admin.router.get_supabase", return_value=mock_supabase):
            response = await admin_client.post(
                "/api/v1/admin/users/block",
                json={"user_id": "target-user-uuid", "block": True},
            )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["user_id"] == "target-user-uuid"
    assert data["is_blocked"] is True


# ---------------------------------------------------------------------------
# POST /api/v1/admin/users/block — non-admin → 403
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_block_user_forbidden(auth_client):
    """Non-admin user cannot block accounts."""
    response = await auth_client.post(
        "/api/v1/admin/users/block",
        json={"user_id": "some-uuid", "block": True},
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# POST /api/v1/admin/users/block — missing body fields → 422
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_block_user_missing_fields(admin_client):
    """Block request missing 'block' field returns 422."""
    response = await admin_client.post(
        "/api/v1/admin/users/block",
        json={"user_id": "some-uuid"},
    )
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# POST /api/v1/admin/data/upload — happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upload_dataset_success(admin_client):
    """Admin can upload a .tif file which is stored and catalogued."""
    mock_supabase = MagicMock()
    mock_supabase.storage.from_.return_value.upload.return_value = MagicMock()
    mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()

    file_content = b"FAKE_TIFF_CONTENT"

    with patch("app.services.activity_service.log_activity"):
        with patch("app.api.v1.admin.router.get_supabase", return_value=mock_supabase):
            response = await admin_client.post(
                "/api/v1/admin/data/upload",
                files={"file": ("observation.tif", io.BytesIO(file_content), "image/tiff")},
                data={"dataset_type": "satellite"},
            )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["filename"] == "observation.tif"
    assert data["dataset_type"] == "satellite"
    assert "observation.tif" in data["storage_path"]


# ---------------------------------------------------------------------------
# POST /api/v1/admin/data/upload — invalid file extension → 400
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upload_dataset_invalid_extension(admin_client):
    """Uploading a .exe file returns 400."""
    mock_supabase = MagicMock()

    with patch("app.api.v1.admin.router.get_supabase", return_value=mock_supabase):
        response = await admin_client.post(
            "/api/v1/admin/data/upload",
            files={"file": ("malware.exe", io.BytesIO(b"bad"), "application/octet-stream")},
            data={"dataset_type": "satellite"},
        )

    assert response.status_code == 400
    assert "not allowed" in response.json()["detail"].lower()


# ---------------------------------------------------------------------------
# POST /api/v1/admin/data/upload — unauthenticated → 401
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upload_dataset_unauthenticated(client):
    """Unauthenticated upload returns 401."""
    response = await client.post(
        "/api/v1/admin/data/upload",
        files={"file": ("data.csv", io.BytesIO(b"col1,col2"), "text/csv")},
        data={"dataset_type": "ground_station"},
    )
    assert response.status_code == 401
