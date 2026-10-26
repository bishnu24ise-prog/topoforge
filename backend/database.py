"""
TopoForge — Database layer using Supabase (free tier PostgreSQL).
Stores: upload sessions, map metadata, view counts.
Uses supabase-py which talks to Supabase REST API — no raw SQL needed.
"""

import os
from datetime import datetime, timezone

try:
    from supabase import create_client, Client
    HAS_DB = True
except ImportError:
    HAS_DB = False

_client = None


def get_client() -> "Client | None":
    """Return a cached Supabase client, or None if not configured."""
    global _client
    if not HAS_DB:
        return None
    if _client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_ANON_KEY")
        if not url or not key:
            return None
        _client = create_client(url, key)
    return _client


# ─────────────────────────────────────────────
# Uploads table
# ─────────────────────────────────────────────

def save_upload(file_id: str, filename: str, file_type: str, has_bounds: bool, bounds: dict | None = None):
    """
    Record a new map upload.
    Table: uploads (file_id, filename, file_type, has_bounds, bounds_json, created_at, view_count)
    """
    db = get_client()
    if not db:
        return  # DB optional — app still works without it

    try:
        db.table("uploads").insert({
            "file_id": file_id,
            "filename": filename,
            "file_type": file_type,
            "has_bounds": has_bounds,
            "bounds_json": bounds,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "view_count": 0,
        }).execute()
    except Exception as e:
        print(f"[DB] save_upload failed (non-fatal): {e}")


def increment_view(file_id: str):
    """Increment the view count for a map session."""
    db = get_client()
    if not db:
        return
    try:
        db.rpc("increment_view_count", {"p_file_id": file_id}).execute()
    except Exception as e:
        print(f"[DB] increment_view failed (non-fatal): {e}")


def get_recent_uploads(limit: int = 10) -> list[dict]:
    """Fetch the most recently uploaded maps."""
    db = get_client()
    if not db:
        return []
    try:
        res = (
            db.table("uploads")
            .select("file_id, filename, file_type, has_bounds, created_at, view_count")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return res.data or []
    except Exception as e:
        print(f"[DB] get_recent_uploads failed (non-fatal): {e}")
        return []


# ─────────────────────────────────────────────
# Voice sessions table
# ─────────────────────────────────────────────

def save_voice_session(file_id: str, duration_seconds: int):
    """Record that a user started a voice tour and how long it lasted."""
    db = get_client()
    if not db:
        return
    try:
        db.table("voice_sessions").insert({
            "file_id": file_id,
            "duration_seconds": duration_seconds,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
    except Exception as e:
        print(f"[DB] save_voice_session failed (non-fatal): {e}")
