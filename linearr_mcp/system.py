"""system toolset — health, configuration, export/import, and logs.

Secrets are deliberately one-way here: `get_configuration` reports only whether
a credential is set (the underlying route already redacts), and
`update_configuration` refuses to write one. Setting a Plex token or an API key
stays a UI action, because a bearer token that can also rewrite credentials is a
much bigger blast radius than one that can rewrite a lineup.

The database backup/restore routes are NOT exposed: restore replaces the entire
database, and neither a SQLite file nor its restore moves usefully through a
chat transport.
"""
from fastapi import HTTPException

from ._request import json_request
from .registry import tool_error

_LOG_KINDS = ("app", "ai")
_IMPORT_MODES = ("merge", "replace")


def register(reg, api):

    @reg.tool(name="get_health", toolset="system", read_only=True)
    async def get_health() -> dict:
        """Is Linearr healthy? Reports app version and database status."""
        return api.health_check()

    @reg.tool(name="get_configuration", toolset="system", read_only=True)
    async def get_configuration() -> dict:
        """Linearr's configuration: Plex URL, Tunarr URL, AI model and base URL,
        and whether each credential is set. Never returns a credential value."""
        cfg = dict(api.get_settings())
        cfg.pop("plex_token", None)
        cfg.pop("openai_api_key", None)
        return cfg

    @reg.tool(name="update_configuration", toolset="system", idempotent=True)
    async def update_configuration(plex_url: str | None = None,
                                   tunarr_url: str | None = None,
                                   tunarr_public_url: str | None = None,
                                   openai_base_url: str | None = None,
                                   openai_model: str | None = None,
                                   plex_token: str | None = None,
                                   openai_api_key: str | None = None) -> dict:
        """Change Linearr's URLs and AI model.

        `tunarr_public_url` is the base URL used for channel icons and watermark
        images written into Tunarr — set it when Tunarr's own address is not
        reachable from your Plex clients, which is what makes icons appear only
        on the local network. Blank means "same as tunarr_url".

        Credentials CANNOT be set here — `plex_token` and `openai_api_key` are
        accepted only so the call fails loudly instead of appearing to work. Set
        them in Settings in the UI."""
        supplied = [n for n, v in (("plex_token", plex_token),
                                   ("openai_api_key", openai_api_key)) if v]
        if supplied:
            raise RuntimeError(
                f"Refusing to set {', '.join(supplied)} over MCP. Credentials are "
                f"set in Settings in the UI.")
        current = api.get_settings()
        body = api.SettingsIn(
            plex_url=plex_url if plex_url is not None else current["plex_url"],
            plex_token="",          # empty preserves the stored token
            openai_api_key=None,    # None preserves the stored key
            openai_base_url=(openai_base_url if openai_base_url is not None
                             else current.get("openai_base_url")),
            openai_model=(openai_model if openai_model is not None
                          else current.get("openai_model")),
            tunarr_url=(tunarr_url if tunarr_url is not None
                        else current.get("tunarr_url")),
            tunarr_public_url=(tunarr_public_url if tunarr_public_url is not None
                               else current.get("tunarr_public_url")))
        try:
            api.save_settings(body)
        except HTTPException as e:
            raise tool_error(e)
        return await get_configuration()

    @reg.tool(name="export_lineup", toolset="system", read_only=True)
    async def export_lineup(channel_number: int | None = None) -> dict:
        """Export the whole lineup — channels, assignments, blocks, slots and
        collection links — as JSON. Pass `channel_number` for a single channel.
        The result is what `import_lineup` / `import_channel` take back."""
        try:
            if channel_number is None:
                return api.export_lineup()
            return api.export_channel(channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="import_lineup", toolset="system",
              destructive=True, idempotent=True)
    async def import_lineup(data: dict, mode: str = "merge") -> dict:
        """Import a lineup export. mode 'merge' adds what is missing and skips
        what already exists. mode 'replace' DELETES every channel, assignment,
        block and slot first — there is no undo."""
        if mode not in _IMPORT_MODES:
            raise RuntimeError(f"mode must be one of {', '.join(_IMPORT_MODES)}")
        try:
            return await api.import_lineup(json_request({"data": data, "mode": mode}))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="import_channel", toolset="system", idempotent=True)
    async def import_channel(data: dict) -> dict:
        """Import one channel export (channel + assignments + blocks + slots).
        A channel already on that number is overwritten, keeping its uid."""
        try:
            return await api.import_channel(json_request(data))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="list_preset_lineups", toolset="system", read_only=True)
    async def list_preset_lineups() -> list[dict]:
        """Prebuilt lineups available to import (id, name, channel count)."""
        try:
            return api.list_preset_lineups()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="import_preset_lineup", toolset="system",
              destructive=True, idempotent=True)
    async def import_preset_lineup(lineup_id: str, mode: str = "merge") -> dict:
        """Import a prebuilt lineup. mode 'replace' WIPES the current lineup
        first; 'merge' adds only what is missing."""
        if mode not in _IMPORT_MODES:
            raise RuntimeError(f"mode must be one of {', '.join(_IMPORT_MODES)}")
        try:
            return await api.import_preset_lineup(
                lineup_id, json_request({"mode": mode}))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_logs", toolset="system", read_only=True)
    async def get_logs(kind: str = "app", limit: int = 100) -> dict | list:
        """Read Linearr's logs. kind 'app' is the Activity Log — every action,
        including every MCP tool call. kind 'ai' is the AI request log."""
        if kind not in _LOG_KINDS:
            raise RuntimeError(f"kind must be one of {', '.join(_LOG_KINDS)}")
        try:
            return api.get_app_logs(limit) if kind == "app" else api.get_ai_logs(limit)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_log_stats", toolset="system", read_only=True)
    async def get_log_stats() -> dict:
        """Log volume by category and level — a quick read on what is misbehaving."""
        try:
            return api.log_stats()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="clear_logs", toolset="system",
              destructive=True, idempotent=True)
    async def clear_logs(kind: str = "app") -> dict:
        """Delete a log entirely. kind: app | ai. There is no other copy."""
        if kind not in _LOG_KINDS:
            raise RuntimeError(f"kind must be one of {', '.join(_LOG_KINDS)}")
        try:
            return api.clear_app_logs() if kind == "app" else api.clear_ai_logs()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="purge_logs", toolset="system",
              destructive=True, idempotent=True)
    async def purge_logs(days: int = 30) -> dict:
        """Delete log entries older than `days`."""
        try:
            return api.purge_logs(days)
        except HTTPException as e:
            raise tool_error(e)
