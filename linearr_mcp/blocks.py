"""blocks toolset — schedule blocks and their slots.

A block is a recurring time window on a channel ("weeknights 20:00-23:00, shows
only"). A slot is one programme placed at a time inside it. A block with
`channel_number = null` is generic — a reusable template you `apply_block` onto
a channel, which copies it and leaves the template alone.
"""
from fastapi import HTTPException

from .registry import tool_error

_DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def register(reg, api):

    @reg.tool(name="list_blocks", toolset="blocks", read_only=True)
    async def list_blocks(channel_number: int | None = None) -> list[dict]:
        """List schedule blocks for a channel. Omit `channel_number` to list the
        generic, reusable blocks instead."""
        try:
            if channel_number is None:
                return api.list_generic_blocks()
            return api.list_channel_blocks(channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="create_block", toolset="blocks")
    async def create_block(name: str, channel_number: int | None = None,
                           days: list[str] = list(_DAYS),
                           start_time: str = "00:00", end_time: str = "23:59",
                           content_type: str = "both", notes: str = "",
                           order_index: int = 0) -> dict:
        """Create a schedule block. Times are 24h HH:MM. days: any of
        mon,tue,wed,thu,fri,sat,sun. content_type: movies | shows | both.
        Omit `channel_number` to create a generic, reusable block."""
        try:
            return api.create_block(api.BlockIn(
                name=name, channel_number=channel_number, days=days,
                start_time=start_time, end_time=end_time,
                content_type=content_type, notes=notes, order_index=order_index))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="update_block", toolset="blocks", idempotent=True)
    async def update_block(block_id: int, name: str | None = None,
                           channel_number: int | None = None,
                           days: list[str] | None = None,
                           start_time: str | None = None,
                           end_time: str | None = None,
                           content_type: str | None = None,
                           notes: str | None = None,
                           order_index: int | None = None) -> dict:
        """Update a block. Only the fields you pass change — the rest keep their
        current values. (The underlying route replaces the whole row, so this
        tool reads the block first and merges.)"""
        with api.get_db() as conn:
            row = conn.execute("SELECT * FROM blocks WHERE id=?", (block_id,)).fetchone()
        if not row:
            raise RuntimeError(f"Block {block_id} not found")
        current = api._row_to_block(row)
        body = api.BlockIn(
            name=name if name is not None else current["name"],
            channel_number=(channel_number if channel_number is not None
                            else current.get("channel_number")),
            days=days if days is not None else (current.get("days") or list(_DAYS)),
            start_time=start_time if start_time is not None else current["start_time"],
            end_time=end_time if end_time is not None else current["end_time"],
            content_type=(content_type if content_type is not None
                          else current.get("content_type") or "both"),
            notes=notes if notes is not None else (current.get("notes") or ""),
            order_index=(order_index if order_index is not None
                         else current.get("order_index") or 0))
        try:
            return api.update_block(block_id, body)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="delete_block", toolset="blocks",
              destructive=True, idempotent=True)
    async def delete_block(block_id: int) -> dict:
        """Delete a block and every slot in it."""
        try:
            return api.delete_block(block_id)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="list_block_slots", toolset="blocks", read_only=True)
    async def list_block_slots(block_id: int) -> list[dict]:
        """List the programmes scheduled inside a block, by time."""
        try:
            return api.list_block_slots(block_id)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="add_block_slot", toolset="blocks", open_world=True)
    async def add_block_slot(block_id: int, slot_time: str, plex_rating_key: str,
                             plex_title: str | None = None,
                             plex_type: str | None = None,
                             duration_minutes: int = 60) -> dict:
        """Schedule a programme inside a block at `slot_time` (24h HH:MM).
        Title and type are fetched from Plex when you don't supply them."""
        title, ptype, thumb, year = plex_title, plex_type, None, None
        if not title or not ptype:
            try:
                item = await api.plex_item(plex_rating_key)
            except HTTPException as e:
                raise tool_error(e)
            title = title or item.get("title") or plex_rating_key
            ptype = ptype or item.get("type") or "movie"
            thumb, year = item.get("thumb"), item.get("year")
        try:
            return api.add_block_slot(block_id, api.SlotIn(
                slot_time=slot_time, plex_rating_key=plex_rating_key,
                plex_title=title, plex_type=ptype, plex_thumb=thumb,
                plex_year=year, duration_minutes=duration_minutes))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="update_block_slot", toolset="blocks", idempotent=True)
    async def update_block_slot(slot_id: int, slot_time: str) -> dict:
        """Move a slot to a different time (24h HH:MM)."""
        try:
            return api.update_block_slot(slot_id, {"slot_time": slot_time})
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="swap_block_slots", toolset="blocks")
    async def swap_block_slots(block_id: int, slot_a: int, slot_b: int) -> dict:
        """Swap the times of two slots in the same block."""
        try:
            return api.swap_block_slots(block_id, {"slot_a": slot_a, "slot_b": slot_b})
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="delete_block_slot", toolset="blocks",
              destructive=True, idempotent=True)
    async def delete_block_slot(slot_id: int) -> dict:
        """Remove one slot from its block."""
        try:
            return api.delete_block_slot(slot_id)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="clear_block_slots", toolset="blocks",
              destructive=True, idempotent=True)
    async def clear_block_slots(block_id: int) -> dict:
        """Remove every slot from a block, keeping the block itself."""
        try:
            return api.clear_block_slots(block_id)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="apply_block", toolset="blocks")
    async def apply_block(block_id: int, channel_number: int) -> dict:
        """Copy a generic block (and its slots) onto a channel. The template is
        left as it was."""
        try:
            return api.apply_block(block_id, channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_block_suggestions", toolset="blocks", read_only=True)
    async def get_block_suggestions(block_id: int) -> dict | list:
        """Content from the channel's assignments that fits this block's
        content type and length."""
        try:
            return api.block_suggestions(block_id)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_network_block_suggestions", toolset="blocks", read_only=True)
    async def get_network_block_suggestions(
            channel_number: int | None = None) -> dict | list:
        """Standard cable-network dayparts (morning, prime time, late night…) to
        model a schedule on. Static reference data, not an AI call."""
        try:
            return api.network_block_suggestions(channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="list_schedule_templates", toolset="blocks", read_only=True)
    async def list_schedule_templates() -> dict | list:
        """Prebuilt whole-day schedule templates that can be turned into blocks."""
        try:
            return api.get_schedule_templates()
        except HTTPException as e:
            raise tool_error(e)
