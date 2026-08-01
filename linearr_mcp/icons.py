"""icons toolset — the reusable icon library and Tunarr icon import.

Deliberately omits the icon-pack export/import/seed routes: they move megabytes
of base64 PNG, which is pure cost in an LLM transcript and no help to a model.
The UI owns them.
"""
from fastapi import HTTPException

from ._request import json_request
from .registry import tool_error


def register(reg, api):

    @reg.tool(name="list_icon_library", toolset="icons", read_only=True)
    async def list_icon_library(include_data: bool = False) -> list[dict]:
        """List saved icons (id, name, category). Data URIs are stripped unless
        `include_data` is true — they are large and rarely useful to read."""
        rows = api.list_saved_icons()
        if include_data:
            return rows
        return [{k: v for k, v in r.items() if k not in ("data", "composition")}
                for r in rows]

    @reg.tool(name="save_icon", toolset="icons")
    async def save_icon(name: str, data: str, category: str = "custom") -> dict:
        """Save an icon to the library. `data` is a base64 data URI."""
        try:
            return await api.save_icon(json_request(
                {"name": name, "data": data, "category": category}))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="update_saved_icon", toolset="icons", idempotent=True)
    async def update_saved_icon(icon_id: int, name: str | None = None,
                                category: str | None = None,
                                data: str | None = None) -> dict:
        """Rename, recategorise or replace a saved icon. Only fields you pass change."""
        body = {k: v for k, v in
                (("name", name), ("category", category), ("data", data))
                if v is not None}
        if not body:
            raise RuntimeError("Pass at least one of name, category, data")
        try:
            return await api.update_saved_icon(icon_id, json_request(body))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="delete_saved_icon", toolset="icons",
              destructive=True, idempotent=True)
    async def delete_saved_icon(icon_id: int) -> dict:
        """Delete an icon from the library. Channels already using it keep their copy."""
        try:
            return api.delete_saved_icon(icon_id)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="import_icons_from_tunarr", toolset="icons", open_world=True)
    async def import_icons_from_tunarr() -> dict:
        """Pull channel logos from Tunarr into the icon library."""
        try:
            return await api.import_icons_from_tunarr()
        except HTTPException as e:
            raise tool_error(e)
