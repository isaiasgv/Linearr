"""Linearr's MCP server: tool registration, split by toolset.

Never imports `main`. The FastAPI app module is passed in as `api` and handlers
are read off it, so there is no import cycle and no HTTP-to-self loop.
"""
from mcp.server.fastmcp import FastMCP

from .registry import TOOLSETS, ToolRegistry, resolve_toolsets

INSTRUCTIONS = (
    "Linearr builds TV channel lineups from a Plex library and pushes them to "
    "Tunarr for playout.\n\n"
    "The model: a CHANNEL is the unit (number, name, tier). ASSIGNMENTS are the "
    "Plex movies and shows that belong to it. BLOCKS are its schedule — "
    "recurring time windows, each holding SLOTS (one programme at one time). "
    "COLLECTIONS are the Plex-side grouping of a channel's content. Tunarr is "
    "the playout server: link a channel to a Tunarr channel, then push its "
    "schedule.\n\n"
    "Typical flow: search or browse the library, create or pick a channel, "
    "assign items, build its collections, add blocks and slots, link it to "
    "Tunarr, push the schedule.\n\n"
    "Two things that surprise people:\n"
    "- Reordering a channel RENUMBERS it. `number` is the primary key and "
    "ordering is by number; six tables reference it by value and follow the "
    "renumber. Use `reorder_channel`, never two `update_channel` calls.\n"
    "- `push_schedule_to_tunarr` previews by default. Pass preview=false to "
    "actually write, which replaces the Tunarr channel's existing schedule."
)

# tool name -> toolset, for every tool the build declared (enabled or not).
TOOLSET_OF: dict[str, str] = {}


def build_mcp_server(api):
    """Build the FastMCP server. Returns (server, toolset_info)."""
    from . import (ai, assignments, blocks, channels, collections, icons, plex,
                   resources, system, tunarr, watermark)

    mcp = FastMCP("linearr", instructions=INSTRUCTIONS)
    enabled = resolve_toolsets(api)
    reg = ToolRegistry(mcp, api, enabled)

    # Registration order sets the order tools appear in `tools/list`.
    for module in (channels, icons, assignments, plex, collections, blocks,
                   tunarr, watermark, ai, system):
        module.register(reg, api)

    # Resources take the raw server: they are not gated or instrumented.
    resources.register(mcp, api)

    # Additive on purpose: a tool's toolset never changes, and a second build
    # (a test constructing a gated server) must not erase the first build's map.
    TOOLSET_OF.update(reg.toolset_of)
    counts = reg.counts()
    info = [{"name": t, "enabled": t in enabled, "tool_count": counts[t]}
            for t in TOOLSETS]
    return mcp, info
