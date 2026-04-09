<div align="center">

<img src="frontend/public/logo.svg" width="80" height="80" alt="Linearr logo" />

# Linearr

**Self-hosted TV channel schedule manager for Plex and Tunarr.**

Build, manage, and push programming schedules for your personal TV network — complete with an AI advisor, EPG generation, and a real-time schedule editor.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![GitHub Actions](https://img.shields.io/github/actions/workflow/status/isaiasgv/linearr/ci.yml?label=CI)](https://github.com/isaiasgv/linearr/actions)
[![Docker](https://img.shields.io/badge/docker-ghcr.io-blue?logo=docker)](https://ghcr.io/isaiasgv/linearr)

[Features](#features) &bull; [Quick Start](#-quick-start) &bull; [Screenshots](#-how-it-works) &bull; [Stack](#-stack) &bull; [API Docs](#-api-documentation) &bull; [Contributing](#-contributing)

</div>

---

> **Linearr does not provide, host, stream, or distribute any media content.** It is a schedule management tool that organizes metadata (titles, thumbnails, time slots) from your own Plex Media Server. All media files remain on your server and are never copied, transcoded, or redistributed by Linearr. You are solely responsible for ensuring that the content on your Plex server complies with applicable copyright laws in your jurisdiction.

---

## Features

| | Feature | Description |
|---|---|---|
| **Channels** | Channel Manager | Manage your full lineup with tier, vibe, and genre metadata |
| **Content** | Plex Content Browser | Browse libraries, search, and assign movies/shows via a poster grid |
| **Schedule** | Schedule Blocks | Drag-and-drop time blocks — morning, primetime, late night |
| **AI** | AI Advisor | Content recommendations, network analysis, auto-generated schedules |
| **Tunarr** | Tunarr Integration | Link channels, sync collections, push schedules in one click |
| **24/7** | 24/7 Channel Builder | Analyze your library and generate standalone loop channels |
| **Backup** | Backup & Restore | One-click database download/upload from the Settings UI |
| **PWA** | Installable App | Mobile-first responsive layout, installable as a PWA |
| **Logs** | Unified Logging | App + AI operation logs with level filtering in Settings |
| **API** | REST API + Swagger | Full OpenAPI docs at `/docs`, health check at `/api/health` |

---

## Quick Start

**Requirements:** Docker + Docker Compose, a running Plex Media Server, and optionally [Tunarr](https://github.com/chrisbenincasa/tunarr).

### 1. Create a project directory

```bash
mkdir linearr && cd linearr
```

### 2. Download the compose file and env template

```bash
curl -O https://raw.githubusercontent.com/isaiasgv/linearr/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/isaiasgv/linearr/main/.env.example
```

Or create `docker-compose.yml` manually:

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

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
APP_USERNAME=admin
APP_PASSWORD=your-secure-password
APP_SECRET=generate-a-random-string-here
PLEX_URL=http://plex:32400
PLEX_TOKEN=your-plex-token
```

> **Note:** Use `http://plex:32400` if Linearr and Plex are on the same Docker network (`plex_default`). Otherwise use your Plex server's IP/hostname.

### 4. Start the container

```bash
docker compose up -d
```

### 5. Open the app

Navigate to **http://localhost:8777** and log in with the credentials from your `.env`.

### Updating

Pull the latest image and recreate the container:

```bash
docker compose pull
docker compose up -d
```

To pin a specific version instead of `latest`:

```yaml
image: ghcr.io/isaiasgv/linearr:0.0.2
```

<details>
<summary><strong>Environment variables</strong></summary>

| Variable | Required | Description |
|---|---|---|
| `APP_USERNAME` | Yes | Login username |
| `APP_PASSWORD` | Yes | Login password |
| `APP_SECRET` | Yes | Random string for session signing |
| `PLEX_URL` | Yes | Plex server URL (`http://plex:32400`) |
| `PLEX_TOKEN` | Yes | Plex authentication token |
| `OPENAI_API_KEY` | No | For AI features (OpenAI-compatible) |
| `ANTHROPIC_API_KEY` | No | For AI features (Anthropic) |
| `TUNARR_URL` | No | Tunarr server URL (also configurable in UI) |

See [`.env.example`](.env.example) for a full template.

</details>

---

## How it works

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

1. **Assign content** — Browse your Plex libraries and assign movies, shows, and collections to channels
2. **Build your schedule** — Create time blocks (Morning, Primetime, Late Night) and fill slots with content. Use AI to auto-generate a full day
3. **Push to Tunarr** — Link channels and push the schedule. Tunarr handles the IPTV stream and EPG

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript |
| State | Zustand (UI) + TanStack React Query (server) |
| Styling | Tailwind CSS v3 |
| Backend | Python 3.12, FastAPI, uvicorn |
| Database | SQLite (persisted via Docker volume) |
| Linting | ESLint 9, Prettier |
| CI/CD | GitHub Actions (lint, typecheck, build, Docker publish) |
| Container | Multi-stage Docker (Node 20 + Python 3.12) |

The frontend uses a **vertical slice architecture** — code organized by feature domain (`channels/`, `blocks/`, `tunarr/`, `ai/`, etc.) rather than technical layer.

---

## Development

```bash
# Set up git hooks (conventional commits enforced)
cd frontend && npm run setup

# Terminal 1 — backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8888

# Terminal 2 — frontend (hot reload, proxies /api → :8888)
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

| Script | Description |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check + production build |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm run typecheck` | TypeScript type checking |
| `npm run release` | Bump version + generate CHANGELOG |
| `npm run setup` | Configure git hooks |

### Docker (local build)

To build and run the Docker image from source instead of pulling from GHCR:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d
```

---

## API Documentation

FastAPI auto-generates interactive docs:

- **Swagger UI:** `http://localhost:8777/docs`
- **OpenAPI JSON:** `http://localhost:8777/openapi.json`

<details>
<summary><strong>Key endpoints</strong></summary>

| Endpoint | Description |
|---|---|
| `GET /api/health` | Health check (no auth) |
| `GET /api/channels` | List all channels |
| `GET /api/assignments` | All content assignments |
| `GET /api/backup` | Download SQLite database |
| `POST /api/restore` | Upload database to restore |
| `GET /api/plex/thumb?path=` | Proxy Plex thumbnail |
| `GET /api/ai-logs` | AI operation logs |
| `GET /api/app-logs` | Application logs |

</details>

---

## Deployment

### Docker Compose (recommended)

```bash
docker compose up -d
docker compose logs -f linearr
```

The container includes a `HEALTHCHECK` on `/api/health`. Persistent data lives in `./data/`.

To build locally from source instead of pulling from GHCR:

```bash
git clone https://github.com/isaiasgv/linearr.git
cd linearr
docker compose up --build -d
```

### Reverse Proxy

Linearr listens on port **8888** internally, mapped to **8777** on the host.

<details>
<summary><strong>Nginx Proxy Manager</strong></summary>

Point to your Docker host IP, port **8777**. Enable WebSocket support if available.

</details>

<details>
<summary><strong>Cloudflare</strong></summary>

- Proxy to port **8777** (host port), not 8888
- After deployments, purge cache: **Caching → Purge Everything**
- SSL mode: **Full** or **Full (strict)**

</details>

<details>
<summary><strong>Traefik</strong></summary>

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.linearr.rule=Host(`channels.yourdomain.com`)"
  - "traefik.http.services.linearr.loadbalancer.server.port=8888"
```

</details>

### Backup & Restore

Download or restore from **Settings → System** in the UI, or via CLI:

```bash
# Backup
curl -b "session=TOKEN" http://localhost:8777/api/backup -o linearr-backup.db

# Restore
curl -X POST -b "session=TOKEN" --data-binary @linearr-backup.db http://localhost:8777/api/restore
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and PR guidelines.

We use [Conventional Commits](https://www.conventionalcommits.org/) — enforced by git hooks.

---

## Disclaimer

Linearr is a **schedule management and metadata organization tool**. It does not:

- Provide, host, stream, or distribute any media content
- Include or bundle any copyrighted material
- Bypass any DRM or copy protection
- Function as a media server or streaming service

Linearr reads metadata (titles, thumbnails, durations) from your Plex Media Server to build programming schedules. All media files remain on your own server and are accessed exclusively through your existing Plex and Tunarr installations.

**You are solely responsible for ensuring that the content on your Plex server is legally obtained and that your use complies with all applicable laws in your jurisdiction.**

---

## License

[GPL-3.0](LICENSE) — free and open source, same as the rest of the *arr stack.

<div align="center">
<br />
<sub>Built with Plex, Tunarr, React, FastAPI, and a love for television.</sub>
</div>
