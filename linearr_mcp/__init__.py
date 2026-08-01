"""Linearr's MCP server: tool registration, split by toolset.

Never imports `main`. The FastAPI app module is passed in as `api` and handlers
are read off it, so there is no import cycle and no HTTP-to-self loop.
"""
from mcp.server.fastmcp import FastMCP

from .registry import TOOLSETS, ToolRegistry, resolve_toolsets

INSTRUCTIONS = (
    "Linearr manages TV channel lineups for Plex + Tunarr. Channels hold "
    "content assignments (movies/shows from the user's Plex library). "
    "Typical flow: browse or search the library, create/pick a channel, "
    "assign items to it, then build Plex collections from the channel."
)

# tool name -> toolset, for every tool the build declared (enabled or not).
TOOLSET_OF: dict[str, str] = {}


def build_mcp_server(api):
    """Build the FastMCP server. Returns (server, toolset_info)."""
    from . import (ai, assignments, blocks, channels, collections, icons, plex,
                   system, tunarr, watermark)

    mcp = FastMCP("linearr", instructions=INSTRUCTIONS)
    enabled = resolve_toolsets(api)
    reg = ToolRegistry(mcp, api, enabled)

    # Registration order sets the order tools appear in `tools/list`.
    for module in (channels, icons, assignments, plex, collections, blocks,
                   tunarr, watermark, ai, system):
        module.register(reg, api)

    # Additive on purpose: a tool's toolset never changes, and a second build
    # (a test constructing a gated server) must not erase the first build's map.
    TOOLSET_OF.update(reg.toolset_of)
    counts = reg.counts()
    info = [{"name": t, "enabled": t in enabled, "tool_count": counts[t]}
            for t in TOOLSETS]
    return mcp, info
