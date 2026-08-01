"""collections toolset — Plex collections and the channel slots that use them."""
from fastapi import HTTPException

from ._request import json_request
from .registry import tool_error


def register(reg, api):

    @reg.tool(name="get_collection_status", toolset="collections",
              read_only=True, open_world=True)
    async def get_collection_status(channel_number: int) -> dict:
        """Check whether Plex collections already exist for a channel's movies/shows."""
        try:
            return await api.collection_status(channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="build_collections", toolset="collections", open_world=True)
    async def build_collections(channel_number: int) -> dict:
        """Create/update Plex collections from a channel's assignments (one for movies,
        one for shows) and link them to the channel. Also syncs Tunarr if linked."""
        try:
            return await api.generate_collections(channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="list_plex_collections", toolset="collections",
              read_only=True, open_world=True)
    async def list_plex_collections(offset: int = 0, limit: int = 100) -> dict:
        """List collections on the Plex server (title, type, item count, smart flag).
        Paged — returns total plus a window."""
        try:
            items = await api.plex_collections()
        except HTTPException as e:
            raise tool_error(e)
        return {"total": len(items), "offset": offset,
                "collections": items[offset:offset + max(1, min(limit, 500))]}

    @reg.tool(name="get_collection_items", toolset="collections",
              read_only=True, open_world=True)
    async def get_collection_items(rating_key: str, offset: int = 0,
                                   limit: int = 100) -> dict:
        """List the items inside a Plex collection. Paged — returns total plus a window."""
        try:
            items = await api.plex_collection_items(rating_key)
        except HTTPException as e:
            raise tool_error(e)
        return {"total": len(items), "offset": offset,
                "items": items[offset:offset + max(1, min(limit, 500))]}

    @reg.tool(name="create_smart_collection", toolset="collections", open_world=True)
    async def create_smart_collection(section_id: str, title: str, type: str = "movie",
                                      genres: list[str] = [], year_min: int | None = None,
                                      year_max: int | None = None, decade: int | None = None,
                                      unwatched: bool = False, content_rating: str | None = None,
                                      title_contains: str | None = None, sort: str | None = None,
                                      limit: int | None = None) -> dict:
        """Create a rule-based Plex smart collection that stays current automatically.
        Genres are names (e.g. ['Horror']); sort: title_asc|title_desc|year_asc|
        year_desc|added_desc|random. type: movie|show."""
        body = api.SmartCollectionIn(
            section_id=section_id, type=type, title=title, sort=sort, limit=limit,
            filters=api.SmartCollectionFilters(
                genres=genres, year_min=year_min, year_max=year_max,
                decade=decade, unwatched=unwatched, content_rating=content_rating,
                title_contains=title_contains))
        try:
            return await api.plex_create_smart_collection(body)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="update_smart_collection", toolset="collections",
              idempotent=True, open_world=True)
    async def update_smart_collection(rating_key: str, section_id: str, type: str = "movie",
                                      title: str | None = None, genres: list[str] = [],
                                      year_min: int | None = None, year_max: int | None = None,
                                      decade: int | None = None, unwatched: bool = False,
                                      content_rating: str | None = None,
                                      title_contains: str | None = None, sort: str | None = None,
                                      limit: int | None = None) -> dict:
        """Update a smart collection's title and/or REPLACE its filter rules.
        Filter rules are only touched when at least one filter argument (genres,
        year_min/max, decade, unwatched, content_rating, title_contains, sort,
        limit) is provided — passing only `title` renames without changing rules.
        When replacing rules, pass the COMPLETE new rule set: whatever you send
        becomes the entire filter."""
        # Only rebuild the filter when the caller actually supplied filter args —
        # otherwise a rename-only call would replace the rules with an empty
        # match-everything filter.
        filters_given = bool(genres) or unwatched or any(
            v is not None for v in (year_min, year_max, decade, content_rating,
                                    title_contains, sort, limit))
        filters = api.SmartCollectionFilters(
            genres=genres, year_min=year_min, year_max=year_max, decade=decade,
            unwatched=unwatched, content_rating=content_rating,
            title_contains=title_contains) if filters_given else None
        body = api.SmartCollectionUpdateIn(section_id=section_id, type=type, title=title,
                                           filters=filters, sort=sort, limit=limit)
        try:
            return await api.plex_update_smart_collection(rating_key, body)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="delete_collection", toolset="collections",
              destructive=True, idempotent=True, open_world=True)
    async def delete_collection(rating_key: str) -> dict:
        """Delete a Plex collection (regular or smart). DESTRUCTIVE — removes it from
        Plex and unlinks it from any channel. Library items themselves are untouched."""
        try:
            return await api.plex_delete_collection(rating_key)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="create_collection", toolset="collections", open_world=True)
    async def create_collection(section_id: str, title: str,
                                rating_keys: list[str], type: str = "movie") -> dict:
        """Create a regular (non-smart) Plex collection from a list of items.
        type: movie | show. For a rule-based collection that keeps itself
        current, use `create_smart_collection` instead."""
        try:
            return await api.plex_create_collection(json_request({
                "section_id": section_id, "title": title,
                "type": type, "items": rating_keys}))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="add_collection_items", toolset="collections", open_world=True)
    async def add_collection_items(rating_key: str, item_keys: list[str]) -> dict:
        """Add items to an existing Plex collection, by their rating keys."""
        try:
            return await api.plex_add_collection_items(
                rating_key, json_request({"items": item_keys}))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="remove_collection_item", toolset="collections",
              destructive=True, idempotent=True, open_world=True)
    async def remove_collection_item(rating_key: str, item_key: str) -> dict:
        """Remove one item from a Plex collection. The library item is untouched."""
        try:
            return await api.plex_remove_collection_item(rating_key, item_key)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="update_collection", toolset="collections",
              idempotent=True, open_world=True)
    async def update_collection(rating_key: str, title: str | None = None,
                                summary: str | None = None) -> dict:
        """Rename a Plex collection or change its summary."""
        body = {k: v for k, v in (("title", title), ("summary", summary))
                if v is not None}
        if not body:
            raise RuntimeError("Pass title and/or summary")
        try:
            return await api.plex_update_collection(rating_key, json_request(body))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="list_channel_collections", toolset="collections", read_only=True)
    async def list_channel_collections(channel_number: int) -> dict:
        """Which Plex collections a channel uses, keyed by content type
        ('movie' / 'show'). `source` is 'owned' for a collection Linearr
        generates and manages, 'assigned' for one the user pointed the channel
        at; `linearr_created` marks the ones Linearr built in Plex itself."""
        try:
            return api.get_channel_collections(channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="assign_collection_to_channel", toolset="collections",
              idempotent=True)
    async def assign_collection_to_channel(channel_number: int, plex_type: str,
                                           collection_rating_key: str,
                                           collection_title: str,
                                           is_smart: bool = False) -> dict:
        """Point a channel at an EXISTING Plex collection, BY REFERENCE.

        Nothing is copied and nothing in Plex is modified — this only records
        that the channel uses that collection. One collection per type, so
        assigning replaces whatever was in that slot. To copy a collection's
        items into the channel's assignments instead, use
        `import_collection_to_channel`.

        Collections named '{Channel} Movies' or '{Channel} TV' are rejected:
        those names belong to the collections Linearr generates and manages, and
        a later build would rewrite their contents."""
        try:
            return api.assign_channel_collection(
                channel_number, api.ChannelCollectionAssignIn(
                    plex_type=plex_type, collection_rating_key=collection_rating_key,
                    collection_title=collection_title, is_smart=is_smart))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="import_collection_to_channel", toolset="collections",
              open_world=True)
    async def import_collection_to_channel(channel_number: int, plex_type: str,
                                           collection_rating_key: str,
                                           collection_title: str) -> dict:
        """COPY every item in a Plex collection into a channel's assignments.

        A one-time import: later changes to the collection do not follow. To
        track the collection instead, use `assign_collection_to_channel`."""
        try:
            return await api.link_channel_collection(
                channel_number, api.ChannelCollectionIn(
                    plex_type=plex_type, collection_rating_key=collection_rating_key,
                    collection_title=collection_title))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="unlink_channel_collection", toolset="collections",
              destructive=True, idempotent=True)
    async def unlink_channel_collection(channel_number: int, plex_type: str) -> dict:
        """Clear a channel's collection slot for one content type. The Plex
        collection itself is not deleted."""
        try:
            return api.unlink_channel_collection(channel_number, plex_type)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="create_channel_smart_collection", toolset="collections",
              open_world=True)
    async def create_channel_smart_collection(
        channel_number: int, section_id: str, title: str, type: str = "movie",
        genres: list[str] = [], year_min: int | None = None,
        year_max: int | None = None, decade: int | None = None,
        unwatched: bool = False, content_rating: str | None = None,
        title_contains: str | None = None, sort: str | None = None,
        limit: int | None = None,
    ) -> dict:
        """Create a Plex smart collection AND assign it to a channel, atomically.
        Same filters as `create_smart_collection`. If the assign fails the new
        collection is deleted again, so a failure never leaves an orphan."""
        body = api.SmartCollectionIn(
            section_id=section_id, type=type, title=title, sort=sort, limit=limit,
            filters=api.SmartCollectionFilters(
                genres=genres, year_min=year_min, year_max=year_max, decade=decade,
                unwatched=unwatched, content_rating=content_rating,
                title_contains=title_contains))
        try:
            return await api.create_and_assign_smart_collection(channel_number, body)
        except HTTPException as e:
            raise tool_error(e)
