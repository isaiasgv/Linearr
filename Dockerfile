# ── Stage 1: Build React frontend ─────────────────────────────────────────────
# node:20-slim, digest-pinned for reproducible builds (refresh: docker buildx imagetools inspect node:20-slim)
FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS frontend-builder

WORKDIR /build

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build
# vite build outputs to /build/dist

# ── Stage 2: Python backend ────────────────────────────────────────────────────
# python:3.12-slim, digest-pinned for reproducible builds (refresh: docker buildx imagetools inspect python:3.12-slim)
FROM python:3.14-slim@sha256:cea0e6040540fb2b965b6e7fb5ffa00871e632eef63719f0ea54bca189ce14a6

WORKDIR /app

# gosu lets the entrypoint drop from root to the app user after fixing volume perms
RUN apt-get update \
 && apt-get install -y --no-install-recommends gosu \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py schedule_templates.json network_blocks.json ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Copy built React app
COPY --from=frontend-builder /build/dist ./dist

# Create the app user and make the entrypoint executable. The container starts
# as root so the entrypoint can chown the bind-mounted /app/data, then drops to
# this user (uid 1000) via gosu — fixing the read-only-database write failures
# caused by a root-owned host volume.
RUN mkdir -p /app/data \
 && useradd --create-home --uid 1000 appuser \
 && chown -R appuser:appuser /app \
 && chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8888

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8888/api/health')" || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8888"]
