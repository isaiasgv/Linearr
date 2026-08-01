"""channels toolset — the lineup itself."""
from fastapi import HTTPException

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
    async def delete_channel(number: int) -> dict:
        """Delete a channel. DESTRUCTIVE: also removes its assignments, schedule
        blocks, collection links and Tunarr links. Cannot be undone."""
        try:
            return api.delete_channel(number)
        except HTTPException as e:
            raise tool_error(e)
