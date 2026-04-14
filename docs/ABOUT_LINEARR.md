# Linearr — Complete Overview

## What is Linearr?

Linearr is a **self-hosted TV channel schedule manager** that turns your Plex media library into a fully programmed cable TV experience. Instead of browsing titles and choosing what to watch, you create channels with scheduled programming — just like real television.

Linearr sits between your **Plex Media Server** (the library) and **Tunarr** (the broadcast tower). Plex stores your movies and shows. Tunarr generates IPTV streams and EPG guides. Linearr is the **programming department** — it decides what plays on which channel, at what time, in what order.

```
Your Plex Library          Linearr                    Tunarr
┌──────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ Movies       │───>│ 1. Assign content│───>│ IPTV streams    │
│ TV Shows     │    │ 2. Build schedule│    │ EPG guide data  │
│ Collections  │    │ 3. Push to Tunarr│    │ M3U playlists   │
└──────────────┘    └──────────────────┘    └─────────────────┘
                           │
                    ┌──────┴──────┐
                    │ AI Advisor  │
                    │ suggestions │
                    └─────────────┘
```

---

## Core Concept: Cable Plex Channels

The heart of Linearr is **Cable Plex** — your personal cable TV channel lineup. Cable Plex channels are the source of truth. Everything else (Tunarr integration, schedule blocks, AI suggestions) serves this central concept.

### What is a Cable Plex Channel?

A Cable Plex channel is a virtual TV channel defined by:

| Field | Description | Example |
|-------|-------------|---------|
| **Number** | Unique channel number (like real cable) | 100, 121, 140 |
| **Name** | Channel brand name | Galaxy ONE, Cartoon Network, HBO |
| **Tier** | Category group | Galaxy Main, Classics, Galaxy Premium |
| **Vibe** | 2-4 word emotional descriptor | "Cozy crime procedurals", "90s/00s cartoon energy" |
| **Mode** | Playback strategy | Shuffle, Flex (curated), Sequential |
| **Style** | 1-2 sentence channel identity | "The 'always on' channel — comfortable, familiar, zero commitment" |
| **Color** | Visual theme for UI display | blue, amber, purple |
| **Icon** | Custom channel logo (optional) | Base64 PNG data URL |

### Channel Tiers

Channels are organized into three tiers, each mapped to a number range:

| Tier | Number Range | Color | Purpose |
|------|-------------|-------|---------|
| **Galaxy Main** | 100-119 | Blue | Flagship channels — drama, comedy, action, movies |
| **Classics** | 120-139 | Amber | Nostalgia, kids, retro content (Cartoon Network, Disney, Nick) |
| **Galaxy Premium** | 140-159 | Purple | Prestige, mature, event TV (HBO, Showtime, FX) |

### Channel Modes

| Mode | How it works |
|------|-------------|
| **Shuffle** | Random playback order — always something on, no commitment |
| **Flex** | Semi-curated — AI or user arranges content into themed blocks |
| **Sequential** | In-order playback — episodes air in sequence like a real show run |

### Pre-Loaded Channels

Linearr ships with ~45 pre-defined channels that serve as a starting template:

- **Galaxy ONE** (100) — Flagship best-of, hand-picked prestige content
- **Galaxy 2** (101) — Everyday cable comfort, procedurals and sitcoms
- **Galaxy Premium** (102) — Elevated cable drama (AMC/FX energy)
- **Galaxy Action** (103) — Franchise blockbusters, adrenaline
- **Galaxy Comedy** (108) — Easy laughs all day
- **Galaxy Movies** (109) — All-day movie channel
- **Cartoon Network** (120) — CN golden era cartoons
- **Disney Channel** (122) — DCOMs, sitcoms, animated mornings
- **Nickelodeon** (124) — Slime-era kids programming
- **Galaxy Premieres** (140) — HBO-level prestige event TV
- **Galaxy After Dark** (145) — Late-night mature content

Each pre-defined channel includes **daypart scheduling guidance** — recommended content for six time blocks:

| Daypart | Time Range | Typical Content |
|---------|-----------|-----------------|
| Early Morning | 6-9 AM | Light, feel-good, easy viewing |
| Morning | 9 AM-12 PM | Series blocks, procedurals |
| Afternoon | 12-5 PM | Movies, marathons, reruns |
| Prime Time | 5-10 PM | Flagship content, premieres, best-of |
| Late Night | 10 PM-2 AM | Prestige drama, adult content, thrillers |
| Overnight | 2-6 AM | Reruns, encores, filler |

### Smart Channel Creation

When creating a new channel, Linearr helps in three ways:

**1. Network Presets** — 80+ real-world network templates (HBO, Cartoon Network, Disney, FX, TNT, ESPN, Netflix, etc.) organized into 14 categories: Kids, Family, Adult Animation, Premium, Drama, Network TV, Cable Drama, Comedy, Movies, Sci-Fi & Action, Lifestyle & Reality, Music, News & Info, Sports. Pick one and the form auto-fills name, tier, vibe, mode, style, and color.

**2. AI Channel Suggestions** — Analyzes your Plex library and existing channel roster, identifies genre/demographic/format gaps, and suggests 8-15 new channel concepts with names, tiers, and recommended content.

**3. 24/7 Channel Builder** — Scans Plex for shows and movie franchises with enough content to run a dedicated loop channel (e.g., "Galaxy Harry Potter" if you have all HP movies, or "Galaxy The Office" with 201 episodes and ~100 hours of content).

### Additional Helpers

- **Auto-suggest channel number** — pre-fills the first free number in the selected tier's range
- **Vibe templates** — 30+ pre-written vibes to choose from (autocomplete dropdown)
- **Style templates** — 20 curated channel identity descriptions (click to insert)

---

## How Content Gets to Channels

### Step 1: Assign Content

Browse your Plex library inside Linearr — search, filter by genre/year/content rating, or browse collections. Assign movies and TV shows to channels. Each assignment links a Plex `ratingKey` to a channel number.

Content can be assigned:
- **Manually** — browse Plex, click "Assign to Channel"
- **From collections** — link a Plex collection to a channel; all items auto-assign
- **Via AI** — the AI content advisor suggests shows/movies based on the channel's vibe
- **24/7 mode** — assign a single show/franchise as the channel's entire content

The Plex browser inside Linearr supports:
- Library browsing with genre, year, and content rating filters (server-side)
- Full-text search across all libraries
- Item detail modal with media quality info (resolution, codec, audio, subtitles)
- Interactive star ratings
- Genre pills, audience/critic ratings
- "Play on Plex" button for any item

### Step 2: Build Schedule Blocks

Schedule blocks define **when content plays** on a channel. A block has:

- **Time range** — start/end times (e.g., 6:00 AM - 9:00 AM)
- **Days** — which days of the week (Mon-Sun)
- **Content type** — shows, movies, or both
- **Slots** — specific items scheduled at specific times within the block

Example blocks for a channel:
```
Morning Block:   6:00 AM - 12:00 PM  (Shows: sitcom reruns)
Afternoon Block: 12:00 PM - 5:00 PM  (Movies: crowd-pleaser films)
Prime Time:      5:00 PM - 10:00 PM  (Shows: flagship drama series)
Late Night:      10:00 PM - 2:00 AM  (Movies: thriller/horror films)
```

Blocks can be created:
- **Manually** — pick a time range, days, and content type
- **From reusable templates** — Generic Blocks are channel-independent templates you can apply to any channel
- **AI-generated** — full day of programming in one click based on the channel's vibe and content

### Step 3: Push to Tunarr

Once a channel's content and schedule are ready, Linearr pushes the schedule to Tunarr:

1. **Channel link** — each Cable Plex channel links to a Tunarr channel (by number or name)
2. **Collection sync** — Plex collections are synced to Tunarr smart collections (tag-based filters)
3. **Schedule push** — time slots with resolved show UUIDs and smart collection references

Tunarr then handles IPTV streaming, EPG guide generation, M3U playlist output, and HDHomeRun emulation.

### Auto-Sync

When you create or update a Cable Plex channel (name, number, tier, icon), Linearr **automatically syncs** metadata to the linked Tunarr channel. If no Tunarr channel exists, one is created automatically.

---

## Cable Plex Views

### Compact View

A grid of channel cards. Each card shows:
- Poster collage strip (thumbnails of assigned content)
- Channel icon + number badge + name overlay
- TV show / movie count badges
- Show titles listed below

### Expanded View

A wider list layout. Each row shows:
- Channel icon (or tier-colored number badge) + name + vibe
- Horizontal scrollable poster strip of all assigned content
- TV/movie count badges
- Click to open the full channel detail

Both views support:
- **Search** — filter channels by name
- **Tier filter** — show only Galaxy Main, Classics, or Premium
- **Content filter** (expanded) — show only shows, only movies, or all
- **Poster size toggle** (expanded) — small, medium, large thumbnails
- **Export/Import** — download/upload channel lineup as JSON

---

## Plex Integration

Linearr proxies all Plex API calls through its backend, so the Plex token is never exposed to the browser.

### What Linearr reads from Plex

| Feature | Description |
|---------|-------------|
| **Libraries** | All movie/show library sections |
| **Browse & Search** | Browse by library, search across all content, filter by genre/year/rating |
| **Item Details** | Full metadata: title, year, summary, genres, content rating, studio |
| **Media Quality** | Resolution (4K/1080p), video codec (HEVC/H264), audio codec/channels, subtitles |
| **Seasons & Episodes** | Full show structure for TV series |
| **Collections** | Full CRUD — list, create, edit, delete; add/remove items |
| **Server Info** | Server name, version, platform, Plex Pass status, machine ID |
| **Now Playing** | Active streaming sessions with user, player, progress, transcode status |
| **Watch History** | Recent viewing activity |
| **On Deck** | Continue watching items |
| **Popular** | Most-watched items sorted by view count |
| **Playlists** | All playlists with item counts |
| **Hubs** | Plex's discovery engine (Continue Watching, Recommended, Recently Released) |
| **User Ratings** | Read and write star ratings (0-10 scale) |
| **Webhooks** | Real-time events (new content, playback, scrobble) via Plex Pass |

### Plex Webhooks

Linearr receives real-time events from Plex (requires Plex Pass):

| Event | Description |
|-------|-------------|
| `library.new` | New content added to library |
| `media.play` | Playback started |
| `media.stop` | Playback stopped |
| `media.scrobble` | Content fully watched |
| `media.rate` | User rated something |

Events display in a color-coded feed in the Plex view. The webhook URL is shown in Settings for easy copy-paste into Plex's webhook configuration.

---

## Tunarr Integration

Tunarr is the broadcast layer — it turns Linearr's schedule into live IPTV streams.

### Features

| Feature | Description |
|---------|-------------|
| **Channel CRUD** | Create, link, sync channels between Cable Plex and Tunarr |
| **Smart Collections** | Sync Plex collections to Tunarr smart collections with tag-based filters |
| **Schedule Push** | Push time-slot schedules with resolved show UUIDs |
| **Program Guide** | Fetch and display materialized EPG data |
| **Channel Schedule** | View what's currently playing and upcoming on each channel |
| **XMLTV/M3U** | Download XMLTV guide and M3U playlist files directly |
| **Sessions** | Monitor active streaming sessions, kill streams |
| **Filler Lists** | Create and manage bumpers/interstitials between programs |
| **Version Check** | Display Tunarr version with compatibility warnings |
| **Import/Export** | Bidirectional channel import/export with auto-matching by number or name |

### Import & Export

**Export (Cable Plex to Tunarr):** Select channels, Linearr creates matching Tunarr channels (or links to existing ones by number), optionally syncs collections.

**Import (Tunarr to Cable Plex):** Preview all Tunarr channels, auto-match by number or name, choose per-channel: link to existing, create new Cable Plex channel, or skip.

---

## AI Features

Powered by any OpenAI-compatible API (OpenAI, Anthropic via proxy, Ollama, LM Studio):

| Feature | What it does |
|---------|-------------|
| **Content Advisor** | Per-channel show/movie suggestions based on vibe, avoiding cross-channel duplicates |
| **Network Advisor** | Cross-network gap analysis and optimization recommendations |
| **Day Generator** | Auto-generates a full day of schedule blocks with content slots |
| **Channel Suggestions** | Proposes 8-15 new channel concepts + 3-5 package bundles from library analysis |
| **24/7 Builder** | Scans library for shows/franchises with enough content for dedicated loop channels |

---

## Icon Editor

A **layered SVG canvas editor** for creating channel logos:

- **Multi-layer composition** — text + image (PNG/SVG) layers with drag/resize/rotate
- **Text features** — 12+ fonts (Google Fonts + system), size, weight, color, letter spacing, alignment
- **Image features** — PNG/SVG upload, color tinting (recolor images to any color), opacity
- **Backgrounds** — transparent, solid color, or linear gradient (angle + two colors)
- **5 color modes for export** — Original, All Black, All White, Text White / Image Original, Custom
- **Dual export** — PNG + SVG for each color mode, plus "Download All Variants" (8 files)
- **Save to library** — compositions stored as JSON for re-editing later
- **Assign to channel** — set icon directly from the editor or during channel creation

Icons display everywhere channels appear: sidebar (with tier-colored number badge overlay), Cable Plex cards (compact and expanded), and channel detail views.

---

## Technical Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, Vite, TypeScript |
| **State** | Zustand (UI state) + TanStack React Query (server state) |
| **Styling** | Tailwind CSS v3 |
| **Backend** | Python 3.12, FastAPI, uvicorn |
| **Database** | SQLite (persisted via Docker volume) |
| **Auth** | Stateless HMAC-SHA256 session cookie (30-day) |
| **Container** | Multi-stage Docker: Node 20 builds frontend, Python 3.12 serves it |
| **CI/CD** | GitHub Actions (lint, typecheck, build, Docker publish, semantic versioning) |
| **License** | GPL-3.0 (matching the *arr ecosystem) |

### Frontend Architecture

Vertical slice architecture — code organized by feature domain:

```
frontend/src/features/
├── auth/          # Login/logout, session
├── channels/      # Channel CRUD, sidebar, form, presets
├── assignments/   # Plex item to channel assignments
├── plex/          # Plex proxy (libraries, search, items, hubs, sessions, webhooks)
├── collections/   # Plex collection management
├── blocks/        # Schedule blocks + hour-grid editor
├── content/       # Content tab (composes plex + assignments)
├── ai/            # AI advisor, network advisor, day generator
├── tunarr/        # Tunarr integration, guide, import/export
├── settings/      # Settings page (Plex, AI, Tunarr, logs, system)
├── cable-plex/    # Cable Plex combined view (poster cards)
├── icons/         # Icon library + layered SVG editor
└── generic-blocks/# Reusable schedule block templates
```

### Database Tables

| Table | Purpose |
|-------|---------|
| `channels` | Channel definitions (number, name, tier, vibe, mode, style, color, icon) |
| `assignments` | Plex items assigned to channels |
| `blocks` | Schedule time blocks per channel |
| `block_slots` | Scheduled items within blocks |
| `channel_collections` | Plex collections linked to channels |
| `settings` | Key-value config store |
| `tunarr_channel_links` | Cable Plex to Tunarr channel mappings |
| `tunarr_collection_links` | Plex collections to Tunarr smart collections |
| `saved_icons` | Icon library with optional composition JSON |
| `ai_logs` | AI operation logs |
| `app_logs` | Application event logs |
| `plex_events` | Plex webhook events |

### API Surface

80+ REST endpoints. Full interactive docs at `/docs` (Swagger UI).

---

## Deployment

```yaml
services:
  linearr:
    image: ghcr.io/isaiasgv/linearr:latest
    container_name: linearr
    ports:
      - "8777:8888"
    volumes:
      - ./data:/app/data
    env_file:
      - path: .env
        required: false
    networks:
      - plex_default
    restart: unless-stopped

networks:
  plex_default:
    external: true
```

| Variable | Required | Description |
|----------|----------|-------------|
| `APP_USERNAME` | Yes | Login username |
| `APP_PASSWORD` | Yes | Login password |
| `APP_SECRET` | Yes | Random string for session signing |
| `PLEX_URL` | Yes | Plex server URL (`http://plex:32400` in Docker) |
| `PLEX_TOKEN` | Yes | Plex authentication token |
| `OPENAI_API_KEY` | No | For AI features |
| `TUNARR_URL` | No | Tunarr server URL (also configurable in UI) |

### Release Cycle

- Monthly stable releases on `main`
- Release candidates (`0.x.y-rc.N`) on `release/*` branches
- Docker tags: `:latest` (stable) and `:rc` (candidate)
- Installable as a PWA (Progressive Web App)

---

## Part of the *arr Ecosystem

Linearr follows the same conventions as Sonarr, Radarr, Prowlarr, and the rest of the *arr stack:

- Self-hosted and open source (GPL-3.0)
- Docker-first deployment
- Designed to work alongside your existing Plex and Tunarr setup
- Community-driven development

---

*Linearr is a schedule management tool. It does not provide, host, stream, or distribute any media content. All media remains on your own Plex server.*
