"""plex toolset — browsing the library and reading server state.

The stream-URL route is deliberately absent: it embeds the Plex token, and
handing that to a model writes a credential into a transcript.
"""
from fastapi import HTTPException

from .registry import tool_error

_HIGHLIGHT_KINDS = ("recently_added", "on_deck", "popular")


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

    @reg.tool(name="get_library_filters", toolset="plex",
              read_only=True, open_world=True)
    async def get_library_filters(section_id: str) -> dict:
        """Available filter values for a library section: genres, years, content
        ratings. Use this before `browse_library` so you filter on values that
        actually exist in the library."""
        try:
            return await api.plex_library_filters(section_id)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_library_stats", toolset="plex",
              read_only=True, open_world=True)
    async def get_library_stats() -> dict:
        """Counts and totals per Plex library section."""
        try:
            return await api.plex_library_stats()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_plex_highlights", toolset="plex",
              read_only=True, open_world=True)
    async def get_plex_highlights(kind: str = "recently_added",
                                  limit: int = 20) -> list[dict]:
        """Curated item lists from Plex. kind: recently_added | on_deck | popular."""
        if kind not in _HIGHLIGHT_KINDS:
            raise RuntimeError(f"kind must be one of {', '.join(_HIGHLIGHT_KINDS)}")
        fn = {"recently_added": api.plex_recently_added,
              "on_deck": api.plex_on_deck,
              "popular": api.plex_popular}[kind]
        try:
            return await fn(limit)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_plex_hubs", toolset="plex", read_only=True, open_world=True)
    async def get_plex_hubs(section_id: str | None = None) -> dict | list:
        """Plex's own recommendation hubs — server-wide, or for one section."""
        try:
            if section_id:
                return await api.plex_library_hubs(section_id)
            return await api.plex_hubs()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_watch_history", toolset="plex",
              read_only=True, open_world=True)
    async def get_watch_history(limit: int = 50) -> list[dict]:
        """Recently watched items from the Plex server's history."""
        try:
            return await api.plex_history(limit)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="list_playlists", toolset="plex", read_only=True, open_world=True)
    async def list_playlists() -> list[dict]:
        """Playlists on the Plex server."""
        try:
            return await api.plex_playlists()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="rate_item", toolset="plex", idempotent=True, open_world=True)
    async def rate_item(rating_key: str, rating: float) -> dict:
        """Set the user rating on a Plex item. 0 clears it, 1-10 sets it."""
        try:
            return await api.plex_rate_item(rating_key, api.PlexRateIn(rating=rating))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="scan_library", toolset="plex", idempotent=True, open_world=True)
    async def scan_library(section_id: str) -> dict:
        """Ask Plex to rescan a library section for new files."""
        try:
            return await api.plex_scan_library(section_id)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="clear_recent_events", toolset="plex",
              destructive=True, idempotent=True)
    async def clear_recent_events() -> dict:
        """Delete the stored Plex webhook event history."""
        try:
            return api.clear_plex_events()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="test_plex_connection", toolset="plex",
              read_only=True, open_world=True)
    async def test_plex_connection() -> dict:
        """Check that Linearr can reach Plex with the configured URL and token."""
        try:
            return await api.plex_test()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_plex_auth_info", toolset="plex", read_only=True)
    async def get_plex_auth_info() -> dict:
        """How Linearr authenticates to Plex: legacy token or JWT device key,
        token age, and whether it needs refreshing. Never returns the token."""
        try:
            return api.plex_auth_info()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="refresh_plex_token", toolset="plex",
              idempotent=True, open_world=True)
    async def refresh_plex_token() -> dict:
        """Mint a fresh Plex token from the stored device key (JWT auth only).
        JWT tokens last about 7 days — check `get_plex_auth_info` first."""
        try:
            return await api.plex_jwt_refresh()
        except HTTPException as e:
            raise tool_error(e)
