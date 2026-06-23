#!/bin/sh
# Ensure the data volume is writable by the runtime user before starting.
#
# A host bind mount (./data:/app/data) is often owned by root or another uid,
# which lets reads succeed but makes every SQLite write fail with
# "attempt to write a readonly database". When started as root we fix the
# ownership of the data dir, then drop privileges to the app user (uid 1000 by
# default, overridable with PUID/PGID for NAS setups).
set -e

DATA_DIR=/app/data
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

mkdir -p "$DATA_DIR" 2>/dev/null || true

if [ "$(id -u)" = "0" ]; then
    if chown -R "$PUID:$PGID" "$DATA_DIR" 2>/dev/null; then
        :
    else
        echo "WARN: could not chown $DATA_DIR — if writes fail, the volume is on a" \
             "read-only or network mount that must be fixed on the host." >&2
    fi
    exec gosu "$PUID:$PGID" "$@"
fi

# Already non-root (e.g. user overridden via compose) — just run.
exec "$@"
