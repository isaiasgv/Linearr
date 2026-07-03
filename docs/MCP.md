# Linearr MCP Server

Linearr ships a built-in [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server at `/mcp`. Connect an AI assistant — Claude Code, Claude Desktop, or any MCP client — and manage your channel lineup conversationally: browse your Plex library, create channels, assign content, and build collections without touching the UI.

The endpoint runs inside the same container as the rest of Linearr (streamable HTTP, stateless, JSON responses) on the same port — `http://YOUR-HOST:8777/mcp` with the default compose file. No extra service to run.

## What you can do

Once connected, just ask:

> "Create a channel called **Halloween 24/7** and fill it with everything from my Horror Classics collection."

> "Make a smart collection of **unwatched 80s comedies**, sorted randomly."

> "What's assigned to channel 42? Remove anything rated above PG-13."

> "Search my library for Star Trek shows and assign them all to a new channel 60 called Trek TV."

## Getting your token

The MCP endpoint is protected by a bearer token, auto-generated on first startup and stored in Linearr's database.

- Find it in the UI under **Settings → System → MCP Server**.
- Rotate it with the **Regenerate** button (or `POST /api/mcp/regenerate-token`). Regenerating **immediately invalidates** the old token — every connected client must be updated.

## Client setup

### Claude Code

```bash
claude mcp add --transport http linearr http://YOUR-HOST:8777/mcp --header "Authorization: Bearer YOUR_TOKEN"
```

### Claude Desktop

Claude Desktop doesn't speak HTTP transports directly, so bridge through [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) (requires Node.js). Add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "linearr": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://YOUR-HOST:8777/mcp",
        "--header",
        "Authorization: Bearer YOUR_TOKEN"
      ]
    }
  }
}
```

Restart Claude Desktop after saving.

### Any other MCP client

Point it at `http://YOUR-HOST:8777/mcp` using the **streamable HTTP** transport and send the header `Authorization: Bearer YOUR_TOKEN` on every request. The server is stateless and returns JSON responses, so no session negotiation or SSE stream is required.

## Tool reference

24 tools, grouped by area. Arguments marked `?` are optional.

### Channels

| Tool | Arguments | What it does |
|---|---|---|
| `list_channels` | — | List all channels (number, name, tier, vibe, mode, style, color) |
| `get_channel` | `number` | One channel plus everything assigned to it |
| `create_channel` | `number`, `name`, `tier?`, `vibe?`, `mode?`, `style?`, `color?` | Create a channel (tier: `Galaxy Main` \| `Classics` \| `Galaxy Premium`; mode: `Shuffle` \| `Flex` \| `Sequential`). Auto-syncs to Tunarr if linked |
| `update_channel` | `number`, `new_number?`, `name?`, `tier?`, `vibe?`, `mode?`, `style?`, `color?` | Update only the fields you pass; `new_number` renumbers (assignments, blocks, links follow) |
| `delete_channel` | `number` | **Destructive** — also removes the channel's assignments, schedule blocks, collection links, and Tunarr links. Cannot be undone |

### Plex library

| Tool | Arguments | What it does |
|---|---|---|
| `list_libraries` | — | List Plex libraries (movie/show sections) with section ids |
| `browse_library` | `section_id`, `type_filter?`, `genre?`, `year?`, `content_rating?`, `offset?`, `limit?` | Browse a section with filters; paged (returns total + a window, limit ≤ 200) |
| `search_library` | `query`, `type_filter?` | Search the whole server by title (`all` \| `movie` \| `show`) |
| `get_item` | `rating_key` | Full details for one item: summary, genres, duration, ratings, media quality |
| `get_show_seasons` | `rating_key` | List a show's seasons |
| `get_season_episodes` | `rating_key` | List a season's episodes (use a season rating_key from `get_show_seasons`) |

### Assignments

| Tool | Arguments | What it does |
|---|---|---|
| `list_assignments` | `channel_number?` | Assignments for all channels, or one channel |
| `assign_items` | `channel_number`, `rating_keys[]` | Assign items by rating key; metadata fetched from Plex; duplicates skipped, not errors |
| `unassign_item` | `channel_number`, `rating_key` | Remove one assigned item from a channel |

### Collections

| Tool | Arguments | What it does |
|---|---|---|
| `get_collection_status` | `channel_number` | Check whether Plex collections exist for a channel's movies/shows |
| `build_collections` | `channel_number` | Create/update Plex collections from a channel's assignments and link them; syncs Tunarr if linked |
| `list_plex_collections` | — | Every collection on the Plex server (title, type, item count, smart flag) |
| `get_collection_items` | `rating_key` | Items inside a collection |
| `create_smart_collection` | `section_id`, `title`, `type?`, `genres?`, `year_min?`, `year_max?`, `decade?`, `unwatched?`, `content_rating?`, `title_contains?`, `sort?`, `limit?` | Rule-based Plex collection that stays current automatically (see filters below) |
| `update_smart_collection` | `rating_key`, `section_id`, plus the same filter args, `title?`, `update_filters?` | Rename and/or replace a smart collection's rules (`update_filters=false` to rename only) |
| `delete_collection` | `rating_key` | **Destructive** — removes the collection (regular or smart) from Plex and unlinks it from any channel. Library items themselves are untouched |

**Smart collection filters:** `genres` (names, e.g. `["Horror"]` — resolved to Plex tag ids), `year_min`/`year_max` (inclusive), `decade` (e.g. `1980`), `unwatched`, `content_rating` (e.g. `"PG"`, `"TV-14"`), `title_contains`. Sort: `title_asc` | `title_desc` | `year_asc` | `year_desc` | `added_desc` | `random`. `limit` caps the item count. `type`: `movie` | `show`.

### Server

| Tool | Arguments | What it does |
|---|---|---|
| `get_server_info` | — | Plex server metadata: name, version, platform, library summary. Good health check |
| `get_now_playing` | — | Active Plex sessions (what's streaming right now) |
| `get_recent_events` | `limit?` | Recent Plex webhook events recorded by Linearr (new content, playback, etc.) |

## Security

- **The token is full control** of your channel lineup and Plex collections — including deleting channels and removing collections from Plex. Treat it like a password.
- The `/mcp` endpoint is exposed on your LAN exactly like the rest of Linearr (host port 8777). Anyone on the network with the token can use it.
- **Rotate the token** (Settings → System → MCP Server → Regenerate) if you suspect it leaked.
- For access from outside your network, put Linearr behind an **HTTPS reverse proxy** — a bearer token over plain HTTP on the open internet is trivially interceptable.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `401 Unauthorized` | Wrong token, missing `Authorization: Bearer` header, or the token was regenerated since the client was configured. Copy the current token from Settings → System → MCP Server |
| Tools fail with "Plex token not configured" | Linearr itself isn't connected to Plex yet. Configure the Plex URL and token in **Settings** first — the MCP tools reuse Linearr's Plex connection |
| Client can't connect at all | Verify the URL (`http://YOUR-HOST:8777/mcp`) is reachable from the machine running the client, and that your client uses the streamable HTTP transport (Claude Desktop needs the `mcp-remote` bridge shown above) |
