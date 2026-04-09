# ErsatzTV Integration Plan

## Overview

Add ErsatzTV as an alternative IPTV backend alongside Tunarr. ErsatzTV is a C#/.NET self-hosted IPTV platform (2700+ stars, zlib license) that supports Plex/Jellyfin/Emby with advanced scheduling.

---

## Research Summary

### What ErsatzTV is

- **Repo:** github.com/ErsatzTV/ErsatzTV
- **Stack:** C# / .NET, Blazor Server UI, ASP.NET Core, SQLite/MySQL
- **What it does:** Transforms personal media into live TV channels with EPG, IPTV streaming, and HDHomeRun emulation
- **Same family as:** pseudotv-plex, dizquetv, Tunarr

### ErsatzTV REST API (available endpoints)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/version` | Health check — returns `{apiVersion, appVersion}` |
| GET | `/api/channels` | List all channels (id, number, name, ffmpegProfile, streamingMode) |
| POST | `/api/channels/{number}/playout/reset` | Reset/rebuild a channel's playout |
| GET | `/api/ffmpeg/profiles` | List FFmpeg transcoding profiles |
| POST/PUT/DELETE | `/api/ffmpeg/profiles/*` | CRUD FFmpeg profiles |
| POST | `/api/libraries/{id}/scan` | Trigger library scan |
| GET/POST/PUT/DELETE | `/api/collections/smart/*` | Smart collection CRUD |
| GET | `/api/sessions` | List active streaming sessions |
| DELETE | `/api/session/{channelNumber}` | Stop a streaming session |

### Scripted Playout API (advanced, stateful)

ErsatzTV has a powerful scripted schedule API at `/api/scripted/playout/build/{buildId}/*` that allows programmatic schedule building:

- `add_collection`, `add_show`, `add_search` — register content sources
- `add_all`, `add_count`, `add_duration` — schedule content
- `pad_to_next`, `pad_until` — fill gaps
- `start_epg_group` / `stop_epg_group` — group items in EPG
- `graphics_on/off`, `watermark_on/off` — control overlays

### What ErsatzTV does NOT expose via REST

- Channel creation/update (Blazor UI only)
- Playout creation/configuration (Blazor UI only)
- Block/Template schedule management (Blazor UI only)
- Direct schedule push (unlike Tunarr's `POST /api/channels/{id}/programming`)

### ErsatzTV vs Tunarr

| Aspect | ErsatzTV | Tunarr |
|--------|----------|--------|
| API surface | Slim REST — most ops via Blazor UI | Full REST API |
| Scheduling | 5 modes: Classic, Block, Sequential (YAML), Scripted, ExternalJson | Time-based slots |
| FFmpeg | Built-in pipeline with HW acceleration | Built-in pipeline |
| Media sources | Plex, Jellyfin, Emby, local | Plex, Jellyfin |
| Advanced features | Watermarks, overlays, pre/mid/post-roll, commercial breaks | Simpler filler model |
| EPG | Built-in XMLTV + HDHomeRun emulation | Built-in XMLTV + HDHomeRun |

---

## Integration Strategy

### Phase 1: Read-only + ExternalJson file bridge

Since ErsatzTV has no REST endpoint for pushing schedules directly, use the **ExternalJson playout** mode: channels configured with this mode read their schedule from a JSON file on disk. Linearr writes these files to a shared Docker volume.

**What Phase 1 includes:**
- ErsatzTV URL in Settings (test connection, save)
- List ErsatzTV channels (read-only from API)
- Link Linearr channels to ErsatzTV channels
- Push schedule by writing ExternalJson files to a shared volume
- Smart collection CRUD (API exists)

**What Phase 1 does NOT include:**
- Channel creation in ErsatzTV (must be done in ErsatzTV UI)
- Scripted Playout API integration (complex, Phase 2)
- Full parity with Tunarr features

### Phase 2 (future): Scripted Playout API

Use ErsatzTV's scripted playout API to programmatically build schedules with content sources, duration-based fills, padding, and EPG grouping. This is more powerful than Tunarr's time-slot model but requires a stateful session-based workflow.

---

## Implementation Plan

### Backend (main.py)

**New setting:** `ersatztv_url` stored in settings table

**New DB table:**
```sql
CREATE TABLE IF NOT EXISTS ersatztv_channel_links (
    channel_number INTEGER PRIMARY KEY,
    ersatztv_id    INTEGER NOT NULL,
    ersatztv_name  TEXT
);
```

**New endpoints:**

| Endpoint | Purpose |
|---|---|
| `POST /api/ersatztv/test` | Test connection via `GET {url}/api/version` |
| `GET /api/ersatztv/channels` | Proxy `GET {url}/api/channels` |
| `GET /api/ersatztv/channel-links` | List linked channels |
| `POST /api/ersatztv/channel-links` | Link Linearr channel to ErsatzTV channel |
| `DELETE /api/ersatztv/channel-links/{channel_number}` | Unlink |
| `POST /api/ersatztv/channel-links/{channel_number}/push-schedule` | Write ExternalJson file |
| `GET /api/ersatztv/smart-collections` | Proxy smart collections list |
| `POST /api/ersatztv/smart-collections` | Proxy create |
| `PUT /api/ersatztv/smart-collections/{id}` | Proxy update |
| `DELETE /api/ersatztv/smart-collections/{id}` | Proxy delete |

**Schedule push (ExternalJson format):**
```json
{
  "items": [
    {
      "ratingKey": "12345",
      "title": "Breaking Bad S01E01",
      "startTime": "2026-04-08T06:00:00",
      "duration": "01:00:00"
    }
  ]
}
```

Written to `/app/ersatztv-schedules/{channel_number}.json` (shared Docker volume).

### Frontend

**New feature slice:** `frontend/src/features/ersatztv/`
```
features/ersatztv/
  api.ts              — API client (mirrors tunarr/api.ts)
  hooks.ts            — React Query hooks
  components/
    ErsatzTVView.tsx  — Main view (mirrors TunarrView)
```

**Modified files:**
- `shared/types/index.ts` — add ErsatzTV types
- `settings/components/SettingsModal.tsx` — add ErsatzTV URL + test connection
- `channels/components/ChannelSidebar.tsx` — add ErsatzTV nav button
- `App.tsx` — add ErsatzTV view route
- `shared/store/ui.store.ts` — add 'ersatztv' to ActiveView

### Docker

Add shared volume in `docker-compose.yml`:
```yaml
volumes:
  - ./data:/app/data
  - ./ersatztv-schedules:/app/ersatztv-schedules
```

User must also mount this path in their ErsatzTV container and configure channels to use ExternalJson playout.

---

## User workflow (after implementation)

1. In ErsatzTV UI: create channels, set playout mode to "ExternalJson", point to the shared volume path
2. In Linearr Settings: add ErsatzTV URL, test connection
3. In Linearr ErsatzTV view: see ErsatzTV channels, link them to Linearr channels
4. Build schedule in Linearr as normal (assign content, create blocks, fill slots)
5. Push schedule — Linearr writes the JSON file, ErsatzTV picks it up on next playout cycle

---

## Effort estimate

- Backend endpoints: ~200 lines (following existing Tunarr pattern)
- Frontend feature slice: ~300 lines (api + hooks + view component)
- Settings/sidebar/routing changes: ~50 lines
- Docker/docs: minimal

Total: ~550 lines of new code, mostly following established patterns.
