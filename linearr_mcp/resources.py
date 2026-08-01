"""MCP resources — read-only context a client can pull without a tool call.

Resources are neither gated nor instrumented: they are cheap reads with no side
effects, and putting them through the tool registry would only add noise to the
Activity Log.
"""
import json


def register(mcp, api):

    @mcp.resource("linearr://lineup", name="Channel lineup",
                  mime_type="application/json")
    def lineup() -> str:
        """Every channel with its assignment and block counts."""
        with api.get_db() as conn:
            channels = [dict(r) for r in conn.execute(
                "SELECT number, name, tier, vibe, mode, style, color, uid "
                "FROM channels ORDER BY number")]
            counts = {r["channel_number"]: r["n"] for r in conn.execute(
                "SELECT channel_number, COUNT(*) AS n FROM assignments "
                "GROUP BY channel_number")}
            blocks = {r["channel_number"]: r["n"] for r in conn.execute(
                "SELECT channel_number, COUNT(*) AS n FROM blocks "
                "WHERE channel_number IS NOT NULL GROUP BY channel_number")}
        for ch in channels:
            ch["assignment_count"] = counts.get(ch["number"], 0)
            ch["block_count"] = blocks.get(ch["number"], 0)
        return json.dumps({"channels": channels, "total": len(channels)}, indent=2)

    @mcp.resource("linearr://channel/{number}", name="Channel detail",
                  mime_type="application/json")
    def channel(number: str) -> str:
        """One channel: metadata, assignments, blocks and collection links."""
        try:
            n = int(number)
        except ValueError:
            return json.dumps({"error": f"{number!r} is not a channel number"})
        ch = api._get_channel(n)
        if not ch:
            return json.dumps({"error": f"Channel {n} not found"})
        ch.pop("icon", None)  # base64 blob — noise for an LLM
        with api.get_db() as conn:
            ch["assignments"] = [dict(r) for r in conn.execute(
                "SELECT plex_rating_key, plex_title, plex_type, plex_year "
                "FROM assignments WHERE channel_number=? ORDER BY plex_title", (n,))]
            ch["blocks"] = [dict(r) for r in conn.execute(
                "SELECT id, name, days, start_time, end_time, content_type "
                "FROM blocks WHERE channel_number=? ORDER BY start_time", (n,))]
            ch["collections"] = [dict(r) for r in conn.execute(
                "SELECT * FROM channel_collections WHERE channel_number=?", (n,))]
        return json.dumps(ch, indent=2, default=str)

    @mcp.resource("linearr://libraries", name="Plex libraries",
                  mime_type="application/json")
    async def libraries() -> str:
        """Plex library sections and their ids."""
        try:
            return json.dumps(await api.plex_libraries(), indent=2)
        except Exception as e:
            return json.dumps({"error": str(e)})

    @mcp.resource("linearr://status", name="System status",
                  mime_type="application/json")
    def status() -> str:
        """Health of Linearr and everything it depends on. No secrets."""
        cfg = api.get_settings()
        try:
            auth = api.plex_auth_info()
        except Exception as e:
            auth = {"error": str(e)}
        return json.dumps({
            "health": api.health_check(),
            "plex": {"url": cfg.get("plex_url"),
                     "token_configured": cfg.get("plex_token_set", False),
                     "auth": auth},
            "tunarr": {"url": cfg.get("tunarr_url")},
            "ai": {"configured": cfg.get("openai_api_key_set", False),
                   "model": cfg.get("openai_model")},
        }, indent=2, default=str)
