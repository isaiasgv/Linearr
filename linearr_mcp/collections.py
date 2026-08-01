"""collections toolset — Plex collections and the channel slots that use them."""
from fastapi import HTTPException

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
