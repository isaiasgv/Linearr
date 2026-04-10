# Plex Deep Integration — Full Roadmap

> Reference document for expanding Linearr's Plex integration beyond the current 28+ endpoints.
> Each phase is independent and can be tackled in any order. Phases are ordered by value for schedule building.

---

## Current State

Linearr already implements:
- Library browsing (sections, items, search, collections)
- Item details (metadata, seasons, episodes)
- Collection CRUD (create, add/remove items)
- Server info, library stats
- Recently added, On Deck, Popular carousels
- Active sessions (now playing), watch history
- Playlists (list only), library scan
- Thumbnail proxy, OAuth authentication

---

## Phase 1: Content Intelligence (HIGH VALUE)

**Status: In Progress**

- 1A: Genre/tag enrichment + server-side filtering
- 1B: Media quality info (resolution, codec, audio, subtitles)
- 1C: User ratings (read/write)
- 1D: Plex hubs (discovery engine)

---

## Phase 2: Plex Webhooks (HIGH VALUE)

**Goal:** Real-time library change awareness.

### Endpoints
- `POST /api/plex/webhook` — receiver for Plex webhook POSTs (requires Plex Pass)
- `GET /api/plex/events` — list stored events
- `DELETE /api/plex/events` — clear event history

### DB Table
```sql
plex_events (id, event_type, rating_key, title, plex_type, user, player, created_at)
```

### Events
- `library.new` — new content added (auto-suggest for channels)
- `media.play` / `media.stop` — track what users watch
- `media.scrobble` — content fully watched
- `media.rate` — user rated something

### UI
- Event feed in PlexView showing recent events
- "New Content" banner when library.new events exist
- Webhook URL display in Settings (with Plex Pass requirement note)
- If user doesn't have Plex Pass, show placeholder explaining the feature requires it

---

## Phase 3: Full Playlist CRUD (MEDIUM VALUE)

### Endpoints
- `GET /api/plex/playlists/{rk}/items` — get playlist contents
- `POST /api/plex/playlists` — create playlist from items
- `PUT /api/plex/playlists/{rk}/items` — add/remove items
- `DELETE /api/plex/playlists/{rk}` — delete playlist

### Use Cases
- Export a channel schedule as a Plex playlist for preview playback
- Import a Plex playlist as channel content
- Manage playlists from within Linearr

---

## Phase 4: AI Advisor Enrichment (HIGH LEVERAGE)

**Depends on:** Phase 1 (genre/rating data)

### Changes
- Enrich AI content suggestion prompts with genre, rating, view count per item
- New `GET /api/plex/content-stats` — aggregate library stats (by genre, decade, rating, resolution)
- Include media duration in AI day-generation for accurate time slots
- Display genre tags and ratings on AI suggestion cards

---

## Phase 5: Server Health & Maintenance (MEDIUM VALUE)

### Endpoints
- `GET /api/plex/butler` — list scheduled tasks with status
- `POST /api/plex/butler/{task_name}` — trigger task (allow-list only)
- `GET /api/plex/update-check` — check for Plex updates
- `DELETE /api/plex/trash` — empty library trash

### Butler Tasks (allow-list)
BackupDatabase, CleanOldBundles, DeepMediaAnalysis, OptimizeDatabase, RefreshLibraries

---

## Phase 6: Metadata Editing (LOWER VALUE)

### Endpoints
- `PUT /api/plex/item/{rk}/metadata` — edit title, summary, sort title
- `PUT /api/plex/item/{rk}/poster` — set poster from URL

---

## Out of Scope

- Remote playback control (play/pause/stop on clients)
- Play queues
- Managed users / friend sharing management
- Photo/music library support
- Server logs / database download

---

## Priority Matrix

| Phase | Feature | Effort | Value |
|-------|---------|--------|-------|
| 1 | Content Intelligence | Medium | High — directly improves scheduling |
| 2 | Webhooks | Medium | High — real-time awareness |
| 3 | Playlist CRUD | Medium | Medium — schedule export/preview |
| 4 | AI Enrichment | Medium | High leverage (uses Phase 1 data) |
| 5 | Server Health | Small | Medium — admin convenience |
| 6 | Metadata Editing | Medium | Low — nice-to-have |
