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

# Reject non-numeric, empty, or root ids before they reach chown/gosu.
case "$PUID" in ''|*[!0-9]*) echo "Invalid PUID: $PUID" >&2; exit 1;; esac
case "$PGID" in ''|*[!0-9]*) echo "Invalid PGID: $PGID" >&2; exit 1;; esac
[ "$PUID" = "0" ] && { echo "Refusing to run app as root (PUID=0)" >&2; exit 1; }

mkdir -p "$DATA_DIR" 2>/dev/null || true

if [ "$(id -u)" = "0" ]; then
    # Only chown when ownership is actually wrong — avoids a slow recursive
    # chown on every start for large data volumes.
    if [ "$(stat -c '%u' "$DATA_DIR")" != "$PUID" ] \
       && ! chown -R "$PUID:$PGID" "$DATA_DIR" 2>/dev/null; then
        echo "WARN: could not chown $DATA_DIR — if writes fail, the volume is on a" \
             "read-only or network mount that must be fixed on the host." >&2
    fi
    exec gosu "$PUID:$PGID" "$@"
fi

# Already non-root (e.g. user overridden via compose) — just run.
exec "$@"
