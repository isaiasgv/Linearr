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
- `linearr_mcp/` — the MCP server, one module per toolset. Calls `main.py`'s route handlers; never imports `main` (see "MCP Server" under API Routes)
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
    │                           #   (TunarrView is a tab host; each tab is a file
    │                           #    under components/panels/)
    ├── icons/                  # Icon library, layer editor, and the icon generator
    ├── settings/               # Plex URL/token, AI keys, OAuth PIN flow, icon defaults
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

### Fonts are self-hosted, and the CSP is why

`public/fonts/` holds the woff2 files (latin + latin-ext), declared in
`src/fonts.css` and imported from `index.css`. **Do not switch anything back to
Google Fonts.** The CSP (`default-src 'self'`, `style-src 'self' 'unsafe-inline'`,
`connect-src 'self'`, no `font-src`) blocks all three routes at once — the
stylesheet `<link>`, the woff2 fetch from gstatic, and the `fetch()` that inlines
a face for PNG export. Everything falls back to `cursive` (Comic Sans on Windows)
with no console error. **`npm run dev` does not reproduce it** — Vite's dev server
sends no CSP — which is how it shipped unnoticed. `--font-sans` is Inter, so this
was the whole app, not just the icon editor.

Three things that must stay true:
- Files live in `public/`, **not** `src/assets/`. Tailwind v4 inlines `@import`ed
  CSS without rebasing relative `url()`s, so `./x.woff2` next to the stylesheet
  resolved to `/assets/x.woff2` while the emitted file was content-hashed — a
  clean build where every font 404s.
- `_STATIC_PREFIXES` in `main.py` must include `fonts/`. The SPA fallback
  otherwise answers a `.woff2` request with `index.html`, which fails to parse as
  a font and falls back silently — the same symptom as the CSP bug.
  `tests/test_static_assets.py` guards it.
- `FontDef.weights` lists the weights the file **actually contains**. A browser
  asked for a missing weight synthesizes one; Baloo Thambi ships only 400, so
  asking for 500 produced a faux bold that looked almost-but-not-quite right.
  Baloo Thambi 2 is the variable sibling (400–800). `nearestWeight` snaps on font
  change, and the weight controls only offer real values.

`getEmbeddableFontFace` base64-inlines the face into the exported SVG. That is
required, not an optimisation: `rasterizeToPng` draws through an `<img>`, and an
SVG loaded that way resolves no external references at all.

**The inlined faces must carry `unicode-range`.** Each family ships as two
disjoint subsets and **`latin-ext` contains no basic Latin** — verified with
fontTools against the shipped files: no `A`, no `a`, no `G`. Two `@font-face`
rules with the same family/style/weight and no range are a plain override, so
latin-ext wins for *every* character and the export asks a face with no `G` to
render "Galaxy". The browser substitutes silently — the preview looks perfect
because `fonts.css` declares the ranges. Guarded by
`tests/test_icon_font_export.py` (static assertions; there is no JS test runner).

`renderTextLayer` uses **one** family string for preview and export. It used to
emit the bare face name when embedding and the full CSS stack otherwise, which
let the two resolve differently with only the export wrong.

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
          uid (uuid4 — STABLE identity for clients; `number` is mutated by a
          reorder and `name` is not unique. Additive only: no route takes it,
          every creation path must supply one, and a trigger backfills any
          insert that doesn't),
          watermark (JSON blob, NULL = none), watermark_image_url (absolute URL
          Tunarr fetches — ffmpeg cannot read the data URI icons are stored as),
          icon_url (the icon uploaded to Tunarr as an HTTP asset — see
          "Tunarr asset URLs" below; NULL = not uploaded yet)

settings             -- key/value store (plex_url, plex_token, client_id, pending_pin_id,
                        tunarr_url, tunarr_public_url, icon_brand_defaults,
                        app_secret, mcp_token, plex_webhook_secret)
```

**Schema migrations** use `ALTER TABLE ... ADD COLUMN` wrapped in `try/except sqlite3.OperationalError` — always use this pattern for new columns, never recreate tables.

### `channels.number` is a primary key referenced by value

`channels.number` is the PRIMARY KEY *and* six tables carry a `channel_number` value
reference to it with **no foreign keys**: `assignments`, `blocks`, `channel_collections`,
`tunarr_channel_links`, `tunarr_collection_links`, `ai_logs`. (`block_slots` follows
`blocks` via `block_id`.) That tuple is `_CHANNEL_REF_TABLES` in `main.py`, read by
`update_channel` and the reorder endpoint via `_move_channel_number`.

**`delete_channel` uses a different list on purpose** — `_CHANNEL_DELETE_TABLES`, which is
`_CHANNEL_REF_TABLES` minus `ai_logs`. A renumber must carry the AI logs (otherwise they
end up pointing at whatever channel later takes that number); a delete must NOT destroy
them (write-only audit trail, no other copy, not mentioned in the confirmation). Do not
re-unify the two lists.

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
  React list on `ch.number`. Key on `ch.uid` (see the `channels` schema above): `name` is
  not unique either, so `tier|name` is not an identity.

---

## API Routes

### Auth
- `POST /api/auth/login` — body `{username, password, remember=true}`; sets the `session`
  cookie and returns `{ok, expires_in}`
- `POST /api/auth/logout`

**Sessions slide.** The token is `<issued>.<max_age>.<nonce>.<HMAC>` and the window runs
from *last use*, not from login: `auth_middleware` re-issues the cookie on any
authenticated request once the token is older than `SESSION_REFRESH_AFTER` (1h). A fixed
window from login expires mid-session, which is what "I keep getting logged out" usually
is. Two lifetimes — `SESSION_MAX_AGE` (7d) and `SESSION_REMEMBER_MAX_AGE` (90d, the
default, chosen by the login checkbox).

Three things must stay true, all guarded by `tests/test_session_sliding.py`:
- **`max_age` is inside the signed message.** It travels in the token so verification
  knows which window applies; unsigned, anyone could grant themselves an unbounded
  session by editing one field. `_verify_session_token` also rejects any lifetime the
  app doesn't itself issue.
- **The refresh never runs on `/api/auth/logout`.** That response deletes the cookie;
  re-issuing it there hands it straight back and logout silently does nothing.
- **Login and the refresh both write through `_set_session_cookie`.** A refresh that
  dropped `httponly`/`samesite` would weaken every session an hour after it was created.

**The session secret IS the session store.** Cookies are stateless —
`<issued>.<nonce>.<HMAC>` with nothing kept server-side — so changing the key
invalidates every outstanding cookie at once. `_get_app_secret()` therefore
resolves in this order: `APP_SECRET` env (explicit config wins, and is what
multi-instance deployments need), else a random key generated **once** and
persisted to `settings.app_secret`. It must never go back to minting one per
process: `.env` is optional in `docker-compose.yml` (`required: false`), so the
ordinary setup has no `APP_SECRET`, and a per-process key logged everyone out on
every restart — silently, with only a startup log line to show for it. The
shipped `default-secret-change-me` counts as unset; honouring it would let anyone
forge `HMAC(known_secret, "admin:changeme")`. Guarded by
`tests/test_session_secret.py`. The resolved value is cached in a module global
because `_sign_session` runs on every authenticated request.

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
- `GET /api/channels/watermark-audit` — channels whose watermark is enabled with no image,
  i.e. channels that will not play at all (see the watermark note under Tunarr).
  `POST /api/channels/watermark-repair[?channel_number=]` fixes them: resolve the icon into
  a real image URL where there is one, otherwise switch the watermark off.
- `GET|PUT|DELETE /api/channels/{n}/watermark` — per-channel Tunarr watermark config.
  `GET` returns `{watermark: null}` or the stored config plus a server-owned `image_url`;
  `PUT`/`DELETE` also re-sync the channel to Tunarr and return `tunarr_sync`. Validation
  mirrors Tunarr's zod rules (`width` strictly > 0 as a percent of frame width, integer
  `opacity` 0–100, margins 0–100, `duration` seconds ≥ 0, `fade.period_mins` ≥ 1).
- `DELETE /api/channels/{n}` — also deletes the **linked Tunarr channel** by default
  (`?delete_tunarr=false` unlinks only). Linearr commits its own delete first and calls
  Tunarr best-effort after, so a Tunarr failure is reported in `tunarr` and never rolls
  the delete back — it means a stranded Tunarr channel, which must be surfaced, not
  swallowed. Guarded by `tests/test_channel_delete_cascade.py`.
- `POST /api/channels/resync-assets[?channel_number=&force=]` — re-upload channel icons
  to Tunarr and push them. The operational half of `tunarr_public_url`; see "Tunarr asset
  URLs" under Tunarr.
- `GET /api/channels/{n}/icon` — `{icon, icon_url, manual}`. `icon` is the data URI
  Linearr renders; `icon_url` is what Tunarr publishes in the guide.
- `POST /api/channels/{n}/icon/image` — the per-channel override for that URL, with the
  same body shape as the watermark's image route: `{url}` (verbatim, sets
  `icon_url_manual`), `{image}` (data URI, uploaded), or `{}` (re-derive from the icon
  and clear the flag). **A manual URL is never re-derived** — `_resolve_channel_icon_url`
  and `set_channel_icon` both skip it, because it may point at a host that has nothing to
  do with Tunarr. Guarded by `tests/test_channel_icon_url.py`.
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
- `POST /api/collections/generate/{channel_number}[?take_over_assigned=]`

**The two types are independent, and an emptied type empties its collection.**
Both were bugs. Generating used to force *both* slots to `owned`, so a channel
referencing an existing collection for movies while Linearr generated its shows
lost the assignment on the next build — `take_over_assigned=true` is now the
explicit opt-in for that conversion. And a type with no assignments used to be
skipped outright, which left removed items in the Plex collection (and therefore
on the Tunarr channel) forever; it is now only skipped when there is also no
managed collection to maintain, and never *creates* one just to empty it.
Guarded by `tests/test_collection_sync.py`.

**A 401 from Linearr must only ever mean "your session is invalid."** The
frontend turns any 401 into a logout, so `_upstream_status` maps upstream
(Plex/Tunarr) 401/403 to **502** — forwarding Plex's 401 verbatim logged people
out of Linearr whenever the *Plex* token expired, on the ~7-day JWT cadence, and
that survived two unrelated session fixes. Every other upstream status passes
through unchanged. `/api/auth/session` is public, never 401s, and is the second
opinion `client.ts` asks for before tearing down to the login screen. Guarded by
`tests/test_upstream_auth_isolation.py`.
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
> **Programming start is ALWAYS 12:00AM, and the two `startTime` fields are
> different units.** A *channel's* `startTime` is an absolute epoch-ms anchor and
> must land on a midnight boundary (`_previous_sunday_midnight_ms`); Linearr
> pushes `period: "day"` schedules, so a channel anchored anywhere else shifts
> every slot on it by the same amount. A *slot's* `startTime` is an offset
> **within the period**, 0..86_400_000 — what `_hhmm_to_ms` returns. Never put an
> epoch value in a slot: the base "shuffle all day" slot once used
> `_previous_sunday_midnight_ms()` and landed ~20,000 days into the period,
> sorting last instead of first. Guarded by `tests/test_tunarr_schedule_slots.py`
> and the midnight assertions in `tests/test_tunarr_channel_writer.py`.
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
>
> **Tunarr asset URLs: what Linearr *calls* and what it *writes* are two
> different addresses.** `get_tunarr_url()` is where API requests go —
> container-to-container, `http://tunarr:8000`. But the URLs Linearr writes
> *into* Tunarr (channel icons, watermark images) are copied into XMLTV and into
> ffmpeg command lines, and are then fetched by Plex clients that may be nowhere
> near this network. `_tunarr_asset_base()` is the base for those, from the
> optional `tunarr_public_url` setting; empty falls back to the internal URL.
>
> **The channel icon must be an uploaded HTTP asset, not a data URI.**
> `_tunarr_icon_obj` used to be handed the base64 `data:` icon directly, and
> Tunarr writes whatever it is given straight into XMLTV — which renders locally
> and nowhere else, because a remote client cannot resolve a data URI it was
> served as an image source. `_resolve_channel_icon_url` uploads it (filename
> `linearr-icon-ch{n}-{sha1[:10]}.{ext}`) and caches the result in
> `channels.icon_url`, which `_tunarr_channel_changes` prefers. Best-effort: a
> failed upload falls back to the data URI, because an icon that renders only
> locally still beats no icon. **Any path that changes or clears `icon` must
> also null `icon_url`** — it is preferred over the icon itself, so a stale one
> pushes the previous logo. The exception is `icon_url_manual`: a URL set by hand
> via `POST /api/channels/{n}/icon/image` is never re-derived or cleared by an
> icon change, because it may point at a host unrelated to Tunarr.
>
> **A watermark that follows the channel icon reuses `icon_url` — it does NOT
> upload a second copy.** "The watermark is the channel icon" means literally the
> same image, so `_refollow_channel_icon_watermark` points at the icon's own
> uploaded URL and only falls back to uploading when there isn't one. Ordering
> matters: `set_channel_icon` resolves the icon URL *before* re-following the
> watermark, otherwise the watermark finds nothing to follow and duplicates the
> upload. This also removes a genuinely silly workflow — to get a chosen domain
> onto a channel logo you previously had to upload the icon, apply it as a
> watermark, copy the URL that came back, and paste it into the watermark's URL
> field, because the icon URL itself could not be set.
>
> **Stored asset URLs are re-based on read, never migrated.** `_tunarr_asset_url`
> rewrites a stored URL onto the current asset base **only** when its path is
> under `/images/` AND its host is a known Tunarr one. That second condition is
> load-bearing: a user may paste a third-party watermark URL, and rewriting it
> onto the Tunarr domain would point at a 404 — which, for an enabled watermark,
> takes the channel off the air. `POST /api/channels/resync-assets` converts an
> existing lineup after the setting changes. Guarded by
> `tests/test_tunarr_asset_urls.py`.
>
> **Every watermark image needs a collision-free upload filename.** Tunarr's
> `POST /api/upload/image` keys uploads by FILENAME: repeat a name and it returns
> the same `fileUrl` and overwrites the bytes (verified on 1.3.10 — two different
> PNGs sent as one name, second won). Every channel used to upload as
> `linearr-watermark.png`, so applying a watermark anywhere silently replaced the
> image every other channel was drawing. `_watermark_image_filename` now builds
> `linearr-ch{number}-{sha1[:10]}.{ext}` — the number separates channels, the hash
> stops a channel's new image clobbering its old one and makes a re-apply a no-op.
> `watermark-audit` reports legacy rows as `issue: "shared_image"` and repair
> re-resolves them (clearing the stale URL first, since the resolver no-ops when
> one is present).
>
> **An enabled watermark must have an image. Tunarr's API accepts one without;
> playback does not.** A probe against **1.3.10** shows `url` is optional in the schema —
> an absent key stores fine and returns 200, and `url: ""` is accepted too — and this
> file once concluded from that there should be no gate. That was wrong, and the ffmpeg
> logs settle it: with no url Tunarr builds a dangling `-i` into the command, the
> transcode exits **254**, no playlist is ever written and the channel 404s in a retry
> loop. Tunarr does **not** fall back to the channel logo. So:
>
> - `_watermark_to_tunarr` refuses to emit `enabled: true` without a resolved image URL,
>   degrading to `enabled: false` — which also self-heals an already-poisoned row on its
>   next sync.
> - `put_channel_watermark` resolves the channel icon into a real uploaded image when one
>   is enabled with no URL, and **rolls the config write back and 400s** when there is no
>   icon to derive from — a rejected request must not leave the poison row behind.
> - `url` is still omitted rather than sent as `""` when there genuinely is no image, so
>   a disabled watermark stays clean.
>
> Defaults for a new watermark live in `_WATERMARK_DEFAULTS` (width 7, margins 5/5,
> **opacity 30**), mirrored in `frontend/src/features/watermark/types.ts` and in the
> `set_channel_watermark` MCP tool — all three must agree, and `tests/test_mcp_tools.py`
> asserts the MCP half. The editor's image picker offers three sources — channel icon,
> an uploaded file, or a pasted URL — all landing on
> `POST /api/channels/{n}/watermark/image`; only the icon source sets `use_channel_icon`,
> which is what makes the watermark follow later icon changes.

- `GET /api/tunarr/channels`
- `GET /api/tunarr/channels/{id}/schedule`
- `GET /api/tunarr/guide` — **reads Tunarr's BULK EPG, not the per-channel endpoint.**
  `GET /api/guide/channels/{id}` returns the channel's *lineup* —
  `[{index, startTimeMs, lineupItem: {durationMs, type}}]` — with no title
  anywhere, so every entry fell through `_normalize_guide_programs`' title chain to
  the literal `"Program"` and the guide rendered as a wall of identical blocks.
  `GET /api/guide/channels` (no id) is the materialized EPG:
  `{<channelId>: {id, name, number, icon, programs: [{title, episodeTitle,
  seasonNumber, episodeNumber, start, stop, duration, type}]}}`. Note `start` /
  `duration`, NOT `startTimeMs` / `durationMs`, and `seasonNumber` on the program
  itself (its absence from the season chain is what produced "S?E1"). One request
  covers the whole lineup where the old code made one per channel. The lineup
  survives only as a fallback for a not-yet-materialized EPG, where titleless
  entries are legitimate. Guarded by `tests/test_tunarr_guide.py`.
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
- `GET /api/tunarr/image?path=` — proxies a Tunarr-hosted image (`/images/…` only) for the
  **browser**. Stored watermark URLs point at the Tunarr container (`http://tunarr:8000`),
  which a LAN browser cannot resolve; keeps the 7-day immutable cache headers like
  `/api/plex/thumb`.
- `GET /api/tunarr/stream/{tunarr_id}` + `GET /api/tunarr/stream-segment?path=` — HLS proxy
  for the in-app player. Same container-hostname problem as the image proxy, but worse:
  Tunarr's playlist points at its own absolute URLs, so the playlist body is **rewritten**
  (`_rewrite_hls_playlist`) to route every segment — and every `URI="…"` attribute on tags
  like EXT-X-KEY/EXT-X-MAP — back through `/api/tunarr/stream-segment`. Nested playlists are
  rewritten in turn. Both are `no-store` (a live playlist changes every segment) and share
  the `/api/tunarr/image` SSRF guard via `_is_safe_tunarr_path`. Tunarr starts ffmpeg on the
  first request, so the read timeout is 60s. **Not exposed over MCP** (binary/streaming);
  `get_tunarr_endpoints` hands out the URL instead.
  The player is `features/tunarr/components/ChannelStreamModal.tsx`. It needs **`hls.js`**
  (the one media dependency — Chrome/Firefox have no native HLS), imported lazily so its
  ~525 KB chunk only loads when someone actually watches a channel, and the CSP carries
  `media-src 'self' blob:` because MSE plays from a blob URL.
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
full coverage of the app: channels, Plex, assignments, collections, schedule blocks,
Tunarr, watermarks, icons, AI advisors, and system/logs. **129 tools across 10 toolsets**
(`channels`, `icons`, `assignments`, `plex`, `collections`, `blocks`, `tunarr`,
`watermark`, `ai`, `system`), plus 4 resources (`linearr://lineup`,
`linearr://channel/{number}`, `linearr://libraries`, `linearr://status`).

Auth: `Authorization: Bearer <token>`; token auto-generated, stored as settings key
`mcp_token`, enforced in `auth_middleware` (constant-time compare, before the cookie
check). Shown in Settings → System → MCP Server. Requires the `mcp` package (in
`requirements.txt`). User docs: `docs/MCP.md`.

**Code lives in `linearr_mcp/`, one module per toolset — not in `main.py`.** Three rules
hold it together:

- **`linearr_mcp` never imports `main`.** `main.py` calls
  `build_mcp_server(sys.modules[__name__])`; every module receives that module object as
  `api` and reads handlers off it. That is what keeps the import acyclic — do not
  "simplify" it into a direct import.
- **Tools call route handlers; they never reimplement them.** A handler typed
  `request: Request` is called with `linearr_mcp._request.json_request(body)`.
  Reimplementing handler logic inside a tool is how the MCP surface and the HTTP surface
  silently drift apart.
- **`ToolRegistry.tool()` is the only way to register.** It applies the Activity-Log
  wrapper, the annotations and the toolset gate at registration time. (The previous design
  wrapped tools in a pass that ran after the last registration, so anything added below
  that line lost its instrumentation.) Annotate honestly — `destructive=True` is what makes
  a client prompt before deleting someone's channel. Argument summaries are redacted for
  anything named like an icon, image, token, key or secret, or any `data:` value.

Toolsets are gated by `MCP_TOOLSETS` (env) or the `mcp_toolsets` settings key; all are on
by default and a change needs a restart, because tools register at import. An empty or
unrecognised selection falls back to all. `linearr_mcp/` must stay in the Dockerfile's
COPY list. `tests/test_mcp_registry.py` asserts every tool is annotated, instrumented, in
a declared toolset, **and documented in `docs/MCP.md`** — that last one exists because the
docs had drifted (a documented argument that never existed, missing paging arguments, a
tool count one short).

Deliberately NOT exposed, and the reasons are in `docs/MCP.md`: DB backup/restore, the
Plex stream URL (embeds the token), writing `plex_token`/`openai_api_key`, the OAuth PIN
flow, image proxies, icon-pack bulk transfer, the Plex webhook receiver, login/logout.

- `GET /api/mcp/info` — `{endpoint, token, tool_count, toolsets[]}` (session-cookie auth)
- `PUT /api/mcp/toolsets` — body `{toolsets: [...]}`, persists the selection (restart to apply)
- `POST /api/mcp/regenerate-token` — rotate the bearer token (invalidates old immediately)

---

## Plex API Notes

- All Plex calls go through `get_plex_config()` — reads from `settings` table first, falls back to `.env`.
- Inside Docker, Plex is at `http://plex:32400` (container hostname on `plex_default` network).
- Thumbnails must be proxied through `/api/plex/thumb?path=` — Plex requires the token in the request header.

---

## Channels

Channels are stored in the SQLite `channels` table (fields: `number, name, tier, vibe, mode, style, color, icon, uid, watermark, watermark_image_url`) and managed at runtime via the `POST/PUT/DELETE /api/channels` routes — this is the authoritative source. `channels.py` exports a `CHANNELS` list as a **reference/seed snapshot only**; it is not imported by `main.py` and is excluded from the Docker image. If you wire it back in as a DB seed, un-ignore it in `.dockerignore` first.

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
