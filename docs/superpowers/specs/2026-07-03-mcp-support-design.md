# MCP Support for Linearr — Design

Date: 2026-07-03
Status: Approved (user confirmed shape, scope, and Plex smart-collection extension)

## Goal

Expose Linearr's Cable Plex functionality to AI assistants (Claude Code, Claude
Desktop, any MCP client) through a built-in Model Context Protocol server, so a
user can manage channels, browse their Plex library, assign content, and
build/manage collections conversationally.

## Architecture

- **Transport:** Streamable HTTP MCP endpoint mounted at `/mcp` inside the
  existing FastAPI app (official `mcp` Python SDK, FastMCP). Stateless mode +
  JSON responses for maximum client compatibility. Same container, same port —
  no new processes.
- **Wiring:** `app.mount("/mcp", mcp_server.streamable_http_app())`; the MCP
  session manager runs inside main.py's existing lifespan.
- **Tools call internal functions directly** (the existing route handlers are
  plain callables) — no HTTP-to-self loop. `HTTPException`s raised by handlers
  are caught and converted to human-readable tool errors.

## Auth

- New `mcp_token` row in the `settings` table, auto-generated (48-hex chars)
  at startup if absent.
- The auth middleware requires `Authorization: Bearer <mcp_token>` for any
  `/mcp` path (constant-time compare). Session-cookie auth for `/api/*` is
  unchanged.
- New authenticated management endpoints:
  - `GET /api/mcp/info` → `{endpoint, token, tool_count}`
  - `POST /api/mcp/regenerate-token` → `{token}` (invalidates the old one)
- Settings → System gains an "MCP Server" card: endpoint URL, token
  (copyable, regenerable), and a ready-to-paste `claude mcp add` snippet.

## Plex smart collections (new backend capability)

Linearr already creates regular (`smart=0`) collections and knows the server's
`machineIdentifier`. We add rule-based smart collections:

- `POST /api/plex/smart-collections` — body:
  `{section_id, type: movie|show, title, filters, sort?, limit?}`.
  Builds a Plex smart-filter URI
  (`server://<machineId>/com.plexapp.plugins.library/library/sections/<id>/all?type=<n>&…`)
  and creates the collection with `smart=1`.
- `PUT /api/plex/smart-collections/{rating_key}` — update title and/or filters
  (filter update = `PUT /library/collections/{rk}/items?uri=<new uri>`;
  title update reuses the existing metadata-edit call).
- List and delete reuse the existing collection endpoints; the collections
  list gains a `smart` flag.

**Filter MVP:** `genres` (names, resolved to Plex tag IDs case-insensitively
via `/library/sections/{id}/genre`), `year_min`/`year_max` (`year>>=`/`year<<=`),
`decade`, `unwatched`, `content_rating`, `title_contains`; `sort` in
`title_asc|title_desc|year_asc|year_desc|added_desc|random`; `limit`.

## Tool surface (24 tools)

| Area | Tools |
|---|---|
| Channels (5) | `list_channels`, `get_channel` (with its assignments), `create_channel`, `update_channel`, `delete_channel` (cascades) |
| Library (6) | `list_libraries`, `browse_library`, `search_library`, `get_item`, `get_show_seasons`, `get_season_episodes` |
| Assignments (3) | `list_assignments` (all or per channel), `assign_items` (bulk by rating keys; item metadata fetched from Plex), `unassign_item` (by channel + rating key) |
| Collections (7) | `get_collection_status`, `build_collections` (from channel assignments), `list_plex_collections`, `get_collection_items`, `create_smart_collection`, `update_smart_collection`, `delete_collection` |
| Server (3) | `get_server_info`, `get_now_playing`, `get_recent_events` (Plex webhook feed) |

Conventions: compact JSON results; errors as human-readable strings ("Plex
token not configured — open Settings", "Channel 100 already exists");
destructive tools state consequences in their descriptions.

## Testing

`tests/test_mcp.py`:
- `/mcp` without / with wrong bearer → 401.
- With the real token: JSON-RPC `initialize`, `tools/list` (≥24 tools),
  `tools/call list_channels` and a `create_channel` → `get_channel` roundtrip
  against the test DB.
- Smart-collection URI builder unit-tested directly (no live Plex needed).
- Live curl smoke-run against a running instance before merge.

## Docs

- `docs/MCP.md` — setup per client (Claude Code, Claude Desktop via
  `mcp-remote`), full tool reference, security notes.
- CLAUDE.md — MCP section + new API routes.
- README — feature blurb.

## Out of scope (deferred)

- Blocks/slots and Tunarr push tools.
- OAuth-style MCP authorization.
- MCP resources/prompts (tools only for v1).
