"""plex toolset — browsing the library and reading server state."""
from fastapi import HTTPException

from .registry import tool_error


def register(reg, api):

    @reg.tool(name="list_libraries", toolset="plex", read_only=True, open_world=True)
    async def list_libraries() -> list[dict]:
        """List the Plex libraries (movie/show sections) with their section ids."""
        try:
            return await api.plex_libraries()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="browse_library", toolset="plex", read_only=True, open_world=True)
    async def browse_library(section_id: str, type_filter: str = "all",
                             genre: str | None = None, year: int | None = None,
                             content_rating: str | None = None,
                             offset: int = 0, limit: int = 50) -> dict:
        """Browse a Plex library section. type_filter: all|movie|show. Filter by genre
        name, year, or content rating. Paged — returns total plus a window."""
        try:
            items = await api.plex_library(section_id, type_filter=type_filter, genre=genre,
                                           year=year, content_rating=content_rating)
        except HTTPException as e:
            raise tool_error(e)
        return {"total": len(items), "offset": offset,
                "items": items[offset:offset + max(1, min(limit, 200))]}

    @reg.tool(name="search_library", toolset="plex", read_only=True, open_world=True)
    async def search_library(query: str, type_filter: str = "all") -> list[dict]:
        """Search the whole Plex server for movies/shows by title. type_filter: all|movie|show."""
        try:
            return await api.plex_search(q=query, type_filter=type_filter)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_item", toolset="plex", read_only=True, open_world=True)
    async def get_item(rating_key: str) -> dict:
        """Full details for one Plex item: summary, genres, duration, ratings, media quality."""
        try:
            return await api.plex_item(rating_key)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_show_seasons", toolset="plex", read_only=True, open_world=True)
    async def get_show_seasons(rating_key: str) -> list[dict]:
        """List a show's seasons (pass the show's rating_key)."""
        try:
            return await api.plex_show_seasons(rating_key)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_season_episodes", toolset="plex", read_only=True, open_world=True)
    async def get_season_episodes(rating_key: str) -> list[dict]:
        """List a season's episodes (pass the season's rating_key from get_show_seasons)."""
        try:
            return await api.plex_season_episodes(rating_key)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_server_info", toolset="plex", read_only=True, open_world=True)
    async def get_server_info() -> dict:
        """Plex server metadata: name, version, platform, library summary. Good health check."""
        try:
            return await api.plex_server_info()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_now_playing", toolset="plex", read_only=True, open_world=True)
    async def get_now_playing() -> list[dict]:
        """What's streaming on the Plex server right now (active sessions)."""
        try:
            return await api.plex_sessions()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_recent_events", toolset="plex", read_only=True)
    async def get_recent_events(limit: int = 50) -> list[dict]:
        """Recent Plex webhook events recorded by Linearr (new content, playback, etc.)."""
        try:
            return api.plex_events(event_type=None, limit=limit)
        except HTTPException as e:
            raise tool_error(e)
