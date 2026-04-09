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

1. Fork the repo and create a branch from `main`
2. Make your changes with clear, conventional commits
3. Ensure `npm run lint` and `npm run build` pass
4. Open a PR with a clear description of what and why
5. Link any relevant issues

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
