from datetime import datetime, timezone


async def log_activity(
    supabase_client,
    user_id: str,
    action: str,
    details: dict = {},
) -> None:
    """
    Insert a row into the user_activity_logs table.

    This function is intentionally fault-tolerant: any error during the insert
    is caught and printed so that a logging failure never disrupts the main
    request lifecycle.

    Args:
        supabase_client: An active Supabase client instance.
        user_id: The UUID of the user performing the action.
        action: A short string identifying the action (e.g. 'LOGIN').
        details: Optional arbitrary dict stored as JSONB on the row.
    """
    try:
        supabase_client.table("user_activity_logs").insert(
            {
                "user_id": user_id,
                "action": action,
                "details": details,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        ).execute()
    except Exception as exc:
        print(f"[activity_service] Failed to log activity '{action}' for user {user_id}: {exc}")
