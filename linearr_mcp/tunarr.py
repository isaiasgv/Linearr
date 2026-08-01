"""tunarr toolset — the playout server Linearr pushes channels to.

Every name carries `tunarr` deliberately. A Tunarr "channel" and a Linearr
channel are different objects joined by a link row, and so are Tunarr smart
collections and Plex smart collections. A tool that blurs them produces
confident, wrong work.

The XMLTV and M3U routes stream files; `get_tunarr_endpoints` returns their URLs
instead, which is what a caller actually needs.
"""
from fastapi import HTTPException

from ._request import json_request
from .registry import tool_error

_TASKS = ("UpdateXmlTvTask", "ScanLibrariesTask")
_LINK_KINDS = ("channel", "collection", "all")


def register(reg, api):

    # ── status & read ────────────────────────────────────────────────────────

    @reg.tool(name="get_tunarr_status", toolset="tunarr",
              read_only=True, open_world=True)
    async def get_tunarr_status() -> dict:
        """Is Tunarr reachable, at what version, and is that version supported?
        Combines the connection test and the version check — start here when
        anything Tunarr-related is failing."""
        try:
            connection = await api.tunarr_test(None)
        except HTTPException as e:
            raise tool_error(e)
        try:
            version = await api.tunarr_version_check()
        except HTTPException:
            version = {}
        return {"connection": connection, "version": version}

    @reg.tool(name="list_tunarr_channels", toolset="tunarr",
              read_only=True, open_world=True)
    async def list_tunarr_channels() -> list | dict:
        """Channels that exist in Tunarr (id, number, name)."""
        try:
            return await api.tunarr_list_channels()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_tunarr_channel", toolset="tunarr",
              read_only=True, open_world=True)
    async def get_tunarr_channel(tunarr_id: str) -> dict:
        """Full Tunarr channel record: transcoding, watermark, guide settings."""
        try:
            return await api.tunarr_get_channel_detail(tunarr_id)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_tunarr_schedule", toolset="tunarr",
              read_only=True, open_world=True)
    async def get_tunarr_schedule(tunarr_id: str, hours: int = 6) -> dict | list:
        """What a Tunarr channel will play over the next `hours`."""
        try:
            return await api.tunarr_get_schedule(tunarr_id, hours)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_tunarr_channel_shows", toolset="tunarr",
              read_only=True, open_world=True)
    async def get_tunarr_channel_shows(tunarr_id: str) -> dict | list:
        """Which shows and movies a Tunarr channel draws from."""
        try:
            return await api.tunarr_get_channel_shows(tunarr_id)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_tunarr_guide", toolset="tunarr",
              read_only=True, open_world=True)
    async def get_tunarr_guide(hours: int = 24) -> dict | list:
        """The whole-lineup EPG for the next `hours`."""
        try:
            return await api.tunarr_guide(hours)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_tunarr_endpoints", toolset="tunarr", read_only=True)
    async def get_tunarr_endpoints() -> dict:
        """URLs for the XMLTV guide and M3U playlist, for pointing a TV client at
        Linearr. The files themselves are downloads and are not returned here."""
        return {
            "tunarr_url": api.get_tunarr_url(),
            "xmltv_url": "/api/tunarr/xmltv",
            "m3u_url": "/api/tunarr/m3u",
        }

    @reg.tool(name="get_tunarr_debug_info", toolset="tunarr",
              read_only=True, open_world=True)
    async def get_tunarr_debug_info() -> dict:
        """Diagnostic dump of what Tunarr's API reports — for troubleshooting a
        sync or push that is not behaving."""
        try:
            return await api.tunarr_debug_api()
        except HTTPException as e:
            raise tool_error(e)

    # ── links ────────────────────────────────────────────────────────────────

    @reg.tool(name="list_tunarr_links", toolset="tunarr", read_only=True)
    async def list_tunarr_links(kind: str = "all") -> dict:
        """Which Linearr channels are linked to which Tunarr channels and
        collections. kind: channel | collection | all."""
        if kind not in _LINK_KINDS:
            raise RuntimeError(f"kind must be one of {', '.join(_LINK_KINDS)}")
        out: dict = {}
        if kind in ("channel", "all"):
            out["channel_links"] = api.tunarr_get_channel_links()
        if kind in ("collection", "all"):
            out["collection_links"] = api.tunarr_get_collection_links()
        return out

    @reg.tool(name="link_tunarr_channel", toolset="tunarr", idempotent=True)
    async def link_tunarr_channel(channel_number: int, tunarr_id: str,
                                  tunarr_name: str | None = None,
                                  tunarr_number: int | None = None) -> dict:
        """Link a Linearr channel to an existing Tunarr channel by its uuid."""
        try:
            return api.tunarr_save_channel_link(api.TunarrChannelLinkIn(
                channel_number=channel_number, tunarr_id=tunarr_id,
                tunarr_name=tunarr_name, tunarr_number=tunarr_number))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="unlink_tunarr_channel", toolset="tunarr",
              destructive=True, idempotent=True)
    async def unlink_tunarr_channel(channel_number: int) -> dict:
        """Break the link. The Tunarr channel itself is not deleted."""
        try:
            return api.tunarr_delete_channel_link(channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="link_tunarr_collection", toolset="tunarr", idempotent=True)
    async def link_tunarr_collection(channel_number: int, plex_type: str,
                                     tunarr_collection_id: str,
                                     tunarr_collection_name: str | None = None) -> dict:
        """Link a channel's movie or show collection to a Tunarr smart collection.
        plex_type: movie | show."""
        try:
            return api.tunarr_save_collection_link(api.TunarrCollectionLinkIn(
                channel_number=channel_number, plex_type=plex_type,
                tunarr_collection_id=tunarr_collection_id,
                tunarr_collection_name=tunarr_collection_name))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="unlink_tunarr_collection", toolset="tunarr",
              destructive=True, idempotent=True)
    async def unlink_tunarr_collection(channel_number: int, plex_type: str) -> dict:
        """Break a channel-to-Tunarr-collection link."""
        try:
            return api.tunarr_delete_collection_link(channel_number, plex_type)
        except HTTPException as e:
            raise tool_error(e)

    # ── push ─────────────────────────────────────────────────────────────────

    @reg.tool(name="push_schedule_to_tunarr", toolset="tunarr",
              idempotent=True, open_world=True)
    async def push_schedule_to_tunarr(channel_number: int,
                                      preview: bool = True) -> dict:
        """Turn a channel's blocks into a Tunarr time-slot schedule and push it.

        PREVIEWS BY DEFAULT: with `preview` true nothing is written and you get
        the schedule that would be pushed. Pass `preview=false` to apply it,
        which REPLACES the Tunarr channel's existing schedule."""
        try:
            return await api.tunarr_push_schedule(
                channel_number, api.TunarrPushScheduleIn(preview=preview))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="sync_channel_collections_to_tunarr", toolset="tunarr",
              idempotent=True, open_world=True)
    async def sync_channel_collections_to_tunarr(channel_number: int) -> dict:
        """Create or refresh the Tunarr smart collections backing a channel's Plex
        collections, and link them. Runs a library scan in Tunarr first, because a
        tag-based smart collection needs the Plex collection to already exist as a
        tag in Tunarr's index."""
        try:
            return await api.tunarr_sync_collections(channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="run_tunarr_task", toolset="tunarr",
              idempotent=True, open_world=True)
    async def run_tunarr_task(task_name: str) -> dict:
        """Run a Tunarr maintenance task: UpdateXmlTvTask (rebuild the guide) or
        ScanLibrariesTask (re-index the Plex sources)."""
        if task_name not in _TASKS:
            raise RuntimeError(f"task_name must be one of {', '.join(_TASKS)}")
        try:
            return await api.tunarr_run_task(task_name, None)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="refresh_tunarr_xmltv", toolset="tunarr",
              idempotent=True, open_world=True)
    async def refresh_tunarr_xmltv() -> dict:
        """Force Tunarr to regenerate its XMLTV guide now."""
        try:
            return await api.tunarr_xmltv_refresh()
        except HTTPException as e:
            raise tool_error(e)

    # ── smart collections ────────────────────────────────────────────────────

    @reg.tool(name="list_tunarr_smart_collections", toolset="tunarr",
              read_only=True, open_world=True)
    async def list_tunarr_smart_collections() -> list | dict:
        """Smart collections defined inside Tunarr (not the Plex ones)."""
        try:
            return await api.tunarr_list_smart_collections()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="create_tunarr_smart_collection", toolset="tunarr",
              open_world=True)
    async def create_tunarr_smart_collection(
            name: str, filter: dict | None = None,
            filter_string: str | None = None) -> dict:
        """Create a Tunarr smart collection. Give either a structured `filter`
        object or a simple `filter_string` like `tags = "My Collection"`, which is
        translated for you. Tunarr ignores filterString on writes, so passing one
        through verbatim would create a collection with NO rules — Linearr checks
        the response echoes the rules back before reporting success."""
        body: dict = {"name": name}
        if filter is not None:
            body["filter"] = filter
        if filter_string:
            body["filterString"] = filter_string
        try:
            return await api.tunarr_create_smart_collection(body)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="update_tunarr_smart_collection", toolset="tunarr",
              idempotent=True, open_world=True)
    async def update_tunarr_smart_collection(
            sc_id: str, name: str | None = None, filter: dict | None = None,
            filter_string: str | None = None) -> dict:
        """Rename a Tunarr smart collection and/or replace its rules. A name-only
        call is a plain rename and leaves the rules alone."""
        body: dict = {}
        if name is not None:
            body["name"] = name
        if filter is not None:
            body["filter"] = filter
        if filter_string:
            body["filterString"] = filter_string
        if not body:
            raise RuntimeError("Pass name and/or filter/filter_string")
        try:
            return await api.tunarr_update_smart_collection(sc_id, body)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="delete_tunarr_smart_collection", toolset="tunarr",
              destructive=True, idempotent=True, open_world=True)
    async def delete_tunarr_smart_collection(sc_id: str) -> dict:
        """Delete one Tunarr smart collection."""
        try:
            return await api.tunarr_delete_smart_collection(sc_id)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="purge_tunarr_smart_collections", toolset="tunarr",
              destructive=True, idempotent=True, open_world=True)
    async def purge_tunarr_smart_collections() -> dict:
        """DESTRUCTIVE: delete Tunarr smart collections in bulk. Read the response
        to see what actually went."""
        try:
            return await api.tunarr_purge_smart_collections()
        except HTTPException as e:
            raise tool_error(e)

    # ── content ──────────────────────────────────────────────────────────────

    @reg.tool(name="list_tunarr_custom_shows", toolset="tunarr",
              read_only=True, open_world=True)
    async def list_tunarr_custom_shows() -> list | dict:
        """Tunarr 1.3 custom shows. Empty on older Tunarr versions."""
        try:
            return await api.tunarr_list_custom_shows()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="list_tunarr_filler_lists", toolset="tunarr",
              read_only=True, open_world=True)
    async def list_tunarr_filler_lists() -> list | dict:
        """Filler lists — the interstitials Tunarr plays between programmes."""
        try:
            return await api.tunarr_filler_lists()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_tunarr_filler_list", toolset="tunarr",
              read_only=True, open_world=True)
    async def get_tunarr_filler_list(filler_id: str,
                                     include_programs: bool = False) -> dict:
        """One filler list. Set `include_programs` to also list its contents."""
        try:
            detail = await api.tunarr_filler_list_detail(filler_id)
            if include_programs:
                return {"filler_list": detail,
                        "programs": await api.tunarr_filler_list_programs(filler_id)}
            return detail
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="create_tunarr_filler_list", toolset="tunarr", open_world=True)
    async def create_tunarr_filler_list(filler_list: dict) -> dict:
        """Create a filler list. `filler_list` is passed to Tunarr as-is — use
        Tunarr's own filler-list shape (`name`, `programs`)."""
        try:
            return await api.tunarr_create_filler_list(json_request(filler_list))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="update_tunarr_filler_list", toolset="tunarr",
              idempotent=True, open_world=True)
    async def update_tunarr_filler_list(filler_id: str, filler_list: dict) -> dict:
        """Update a filler list. `filler_list` is passed to Tunarr as-is."""
        try:
            return await api.tunarr_update_filler_list(
                filler_id, json_request(filler_list))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="delete_tunarr_filler_list", toolset="tunarr",
              destructive=True, idempotent=True, open_world=True)
    async def delete_tunarr_filler_list(filler_id: str) -> dict:
        """Delete a filler list."""
        try:
            return await api.tunarr_delete_filler_list(filler_id)
        except HTTPException as e:
            raise tool_error(e)

    # ── sessions & settings ──────────────────────────────────────────────────

    @reg.tool(name="list_tunarr_sessions", toolset="tunarr",
              read_only=True, open_world=True)
    async def list_tunarr_sessions() -> list | dict:
        """Who is watching which Tunarr channel right now."""
        try:
            return await api.tunarr_sessions()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="stop_tunarr_sessions", toolset="tunarr",
              destructive=True, idempotent=True, open_world=True)
    async def stop_tunarr_sessions(channel_id: str) -> dict:
        """Cut every active stream on a Tunarr channel. Viewers are disconnected
        mid-programme."""
        try:
            return await api.tunarr_kill_sessions(channel_id)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_tunarr_xmltv_settings", toolset="tunarr",
              read_only=True, open_world=True)
    async def get_tunarr_xmltv_settings() -> dict:
        """Tunarr's XMLTV guide settings (refresh interval, programme count)."""
        try:
            return await api.tunarr_get_xmltv_settings()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="update_tunarr_xmltv_settings", toolset="tunarr",
              idempotent=True, open_world=True)
    async def update_tunarr_xmltv_settings(settings: dict) -> dict:
        """Update Tunarr's XMLTV settings. Passed to Tunarr as-is — read
        `get_tunarr_xmltv_settings` first and send back the same shape."""
        try:
            return await api.tunarr_update_xmltv_settings(json_request(settings))
        except HTTPException as e:
            raise tool_error(e)

    # ── migration ────────────────────────────────────────────────────────────

    @reg.tool(name="preview_tunarr_import", toolset="tunarr",
              read_only=True, open_world=True)
    async def preview_tunarr_import(channel_ids: list[str] | None = None) -> dict:
        """Show how Tunarr's channels would map onto Linearr channels — what would
        be created, matched or skipped. Changes nothing."""
        body = {"channel_ids": channel_ids} if channel_ids else {}
        try:
            return await api.tunarr_import_preview(body)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="import_tunarr_channels", toolset="tunarr", open_world=True)
    async def import_tunarr_channels(actions: list[dict]) -> dict:
        """Import channels from Tunarr into Linearr. Run `preview_tunarr_import`
        first and pass the actions you want from its result."""
        try:
            return await api.tunarr_import_channels(
                api.TunarrImportRequest(actions=actions))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="export_channels_to_tunarr", toolset="tunarr", open_world=True)
    async def export_channels_to_tunarr(channel_numbers: list[int] | str = "all",
                                        sync_collections: bool = False) -> dict:
        """Create or link Tunarr channels for Linearr channels. Pass a list of
        numbers, or "all". With `sync_collections` it also builds the backing
        Tunarr smart collections."""
        try:
            return await api.tunarr_export_channels(api.TunarrExportRequest(
                channel_numbers=channel_numbers,
                sync_collections=sync_collections))
        except HTTPException as e:
            raise tool_error(e)
