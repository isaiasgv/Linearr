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
| Styling | Tailwind CSS v3 (npm, not CDN) |
| Database | SQLite at `/app/data/assignments.db` (persisted via Docker volume `./data`) |
| Plex API | httpx async client, proxied through FastAPI routes |
| Auth | Stateless HMAC-SHA256 session cookie |
| Container | Port 8777 (host) → 8888 (container), external network `plex_default` |
| Build | Multi-stage Docker: Node 20 builds frontend → `/app/dist/`, Python 3.12 serves it |

**Key files:**
- `main.py` — all backend logic (routes, DB, Plex proxy); serves built React app from `/app/dist/`
- `frontend/` — React + Vite app (vertical slice: `src/features/`, `src/shared/`)
- `channels.py` — static list of Galaxy Network channels (`CHANNELS`)
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
    ├── cable-plex/             # Cable+Plex combined view
    └── generic-blocks/         # Reusable blocks view (no channel context)
```

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

settings             -- key/value store (plex_url, plex_token, client_id, pending_pin_id)
```

**Schema migrations** use `ALTER TABLE ... ADD COLUMN` wrapped in `try/except sqlite3.OperationalError` — always use this pattern for new columns, never recreate tables.

---

## API Routes

### Auth
- `POST /api/auth/login` — sets `session` cookie (30-day)
- `POST /api/auth/logout`

### Channels
- `GET /api/channels` — returns `CHANNELS` list from `channels.py`
- `GET /api/channels/suggest-247` — analyze Plex library, return 24/7 loop channel candidates
- `POST /api/channels/ai-suggest` — AI-generate channel + package suggestions from DB

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
> `TUNARR_MIN_VERSION` / `TUNARR_TESTED_VERSION` in `main.py`. Tunarr **1.3.0** renamed
> the smart-collection search body field `filter` → `query`; writes pick the field by
> version and retry with the other on a 400/422 (`_tunarr_write_smart_collection`).
> Channel creates try the 1.3 `{"type":"new","channel":{…}}` shape then fall back to the
> flat object (`_tunarr_create_channel`); schedule slots carry an `id` (1.3 linkable slots).

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

---

## Plex API Notes

- All Plex calls go through `get_plex_config()` — reads from `settings` table first, falls back to `.env`.
- Inside Docker, Plex is at `http://plex:32400` (container hostname on `plex_default` network).
- Thumbnails must be proxied through `/api/plex/thumb?path=` — Plex requires the token in the request header.

---

## Channels

`channels.py` exports a `CHANNELS` list: `{number, name, tier, vibe, mode, style, dayparts, ...}`. This is the authoritative source. New channels must be added here.

---

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
