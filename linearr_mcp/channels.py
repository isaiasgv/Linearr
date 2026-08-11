"""channels toolset — the lineup itself."""
from fastapi import HTTPException

from ._request import json_request
from .registry import tool_error


def register(reg, api):

    @reg.tool(name="list_channels", toolset="channels", read_only=True)
    async def list_channels() -> list[dict]:
        """List all channels in the lineup (number, name, tier, vibe, mode, style, color)."""
        # Strip icon blobs (base64 PNGs) — pure noise for an LLM consumer.
        return [{k: v for k, v in ch.items() if k != "icon"} for ch in api.list_channels()]

    @reg.tool(name="get_channel", toolset="channels", read_only=True)
    async def get_channel(number: int) -> dict:
        """Get one channel plus everything assigned to it (titles, types, years)."""
        ch = api._get_channel(number)
        if not ch:
            raise RuntimeError(f"Channel {number} not found")
        ch.pop("icon", None)  # base64 blob — noise for an LLM
        with api.get_db() as conn:
            rows = conn.execute(
                "SELECT id, plex_rating_key, plex_title, plex_type, plex_year FROM assignments "
                "WHERE channel_number=? ORDER BY plex_title", (number,)).fetchall()
        ch["assignments"] = [dict(r) for r in rows]
        ch["assignment_count"] = len(ch["assignments"])
        return ch

    @reg.tool(name="create_channel", toolset="channels", open_world=True)
    async def create_channel(number: int, name: str, tier: str = "Galaxy Main",
                             vibe: str = "", mode: str = "Shuffle", style: str = "",
                             color: str = "blue") -> dict:
        """Create a channel. tier: 'Galaxy Main' | 'Classics' | 'Galaxy Premium'.
        mode: 'Shuffle' | 'Flex' | 'Sequential'. If Tunarr is configured, this also
        CREATES a matching Tunarr channel and links it (not just a sync)."""
        try:
            result = await api.create_channel(api.ChannelIn(
                number=number, name=name, tier=tier, vibe=vibe, mode=mode,
                style=style, color=color))
        except HTTPException as e:
            raise tool_error(e)
        result.pop("icon", None)
        return result

    @reg.tool(name="update_channel", toolset="channels",
              idempotent=True, open_world=True)
    async def update_channel(number: int, new_number: int | None = None,
                             name: str | None = None, tier: str | None = None,
                             vibe: str | None = None, mode: str | None = None,
                             style: str | None = None, color: str | None = None) -> dict:
        """Update a channel. Only the fields you pass change; pass new_number to renumber
        (assignments, blocks and links follow the channel). If Tunarr is configured
        and no link exists yet, a matching Tunarr channel may be created."""
        existing = api._get_channel(number)
        if not existing:
            raise RuntimeError(f"Channel {number} not found")
        body = api.ChannelIn(
            number=new_number if new_number is not None else number,
            name=name if name is not None else existing["name"],
            tier=tier if tier is not None else existing["tier"],
            vibe=vibe if vibe is not None else (existing.get("vibe") or ""),
            mode=mode if mode is not None else (existing.get("mode") or "Shuffle"),
            style=style if style is not None else (existing.get("style") or ""),
            color=color if color is not None else (existing.get("color") or "blue"),
            icon=existing.get("icon"),
        )
        try:
            result = await api.update_channel(number, body)
        except HTTPException as e:
            raise tool_error(e)
        result.pop("icon", None)
        return result

    @reg.tool(name="delete_channel", toolset="channels",
              destructive=True, idempotent=True, open_world=True)
    async def delete_channel(number: int, delete_tunarr: bool = True) -> dict:
        """Delete a channel. DESTRUCTIVE: also removes its assignments, schedule
        blocks, collection links and Tunarr links. Cannot be undone.
        By default this ALSO deletes the linked Tunarr channel and its
        programming; pass delete_tunarr=false to keep it and only unlink."""
        try:
            return await api.delete_channel(number, delete_tunarr=delete_tunarr)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="reorder_channel", toolset="channels",
              idempotent=True, open_world=True)
    async def reorder_channel(moved_number: int, target_index: int,
                              target_tier: str | None = None) -> dict:
        """Move a channel to a new position in the lineup. This RENUMBERS it —
        `number` is the primary key, so ordering is by number and there is no
        separate order column. `target_index` is the 0-based index the channel
        should occupy in the RESULTING lineup. Pass `target_tier` only for a
        cross-tier move. Assignments, blocks, collection links, Tunarr links and
        AI logs all follow the channel. Tunarr is renumbered after the local
        commit; entries in `tunarr.failed` mean Tunarr is out of step, NOT that
        the reorder failed."""
        try:
            return await api.reorder_channels(api.ChannelReorderIn(
                moved_number=moved_number, target_index=target_index,
                target_tier=target_tier))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="sync_channel_to_tunarr", toolset="channels",
              idempotent=True, open_world=True)
    async def sync_channel_to_tunarr(channel_number: int) -> dict:
        """Push a channel's name, number and icon to its linked Tunarr channel."""
        try:
            return await api.sync_channel_to_tunarr(channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="create_channel_package", toolset="channels")
    async def create_channel_package(channels: list[dict]) -> dict:
        """Create several channels at once. Each entry needs `number` and `name`;
        `tier`, `vibe`, `mode`, `description`, `color` are optional. Numbers that
        already exist are skipped, not errors. Local only — unlike
        `create_channel` this does NOT create matching Tunarr channels; call
        `export_channels_to_tunarr` afterwards if you want them."""
        try:
            return api.create_channel_package({"channels": channels})
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="suggest_247_channels", toolset="channels",
              read_only=True, open_world=True)
    async def suggest_247_channels() -> dict:
        """Analyse the Plex library and suggest 24/7 single-show or franchise
        channels worth creating. Library analysis, not an AI call — no API key
        needed."""
        try:
            return await api.suggest_247_channels()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="set_channel_icon", toolset="channels",
              idempotent=True, open_world=True)
    async def set_channel_icon(channel_number: int, icon: str | None = None,
                               icon_id: int | None = None) -> dict:
        """Set a channel's icon, from a base64 data URI (`icon`) or an entry in
        the icon library (`icon_id`). Also re-syncs the channel — and any
        icon-following watermark — to Tunarr."""
        if icon_id is not None and not icon:
            with api.get_db() as conn:
                row = conn.execute("SELECT data FROM saved_icons WHERE id=?",
                                   (icon_id,)).fetchone()
            if not row:
                raise RuntimeError(f"Icon {icon_id} not found in the library")
            icon = row["data"]
        if not icon:
            raise RuntimeError("Pass either `icon` (a data URI) or `icon_id`")
        try:
            return await api.set_channel_icon(channel_number,
                                              json_request({"icon": icon}))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="clear_channel_icon", toolset="channels",
              destructive=True, idempotent=True, open_world=True)
    async def clear_channel_icon(channel_number: int) -> dict:
        """Remove a channel's icon, clearing it in Tunarr too."""
        try:
            return await api.delete_channel_icon(channel_number)
        except HTTPException as e:
            raise tool_error(e)
