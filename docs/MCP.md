# Linearr MCP Server

Linearr ships a built-in [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server at `/mcp`. Connect an AI assistant — Claude Code, Claude Desktop, or any MCP client — and drive the whole app conversationally: browse your Plex library, build channels, schedule them, push them to Tunarr, and read the logs when something goes wrong.

The endpoint runs inside the same container as the rest of Linearr (streamable HTTP, stateless, JSON responses) on the same port — `http://YOUR-HOST:8777/mcp` with the default compose file. No extra service to run.

## What you can do

Once connected, just ask:

> "Create a channel called **Halloween 24/7** and fill it with everything from my Horror Classics collection."

> "Make a smart collection of **unwatched 80s comedies**, sorted randomly."

> "Give channel 42 a weeknight prime-time block of Star Trek, then show me what the Tunarr push would look like."

> "Which channels have no schedule blocks yet?"

> "Search my library for Star Trek shows and assign them all to a new channel 60 called Trek TV."

> "Channel 118 isn't playing. Check Tunarr's status and the recent activity log."

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

## Toolsets

Tools are grouped into ten toolsets. **All are enabled by default** — the point of this server is that an assistant can do everything the UI can.

| Toolset | Covers |
|---|---|
| `channels` | The lineup: channel CRUD, reorder (which renumbers), packages, icons, 24/7 suggestions |
| `icons` | The reusable icon library, and importing logos from Tunarr |
| `assignments` | Which Plex items belong to which channel |
| `plex` | Library browsing and search, item detail, discovery hubs, history, ratings, scans, connection and auth diagnostics |
| `collections` | Plex collections — build, edit, smart collections — and the channel slots that point at them |
| `blocks` | The schedule: blocks, slots, reusable templates, daypart suggestions |
| `tunarr` | The playout server: links, schedule push, guide, smart collections, filler, sessions, import/export |
| `watermark` | Per-channel Tunarr watermark configuration |
| `ai` | Linearr's own AI advisors (these spend your OpenAI credits — see below) |
| `system` | Health, configuration, lineup export/import, presets, logs |

**Trimming the surface.** 129 tool schemas is real context cost in a client — roughly 20–25k tokens if everything is on. If you only ever use Linearr for, say, channels and Plex, turn the rest off:

- **Settings → System → MCP Server** — tick the toolsets you want, then Save.
- Or set the environment variable, which wins over the stored setting:
  ```yaml
  environment:
    - MCP_TOOLSETS=channels,plex,assignments,collections
  ```
  Use `all` (or leave it unset) for everything.

Tools are registered when the app starts, so **a change takes effect on the next restart**. The UI says so too. An unrecognised toolset name is ignored, and a selection that ends up empty falls back to all — a typo can't leave you with a server that has no tools.

## Safety annotations

Every tool declares what it does to your data, so a well-behaved client can auto-approve safe reads and prompt before anything destructive:

| Annotation | Meaning |
|---|---|
| `readOnlyHint` | Makes no change at all. Every `list_*` / `get_*` / `search_*` tool, plus all five `ai_*` tools (they return proposals). |
| `destructiveHint` | Removes or overwrites something you'd miss. Marked **⚠** in the tables below. |
| `idempotentHint` | Calling it twice with the same arguments has the same effect as calling it once. |
| `openWorldHint` | Reaches Plex or Tunarr, so the result depends on a system outside Linearr. |

Every tool call — success or failure, with a redacted argument summary and a duration — lands in the Activity Log under category `mcp`. Read it with `get_logs`, or in the UI.

## Tool reference

**129 tools**, grouped by toolset. Arguments marked `?` are optional; **⚠** marks a destructive tool.

#### `channels` (11)

| Tool | Arguments | What it does |
|---|---|---|
| `list_channels` | — | List all channels in the lineup (number, name, tier, vibe, mode, style, color). |
| `get_channel` | `number` | Get one channel plus everything assigned to it (titles, types, years). |
| `create_channel` | `number`, `name`, `tier`?, `vibe`?, `mode`?, `style`?, `color`? | Create a channel. tier: 'Galaxy Main' \| 'Classics' \| 'Galaxy Premium'. mode: 'Shuffle' \| 'Flex' \| 'Sequential'. If Tunarr is configured, this also CREATES a matching Tunarr channel and links it (not just a sync). |
| `update_channel` | `number`, `new_number`?, `name`?, `tier`?, `vibe`?, `mode`?, `style`?, `color`? | Update a channel. Only the fields you pass change; pass new_number to renumber (assignments, blocks and links follow the channel). If Tunarr is configured and no link exists yet, a matching Tunarr channel may be created. |
| `delete_channel` | `number`, `delete_tunarr`? | **⚠** Delete a channel. DESTRUCTIVE: also removes its assignments, schedule blocks, collection links and Tunarr links. Cannot be undone. By default this ALSO deletes the linked Tunarr channel and its programming; pass delete_tunarr=false to keep it and only unlink. |
| `reorder_channel` | `moved_number`, `target_index`, `target_tier`? | Move a channel to a new position in the lineup. This RENUMBERS it — `number` is the primary key, so ordering is by number and there is no separate order column. `target_index` is the 0-based index the channel should occupy in the RESULTING lineup. Pass `target_tier` only for a cross-tier move. Assignments, blocks, collection links, Tunarr links and AI logs all follow the channel. Tunarr is renumbered after the local commit; entries in `tunarr.failed` mean Tunarr is out of step, NOT that the reorder failed. |
| `sync_channel_to_tunarr` | `channel_number` | Push a channel's name, number and icon to its linked Tunarr channel. |
| `create_channel_package` | `channels` | Create several channels at once. Each entry needs `number` and `name`; `tier`, `vibe`, `mode`, `description`, `color` are optional. Numbers that already exist are skipped, not errors. Local only — unlike `create_channel` this does NOT create matching Tunarr channels; call `export_channels_to_tunarr` afterwards if you want them. |
| `suggest_247_channels` | — | Analyse the Plex library and suggest 24/7 single-show or franchise channels worth creating. Library analysis, not an AI call — no API key needed. |
| `set_channel_icon` | `channel_number`, `icon`?, `icon_id`? | Set a channel's icon, from a base64 data URI (`icon`) or an entry in the icon library (`icon_id`). Also re-syncs the channel — and any icon-following watermark — to Tunarr. |
| `clear_channel_icon` | `channel_number` | **⚠** Remove a channel's icon, clearing it in Tunarr too. |

#### `icons` (5)

| Tool | Arguments | What it does |
|---|---|---|
| `list_icon_library` | `include_data`? | List saved icons (id, name, category). Data URIs are stripped unless `include_data` is true — they are large and rarely useful to read. |
| `save_icon` | `name`, `data`, `category`? | Save an icon to the library. `data` is a base64 data URI. |
| `update_saved_icon` | `icon_id`, `name`?, `category`?, `data`? | Rename, recategorise or replace a saved icon. Only fields you pass change. |
| `delete_saved_icon` | `icon_id` | **⚠** Delete an icon from the library. Channels already using it keep their copy. |
| `import_icons_from_tunarr` | — | Pull channel logos from Tunarr into the icon library. |

#### `assignments` (4)

| Tool | Arguments | What it does |
|---|---|---|
| `list_assignments` | `channel_number`? | List content assignments — all channels, or one channel if channel_number given. |
| `assign_items` | `channel_number`, `rating_keys` | Assign Plex items (movies/shows) to a channel by rating key. Fetches each item's metadata from Plex; duplicates are skipped, not errors. |
| `unassign_item` | `channel_number`, `rating_key` | **⚠** Remove one assigned item from a channel (by Plex rating key). |
| `purge_channel_content` | `channel_number`, `content_type`? | **⚠** Bulk-remove a channel's assigned content. DESTRUCTIVE. content_type: 'movies' removes all movies, 'shows' removes all shows, 'both' clears everything assigned to the channel. Returns how many items were removed. |

#### `plex` (21)

| Tool | Arguments | What it does |
|---|---|---|
| `list_libraries` | — | List the Plex libraries (movie/show sections) with their section ids. |
| `browse_library` | `section_id`, `type_filter`?, `genre`?, `year`?, `content_rating`?, `offset`?, `limit`? | Browse a Plex library section. type_filter: all\|movie\|show. Filter by genre name, year, or content rating. Paged — returns total plus a window. |
| `search_library` | `query`, `type_filter`? | Search the whole Plex server for movies/shows by title. type_filter: all\|movie\|show. |
| `get_item` | `rating_key` | Full details for one Plex item: summary, genres, duration, ratings, media quality. |
| `get_show_seasons` | `rating_key` | List a show's seasons (pass the show's rating_key). |
| `get_season_episodes` | `rating_key` | List a season's episodes (pass the season's rating_key from get_show_seasons). |
| `get_server_info` | — | Plex server metadata: name, version, platform, library summary. Good health check. |
| `get_now_playing` | — | What's streaming on the Plex server right now (active sessions). |
| `get_recent_events` | `limit`? | Recent Plex webhook events recorded by Linearr (new content, playback, etc.). |
| `get_library_filters` | `section_id` | Available filter values for a library section: genres, years, content ratings. Use this before `browse_library` so you filter on values that actually exist in the library. |
| `get_library_stats` | — | Counts and totals per Plex library section. |
| `get_plex_highlights` | `kind`?, `limit`? | Curated item lists from Plex. kind: recently_added \| on_deck \| popular. |
| `get_plex_hubs` | `section_id`? | Plex's own recommendation hubs — server-wide, or for one section. |
| `get_watch_history` | `limit`? | Recently watched items from the Plex server's history. |
| `list_playlists` | — | Playlists on the Plex server. |
| `rate_item` | `rating_key`, `rating` | Set the user rating on a Plex item. 0 clears it, 1-10 sets it. |
| `scan_library` | `section_id` | Ask Plex to rescan a library section for new files. |
| `clear_recent_events` | — | **⚠** Delete the stored Plex webhook event history. |
| `test_plex_connection` | — | Check that Linearr can reach Plex with the configured URL and token. |
| `get_plex_auth_info` | — | How Linearr authenticates to Plex: legacy token or JWT device key, token age, and whether it needs refreshing. Never returns the token. |
| `refresh_plex_token` | — | Mint a fresh Plex token from the stored device key (JWT auth only). JWT tokens last about 7 days — check `get_plex_auth_info` first. |

#### `collections` (16)

| Tool | Arguments | What it does |
|---|---|---|
| `get_collection_status` | `channel_number` | Check whether Plex collections already exist for a channel's movies/shows. |
| `build_collections` | `channel_number` | Create/update Plex collections from a channel's assignments (one for movies, one for shows) and link them to the channel. Also syncs Tunarr if linked. |
| `list_plex_collections` | `offset`?, `limit`? | List collections on the Plex server (title, type, item count, smart flag). Paged — returns total plus a window. |
| `get_collection_items` | `rating_key`, `offset`?, `limit`? | List the items inside a Plex collection. Paged — returns total plus a window. |
| `create_smart_collection` | `section_id`, `title`, `type`?, `genres`?, `year_min`?, `year_max`?, `decade`?, `unwatched`?, `content_rating`?, `title_contains`?, `sort`?, `limit`? | Create a rule-based Plex smart collection that stays current automatically. Genres are names (e.g. ['Horror']); sort: title_asc\|title_desc\|year_asc\| year_desc\|added_desc\|random. type: movie\|show. |
| `update_smart_collection` | `rating_key`, `section_id`, `type`?, `title`?, `genres`?, `year_min`?, `year_max`?, `decade`?, `unwatched`?, `content_rating`?, `title_contains`?, `sort`?, `limit`? | Update a smart collection's title and/or REPLACE its filter rules. Filter rules are only touched when at least one filter argument (genres, year_min/max, decade, unwatched, content_rating, title_contains, sort, limit) is provided — passing only `title` renames without changing rules. When replacing rules, pass the COMPLETE new rule set: whatever you send becomes the entire filter. |
| `delete_collection` | `rating_key` | **⚠** Delete a Plex collection (regular or smart). DESTRUCTIVE — removes it from Plex and unlinks it from any channel. Library items themselves are untouched. |
| `create_collection` | `section_id`, `title`, `rating_keys`, `type`? | Create a regular (non-smart) Plex collection from a list of items. type: movie \| show. For a rule-based collection that keeps itself current, use `create_smart_collection` instead. |
| `add_collection_items` | `rating_key`, `item_keys` | Add items to an existing Plex collection, by their rating keys. |
| `remove_collection_item` | `rating_key`, `item_key` | **⚠** Remove one item from a Plex collection. The library item is untouched. |
| `update_collection` | `rating_key`, `title`?, `summary`? | Rename a Plex collection or change its summary. |
| `list_channel_collections` | `channel_number` | Which Plex collections a channel uses, keyed by content type ('movie' / 'show'). `source` is 'owned' for a collection Linearr generates and manages, 'assigned' for one the user pointed the channel at; `linearr_created` marks the ones Linearr built in Plex itself. |
| `assign_collection_to_channel` | `channel_number`, `plex_type`, `collection_rating_key`, `collection_title`, `is_smart`? | Point a channel at an EXISTING Plex collection, BY REFERENCE. Nothing is copied and nothing in Plex is modified — this only records that the channel uses that collection. One collection per type, so assigning replaces whatever was in that slot. To copy a collection's items into the channel's assignments instead, use `import_collection_to_channel`. Collections named '{Channel} Movies' or '{Channel} TV' are rejected: those names belong to the collections Linearr generates and manages, and a later build would rewrite their contents. |
| `import_collection_to_channel` | `channel_number`, `plex_type`, `collection_rating_key`, `collection_title` | COPY every item in a Plex collection into a channel's assignments. A one-time import: later changes to the collection do not follow. To track the collection instead, use `assign_collection_to_channel`. |
| `unlink_channel_collection` | `channel_number`, `plex_type` | **⚠** Clear a channel's collection slot for one content type. The Plex collection itself is not deleted. |
| `create_channel_smart_collection` | `channel_number`, `section_id`, `title`, `type`?, `genres`?, `year_min`?, `year_max`?, `decade`?, `unwatched`?, `content_rating`?, `title_contains`?, `sort`?, `limit`? | Create a Plex smart collection AND assign it to a channel, atomically. Same filters as `create_smart_collection`. If the assign fails the new collection is deleted again, so a failure never leaves an orphan. |

#### `blocks` (14)

| Tool | Arguments | What it does |
|---|---|---|
| `list_blocks` | `channel_number`? | List schedule blocks for a channel. Omit `channel_number` to list the generic, reusable blocks instead. |
| `create_block` | `name`, `channel_number`?, `days`?, `start_time`?, `end_time`?, `content_type`?, `notes`?, `order_index`? | Create a schedule block. Times are 24h HH:MM. days: any of mon,tue,wed,thu,fri,sat,sun. content_type: movies \| shows \| both. Omit `channel_number` to create a generic, reusable block. |
| `update_block` | `block_id`, `name`?, `channel_number`?, `days`?, `start_time`?, `end_time`?, `content_type`?, `notes`?, `order_index`? | Update a block. Only the fields you pass change — the rest keep their current values. (The underlying route replaces the whole row, so this tool reads the block first and merges.) |
| `delete_block` | `block_id` | **⚠** Delete a block and every slot in it. |
| `list_block_slots` | `block_id` | List the programmes scheduled inside a block, by time. |
| `add_block_slot` | `block_id`, `slot_time`, `plex_rating_key`, `plex_title`?, `plex_type`?, `duration_minutes`? | Schedule a programme inside a block at `slot_time` (24h HH:MM). Title and type are fetched from Plex when you don't supply them. |
| `update_block_slot` | `slot_id`, `slot_time` | Move a slot to a different time (24h HH:MM). |
| `swap_block_slots` | `block_id`, `slot_a`, `slot_b` | Swap the times of two slots in the same block. |
| `delete_block_slot` | `slot_id` | **⚠** Remove one slot from its block. |
| `clear_block_slots` | `block_id` | **⚠** Remove every slot from a block, keeping the block itself. |
| `apply_block` | `block_id`, `channel_number` | Copy a generic block (and its slots) onto a channel. The template is left as it was. |
| `get_block_suggestions` | `block_id` | Content from the channel's assignments that fits this block's content type and length. |
| `get_network_block_suggestions` | `channel_number`? | Standard cable-network dayparts (morning, prime time, late night…) to model a schedule on. Static reference data, not an AI call. |
| `list_schedule_templates` | — | Prebuilt whole-day schedule templates that can be turned into blocks. |

#### `tunarr` (35)

| Tool | Arguments | What it does |
|---|---|---|
| `get_tunarr_status` | — | Is Tunarr reachable, at what version, and is that version supported? Combines the connection test and the version check — start here when anything Tunarr-related is failing. |
| `list_tunarr_channels` | — | Channels that exist in Tunarr (id, number, name). |
| `get_tunarr_channel` | `tunarr_id` | Full Tunarr channel record: transcoding, watermark, guide settings. |
| `get_tunarr_schedule` | `tunarr_id`, `hours`? | What a Tunarr channel will play over the next `hours`. |
| `get_tunarr_channel_shows` | `tunarr_id` | Which shows and movies a Tunarr channel draws from. |
| `get_tunarr_guide` | `hours`? | The whole-lineup EPG for the next `hours`. |
| `get_tunarr_endpoints` | `channel_number`? | URLs for the XMLTV guide, the M3U playlist, and a channel's live stream. These are Linearr-proxied paths, not Tunarr's own: Tunarr emits URLs on its container hostname, which a browser on the LAN cannot resolve. Pass `channel_number` to also get that channel's stream URL. The XMLTV, M3U and stream bodies are downloads/video and are not returned here. |
| `get_tunarr_debug_info` | — | Diagnostic dump of what Tunarr's API reports — for troubleshooting a sync or push that is not behaving. |
| `list_tunarr_links` | `kind`? | Which Linearr channels are linked to which Tunarr channels and collections. kind: channel \| collection \| all. |
| `link_tunarr_channel` | `channel_number`, `tunarr_id`, `tunarr_name`?, `tunarr_number`? | Link a Linearr channel to an existing Tunarr channel by its uuid. |
| `unlink_tunarr_channel` | `channel_number` | **⚠** Break the link. The Tunarr channel itself is not deleted. |
| `link_tunarr_collection` | `channel_number`, `plex_type`, `tunarr_collection_id`, `tunarr_collection_name`? | Link a channel's movie or show collection to a Tunarr smart collection. plex_type: movie \| show. |
| `unlink_tunarr_collection` | `channel_number`, `plex_type` | **⚠** Break a channel-to-Tunarr-collection link. |
| `push_schedule_to_tunarr` | `channel_number`, `preview`? | Turn a channel's blocks into a Tunarr time-slot schedule and push it. PREVIEWS BY DEFAULT: with `preview` true nothing is written and you get the schedule that would be pushed. Pass `preview=false` to apply it, which REPLACES the Tunarr channel's existing schedule. |
| `sync_channel_collections_to_tunarr` | `channel_number` | Create or refresh the Tunarr smart collections backing a channel's Plex collections, and link them. Runs a library scan in Tunarr first, because a tag-based smart collection needs the Plex collection to already exist as a tag in Tunarr's index. |
| `run_tunarr_task` | `task_name` | Run a Tunarr maintenance task: UpdateXmlTvTask (rebuild the guide) or ScanLibrariesTask (re-index the Plex sources). |
| `refresh_tunarr_xmltv` | — | Force Tunarr to regenerate its XMLTV guide now. |
| `list_tunarr_smart_collections` | — | Smart collections defined inside Tunarr (not the Plex ones). |
| `create_tunarr_smart_collection` | `name`, `filter`?, `filter_string`? | Create a Tunarr smart collection. Give either a structured `filter` object or a simple `filter_string` like `tags = "My Collection"`, which is translated for you. Tunarr ignores filterString on writes, so passing one through verbatim would create a collection with NO rules — Linearr checks the response echoes the rules back before reporting success. |
| `update_tunarr_smart_collection` | `sc_id`, `name`?, `filter`?, `filter_string`? | Rename a Tunarr smart collection and/or replace its rules. A name-only call is a plain rename and leaves the rules alone. |
| `delete_tunarr_smart_collection` | `sc_id` | **⚠** Delete one Tunarr smart collection. |
| `purge_tunarr_smart_collections` | — | **⚠** DESTRUCTIVE: delete Tunarr smart collections in bulk. Read the response to see what actually went. |
| `list_tunarr_custom_shows` | — | Tunarr 1.3 custom shows. Empty on older Tunarr versions. |
| `list_tunarr_filler_lists` | — | Filler lists — the interstitials Tunarr plays between programmes. |
| `get_tunarr_filler_list` | `filler_id`, `include_programs`? | One filler list. Set `include_programs` to also list its contents. |
| `create_tunarr_filler_list` | `filler_list` | Create a filler list. `filler_list` is passed to Tunarr as-is — use Tunarr's own filler-list shape (`name`, `programs`). |
| `update_tunarr_filler_list` | `filler_id`, `filler_list` | Update a filler list. `filler_list` is passed to Tunarr as-is. |
| `delete_tunarr_filler_list` | `filler_id` | **⚠** Delete a filler list. |
| `list_tunarr_sessions` | — | Who is watching which Tunarr channel right now. |
| `stop_tunarr_sessions` | `channel_id` | **⚠** Cut every active stream on a Tunarr channel. Viewers are disconnected mid-programme. |
| `get_tunarr_xmltv_settings` | — | Tunarr's XMLTV guide settings (refresh interval, programme count). |
| `update_tunarr_xmltv_settings` | `settings` | Update Tunarr's XMLTV settings. Passed to Tunarr as-is — read `get_tunarr_xmltv_settings` first and send back the same shape. |
| `preview_tunarr_import` | `channel_ids`? | Show how Tunarr's channels would map onto Linearr channels — what would be created, matched or skipped. Changes nothing. |
| `import_tunarr_channels` | `actions` | Import channels from Tunarr into Linearr. Run `preview_tunarr_import` first and pass the actions you want from its result. |
| `export_channels_to_tunarr` | `channel_numbers`?, `sync_collections`? | Create or link Tunarr channels for Linearr channels. Pass a list of numbers, or "all". With `sync_collections` it also builds the backing Tunarr smart collections. |

#### `watermark` (6)

| Tool | Arguments | What it does |
|---|---|---|
| `get_channel_watermark` | `channel_number` | Read a channel's watermark config. `{"watermark": null}` means none is set. |
| `set_channel_watermark` | `channel_number`, `enabled`?, `position`?, `width`?, `vertical_margin`?, `horizontal_margin`?, `duration`?, `opacity`?, `fixed_size`?, `use_channel_icon`?, `fade_period_mins`?, `fade_leading_edge`? | Set a channel's watermark and re-sync it to Tunarr. position: top-left \| top-right \| bottom-left \| bottom-right. `width` is a percent of frame width and must be > 0 (inert when `fixed_size`). opacity 0-100, margins 0-100, `duration` in seconds (0 = always on). Set `fade_period_mins` (>= 1) to fade it in and out. No image is required. With none set, Linearr omits the image URL from the Tunarr payload and Tunarr draws the channel's own icon. Call `set_watermark_image` only to use a DIFFERENT image from the icon. |
| `clear_channel_watermark` | `channel_number` | **⚠** Remove a channel's watermark and push `enabled: false` to Tunarr. |
| `audit_watermarks` | — | Find channels that will NOT PLAY because their watermark is enabled with no image. Tunarr builds a dangling ffmpeg `-i` for those, the transcode exits 254, no playlist is written and the channel 404s in a retry loop. `can_use_icon` marks the ones `repair_watermarks` can fix while keeping the watermark; the rest can only be switched off. |
| `repair_watermarks` | `channel_number`? | Fix channels stuck with an enabled, imageless watermark so they play again. Per channel: upload its icon and keep the watermark if it has one, otherwise switch the watermark off. Omit `channel_number` to repair every affected channel; run `audit_watermarks` first to see what will change. |
| `set_watermark_image` | `channel_number`, `image`?, `url`? | Resolve the watermark image to an absolute URL Tunarr can fetch. Pass `url` (an absolute URL, stored as-is), `image` (a data URI, uploaded to Tunarr), or neither to use the channel's icon. This step exists because Tunarr hands the value to ffmpeg as an HTTP input and ffmpeg cannot read a `data:` URI — which is also why inheriting the channel icon is an upload, not a copy. |

#### `ai` (5)

| Tool | Arguments | What it does |
|---|---|---|
| `ai_suggest_channels` | — | Propose new channels and channel packages from the current lineup and library. Returns suggestions only — nothing is created. Spends the OpenAI credits of the key configured in Linearr's Settings. |
| `ai_suggest_channel_content` | `channel_number` | Propose library content that would suit a channel's vibe. Returns suggestions only. Spends the configured OpenAI key's credits. |
| `ai_network_advisor` | — | Review the whole lineup — gaps, overlaps, balance. Advice only. Spends the configured OpenAI key's credits. |
| `ai_generate_day` | `channel_number`, `style`? | Draft a full day of schedule blocks for a channel. style: cable \| kids \| anime \| movies. Returns the draft — create the blocks yourself with `create_block`. Spends the configured OpenAI key's credits. |
| `ai_autofill_block` | `block_id`, `channel_number`? | Draft slots to fill a block from the channel's assigned content. Returns the draft — add them yourself with `add_block_slot`. Spends the configured OpenAI key's credits. |

#### `system` (12)

| Tool | Arguments | What it does |
|---|---|---|
| `get_health` | — | Is Linearr healthy? Reports app version and database status. |
| `get_configuration` | — | Linearr's configuration: Plex URL, Tunarr URL, AI model and base URL, and whether each credential is set. Never returns a credential value. |
| `update_configuration` | `plex_url`?, `tunarr_url`?, `openai_base_url`?, `openai_model`?, `plex_token`?, `openai_api_key`? | Change Linearr's URLs and AI model. Credentials CANNOT be set here — `plex_token` and `openai_api_key` are accepted only so the call fails loudly instead of appearing to work. Set them in Settings in the UI. |
| `export_lineup` | `channel_number`? | Export the whole lineup — channels, assignments, blocks, slots and collection links — as JSON. Pass `channel_number` for a single channel. The result is what `import_lineup` / `import_channel` take back. |
| `import_lineup` | `data`, `mode`? | **⚠** Import a lineup export. mode 'merge' adds what is missing and skips what already exists. mode 'replace' DELETES every channel, assignment, block and slot first — there is no undo. |
| `import_channel` | `data` | Import one channel export (channel + assignments + blocks + slots). A channel already on that number is overwritten, keeping its uid. |
| `list_preset_lineups` | — | Prebuilt lineups available to import (id, name, channel count). |
| `import_preset_lineup` | `lineup_id`, `mode`? | **⚠** Import a prebuilt lineup. mode 'replace' WIPES the current lineup first; 'merge' adds only what is missing. |
| `get_logs` | `kind`?, `limit`? | Read Linearr's logs. kind 'app' is the Activity Log — every action, including every MCP tool call. kind 'ai' is the AI request log. |
| `get_log_stats` | — | Log volume by category and level — a quick read on what is misbehaving. |
| `clear_logs` | `kind`? | **⚠** Delete a log entirely. kind: app \| ai. There is no other copy. |
| `purge_logs` | `days`? | **⚠** Delete log entries older than `days`. |

**Smart collection filters** (`create_smart_collection`, `update_smart_collection`, `create_channel_smart_collection`): `genres` (names, e.g. `["Horror"]` — resolved to Plex tag ids), `year_min`/`year_max` (inclusive), `decade` (e.g. `1980`), `unwatched`, `content_rating` (e.g. `"PG"`, `"TV-14"`), `title_contains`. Sort: `title_asc` | `title_desc` | `year_asc` | `year_desc` | `added_desc` | `random`. `limit` caps the item count. `type`: `movie` | `show`.

## Resources

Four read-only resources, for pulling context without spending a tool call:

| URI | Contents |
|---|---|
| `linearr://lineup` | Every channel with its assignment and block counts |
| `linearr://channel/{number}` | One channel: metadata, assignments, blocks, collection links |
| `linearr://libraries` | Plex library sections and their ids |
| `linearr://status` | Health of Linearr, Plex (URL + auth mode), Tunarr, and the AI configuration. No secrets |

## What is deliberately not exposed

Some routes exist in Linearr's HTTP API but are not MCP tools, on purpose. If an assistant goes looking for these, the answer is "use the UI":

| Not a tool | Why |
|---|---|
| Database backup / restore | Restore replaces the entire database, and a SQLite file doesn't move usefully through a chat transport. |
| The direct stream URL for a Plex item | It embeds your Plex token. Handing that to a model writes a credential into a transcript. |
| Setting `plex_token` or `openai_api_key` | `update_configuration` refuses them outright. A bearer token that can also rewrite credentials is a far bigger blast radius than one that can rewrite a lineup. Credentials are set in Settings. |
| Plex OAuth PIN start/status | Interactive browser flows an assistant can't complete. (`refresh_plex_token` and `get_plex_auth_info` *are* exposed — those are non-interactive.) |
| Thumbnail and Tunarr image proxies | Binary image proxies for the browser. A client wants URLs, not JPEG bytes. |
| The channel stream proxy (`/api/tunarr/stream/…`) | It serves an HLS playlist and video segments to a player. `get_tunarr_endpoints` returns the stream URL instead. |
| Icon pack export / import / seed | Megabytes of base64 PNG — pure cost in a transcript, no interpretive value. |
| The Plex webhook receiver | An inbound endpoint for Plex, not a user action. |
| Login / logout | MCP authenticates with the bearer token; session cookies are the browser's business. |
| AI provider key tests (`/api/ai-models`, `/api/ai-test`) | Credential probes that take an API key as an argument. |

## Security

- **The token is full control** of your lineup, your Plex collections, and your Tunarr channels. Among the 127 tools it reaches are `delete_channel`, `import_lineup` in `replace` mode (which wipes every channel, assignment, block and slot), `purge_tunarr_smart_collections`, `stop_tunarr_sessions`, and `clear_logs`. Treat it like a password.
- The destructive tools are annotated `destructiveHint`, so a client that honours annotations will ask before running them. Not every client does — that's a reason to trust the token, not the client.
- The `/mcp` endpoint is exposed on your LAN exactly like the rest of Linearr (host port 8777). Anyone on the network with the token can use it.
- **Rotate the token** (Settings → System → MCP Server → Regenerate) if you suspect it leaked.
- For access from outside your network, put Linearr behind an **HTTPS reverse proxy** — a bearer token over plain HTTP on the open internet is trivially interceptable.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `401 Unauthorized` | Wrong token, missing `Authorization: Bearer` header, or the token was regenerated since the client was configured. Copy the current token from Settings → System → MCP Server |
| A tool you expected is missing | Its toolset is switched off. Check Settings → System → MCP Server (or the `MCP_TOOLSETS` environment variable), then restart Linearr — tools are registered at startup |
| Tools fail with "Plex token not configured" | Linearr itself isn't connected to Plex yet. Configure the Plex URL and token in **Settings** first — the MCP tools reuse Linearr's Plex connection |
| Every `tunarr_*` tool fails | Run `get_tunarr_status` — it reports whether Tunarr is reachable, at what version, and whether that version is supported |
| The `ai_*` tools fail | They need an OpenAI API key configured in **Settings → AI**. They spend your credits; the calling assistant can usually do the same reasoning itself for free |
| A watermark won't enable | Tunarr needs an image URL to draw. Call `set_watermark_image` first (or leave `use_channel_icon` on for a channel that has an icon) |
| Client can't connect at all | Verify the URL (`http://YOUR-HOST:8777/mcp`) is reachable from the machine running the client, and that your client uses the streamable HTTP transport (Claude Desktop needs the `mcp-remote` bridge shown above) |
