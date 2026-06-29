# Contributing to Linearr

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

### Prerequisites

- **Node.js 20+** and **npm**
- **Python 3.12+** and **pip**
- **Docker + Docker Compose** (for full-stack testing)
- A running **Plex Media Server** (for Plex features)

### Local Development

```bash
# Clone and navigate
git clone https://github.com/isaiasgv/linearr.git
cd linearr

# Set up git hooks (conventional commits, lint-staged)
npm run setup

# Backend
cp .env.example .env
# Edit .env with your Plex token and credentials
pip install -r requirements.txt
uvicorn main:app --reload --port 8888

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
# Open http://localhost:5173
```

### Docker

```bash
docker compose up --build -d
# Open http://localhost:8777
```

## Code Style

- **Frontend**: ESLint + Prettier enforced via CI. Run `npm run lint` and `npm run format` before committing.
- **Backend**: Python code follows standard PEP 8. Keep `main.py` organized by section.

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/). The `commit-msg` git hook enforces this automatically.

```
feat(blocks): add drag-and-drop slot reordering
fix(tunarr): correct test connection field name
docs: update README with proxy setup guide
refactor(plex): extract thumbnail proxy logic
```

**Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

**Scope** (optional): `linearr`, `blocks`, `tunarr`, `plex`, `ai`, `auth`, `channels`, `settings`

## Pull Requests

1. Fork the repo and create a feature branch from `dev` (the integration branch)
2. Make your changes with clear, conventional commits
3. Ensure `npm run lint`, `npm run build`, and `pytest` pass
4. Open a PR into `dev` with a clear description of what and why
5. Link any relevant issues

## Branch protection

`main` and `dev` are protected branches:

- **No direct pushes** — all changes land via pull request.
- **CI must pass** — the `ci` and `backend` jobs (lint, typecheck, build, tests) are
  required status checks before merge.
- **At least one approving review** is required before a PR can be merged.
- `main` is release-only: it receives merges from `release/<M.N>` or `dev` and is the
  branch stable tags are cut from. Day-to-day work targets `dev`.

## Reporting Issues

Use [GitHub Issues](https://github.com/isaiasgv/linearr/issues). Please include:
- Steps to reproduce
- Expected vs actual behavior
- Browser / OS / Docker version
- Screenshots if applicable

## Architecture Overview

See [CLAUDE.md](CLAUDE.md) for a full technical overview. Key points:

- **Frontend**: React 18 + Vite + TypeScript, organized as vertical feature slices under `frontend/src/features/`
- **Backend**: FastAPI (Python), single `main.py` file
- **State**: Zustand for UI state, TanStack React Query for server state
- **Database**: SQLite at `./data/assignments.db`

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
