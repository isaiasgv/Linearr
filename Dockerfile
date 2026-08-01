# ── Stage 1: Build React frontend ─────────────────────────────────────────────
# node:20-slim, digest-pinned for reproducible builds (refresh: docker buildx imagetools inspect node:20-slim)
FROM node:25-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS frontend-builder

WORKDIR /build

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build
# vite build outputs to /build/dist

# ── Stage 2: Python backend ────────────────────────────────────────────────────
# python:3.12-slim, digest-pinned for reproducible builds (refresh: docker buildx imagetools inspect python:3.12-slim)
FROM python:3.12-slim@sha256:423ed6ab25b1921a477529254bfeeabf5855151dc2c3141699a1bfc852199fbf

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
