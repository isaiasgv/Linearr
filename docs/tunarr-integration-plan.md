# Tunarr Deep Integration — Implementation Plan

> Reference document for expanding Linearr's Tunarr integration. Each phase is independent and can be tackled in any order. Phases are ordered by user impact.

---

## Current State

Linearr currently integrates with these Tunarr endpoints:

| Area | What works today |
|---|---|
| Channels | List, get detail, get schedule, get shows |
| Smart Collections | Full CRUD, sync from Plex collections |
| Programming | Push schedule via `POST /channels/{id}/programming` |
| Tasks | Run `ScanLibrariesTask`, `UpdateXmlTvTask` |
| Connection | Test connectivity, get version |
| Guide | 24-hour guide view (fetches per-channel schedules) |

---

## Phase 1: Filler Lists

**Goal:** Let users create and manage filler content (bumpers, interstitials, station IDs) that plays between scheduled programs.

### Tunarr Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/filler-lists` | List all filler lists |
| POST | `/api/filler-lists` | Create filler list |
| GET | `/api/filler-lists/{id}` | Get filler list |
| PUT | `/api/filler-lists/{id}` | Update filler list |
| DELETE | `/api/filler-lists/{id}` | Delete filler list |
| GET | `/api/filler-lists/{id}/programs` | Get programs in filler list |

### Backend (`main.py`)

- `GET /api/tunarr/filler-lists` — proxy list
- `POST /api/tunarr/filler-lists` — proxy create
- `GET /api/tunarr/filler-lists/{id}` — proxy get with programs
- `PUT /api/tunarr/filler-lists/{id}` — proxy update
- `DELETE /api/tunarr/filler-lists/{id}` — proxy delete
- `POST /api/tunarr/filler-lists/{id}/add-programs` — add Plex items to filler list (resolve Plex keys → Tunarr program IDs via batch lookup)

### Frontend

- **New feature slice:** `features/fillers/`
- **FillerListManager component:** CRUD table with inline editing
- **FillerContentPicker:** reuse existing Plex browser + poster grid to add content to filler lists
- **Channel filler assignment:** in TunarrTab, let users assign filler lists to linked channels
- React Query keys: `['tunarr', 'filler-lists']`, `['tunarr', 'filler-list', id]`

### Database

- `tunarr_filler_links (channel_number, filler_list_id, filler_list_name)` — track which filler lists are assigned to which Galaxy channels

---

## Phase 2: Programs & Programming

**Goal:** Search, browse, and manage Tunarr's indexed program library directly. Enable direct lineup editing without going through Plex.

### Tunarr Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/programs/search` | Search programs with filters |
| GET | `/api/programs/{id}` | Get program details |
| GET | `/api/programs/{id}/children` | Get episodes (paginated) |
| GET | `/api/programs/{id}/descendants` | Get all descendants |
| GET | `/api/programs/{id}/thumb` | Get thumbnail |
| GET | `/api/programs/{id}/stream_details` | Get media info |
| GET | `/api/programs/{id}/external-link` | Get Plex/Jellyfin link |
| POST | `/api/programming/batch/lookup` | Batch resolve external IDs |
| GET | `/api/programming/shows/{id}` | Get show with seasons |
| GET | `/api/programming/shows/{id}/seasons` | Get seasons |
| GET | `/api/programs/facets/{name}` | Get facet values for filtering |
| POST | `/api/channels/{id}/programming` | Update channel lineup |
| GET | `/api/channels/{id}/programming` | Get current lineup |
| POST | `/api/channels/{id}/schedule-time-slots` | Generate time-slot schedule |
| POST | `/api/channels/{id}/schedule-slots` | Generate random schedule |

### Backend (`main.py`)

- `POST /api/tunarr/programs/search` — proxy search with pagination
- `GET /api/tunarr/programs/{id}` — proxy program detail
- `GET /api/tunarr/programs/{id}/children` — proxy children/episodes
- `POST /api/tunarr/programs/batch-lookup` — proxy batch lookup
- `GET /api/tunarr/programs/{id}/thumb` — proxy thumbnail
- `GET /api/tunarr/channels/{id}/programming` — get current lineup
- `POST /api/tunarr/channels/{id}/programming` — update lineup directly
- `POST /api/tunarr/channels/{id}/schedule-time-slots` — generate time-slot schedule
- `POST /api/tunarr/channels/{id}/schedule-slots` — generate random schedule

### Frontend

- **TunarrProgramBrowser component:** search/filter Tunarr programs (independent of Plex browser)
- **TunarrProgramDetail modal:** show program info, media details, external link
- **Direct lineup editor:** drag-and-drop reorder of channel programming in Tunarr
- **Schedule generators:** UI for time-slot and random schedule generation with options
- React Query keys: `['tunarr', 'programs', 'search', params]`, `['tunarr', 'program', id]`, `['tunarr', 'channel-programming', id]`

### Impact on Existing Code

- The existing `pushSchedule` function in TunarrTab uses `POST /channels/{id}/programming` — the new direct lineup editor would be an alternative to the block-based push workflow
- Batch lookup can improve the show-key resolution in `push-schedule` (currently uses sequential lookups)

---

## Phase 3: Enhanced Smart Collections

**Goal:** Expose the full power of Tunarr smart collection filters — not just tag-based matching.

### Current Limitation

Linearr currently creates smart collections with a simple tag filter:
```json
{ "type": "value", "fieldSpec": { "type": "faceted_string", "key": "tags", "op": "=", "value": ["collection_name"] } }
```

### Enhancements

- **Filter builder UI:** let users build complex filters (genre, year, rating, studio, etc.)
- **Facet browser:** use `GET /api/programs/facets/{name}` to show available values for each filter field
- **Preview:** before saving, show which programs match the filter using `POST /api/programs/search`
- **Bulk operations:** create/update multiple smart collections at once during collection sync

### Frontend

- **SmartCollectionEditor component:** visual filter builder
- **SmartCollectionPreview:** shows matched programs count and sample
- Enhance existing smart collection list in TunarrView with edit capability

---

## Phase 4: Live Guide / EPG

**Goal:** Full TV guide experience inside Linearr with real-time data from Tunarr.

### Tunarr Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/guide/channels` | Guide data for all channels (dateFrom/dateTo) |
| GET | `/api/guide/channels/{id}` | Guide for specific channel |
| GET | `/api/guide/status` | Guide generation status |
| GET | `/api/channels/{id}/now_playing` | Currently playing program |
| GET | `/api/channels/all/lineups` | All channel lineups for date range |

### Backend (`main.py`)

- `GET /api/tunarr/guide/epg` — proxy full EPG data with date range
- `GET /api/tunarr/guide/status` — proxy guide status
- `GET /api/tunarr/channels/{id}/now-playing` — proxy now playing
- `GET /api/tunarr/guide/all-lineups` — proxy all lineups

### Frontend

- **Enhance TunarrGuide.tsx:**
  - Multi-day navigation (not just 24h)
  - Channel filtering by Galaxy tier/category
  - Click program → show detail modal
  - Now-playing indicators with auto-refresh
  - Mini-guide widget for dashboard/sidebar
- **NowPlaying component:** show what's currently airing across all channels
- **GuideStatus indicator:** show when guide was last generated, trigger refresh
- React Query keys: `['tunarr', 'guide', 'epg', dateRange]`, `['tunarr', 'now-playing', channelId]`, `['tunarr', 'guide', 'status']`

---

## Phase 5: Media Sources

**Goal:** View and manage Tunarr's media sources (Plex, Jellyfin, Emby) from within Linearr.

### Tunarr Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/media-sources` | List all media sources |
| POST | `/api/media-sources` | Add media source |
| GET | `/api/media-sources/{id}` | Get media source |
| PUT | `/api/media-sources/{id}` | Update media source |
| DELETE | `/api/media-sources/{id}` | Delete media source |
| GET | `/api/media-sources/{id}/status` | Connection health |
| GET | `/api/media-sources/{id}/libraries` | List libraries |
| POST | `/api/media-sources/{id}/scan` | Trigger full scan |
| POST | `/api/media-sources/{id}/libraries/{libId}/scan` | Scan specific library |
| POST | `/api/media-sources/{id}/libraries/refresh` | Refresh library list |

### Backend (`main.py`)

- `GET /api/tunarr/media-sources` — list with status
- `POST /api/tunarr/media-sources` — add new source
- `PUT /api/tunarr/media-sources/{id}` — update
- `DELETE /api/tunarr/media-sources/{id}` — delete
- `GET /api/tunarr/media-sources/{id}/status` — health check
- `GET /api/tunarr/media-sources/{id}/libraries` — list libraries
- `POST /api/tunarr/media-sources/{id}/scan` — trigger scan
- `POST /api/tunarr/media-sources/{id}/libraries/{libId}/scan` — scan library

### Frontend

- **MediaSourceManager component:** in Settings or Tunarr view
  - List sources with connection status indicators
  - Add/edit/remove sources
  - Per-library scan buttons
  - Scan progress indicator (poll `GET /media-sources/{id}/{libId}/status`)
- React Query keys: `['tunarr', 'media-sources']`, `['tunarr', 'media-source', id, 'status']`, `['tunarr', 'media-source', id, 'libraries']`

---

## Phase 6: Streaming & Live Preview

**Goal:** Embed live channel previews directly in the Linearr UI.

### Tunarr Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/stream/channels/{id}` | Auto-redirect to best format |
| GET | `/stream/channels/{id}.m3u8` | HLS playlist |
| GET | `/stream/channels/{id}.ts` | MPEG-TS stream |

### Backend (`main.py`)

- `GET /api/tunarr/stream/{tunarr_id}` — proxy/redirect to Tunarr HLS stream
- Alternatively, expose Tunarr stream URL directly to frontend (if Tunarr is accessible from browser)

### Frontend

- **LivePreview component:** HLS.js video player embedded in channel cards or modal
- **Preview button** on TunarrView channel cards — click to watch live
- **Picture-in-picture** support for monitoring while editing schedules
- Consider: if Tunarr is not directly accessible from the browser (Docker internal network), the backend must proxy the stream via `StreamingResponse`

### Technical Notes

- HLS.js library needed for frontend (`npm install hls.js`)
- Backend proxy for HLS must handle both `.m3u8` playlist and `.ts` segment requests
- Consider bandwidth: only stream when user explicitly requests preview

---

## Phase 7: XMLTV & M3U Output

**Goal:** Manage and download XMLTV/M3U files from Linearr, configure EPG settings.

### Tunarr Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/xmltv.xml` | Download XMLTV guide |
| POST | `/xmltv/refresh` | Force XMLTV refresh |
| GET | `/xmltv-last-refresh` | Last refresh timestamp |
| GET | `/channels.m3u` | Download M3U playlist |
| DELETE | `/channels.m3u` | Clear M3U cache |
| GET | `/api/xmltv-settings` | Get XMLTV settings |
| PUT | `/api/xmltv-settings` | Update XMLTV settings |

### Backend (`main.py`)

- `GET /api/tunarr/xmltv` — proxy XMLTV download
- `POST /api/tunarr/xmltv/refresh` — force refresh
- `GET /api/tunarr/xmltv/status` — last refresh time
- `GET /api/tunarr/m3u` — proxy M3U download
- `DELETE /api/tunarr/m3u/cache` — clear M3U cache
- `GET /api/tunarr/xmltv-settings` — get settings
- `PUT /api/tunarr/xmltv-settings` — update settings

### Frontend

- **XMLTV/M3U panel** in Settings or Tunarr view:
  - Download XMLTV button with last-refresh timestamp
  - Download M3U button
  - Force refresh button
  - Clear cache button
  - XMLTV settings editor (refresh interval, image cache, programming hours, use show poster)
  - Copy M3U/XMLTV URLs for pasting into Plex/Jellyfin tuner setup
- React Query keys: `['tunarr', 'xmltv-settings']`, `['tunarr', 'xmltv-status']`

---

## Phase 8: Sessions

**Goal:** Monitor active streaming sessions and manage them from Linearr.

### Tunarr Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/sessions` | All active sessions by channel |
| GET | `/api/channels/{id}/sessions` | Sessions for specific channel |
| DELETE | `/api/channels/{id}/sessions` | Kill all sessions for channel |

### Backend (`main.py`)

- `GET /api/tunarr/sessions` — list all active sessions
- `GET /api/tunarr/sessions/{tunarr_id}` — sessions for channel
- `DELETE /api/tunarr/sessions/{tunarr_id}` — kill sessions for channel

### Frontend

- **SessionMonitor component:** real-time session dashboard
  - Active viewer count per channel
  - Stream details (format, duration, client info)
  - Kill session button per channel
  - Auto-refresh every 10 seconds
- **Session badge** on channel cards in TunarrView — show active viewer count
- React Query keys: `['tunarr', 'sessions']` with `refetchInterval: 10000`

---

## Phase 9: Channel CRUD from Linearr

**Goal:** Create, update, and delete Tunarr channels directly from Linearr instead of switching to Tunarr's UI.

### Tunarr Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/channels` | Create channel |
| PUT | `/api/channels/{id}` | Update channel |
| DELETE | `/api/channels/{id}` | Delete channel |

### Backend (`main.py`)

- `POST /api/tunarr/channels` already exists — enhance to pass full channel config (icon, transcode settings, watermark, etc.)
- `PUT /api/tunarr/channels/{id}` — update channel name, number, icon, settings
- `DELETE /api/tunarr/channels/{id}` — delete (with confirmation, also clean up `tunarr_channel_links`)

### Frontend

- **Enhance TunarrView:** add edit/delete buttons to channel cards
- **TunarrChannelFormModal:** full channel editor (name, number, icon, group tag, stealth mode, transcode config)
- **Bulk channel creation:** from Galaxy channel lineup, create all matching Tunarr channels at once

---

## Phase 10: Now Playing Dashboard

**Goal:** A real-time dashboard showing what's airing across all channels.

### Tunarr Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/channels/{id}/now_playing` | Currently playing program |
| GET | `/api/channels/all/lineups` | All lineups for date range |

### Backend (`main.py`)

- `GET /api/tunarr/now-playing` — fetch now-playing for all linked channels in parallel
- Returns: `{ channels: [{ channel_number, tunarr_name, now_playing: { title, type, thumb, start, end, progress_pct } }] }`

### Frontend

- **NowPlayingDashboard:** grid of channel cards with:
  - Currently playing title + thumbnail
  - Progress bar (elapsed/remaining)
  - Up next info
  - Live preview button (Phase 6)
  - Active viewers badge (Phase 8)
- Auto-refresh every 30 seconds
- Could serve as the Linearr homepage/landing view

---

## Summary — Priority Matrix

| Phase | Feature | User Impact | Effort | Dependencies |
|---|---|---|---|---|
| 1 | Filler Lists | High — fills gaps between programs | Medium | None |
| 2 | Programs & Programming | High — direct lineup control | Large | None |
| 3 | Enhanced Smart Collections | Medium — power-user feature | Medium | None |
| 4 | Live Guide / EPG | High — core TV experience | Medium | None |
| 5 | Media Sources | Medium — setup/admin feature | Medium | None |
| 6 | Streaming & Live Preview | High — visual wow factor | Large | HLS.js dependency |
| 7 | XMLTV & M3U Output | Medium — setup/export feature | Small | None |
| 8 | Sessions | Medium — monitoring feature | Small | None |
| 9 | Channel CRUD | High — reduces Tunarr UI dependency | Medium | None |
| 10 | Now Playing Dashboard | High — real-time experience | Medium | Phases 4, optionally 6 & 8 |

### Suggested Order

1. **Phase 7** (XMLTV/M3U) — smallest, high utility, quick win
2. **Phase 8** (Sessions) — small, adds monitoring
3. **Phase 1** (Filler Lists) — fills a real gap in schedule quality
4. **Phase 4** (Live Guide) — core feature upgrade
5. **Phase 9** (Channel CRUD) — reduces context-switching to Tunarr
6. **Phase 10** (Now Playing) — builds on Phase 4
7. **Phase 2** (Programs & Programming) — largest, most powerful
8. **Phase 3** (Enhanced Smart Collections) — power-user refinement
9. **Phase 5** (Media Sources) — admin convenience
10. **Phase 6** (Streaming) — most complex, biggest visual impact

---

## Reference

- **Tunarr API Docs:** https://tunarr.com/api-docs.html
- **Tunarr OpenAPI Spec:** https://tunarr.com/generated/tunarr-latest-openapi.json
- **Linearr Backend:** `main.py`
- **Linearr Tunarr Frontend:** `frontend/src/features/tunarr/`
