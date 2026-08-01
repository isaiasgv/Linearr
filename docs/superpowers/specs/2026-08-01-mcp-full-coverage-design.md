# Linearr MCP — full-capability coverage

**Date:** 2026-08-01
**Status:** Approved for implementation
**Scope:** Audit the existing MCP server and expand it so every capability Linearr
exposes over `/api/*` is reachable over `/mcp`, with the ergonomics, safety
metadata, docs and tests that "properly" implies.

---

## 1. Where we are today

The MCP server lives in a ~450-line section at the bottom of `main.py`
(`# ── MCP server`). It registers **25 tools** over the streamable-HTTP
transport, authenticated by a bearer token (`settings.mcp_token`) checked in
`auth_middleware` before the session-cookie path. Tools call the internal route
handlers directly — no HTTP-to-self loop — and every call is wrapped by
`_instrument_mcp_tools()` so it lands in the Activity Log under category `mcp`.

That foundation is sound. The problem is coverage and metadata.

### 1.1 Coverage gap

`main.py` registers **~160 HTTP routes**. The MCP server exposes 25 tools
covering channels (CRUD), Plex browsing, assignments, and collections. Entire
feature domains are unreachable:

| Domain | Routes | MCP tools today |
|---|---|---|
| Schedule blocks + slots (the app's most complex feature) | 14 | **0** |
| Tunarr (links, push-schedule, guide, smart collections, filler, sessions, tasks, import/export) | 45 | **0** |
| Watermarks | 4 | **0** |
| Channel icons + icon library | 8 | **0** |
| Channel↔collection links | 5 | **0** |
| Plex discovery (recently added, on deck, popular, hubs, history, playlists, stats, filters) | 9 | **0** |
| Plex collection editing (create, add/remove items, rename) | 4 | **0** |
| AI advisors + generators | 6 | **0** |
| Export / import / presets | 6 | **0** |
| Logs + health + configuration | 8 | **0** |
| Channel reorder (renumber) | 1 | **0** |

An assistant connected to Linearr today can build a channel and fill it with
content, but cannot schedule it, cannot push it to Tunarr, cannot see whether
the push worked, and cannot read the logs to find out why it didn't. That is
the gap this work closes.

### 1.2 Audit findings on the existing 25

| # | Finding | Severity |
|---|---|---|
| A1 | **No tool annotations.** Not one tool declares `readOnlyHint` / `destructiveHint` / `idempotentHint`. A client cannot tell `list_channels` from `delete_channel`, so it cannot auto-approve safe reads or warn on destructive writes. The token is full control — this matters. | High |
| A2 | **Docs drift — phantom argument.** `docs/MCP.md` documents `update_smart_collection` as taking `update_filters?`. No such parameter exists; the implementation infers intent from whether any filter argument was supplied. A caller following the docs passes an unknown argument and gets a schema error. | High |
| A3 | **Docs drift — missing arguments.** `list_plex_collections` and `get_collection_items` both take `offset` / `limit` in code; `docs/MCP.md` lists them as taking none / only `rating_key`. | Medium |
| A4 | **Docs drift — tool count.** `docs/MCP.md` and `CLAUDE.md` both say "24 tools"; 25 are registered and `/api/mcp/info` reports the live count, so the UI already disagrees with the docs. | Low |
| A5 | **`_instrument_mcp_tools()` is a positional landmine.** It wraps whatever is registered *at the moment it runs*. Any tool registered after that line silently loses Activity-Log instrumentation and raw-`httpx`-error translation. Nothing enforces the ordering. | Medium |
| A6 | **`mcp_unassign_item` hand-writes SQL** instead of going through a handler, duplicating the delete + log logic that `delete_assignment` owns. | Low |
| A7 | **`browse_library` pages in memory** — it fetches the whole section then slices. Correct, but `limit=0` clamps to 1 via `max(1, min(limit, 200))`, which is a silently surprising result. | Low |
| A8 | **No `structured_output` / schema discipline** — tools return bare `dict`/`list`, so clients get text blobs. Acceptable, but worth stating as a deliberate choice rather than an accident. | Info |

### 1.3 Structural finding

`main.py` is **8130 lines**. Adding ~2000 lines of tool definitions to the
bottom of it makes an already-unwieldy file worse, and puts the app's entire
AI-facing contract in the same file as its SQL, its Plex proxy, and its Tunarr
writer. This design extracts the MCP surface into a package.

---

## 2. Goals and non-goals

**Goals**

1. Every capability Linearr exposes over HTTP that is *meaningful to an
   assistant* is reachable as an MCP tool.
2. Every tool carries accurate safety annotations.
3. The tool surface stays navigable: consistent naming, one toolset per domain,
   and per-toolset gating so an operator can trim the context cost.
4. Every tool is instrumented (Activity Log) by construction, not by ordering.
5. Docs match the implementation exactly, and a test enforces that.

**Non-goals — deliberate exclusions, with reasons**

| Excluded | Why |
|---|---|
| `POST /api/auth/login` `/logout` | MCP auth is the bearer token. Session cookies are the browser's business. |
| `GET /api/plex/thumb`, `GET /api/tunarr/image` | Binary image proxies for the browser. An MCP client wants URLs, not JPEG bytes. |
| `GET /api/plex/stream/{rating_key}` | Returns a direct stream URL **with the Plex token embedded**. Handing that to an LLM leaks a credential into a transcript. |
| `POST /api/plex/auth/start` / `status`, `jwt/start` / `status` | Interactive browser PIN flows. An assistant cannot complete them. `jwt/refresh` and `auth/info` *are* exposed — they are non-interactive. |
| `POST /api/plex/webhook` | Inbound webhook receiver for Plex, not a user action. |
| `GET /api/backup`, `POST /api/restore` | Backup streams a binary SQLite file; restore replaces the entire database. Catastrophic-by-design and a bad fit for a chat transport. The UI owns them. |
| `GET /api/icons/export`, `POST /api/icons/import`, `POST /api/icons/library/seed` | Bulk transfer of base64 PNG blobs. Enormous in context, zero interpretive value. |
| `POST /api/ai-models`, `POST /api/ai-test` | Provider credential probes that take an API key as an argument. |
| Writing secrets via `update_configuration` | `plex_token`, `openai_api_key` are settable over HTTP but **will not be settable over MCP**. Reading is already redacted server-side; writing stays a UI action. |
| MCP **prompts** | Every client supports tools; few surface prompts. The server `instructions` string already carries workflow guidance. Revisit if asked. |

---

## 3. Design

### 3.1 Module layout

Extract the MCP surface from `main.py` into a package, one module per toolset:

```
linearr_mcp/
├── __init__.py      # build_mcp_server(api, toolsets) — the only public entry
├── registry.py      # Toolset enum, tool() decorator factory, instrumentation
├── _request.py      # in-process Request shim for handlers typed `request: Request`
├── channels.py      # channels toolset
├── icons.py         # icons toolset
├── assignments.py   # assignments toolset
├── plex.py          # plex toolset
├── collections.py   # collections toolset
├── blocks.py        # blocks toolset
├── tunarr.py        # tunarr toolset
├── watermark.py     # watermark toolset
├── ai.py            # ai toolset
├── system.py        # system toolset
└── resources.py     # MCP resources
```

**No circular import.** `linearr_mcp` never imports `main`. `main.py`, at the
same point in the file where the MCP section lives today, does:

```python
import sys
from linearr_mcp import build_mcp_server
mcp_server, _mcp_toolset_info = build_mcp_server(sys.modules[__name__])
```

Every module receives the `api` module object and reads handlers off it
(`api.create_channel`, `api.ChannelIn`, `api._log_app`, …). `main.mcp_server`
stays bound exactly as today, so `_mcp_asgi`, `/api/mcp/info` and the existing
tests are unaffected.

`Dockerfile` line 28 must gain `COPY linearr_mcp/ ./linearr_mcp/` — without it
the container starts with no MCP module at all.

### 3.2 The `tool()` registry (fixes A1 and A5)

`registry.py` owns a `ToolRegistry` that wraps `FastMCP.tool`:

```python
reg.tool(name="delete_channel", toolset="channels", destructive=True)
reg.tool(name="list_channels", toolset="channels", read_only=True)
```

It does three things in one place:

1. Skips registration entirely when the toolset is disabled.
2. Attaches `ToolAnnotations(readOnlyHint=…, destructiveHint=…,
   idempotentHint=…, openWorldHint=…)`. `openWorldHint=True` for anything that
   talks to Plex or Tunarr.
3. Applies the Activity-Log + `httpx`-error wrapper **at registration time**,
   so instrumentation is structural. `_instrument_mcp_tools()`'s
   run-after-everything ordering requirement disappears (A5).

A test asserts every registered tool has annotations and a logging wrapper.

**Annotation rules**

| Class | `readOnly` | `destructive` | `idempotent` |
|---|---|---|---|
| `list_*` / `get_*` / `search_*` / `browse_*` | ✓ | — | ✓ |
| create / assign / link | — | ✗ (additive) | ✗ |
| update / set / sync / push | — | ✗ | ✓ |
| delete / clear / purge / unassign / unlink / import-replace | — | ✓ | ✓ |

### 3.3 Toolsets and gating

Ten toolsets: `channels`, `icons`, `assignments`, `plex`, `collections`,
`blocks`, `tunarr`, `watermark`, `ai`, `system`.

**All are enabled by default.** The brief is complete coverage out of the box.

Gating exists because ~120 tools is real context cost for a client (~20–25k
tokens of schema). Resolution order, first match wins:

1. `MCP_TOOLSETS` env var (comma-separated, or `all`).
2. Settings key `mcp_toolsets` (comma-separated, written by the UI).
3. Default: all.

`GET /api/mcp/info` gains `toolsets: [{name, enabled, tool_count}]`, and a new
`PUT /api/mcp/toolsets` persists the selection. Changing toolsets requires an
app restart to take effect (tools are registered at import); the API response
and the UI both say so.

Settings → System → MCP Server gains a compact checkbox row per toolset with
the live tool count and a "restart to apply" note.

### 3.4 Calling handlers typed `request: Request`

Several handlers (`set_channel_icon`, `plex_create_collection`,
`plex_add_collection_items`, `plex_update_collection`,
`tunarr_create_filler_list`, `tunarr_update_xmltv_settings`, `import_lineup`,
`import_channel`, `import_preset_lineup`, …) read their body via
`await request.json()` rather than a Pydantic model.

`_request.py` provides `json_request(body: dict) -> Request` — a Starlette
`Request` built over an in-memory `receive` that yields the encoded body once.
This keeps the tools calling the *real* handler instead of reimplementing it,
which is the invariant that stops MCP and HTTP behaviour from drifting (A6 is
the same class of bug: `mcp_unassign_item` gets rewritten to go through
`api.delete_assignment` after an id lookup).

### 3.5 Naming

Existing 25 tool names are **frozen** — renaming breaks every configured
client. New tools follow the same `verb_noun` style, with a domain word where
the noun alone is ambiguous (`push_schedule_to_tunarr`, not `push_schedule`).
Tunarr tools carry `tunarr` in the name because "channel" and "smart
collection" mean different things in Linearr and in Tunarr, and an assistant
that confuses the two produces convincing, wrong work.

### 3.6 Consolidation

Where sibling routes differ only by data source and share a response shape,
they become one tool with an enum argument — fewer near-identical schemas is
better tool selection, not just fewer tokens:

- `get_plex_highlights(kind: recently_added|on_deck|popular, limit)` — 3 routes.
- `get_logs(kind: app|ai, limit, category?)` and `clear_logs(kind)` — 4 routes.
- `export_lineup(channel_number?)` — 2 routes.
- `list_tunarr_links(kind: channel|collection|all)` — 2 routes.
- `get_tunarr_status()` — merges `/test` and `/version-check`.
- `get_tunarr_endpoints()` — returns the XMLTV and M3U **URLs**; the routes
  themselves stream files and are not exposed.
- `get_tunarr_filler_list(filler_id, include_programs=False)` — 2 routes.

Where arguments or semantics differ, tools stay separate. In particular
`assign_collection_to_channel` (link by reference, nothing copied) and
`import_collection_to_channel` (copies the collection's items into the channel
as assignments) are two tools, because collapsing them would hide the only
thing that matters about the choice.

### 3.7 Resources

Four read-only resources, for clients that can pull context without a tool call:

| URI | Contents |
|---|---|
| `linearr://lineup` | Every channel with assignment/block counts — the whole lineup at a glance |
| `linearr://channel/{number}` | One channel: metadata, assignments, blocks, links, watermark |
| `linearr://libraries` | Plex library sections |
| `linearr://status` | Health: DB, Plex reachable + auth mode, Tunarr reachable + version, AI configured |

### 3.8 Server instructions

The `FastMCP(instructions=…)` string is rewritten to describe the full model —
channels are the unit, assignments are content, blocks are the schedule,
collections are the Plex-side grouping, Tunarr is the playout target — plus the
two rules an assistant most needs: **reordering a channel renumbers it**, and
**`push_schedule_to_tunarr` defaults to `preview=True`**.

---

## 4. Tool inventory

Existing tools are marked ▪; new ones ✚. `R` = read-only, `D` = destructive.

### `channels` (11)

| Tool | | Handler |
|---|---|---|
| `list_channels` ▪ R | | `list_channels` |
| `get_channel` ▪ R | | `_get_channel` + assignments |
| `create_channel` ▪ | | `create_channel` |
| `update_channel` ▪ | | `update_channel` |
| `delete_channel` ▪ D | | `delete_channel` |
| `reorder_channel` ✚ | renumbers; returns `changed` + `tunarr.failed` | `reorder_channels` |
| `sync_channel_to_tunarr` ✚ | | `sync_channel_to_tunarr` |
| `create_channel_package` ✚ | bulk create, skips existing numbers | `create_channel_package` |
| `suggest_247_channels` ✚ R | library analysis, no AI key needed | `suggest_247_channels` |
| `set_channel_icon` ✚ | data URI or `icon_id` from the library | `set_channel_icon` |
| `clear_channel_icon` ✚ D | | `delete_channel_icon` |

### `icons` (5)

`list_icon_library` R (strips data URIs unless `include_data=True`),
`save_icon`, `update_saved_icon`, `delete_saved_icon` D,
`import_icons_from_tunarr`.

### `assignments` (4)

`list_assignments` ▪ R, `assign_items` ▪, `unassign_item` ▪ D (rewritten to go
through `delete_assignment`), `purge_channel_content` ▪ D.

### `plex` (21)

`list_libraries` ▪ R, `browse_library` ▪ R, `search_library` ▪ R, `get_item` ▪ R,
`get_show_seasons` ▪ R, `get_season_episodes` ▪ R, `get_server_info` ▪ R,
`get_now_playing` ▪ R, `get_recent_events` ▪ R,
✚ `get_library_filters` R, `get_library_stats` R, `get_plex_highlights` R,
`get_plex_hubs` R, `get_watch_history` R, `list_playlists` R,
`rate_item`, `scan_library`, `clear_recent_events` D,
`test_plex_connection` R, `get_plex_auth_info` R, `refresh_plex_token`.

### `collections` (16)

`get_collection_status` ▪ R, `build_collections` ▪, `list_plex_collections` ▪ R,
`get_collection_items` ▪ R, `create_smart_collection` ▪,
`update_smart_collection` ▪, `delete_collection` ▪ D,
✚ `create_collection`, `add_collection_items`, `remove_collection_item` D,
`update_collection`, `list_channel_collections` R,
`assign_collection_to_channel`, `import_collection_to_channel`,
`unlink_channel_collection` D, `create_channel_smart_collection`.

### `blocks` (14) — all new

`list_blocks` R (`channel_number` omitted ⇒ generic/reusable blocks),
`create_block`, `update_block`, `delete_block` D,
`list_block_slots` R, `add_block_slot` (takes a rating key; metadata fetched
from Plex, mirroring `assign_items`), `update_block_slot`, `swap_block_slots`,
`delete_block_slot` D, `clear_block_slots` D, `apply_block`,
`get_block_suggestions` R, `get_network_block_suggestions` R,
`list_schedule_templates` R.

### `tunarr` (35) — all new

*Status & read:* `get_tunarr_status` R, `list_tunarr_channels` R,
`get_tunarr_channel` R, `get_tunarr_schedule` R, `get_tunarr_channel_shows` R,
`get_tunarr_guide` R, `get_tunarr_endpoints` R, `get_tunarr_debug_info` R.

*Links:* `list_tunarr_links` R, `link_tunarr_channel`, `unlink_tunarr_channel` D,
`link_tunarr_collection`, `unlink_tunarr_collection` D.

*Push:* `push_schedule_to_tunarr` (**`preview=True` by default**),
`sync_channel_collections_to_tunarr`, `run_tunarr_task`, `refresh_tunarr_xmltv`.

*Smart collections:* `list_tunarr_smart_collections` R,
`create_tunarr_smart_collection`, `update_tunarr_smart_collection`,
`delete_tunarr_smart_collection` D, `purge_tunarr_smart_collections` D.

*Content:* `list_tunarr_custom_shows` R, `list_tunarr_filler_lists` R,
`get_tunarr_filler_list` R, `create_tunarr_filler_list`,
`update_tunarr_filler_list`, `delete_tunarr_filler_list` D.

*Sessions & settings:* `list_tunarr_sessions` R, `stop_tunarr_sessions` D,
`get_tunarr_xmltv_settings` R, `update_tunarr_xmltv_settings`.

*Migration:* `preview_tunarr_import` R, `import_tunarr_channels`,
`export_channels_to_tunarr`.

### `watermark` (4) — all new

`get_channel_watermark` R, `set_channel_watermark`, `clear_channel_watermark` D,
`set_watermark_image`.

### `ai` (5) — all new

`ai_suggest_channels`, `ai_suggest_channel_content`, `ai_network_advisor`,
`ai_generate_day`, `ai_autofill_block`.

All five **return proposals and write nothing** — annotated `readOnlyHint=True`,
`openWorldHint=True`. Each docstring states that the call spends the operator's
own OpenAI credits via the key configured in Settings, and that the calling
assistant can usually do the same reasoning itself for free.

### `system` (12) — all new

`get_health` R, `get_configuration` R (redacted; secrets never returned),
`update_configuration` (URLs and model only — **never** tokens or API keys),
`export_lineup` R, `import_lineup` D (`mode=merge|replace`; `replace` wipes
channels, assignments, blocks and slots), `import_channel`,
`list_preset_lineups` R, `import_preset_lineup` D,
`get_logs` R, `get_log_stats` R, `clear_logs` D, `purge_logs` D.

**Total: ~127 tools across 10 toolsets** (11 + 5 + 4 + 21 + 16 + 14 + 35 + 4 + 5 + 12).
The exact figure is asserted by a test against `/api/mcp/info` once built.

---

## 5. Error handling

Unchanged in shape, tightened in coverage:

- `HTTPException` → `RuntimeError(detail)` via `tool_error` — the client sees
  "Channel 42 not found", not a stack trace.
- `httpx.HTTPError` → `RuntimeError("Cannot reach the upstream server: …")`,
  applied by the registry wrapper so Plex/Tunarr being down never surfaces as a
  raw traceback.
- Every failure is logged at `error` level under category `mcp` with the tool
  name, a redacted argument summary, and the duration.
- Argument summarisation already truncates long strings and collapses long
  lists. It gains one rule: any argument whose name contains `icon`, `image`,
  `token`, `key` or `secret`, or whose value starts with `data:`, is logged as
  `"<redacted>"` — icon writes and configuration changes must not fill the
  Activity Log with base64 or credentials.

---

## 6. Testing

New `tests/test_mcp_tools.py` (per-toolset behaviour) plus additions to
`tests/test_mcp_hardening.py`. All tests use the existing JSON-RPC `_call`
helper and the `respx`-mocked Plex/Tunarr transports already in the suite.

Structural tests, which are the ones that keep this honest as the app grows:

1. **Every tool is annotated** — no tool may ship without `readOnlyHint` or an
   explicit write classification.
2. **Every tool is instrumented** — calling any read-only tool produces an
   Activity-Log entry under category `mcp`.
3. **Every tool belongs to a declared toolset**, and toolset tool-counts in
   `/api/mcp/info` sum to the registered total.
4. **Docs match code** — parse the tool tables in `docs/MCP.md` and assert the
   documented tool names are exactly the registered tool names. This makes
   findings A2–A4 unrepeatable.
5. **No tool leaks secrets** — `get_configuration` never returns a value for
   `plex_token` / `openai_api_key`; `update_configuration` rejects them.
6. **Toolset gating works** — disabling a toolset removes exactly its tools.

Behavioural tests cover, at minimum: block create → add slot → apply to
channel; watermark set → get → clear; a Tunarr link + preview push against the
mocked Tunarr; `import_lineup` in `merge` vs `replace`; `reorder_channel`
renumbering assignments along with the channel.

---

## 7. Documentation

- `docs/MCP.md` — rewritten. Toolset-grouped tool reference, the annotation
  legend, the toolset gating section with the context-cost note, the resources
  table, the deliberate-exclusions table from §2, and corrected arguments for
  `update_smart_collection`, `list_plex_collections`, `get_collection_items`.
- `CLAUDE.md` — the MCP paragraph is rewritten: new module layout, toolsets,
  the "handlers are called directly, never reimplemented" invariant, and the
  registry-owns-instrumentation rule that replaces the old ordering landmine.
- `README.md` — the MCP feature line updated with the real tool count.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Extracting ~450 lines out of `main.py` breaks imports at startup | The extraction lands as its own step with zero behaviour change and the full 505-test suite green before any new tool is written. |
| `Dockerfile` COPY misses the new package → container boots without MCP | Explicit step in the plan; verified with a real `docker compose build` + container start. |
| ~127 tools overwhelm a client | Toolset gating, on by default but one click to trim, documented with its token cost. |
| Destructive tools reachable by anyone holding the token | Accurate `destructiveHint` on all 20 destructive tools so clients prompt; the security section of `docs/MCP.md` restates that the token is full control. |
| Tunarr passthrough tools take opaque `dict` bodies | Documented as passthrough with the Tunarr shape named; the existing verified-write helpers (`_tunarr_write_smart_collection`) are reused, never bypassed. |
