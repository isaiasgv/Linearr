"""assignments toolset — which Plex items belong to which channel."""
from fastapi import HTTPException

from .registry import tool_error


def register(reg, api):

    @reg.tool(name="list_assignments", toolset="assignments", read_only=True)
    async def list_assignments(channel_number: int | None = None) -> dict:
        """List content assignments — all channels, or one channel if channel_number given."""
        with api.get_db() as conn:
            if channel_number is not None:
                rows = conn.execute(
                    "SELECT id, channel_number, plex_rating_key, plex_title, plex_type, plex_year "
                    "FROM assignments WHERE channel_number=? ORDER BY plex_title",
                    (channel_number,)).fetchall()
            else:
                rows = conn.execute(
                    "SELECT id, channel_number, plex_rating_key, plex_title, plex_type, plex_year "
                    "FROM assignments ORDER BY channel_number, plex_title").fetchall()
        grouped: dict[str, list] = {}
        for r in rows:
            grouped.setdefault(str(r["channel_number"]), []).append(
                {k: r[k] for k in ("id", "plex_rating_key", "plex_title", "plex_type", "plex_year")})
        return {"channels": grouped, "total": len(rows)}

    @reg.tool(name="assign_items", toolset="assignments", open_world=True)
    async def assign_items(channel_number: int, rating_keys: list[str]) -> dict:
        """Assign Plex items (movies/shows) to a channel by rating key. Fetches each
        item's metadata from Plex; duplicates are skipped, not errors."""
        if not api._get_channel(channel_number):
            raise RuntimeError(f"Channel {channel_number} not found")
        items, failed = [], []
        for rk in rating_keys:
            try:
                it = await api.plex_item(rk)
                items.append(api.BulkAssignmentItem(
                    plex_rating_key=str(it["rating_key"]),
                    plex_title=it.get("title") or rk, plex_type=it.get("type") or "movie",
                    plex_thumb=it.get("thumb"), plex_year=it.get("year")))
            except HTTPException as e:
                failed.append({"rating_key": rk, "error": str(e.detail)})
        if not items and failed:
            raise RuntimeError(f"No items could be fetched from Plex: {failed}")
        try:
            result = api.bulk_assignments(api.BulkAssignmentIn(
                channel_number=channel_number, items=items))
        except HTTPException as e:
            raise tool_error(e)
        return {"added": result["added"], "skipped_duplicates": result["skipped"],
                "failed": failed}

    @reg.tool(name="unassign_item", toolset="assignments",
              destructive=True, idempotent=True)
    async def unassign_item(channel_number: int, rating_key: str) -> dict:
        """Remove one assigned item from a channel (by Plex rating key)."""
        with api.get_db() as conn:
            row = conn.execute(
                "SELECT id FROM assignments WHERE channel_number=? AND plex_rating_key=?",
                (channel_number, rating_key)).fetchone()
        if not row:
            raise RuntimeError(
                f"Nothing assigned with rating key {rating_key} on channel {channel_number}")
        try:
            api.delete_assignment(row["id"])
        except HTTPException as e:
            raise tool_error(e)
        return {"ok": True, "removed": 1}

    @reg.tool(name="purge_channel_content", toolset="assignments",
              destructive=True, idempotent=True)
    async def purge_channel_content(channel_number: int, content_type: str = "both") -> dict:
        """Bulk-remove a channel's assigned content. DESTRUCTIVE. content_type:
        'movies' removes all movies, 'shows' removes all shows, 'both' clears
        everything assigned to the channel. Returns how many items were removed."""
        try:
            return api.purge_channel_assignments(channel_number, content_type=content_type)
        except HTTPException as e:
            raise tool_error(e)
