# Introducing Linearr: Build Your Own TV Network with Plex and Tunarr

If you've ever wanted to turn your Plex library into something that feels like actual cable TV — with channels, time slots, and a real programming schedule — Linearr is for you.

Linearr is a free, open-source, self-hosted TV channel schedule manager. It sits between your Plex Media Server and [Tunarr](https://github.com/chrisbenincasa/tunarr), giving you a visual tool to build, manage, and push programming schedules for your own personal TV network.

No more random shuffles. You decide what plays, when it plays, and on which channel.

---

## What Problem Does Linearr Solve?

Tools like Tunarr are great at turning your Plex library into IPTV streams with EPG data. But building a *schedule* — deciding that channel 100 plays Oscar winners at primetime and sitcom reruns in the morning — is tedious to do by hand.

Linearr gives you a visual schedule editor, a channel lineup manager, and an AI advisor that can help you fill time slots, suggest content, and even generate an entire day of programming automatically.

Think of it this way:

- **Plex** = your media library
- **Tunarr** = the broadcast tower
- **Linearr** = the programming department

---

## Key Features

### Channel Lineup Manager

Define your full channel lineup with names, numbers, tiers, vibes, and genres. Organize channels into groups like "Galaxy Main", "Movies", "Kids", or whatever fits your network. Each channel gets its own identity and schedule.

### Plex Content Browser

Browse your Plex libraries directly inside Linearr. Search for movies and shows, view details, and assign content to channels — all through a clean poster grid interface. No need to bounce between apps.

### Drag-and-Drop Schedule Blocks

Build your schedule visually with time blocks. Create a "Morning" block from 6-9 AM, a "Primetime" block from 5-10 PM, and fill each slot with specific content. Drag and drop to rearrange. The hour grid makes it easy to see your entire day at a glance.

### AI-Powered Scheduling

Stuck on what to program? Linearr has a built-in AI advisor (supports OpenAI and Anthropic) that can:

- Suggest content for a specific channel based on its vibe and genre
- Analyze your entire network for gaps and overlaps
- Auto-generate a full day of programming with one click

### Tunarr Integration

Once your schedule is built, push it to Tunarr in one click. Linearr handles linking channels, syncing collections, and pushing schedules. Tunarr takes care of the IPTV stream and EPG guide data.

### 24/7 Channel Builder

Analyze your Plex library and generate standalone 24/7 loop channels automatically. Perfect for a "Friends Marathon" channel or a "90s Action" channel that runs all day.

### Backup and Restore

Download your entire database from the Settings UI with one click. Restore it just as easily. You never lose your schedule work.

### Installable PWA

Linearr is a Progressive Web App. Install it on your phone, tablet, or desktop for a native app experience. The interface is mobile-first and fully responsive.

---

## How It Works

```
Your Plex Library          Linearr                    Tunarr
┌──────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ Movies       │───>│ 1. Assign content│───>│ IPTV streams    │
│ TV Shows     │    │ 2. Build schedule│    │ EPG guide data  │
│ Collections  │    │ 3. Push to Tunarr│    │ M3U playlists   │
└──────────────┘    └──────────────────┘    └─────────────────┘
```

1. **Assign content** — Browse your Plex libraries and assign movies, shows, and collections to channels.
2. **Build your schedule** — Create time blocks (Morning, Primetime, Late Night) and fill slots with content. Use the AI advisor to auto-generate schedules.
3. **Push to Tunarr** — Link your Linearr channels to Tunarr channels and push. Tunarr handles the IPTV stream and EPG.

---

## Installation

Linearr runs as a Docker container. You can be up and running in under 5 minutes.

### Requirements

- Docker and Docker Compose
- A running Plex Media Server
- [Tunarr](https://github.com/chrisbenincasa/tunarr) (optional, for IPTV output)

### Step 1: Create a Directory

```bash
mkdir linearr && cd linearr
```

### Step 2: Create a docker-compose.yml

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

> **Note:** The `plex_default` network assumes Plex is running in Docker on the same host. If your Plex setup is different, adjust the network or use your Plex server's IP directly.

### Step 3: Configure Environment Variables

Create a `.env` file:

```env
APP_USERNAME=admin
APP_PASSWORD=your-secure-password
APP_SECRET=generate-a-random-string-here
PLEX_URL=http://plex:32400
PLEX_TOKEN=your-plex-token
```

Use `http://plex:32400` if Linearr and Plex share the same Docker network. Otherwise, use your Plex server's IP or hostname.

**Optional variables:**

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | Enable AI features with OpenAI |
| `ANTHROPIC_API_KEY` | Enable AI features with Anthropic |
| `TUNARR_URL` | Tunarr server URL (also configurable in the UI) |

### Step 4: Start the Container

```bash
docker compose up -d
```

### Step 5: Open the App

Navigate to `http://your-server-ip:8777` and log in with the credentials from your `.env` file.

---

## Updating

Pull the latest image and recreate the container:

```bash
docker compose pull
docker compose up -d
```

Your data is persisted in the `./data` directory and survives updates.

---

## The Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript |
| State | Zustand + TanStack React Query |
| Styling | Tailwind CSS |
| Backend | Python 3.12, FastAPI |
| Database | SQLite |
| Container | Multi-stage Docker (Node 20 + Python 3.12) |

Linearr is fully self-contained. No external databases, no message queues, no complex infrastructure. One container, one SQLite file, done.

---

## Part of the *arr Ecosystem

Linearr follows the same conventions as the rest of the *arr stack (Sonarr, Radarr, Prowlarr, etc.):

- Self-hosted and open source
- Licensed under GPL-3.0
- Docker-first deployment
- Designed to work alongside your existing setup

If you already run Plex and Tunarr, Linearr slots right in.

---

## Get Started

- **GitHub:** [github.com/isaiasgv/linearr](https://github.com/isaiasgv/linearr)
- **Docker Image:** `ghcr.io/isaiasgv/linearr:latest`
- **API Docs:** Available at `/docs` once running

Contributions, issues, and feature requests are welcome. Check out the [Contributing Guide](https://github.com/isaiasgv/linearr/blob/main/CONTRIBUTING.md) to get started.

---

*Linearr is a schedule management tool. It does not provide, host, stream, or distribute any media content. All media remains on your own Plex server.*
