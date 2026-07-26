# Linearr — CLAUDE.md

Self-hosted TV channel schedule manager for Plex and Tunarr (Galaxy Network). Runs as a Docker container alongside Plex on the `plex_default` network.

---

<!-- repo-standards:branch-flow -->
## Branch + release flow

- `main` — stable. Tags like `linearr-v1.2.3` are cut from here.
- `release/<M.N>` — prerelease branch for an in-progress version. Publishes `-rc.N` images to GHCR (e.g. `linearr-v1.0.0-rc.4`).
- `dev` — continuous integration branch. Publishes `-dev.N` prerelease images.
- Feature branches → PR into `dev` (or `release/<M.N>` for a near-cut release).
- Versioning is **patch-only by default**. Minor/major bumps require either:
  - workflow_dispatch with `release_level=minor|major`, or
  - commit body containing `release-as: minor` / `release-as: major`.
- Container images are published only from `main` and `release/*` (the `dev` channel publishes prerelease tags but not `latest`).
- See `.releaserc.js` for the full semantic-release config.
<!-- /repo-standards:branch-flow -->

---

## Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, FastAPI, uvicorn |
| Frontend | React 18 + Vite + TypeScript (vertical slice architecture) |
| State | Zustand (UI state) + TanStack React Query (server state) |
| Styling | Tailwind CSS v4 (npm, not CDN; CSS-first `@theme` config in `src/index.css`, `@tailwindcss/postcss`) |
| Database | SQLite at `/app/data/assignments.db` (persisted via Docker volume `./data`) |
| Plex API | httpx async client, proxied through FastAPI routes |
| Auth | Stateless HMAC-SHA256 session cookie |
| Container | Port 8777 (host) → 8888 (container), external network `plex_default` |
| Build | Multi-stage Docker: Node 20 builds frontend → `/app/dist/`, Python 3.12 serves it |

**Key files:**
- `main.py` — all backend logic (routes, DB, Plex proxy); serves built React app from `/app/dist/`
- `frontend/` — React + Vite app (vertical slice: `src/features/`, `src/shared/`)
- `channels.py` — reference/seed list of Galaxy Network channels (`CHANNELS`). **Not imported at runtime** — channels live in the SQLite `channels` table; this file is a seed/reference snapshot and is excluded from the Docker image (`.dockerignore`).
- `.env` — secrets (not committed: `PLEX_TOKEN`, `APP_PASSWORD`, `APP_SECRET`)
- `docker-compose.yml` — service definition

---

## Running Locally

> Paths are relative to the **repo root** — `main.py`, `channels.py`, `frontend/`, and
> `docker-compose.yml` all live there (there is no `tunarr/channels/channel-manager/` subdir).

**Dev mode** (hot-reload frontend, backend on port 8888):
```bash
# Terminal 1 — FastAPI backend (repo root)
docker compose up -d   # or: uvicorn main:app --reload --port 8888

# Terminal 2 — Vite dev server (proxies /api → localhost:8888)
cd frontend
npm run dev   # http://localhost:5173
```

**Production build** (Docker, from repo root):
```bash
docker compose up --build -d
```

Logs: `docker compose logs -f linearr`

The `.env` file must have `PLEX_TOKEN` set for any Plex API calls to work.

---

## Frontend Architecture (React + Vite, Vertical Slices)

Code is organized by **feature domain** under `frontend/src/features/`. Each feature owns its API calls, React Query hooks, Zustand slices (if needed), types, and components. Shared infrastructure lives in `frontend/src/shared/`.

```
frontend/src/
├── main.tsx                    # React root, QueryClient, providers
├── App.tsx                     # Auth gate + layout shell
├── shared/
│   ├── api/client.ts           # Base fetch wrapper (cookies, 401 dispatch)
│   ├── store/ui.store.ts       # Navigation, modals, active view/tab/filter
│   ├── store/toast.store.ts    # Toast notification queue
│   ├── types/index.ts          # Types shared across features
│   ├── hooks/useDebounce.ts
│   └── components/
│       ├── ui/                 # Spinner, Toast, TierBadge, ModalWrapper, Logo
│       └── layout/             # AppLayout, TopBar
└── features/
    ├── auth/                   # Login/logout, session cookie
    ├── channels/               # Channel list, CRUD, sidebar
    ├── assignments/            # Plex item → channel assignments
    ├── plex/                   # Plex proxy (libraries, search, items, OAuth)
    ├── collections/            # Plex collection generation + channel links
    ├── blocks/                 # Schedule blocks + hour-grid editor (most complex)
    ├── content/                # ContentTab (composes plex + assignments + collections)
    ├── ai/                     # AI content advisor, network advisor, day generator
    ├── tunarr/                 # Tunarr channel links, schedules, smart collections
    ├── settings/               # Plex URL/token, AI keys, OAuth PIN flow
    ├── watermark/              # Per-channel Tunarr watermark config + live preview
    ├── cable-plex/             # Cable+Plex combined view + add-content picker/tray
    └── generic-blocks/         # Reusable blocks view (no channel context)
```

### Cable Plex view

Two layouts — **compact** (card grid) and **expanded** (wide rows with a full
poster strip). **Expanded is the default**; both the layout and the expanded
poster size are persisted in `localStorage` via `ui.store.ts`
(`linearr:cablePlexViewMode`, `linearr:cablePlexPosterSize`), so a stored
choice always beats the default.

Two ways to add content to a channel, both ending in ONE
`POST /api/assignments/bulk` (`useBulkAssign`):

- **Add-content modal** — the "+" affordance on a channel card opens the
  propless, store-driven `addContent` modal (target channel carried in
  `addContentChannel`). It embeds `PlexBrowser`; a sticky footer adds the whole
  selection at once.
- **Plex tray + drag** — the "Plex tray" drawer keeps posters on screen next to
  the cards. Dragging a poster that is part of the selection drags the whole
  selection, otherwise just that poster; channel cards are drop targets.

Both reuse one selection primitive: the **optional** `selectedKeys` /
`onToggleSelect` props on `features/plex/components/PosterGrid.tsx` (passed
through by `PlexBrowser`). Omit them and `PosterGrid` behaves exactly as it did
before — no checkboxes, no rings, no drag. Drag is native HTML5 with the
payload in `ui.store` (`draggingPlexItems` / `plexDropChannelNumber`) — there is
no drag library in `frontend/package.json` and there must not be one.

`toBulkAssignItem` (`features/assignments/utils.ts`) is the single
`PlexItem → bulk-assign row` mapping. Never client-filter duplicates — the DB
uniqueness constraint on `(channel_number, plex_rating_key)` skips them and the
response reports `{added, skipped}`.

### Path alias
`@/` maps to `frontend/src/` (configured in `vite.config.ts`). Use `@/shared/...` and `@/features/...`.

### State management
- **React Query** — all server state. Queries/mutations colocated in `features/<name>/hooks.ts`.
- **Zustand** — pure UI state only (selected channel, open modals, active tab, drag state).
- `ui.store.ts` holds navigation + modal state; `blocks/store.ts` holds drag + expansion state.

### React Query key conventions
```
['channels']
['assignments']
['blocks', { channelNumber }]
['blocks', 'generic']
['block-slots', blockId]
['plex', 'libraries']
['plex', 'search', { query, typeFilter }]
['plex', 'item', ratingKey]
['tunarr', 'channels']
['tunarr', 'links']
['tunarr', 'collection-links']
['tunarr', 'smart-collections']
['tunarr', 'schedule', tunarrId]
['watermark', channelNumber]
['ai-logs']
```

### Logo
The Linearr logo (`shared/components/ui/Logo.tsx`) is an inline SVG — an L-shape with EPG schedule bars, indigo→purple gradient. Used in `TopBar` and `LoginModal`. Static assets (favicon, PWA icons, manifest) are in `frontend/public/`.

---

## Database Schema

```sql
assignments          -- plex items assigned to channels
  (channel_number, plex_rating_key UNIQUE)
  fields: plex_title, plex_type, plex_thumb, plex_year

block_slots          -- scheduled slots within a block
  (block_id FK → blocks)
  fields: slot_time (HH:MM), plex_rating_key, plex_title, plex_type,
          plex_thumb, plex_year, duration_minutes (DEFAULT 60)

blocks               -- schedule time blocks per channel (or generic/reusable)
  fields: name, channel_number (NULL = generic), days (JSON array),
          start_time, end_time, content_type (movies/shows/both), notes, order_index

channel_collections  -- user-linked Plex collections per channel+type
  (channel_number, plex_type UNIQUE)
  fields: collection_rating_key, collection_title

channels             -- TV channels (authoritative source; channels.py is a seed snapshot)
  (number PK)
  fields: name, tier, vibe, mode, style, color, icon (data URI),
          watermark (JSON blob, NULL = none), watermark_image_url (absolute URL
          Tunarr fetches — ffmpeg cannot read the data URI icons are stored as)

settings             -- key/value store (plex_url, plex_token, client_id, pending_pin_id)
```

**Schema migrations** use `ALTER TABLE ... ADD COLUMN` wrapped in `try/except sqlite3.OperationalError` — always use this pattern for new columns, never recreate tables.

### `channels.number` is a primary key referenced by value

`channels.number` is the PRIMARY KEY *and* six tables carry a `channel_number` value
reference to it with **no foreign keys**: `assignments`, `blocks`, `channel_collections`,
`tunarr_channel_links`, `tunarr_collection_links`, `ai_logs`. (`block_slots` follows
`blocks` via `block_id`.) That tuple is `_CHANNEL_REF_TABLES` in `main.py` — the single
source of truth read by `update_channel`, `delete_channel` and the reorder endpoint, so
the three paths cannot drift apart. `ai_logs` used to be missing from the renumber cascade
and the delete cleanup; that was a bug and is fixed.

Consequences:
- **There is no `order_index` — reordering channels means renumbering them.**
- Any renumber must go through the transactional endpoint (`POST /api/channels/reorder`)
  or `PUT /api/channels/{n}` — never hand-write `UPDATE channels SET number=…`, which
  silently orphans rows in all six tables.
- A renumber is written in **two phases** (`_renumber_channels`): park every affected row
  at a temporary negative number, then write the finals. A reorder is normally a *cycle*,
  so a single-phase sequential update collides on the PRIMARY KEY immediately.
- Frontend: after a renumber, invalidate everything keyed by channel number —
  `['assignments']`, `['blocks']`, `['channel-collections']`, `['collection-status']`,
  `['tunarr','links']`, `['tunarr','collection-links']`, `['watermark']` — and never key a
  React list on `ch.number`.

---

## API Routes

### Auth
- `POST /api/auth/login` — sets `session` cookie (30-day)
- `POST /api/auth/logout`

### Channels
- `GET /api/channels` — returns all rows from the SQLite `channels` table (ordered by number)
- `GET /api/channels/suggest-247` — analyze Plex library, return 24/7 loop channel candidates
- `POST /api/channels/ai-suggest` — AI-generate channel + package suggestions from DB
- `POST /api/channels/reorder` — drag-and-drop reorder, i.e. **renumber**.
  Body `{moved_number, target_index, target_tier}`; `target_index` is the 0-based index the
  moved channel should occupy in the **resulting** lineup (dropping onto a row = that row's
  pre-drop index), and `target_tier` is only for a cross-tier move (`null` keeps the tier).
  Returns `{changed: [{old_number, new_number, tier}], channels: [...full new lineup...],
  tunarr: {synced, failed: [{number, message, state, parked_number}]}}`.
  The renumber math is the pure `_compute_reorder` (mirrored client-side in
  `frontend/src/features/channels/reorder.ts` for the confirm preview only); the write is
  one all-or-nothing transaction cascading to `_CHANNEL_REF_TABLES`.
  Tunarr propagation runs **after** the commit and can never undo it — a failure entry's
  `state` is `unchanged` (Tunarr kept the old number, harmless) or `parked` (the Tunarr
  channel is stranded on temporary number `parked_number` and needs attention). Never
  report either as "the reorder failed".
- `PUT /api/channels/{n}` also renumbers when `body.number` differs from the path number
  (409 if the target number is taken).
- `GET|PUT|DELETE /api/channels/{n}/watermark` — per-channel Tunarr watermark config.
  `GET` returns `{watermark: null}` or the stored config plus a server-owned `image_url`;
  `PUT`/`DELETE` also re-sync the channel to Tunarr and return `tunarr_sync`. Validation
  mirrors Tunarr's zod rules (`width` strictly > 0 as a percent of frame width, integer
  `opacity` 0–100, margins 0–100, `duration` seconds ≥ 0, `fade.period_mins` ≥ 1).
- `POST /api/channels/{n}/watermark/image` — resolve the watermark image to an absolute
  URL Tunarr can fetch. Body `{image}` (data URI), `{url}` (absolute), or `{}` to use the
  channel icon; data URIs are uploaded via Tunarr's `POST /api/upload/image`.

### Assignments
- `GET /api/assignments` — all assignments grouped by channel_number
- `POST /api/assignments` — add single item; 409 if duplicate
- `DELETE /api/assignments/{id}`
- `POST /api/assignments/bulk` — body: `{channel_number, items: [...]}`, skips duplicates

### Plex Proxy
- `GET /api/plex/libraries`
- `GET /api/plex/library/{section_id}`
- `GET /api/plex/search?q=`
- `GET /api/plex/item/{rating_key}`
- `GET /api/plex/show/{rating_key}/seasons`
- `GET /api/plex/season/{rating_key}/episodes`
- `GET /api/plex/collections`
- `GET /api/plex/collections/{rating_key}/items`
- `POST /api/plex/smart-collections` — create rule-based (smart) Plex collection; filters: genres (names), year_min/year_max (inclusive), decade, unwatched, content_rating, title_contains; sort: `title_asc|title_desc|year_asc|year_desc|added_desc|random`; limit
- `PUT /api/plex/smart-collections/{rating_key}` — update title and/or replace filter rules
- `GET /api/plex/thumb?path=` — proxies Plex thumbnail with auth token (**always `?path=`, never `?url=`**)

### Plex OAuth
- `POST /api/plex/auth/start` — gets PIN from plex.tv, returns auth_url (legacy long-lived token)
- `GET /api/plex/auth/status` — polls for fulfilled PIN, saves token to DB

### Plex JWT auth ("API Unlocked")
Modern device-keypair auth. Additive — legacy token auth still works and is the default
until a JWT is enrolled. The minted token is stored as `plex_token` and used in the same
`X-Plex-Token` header, so the rest of the app is unchanged. Tokens last ~7 days.
- `POST /api/plex/auth/jwt/start` — generates/persists an Ed25519 device key, registers the JWK with `clients.plex.tv`, returns auth_url
- `GET /api/plex/auth/jwt/status` — signs a deviceJWT, redeems the PIN, stores the token
- `POST /api/plex/auth/jwt/refresh` — mints a fresh token from the device key
- `GET /api/plex/auth/info` — `{mode: legacy|jwt, token_age_days, needs_refresh}`

Settings keys: `plex_device_privkey` (PEM), `plex_device_kid`, `plex_auth_mode`,
`plex_token_issued_at`. Requires the `cryptography` package (in `requirements.txt`).

### Collections
- `GET /api/collections/status/{channel_number}`
- `POST /api/collections/generate/{channel_number}`
- `GET /api/channel-collections/{channel_number}`
- `POST /api/channel-collections/{channel_number}`
- `DELETE /api/channel-collections/{channel_number}/{plex_type}`

### Blocks
- `GET /api/blocks?channel_number=` — channel blocks
- `GET /api/blocks/generic` — reusable blocks
- `POST /api/blocks` — create
- `PUT /api/blocks/{id}` — update
- `DELETE /api/blocks/{id}`
- `POST /api/blocks/{id}/apply/{channel_number}`
- `GET /api/blocks/{id}/slots`
- `POST /api/blocks/{id}/slots`
- `DELETE /api/blocks/{id}/slots/{slot_id}`
- `GET /api/blocks/{id}/suggestions`
- `POST /api/blocks/ai-generate-day` — AI generate a full day of block slots

### Settings
- `GET /api/settings` / `POST /api/settings`

### Tunarr
> **Version support:** tested against Tunarr **1.3.6**; minimum supported **1.2.10**.
> Support is a floor (`version >= TUNARR_MIN_VERSION`), not a ceiling — see
> `TUNARR_MIN_VERSION` / `TUNARR_TESTED_VERSION` in `main.py`.
> **`/api/smart_collections` is underscored in every supported version** (verified in
> Tunarr's `smartCollectionsApi.ts` at v1.2.10 and v1.3.6) — there is no hyphenated
> alias, so a wrong separator is a plain 404. The smart-collection search body field is
> **`filter`** (all versions; `query` is only Tunarr's DB column) and it's optional in
> Tunarr's schema — so writes must verify the response echoes the rules back, not just
> trust a 2xx (`_tunarr_write_smart_collection` retries with the other field name on
> 400/422/500 **or** a rule-dropping 2xx). Tag-based smart
> collections require the Plex collection to exist as a tag in Tunarr's index, so both
> sync flows run `ScanLibrariesTask` in the foreground *before* writing them.
> Schedule slots carry an `id` (1.3 linkable slots).
>
> **Channel writes go through `_tunarr_save_channel` (read-modify-write).** Tunarr's
> `PUT /api/channels/:id` validates the body as the FULL `SaveableChannel` — only
> `onDemand` is partial — so a partial PUT is a 400. Never compute
> `guideMinimumDuration` (its unit is inconsistent inside Tunarr) or `duration`
> (server-maintained); echo them back. Read-only keys Tunarr strips on write:
> `programCount`, `transcoding`, `sessions`, `fallback`. Creates use only the
> discriminated `{"type":"new","channel":{…}}` body — no Tunarr 1.x accepts a flat
> object — and must carry a real `transcodeConfigId` from
> `_tunarr_resolve_transcode_config` (1.3.x validates it as a uuid AND checks existence;
> `transcoding` is read-only and stripped). A duplicate channel number returns **500, not
> 409** — there is no 409 anywhere in the channel API. The watermark schema is
> byte-identical from v1.0.0 to v1.3.9; `animated` and `fadeConfig[].programType` are
> persisted but never read, and only `fadeConfig[0]` is applied — so clearing a watermark
> pushes an explicit `enabled: false` (read-modify-write would otherwise echo Tunarr's
> existing one straight back).

- `GET /api/tunarr/channels`
- `GET /api/tunarr/channels/{id}/schedule`
- `GET /api/tunarr/channels/{id}/shows`
- `GET /api/tunarr/custom-shows` — Tunarr 1.3 custom shows (`[]` on older)
- `GET /api/tunarr/channel-links`
- `POST /api/tunarr/channel-links` — body: `{channel_number, tunarr_id}`
- `DELETE /api/tunarr/channel-links/{channel_number}`
- `POST /api/tunarr/channel-links/{channel_number}/push-schedule`
- `POST /api/tunarr/channel-links/{channel_number}/sync-collections`
- `GET /api/tunarr/collection-links`
- `POST /api/tunarr/collection-links`
- `DELETE /api/tunarr/collection-links/{channel_number}/{plex_type}`
- `GET /api/tunarr/smart-collections`
- `PUT /api/tunarr/smart-collections/{uuid}`
- `DELETE /api/tunarr/smart-collections/{uuid}`
- `POST /api/tunarr/test` — body: `{url}`, returns `{ok, latency_ms}`
- `POST /api/tunarr/tasks/UpdateXmlTvTask`
- `POST /api/tunarr/tasks/ScanLibrariesTask`

### AI
- `GET /api/ai-models`
- `POST /api/ai-test`
- `GET /api/ai-logs`
- `DELETE /api/ai-logs`
- `GET /api/channels/{n}/ai-content-suggestions`
- `GET /api/network/ai-advisor`

### MCP Server
Model Context Protocol endpoint at `/mcp` (streamable HTTP, stateless, JSON responses) —
lets AI assistants manage channels, browse Plex, assign content, and build collections.
24 tools. Auth: `Authorization: Bearer <token>`; token auto-generated, stored as settings
key `mcp_token`, enforced in `auth_middleware` (constant-time compare, before the cookie
check). Shown in Settings → System → MCP Server. Code lives in the "── MCP server" section
at the bottom of `main.py`; tools call the internal route handlers directly — no
HTTP-to-self loop. Requires the `mcp` package (in `requirements.txt`).
User docs: `docs/MCP.md`.
- `GET /api/mcp/info` — `{endpoint, token, tool_count}` (session-cookie auth, for Settings UI)
- `POST /api/mcp/regenerate-token` — rotate the bearer token (invalidates old immediately)

---

## Plex API Notes

- All Plex calls go through `get_plex_config()` — reads from `settings` table first, falls back to `.env`.
- Inside Docker, Plex is at `http://plex:32400` (container hostname on `plex_default` network).
- Thumbnails must be proxied through `/api/plex/thumb?path=` — Plex requires the token in the request header.

---

## Channels

Channels are stored in the SQLite `channels` table (fields: `number, name, tier, vibe, mode, style, color, icon`) and managed at runtime via the `POST/PUT/DELETE /api/channels` routes — this is the authoritative source. `channels.py` exports a `CHANNELS` list as a **reference/seed snapshot only**; it is not imported by `main.py` and is excluded from the Docker image. If you wire it back in as a DB seed, un-ignore it in `.dockerignore` first.

Tier ranges (`Galaxy Main [100,119]`, `Classics [120,139]`, `Galaxy Premium [140,159]`) live
in `TIER_RANGES` — `main.py` and `frontend/src/features/channels/presets/numbering.ts` must
agree. Ordering is *by number*: there is no separate ordering column, so reordering
renumbers. See "`channels.number` is a primary key referenced by value" above and
`POST /api/channels/reorder`. The sidebar (`ChannelSidebar.tsx`) drives it with native
HTML5 drag-and-drop — no drag library, and none should be added.

---

## Performance invariants (keep the app feeling fast)

Image-heavy navigation is the hot path. Do **not** regress these — they're what
make view-switching feel instant:

- **Thumbnails must be transcoded, never full-size.** `/api/plex/thumb` proxies
  Plex's `/photo/:/transcode` (10–30 KB), never the raw art path (0.5–2 MB).
  Guarded by `tests/test_thumb_perf.py` (`test_thumb_uses_plex_transcoder`).
- **Three cache layers**: in-process LRU (`_THUMB_CACHE`), the service worker's
  `linearr-thumbs` cache (cache-first), and a 7-day immutable `Cache-Control`.
  Any new thumb route must keep the long-lived cache headers.
- **`PlexThumb` always passes `w`/`h`** (≈2× the rendered CSS size) so the
  backend transcodes to the right dimensions; dims are clamped server-side.
- **Poster grids use `content-visibility:auto`** with an intrinsic-size hint so
  offscreen cells skip layout/paint on large libraries.
- React Query defaults (`staleTime` 5 min) avoid refetch churn on tab switches;
  keep server-state reads cached, don't add `refetchOnWindowFocus`.

## Deployment

```bash
# from repo root
docker compose up --build -d
docker compose logs -f linearr
```

Persistent data: `./data/` (gitignored). Secrets: `.env` (gitignored).

---

## PWA

Linearr is installable as a PWA. Assets in `frontend/public/`:
- `manifest.webmanifest` — app manifest (name, icons, theme color)
- `sw.js` — service worker (cache-first for app shell, passthrough for `/api/`)
- `favicon.svg`, `icon-192.svg`, `icon-512.svg` — SVG icons

The service worker and manifest are registered/linked in `frontend/index.html`.

<!-- ownership:labeling-rule -->
## Issue part-labeling (always-on)

- When creating or triaging an issue, infer the part, apply the `part:*` label,
  and assign it. Before working an unlabeled issue, infer and apply a label
  first. If it genuinely spans parts, apply `part:cross-cutting` and flag triage
  to split it. `part:*` = who may *pick it up*; CODEOWNERS = who must *approve* —
  orthogonal axes; do not derive one from the other. The map lives in
  `docs/ownership.md`.
<!-- /ownership:labeling-rule -->
