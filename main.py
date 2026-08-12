import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import shutil
import sqlite3
import time
import uuid
from collections import OrderedDict, defaultdict
from urllib.parse import urlencode as _urlencode, urlparse as _urlparse
import httpx
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-5s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("linearr")

def _get_channel(channel_number: int) -> dict | None:
    """Look up a channel from DB."""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM channels WHERE number=?", (channel_number,)).fetchone()
    return dict(row) if row else None

# ── Config ────────────────────────────────────────────────────────────────────

DB_PATH = Path(os.getenv("DB_PATH", "/app/data/assignments.db"))
INDEX_HTML = Path("/app/dist/index.html")
PLEX_URL_DEFAULT = os.getenv("PLEX_URL", "http://plex:32400")
PLEX_TOKEN_DEFAULT = os.getenv("PLEX_TOKEN", "")

_DEFAULT_PASSWORD = "changeme"
_DEFAULT_SECRET = "default-secret-change-me"

APP_USERNAME = os.getenv("APP_USERNAME", "admin")
APP_PASSWORD = os.getenv("APP_PASSWORD", _DEFAULT_PASSWORD)

# An explicitly configured secret always wins. The shipped default counts as
# "unset" — keeping it would let anyone forge HMAC(known_secret, "admin:changeme").
_APP_SECRET_ENV = os.getenv("APP_SECRET", "")
if _APP_SECRET_ENV == _DEFAULT_SECRET:
    _APP_SECRET_ENV = ""

# Resolved once per process, then cached — `_sign_session` runs on every
# authenticated request and must not hit the DB each time.
_app_secret_cache: str | None = None


def _get_app_secret() -> str:
    """The HMAC key for session cookies: env var, else a persisted random one.

    This used to mint a fresh `secrets.token_hex(32)` per process whenever
    APP_SECRET was unset, which silently invalidated **every session on every
    restart** — the sessions are stateless, so a new key means every existing
    cookie fails verification and everyone is logged out. `.env` is optional in
    `docker-compose.yml` (`required: false`), so the common setup hits this, and
    the only signal was a log line nobody reads. Anyone redeploying regularly
    was being logged out on every pull.

    Generating once and persisting to the `settings` table fixes that while
    keeping the property that mattered: the key is still random per install,
    never the shipped default. Same get-or-create pattern as `_get_mcp_token`
    and `_get_client_id`, and it lives on the same persisted volume.
    """
    global _app_secret_cache
    if _APP_SECRET_ENV:
        return _APP_SECRET_ENV
    if _app_secret_cache:
        return _app_secret_cache
    with get_db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key='app_secret'").fetchone()
        if row and row["value"]:
            _app_secret_cache = row["value"]
            return _app_secret_cache
        generated = secrets.token_hex(32)
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('app_secret', ?)", (generated,))
    _app_secret_cache = generated
    log.info("Generated a persistent session secret and stored it in the database. "
             "Set APP_SECRET in your .env to manage it yourself.")
    return generated


if APP_PASSWORD == _DEFAULT_PASSWORD:
    log.warning("APP_PASSWORD is the default 'changeme' — set a strong APP_PASSWORD in your .env.")

# Session cookie should be HTTPS-only in production. Default off so first-run LAN/HTTP
# deployments still work; set COOKIE_SECURE=true once behind a TLS reverse proxy.
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() in ("1", "true", "yes")

# Sessions SLIDE: the window runs from last use, not from login, so an app you
# open regularly never logs you out. A fixed window from login does, on a
# schedule that looks arbitrary from the outside — you are working normally and
# are suddenly at the login screen.
SESSION_MAX_AGE = 86400 * 7            # 7 days since last use
SESSION_REMEMBER_MAX_AGE = 86400 * 90  # 90 days, when "keep me signed in" is ticked
# Re-issue at most once an hour. The cookie only needs refreshing often enough to
# stay ahead of its own expiry; doing it on every request would rewrite a
# Set-Cookie header onto every single API response for no benefit.
SESSION_REFRESH_AFTER = 3600
_SESSION_MAX_AGES = (SESSION_MAX_AGE, SESSION_REMEMBER_MAX_AGE)

# ── Auth helpers ───────────────────────────────────────────────────────────────

def _sign_session(issued: int, nonce: str, max_age: int) -> str:
    # `max_age` is inside the signed message on purpose: it is carried in the
    # token so verification knows which window applies, and a client that could
    # edit it could grant itself an unbounded session.
    msg = f"{APP_USERNAME}:{APP_PASSWORD}:{issued}:{max_age}:{nonce}".encode()
    return hmac.new(_get_app_secret().encode(), msg, hashlib.sha256).hexdigest()

def _make_session_token(max_age: int = SESSION_MAX_AGE) -> str:
    """Issue a session value: `<issued>.<max_age>.<nonce>.<sig>`.

    Bound to the current credentials (changing the password invalidates every
    session) and carries both an issued-at timestamp and its own lifetime, so a
    "keep me signed in" cookie outlives an ordinary one without the server
    keeping any state about which is which.
    """
    issued = int(time.time())
    nonce = secrets.token_hex(16)
    return f"{issued}.{max_age}.{nonce}.{_sign_session(issued, nonce, max_age)}"

def _verify_session_token(token: str | None) -> tuple[int, int] | None:
    """Return `(issued, max_age)` for a valid token, else None.

    Returning the claims rather than a bool is what lets the middleware slide the
    window — it needs to know how old the token is and which lifetime it was
    issued with.
    """
    if not token:
        return None
    parts = token.split(".")
    if len(parts) != 4:
        return None
    issued_s, max_age_s, nonce, sig = parts
    if not issued_s.isdigit() or not max_age_s.isdigit():
        return None
    issued, max_age = int(issued_s), int(max_age_s)
    # Only the lifetimes this app issues are acceptable. Without this a forged
    # (or future) token could name any window it liked; the signature check below
    # already prevents that, so this is belt-and-braces against a token minted
    # under a different policy surviving a downgrade.
    if max_age not in _SESSION_MAX_AGES:
        return None
    if int(time.time()) - issued > max_age:
        return None
    if not hmac.compare_digest(sig, _sign_session(issued, nonce, max_age)):
        return None
    return issued, max_age

def _set_session_cookie(response, token: str, max_age: int) -> None:
    """One place that knows the cookie's attributes.

    Login and the sliding refresh both write it, and they must agree — a refresh
    that dropped `httponly` or `samesite` would quietly weaken every session
    an hour after it was created.
    """
    response.set_cookie(
        "session", token, httponly=True, secure=COOKIE_SECURE,
        samesite="lax", max_age=max_age, path="/",
    )


_PUBLIC_PATHS = {"/", "/api/auth/login", "/api/health", "/docs", "/openapi.json", "/api/plex/webhook"}

# ── Rate limiting (login) ────────────────────────────────────────────────────
_login_attempts: dict[str, list[float]] = defaultdict(list)
_LOGIN_WINDOW = 300   # 5 minutes
_LOGIN_MAX = 10       # max attempts per window

# ── DB ────────────────────────────────────────────────────────────────────────

def get_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    # Per-connection pragma: FK enforcement (and the block_slots ON DELETE
    # CASCADE) is off by default in SQLite and must be enabled on every connect.
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def _new_channel_uid() -> str:
    """A fresh stable identity for a `channels` row.

    Every channel-creating path must pass one (see the `uid` migration in
    `init_db`); the `channels_uid_default` trigger is the safety net, not the
    intended mechanism.
    """
    return str(uuid.uuid4())


# uuid4 as a SQL expression, for the `channels_uid_default` trigger. `random() % 4`
# (rather than `abs(random()) % 4`) keeps the operand away from the one value
# whose abs() overflows a signed 64-bit int.
_SQL_UUID4 = (
    "lower("
    "hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||"
    " substr(hex(randomblob(2)), 2) || '-' ||"
    " substr('89ab', abs(random() % 4) + 1, 1) || substr(hex(randomblob(2)), 2) ||"
    " '-' || hex(randomblob(6)))"
)


def init_db():
    with get_db() as conn:
        conn.executescript("""
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS assignments (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_number  INTEGER NOT NULL,
                plex_rating_key TEXT NOT NULL,
                plex_title      TEXT NOT NULL,
                plex_type       TEXT NOT NULL,
                plex_thumb      TEXT,
                plex_year       INTEGER,
                assigned_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(channel_number, plex_rating_key)
            );
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS blocks (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                name            TEXT NOT NULL,
                channel_number  INTEGER,
                days            TEXT NOT NULL DEFAULT '["mon","tue","wed","thu","fri","sat","sun"]',
                start_time      TEXT NOT NULL DEFAULT '00:00',
                end_time        TEXT NOT NULL DEFAULT '23:59',
                content_type    TEXT NOT NULL DEFAULT 'both',
                notes           TEXT NOT NULL DEFAULT '',
                order_index     INTEGER NOT NULL DEFAULT 0,
                created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS block_slots (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                block_id        INTEGER NOT NULL,
                slot_time       TEXT NOT NULL,
                plex_rating_key TEXT NOT NULL,
                plex_title      TEXT NOT NULL,
                plex_type       TEXT NOT NULL,
                plex_thumb      TEXT,
                plex_year       INTEGER,
                created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (block_id) REFERENCES blocks(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS channel_collections (
                id                    INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_number        INTEGER NOT NULL,
                plex_type             TEXT NOT NULL,
                collection_rating_key TEXT NOT NULL,
                collection_title      TEXT NOT NULL,
                UNIQUE(channel_number, plex_type)
            );
        """)
    # Column migrations — silently skip if already present
    with get_db() as conn:
        try:
            conn.execute("ALTER TABLE block_slots ADD COLUMN duration_minutes INTEGER DEFAULT 60")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE channel_collections ADD COLUMN managed INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        # Which kind of collection fills this (channel_number, plex_type) slot:
        #   'owned'    — Linearr generated + manages it ('{Channel} Movies/TV')
        #   'assigned' — an existing collection referenced by the channel; its
        #                contents are NEVER read or modified by Linearr.
        # Existing rows default to 'owned', which is what they always were.
        try:
            conn.execute("ALTER TABLE channel_collections ADD COLUMN source TEXT NOT NULL DEFAULT 'owned'")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE channel_collections ADD COLUMN is_smart INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        # Did LINEARR create the Plex collection sitting in this slot?
        #
        # `source`/`managed` say what Linearr is allowed to *do* with a slot;
        # this says where the collection came from, and it is the hard gate on
        # the two destructive paths: pruning during generate, and the
        # "Edit filters…" / "Delete collection" smart-collection actions. A
        # collection Linearr did not create is never pruned and never rewritten,
        # even if its title later matches the owned name.
        #
        # Backfill: `managed=1` is only ever written by `generate_collections`,
        # which resolves its target by owned name — so those rows are Linearr's
        # own generated collections and must keep their manage rights (losing
        # them would silently stop pruning on every existing install). Everything
        # else defaults to 0, which is the safe direction: at worst a slot
        # becomes additive-only until the next generate re-creates it.
        try:
            conn.execute(
                "ALTER TABLE channel_collections ADD COLUMN linearr_created INTEGER NOT NULL DEFAULT 0")
            conn.execute("UPDATE channel_collections SET linearr_created=1 WHERE managed=1")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS tunarr_channel_links (
                    channel_number INTEGER PRIMARY KEY,
                    tunarr_id      TEXT NOT NULL,
                    tunarr_name    TEXT
                )
            """)
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS tunarr_collection_links (
                    channel_number         INTEGER NOT NULL,
                    plex_type              TEXT NOT NULL,
                    tunarr_collection_id   TEXT NOT NULL,
                    tunarr_collection_name TEXT,
                    PRIMARY KEY (channel_number, plex_type)
                )
            """)
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS channels (
                    number      INTEGER PRIMARY KEY,
                    name        TEXT NOT NULL,
                    tier        TEXT NOT NULL DEFAULT 'Galaxy Main',
                    vibe        TEXT DEFAULT '',
                    mode        TEXT DEFAULT 'Shuffle',
                    style       TEXT DEFAULT '',
                    color       TEXT DEFAULT 'blue'
                )
            """)
        except sqlite3.OperationalError:
            pass
        # Stable per-channel identity, additive only.
        #
        # `number` is the PRIMARY KEY but a reorder MUTATES it, so it cannot
        # identify a row across the very operation that matters most; `name` has
        # no unique constraint, so two channels can legitimately share one. `uid`
        # is never part of a route path and never replaces the primary key — it
        # exists so clients (React keys, drag state, focus) have something that
        # survives a renumber. A renumber only UPDATEs `number`, so `uid` is
        # carried through unchanged for free.
        try:
            conn.execute("ALTER TABLE channels ADD COLUMN uid TEXT")
        except sqlite3.OperationalError:
            pass
        # Backfill every row that has no uid yet — existing installs on first
        # boot after this migration, plus anything a future path inserts without
        # one. Never recreates the table.
        try:
            for (number,) in conn.execute(
                "SELECT number FROM channels WHERE uid IS NULL OR uid=''"
            ).fetchall():
                conn.execute("UPDATE channels SET uid=? WHERE number=?",
                             (_new_channel_uid(), number))
        except sqlite3.OperationalError:
            pass
        # Belt and braces. SQLite rejects a non-constant DEFAULT in
        # `ALTER TABLE ... ADD COLUMN`, so the invariant "every channels row has
        # a uid" is enforced by a trigger instead: any INSERT that omits it gets
        # one. Covers direct DB writes (tests, manual SQL) and any future code
        # path that forgets. The app paths still pass one explicitly.
        try:
            conn.execute(f"""
                CREATE TRIGGER IF NOT EXISTS channels_uid_default
                AFTER INSERT ON channels
                WHEN NEW.uid IS NULL OR NEW.uid = ''
                BEGIN
                    UPDATE channels SET uid = {_SQL_UUID4} WHERE number = NEW.number;
                END
            """)
        except sqlite3.OperationalError:
            pass
        # Seed a single example channel on fresh install. Users can import
        # the full Galaxy Network lineup via the Cable Plex view if they want.
        try:
            count = conn.execute("SELECT COUNT(*) FROM channels").fetchone()[0]
            if count == 0:
                conn.execute(
                    "INSERT OR IGNORE INTO channels (number, name, tier, vibe, mode, style, color, uid) VALUES (?,?,?,?,?,?,?,?)",
                    (100, "My First Channel", "Galaxy Main", "Everyday cable comfort",
                     "Shuffle",
                     "Your example channel. Edit this, create new ones, or import the Galaxy Network lineup from Cable Plex.",
                     "blue", _new_channel_uid()),
                )
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE tunarr_channel_links ADD COLUMN tunarr_number INTEGER")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS ai_logs (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    block_id     INTEGER,
                    block_name   TEXT,
                    channel_number INTEGER,
                    model        TEXT,
                    base_url     TEXT,
                    prompt       TEXT,
                    response_raw TEXT,
                    slots_json   TEXT,
                    error        TEXT,
                    duration_ms  INTEGER
                )
            """)
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS app_logs (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    level      TEXT NOT NULL DEFAULT 'info',
                    category   TEXT NOT NULL DEFAULT 'app',
                    message    TEXT NOT NULL,
                    detail     TEXT
                )
            """)
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE channels ADD COLUMN icon TEXT")
        except sqlite3.OperationalError:
            pass
        # Watermark config as a JSON blob: Tunarr's watermark schema is identical
        # across every supported version (v1.0.0-v1.3.9), so there is nothing to
        # normalize into columns. NULL = no watermark.
        try:
            conn.execute("ALTER TABLE channels ADD COLUMN watermark TEXT")
        except sqlite3.OperationalError:
            pass
        # Absolute URL of the watermark image hosted BY TUNARR. Tunarr feeds this
        # to ffmpeg as an HTTP input, so a base64 data URI (how Linearr stores
        # icons) cannot be used directly — it must be uploaded and cached here.
        try:
            conn.execute("ALTER TABLE channels ADD COLUMN watermark_image_url TEXT")
        except sqlite3.OperationalError:
            pass
        # Absolute URL of the channel ICON hosted by Tunarr, for exactly the same
        # reason as the watermark above. The icon itself stays a data URI in
        # `icon` — that is what Linearr's own UI renders — but Tunarr writes
        # whatever it is given straight into XMLTV, and a data URI there is
        # unreadable to remote Plex clients. NULL = not uploaded yet.
        try:
            conn.execute("ALTER TABLE channels ADD COLUMN icon_url TEXT")
        except sqlite3.OperationalError:
            pass
        # 1 when `icon_url` was set by hand rather than derived from `icon`.
        # Mirrors the watermark's `use_channel_icon`: without it, the next sync
        # would re-upload the stored icon and silently overwrite a URL the user
        # deliberately pointed somewhere else.
        try:
            conn.execute(
                "ALTER TABLE channels ADD COLUMN icon_url_manual INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS saved_icons (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    name       TEXT NOT NULL,
                    category   TEXT NOT NULL DEFAULT 'custom',
                    data       TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE saved_icons ADD COLUMN composition TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS plex_events (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type  TEXT NOT NULL,
                    rating_key  TEXT,
                    title       TEXT,
                    plex_type   TEXT,
                    user_name   TEXT,
                    player      TEXT,
                    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
        except sqlite3.OperationalError:
            pass
        # App log columns
        for col in ["duration_ms INTEGER", "request_path TEXT", "metadata TEXT"]:
            try:
                conn.execute(f"ALTER TABLE app_logs ADD COLUMN {col}")
            except sqlite3.OperationalError:
                pass

def _log_app(category: str, message: str, level: str = "info", detail: str | None = None,
             duration_ms: int | None = None, path: str | None = None, metadata: dict | None = None):
    """Insert an app-level log entry with optional timing and context."""
    try:
        import json as _j
        meta_str = _j.dumps(metadata) if metadata else None
        with get_db() as conn:
            conn.execute(
                "INSERT INTO app_logs (level, category, message, detail, duration_ms, request_path, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (level, category, message, detail, duration_ms, path, meta_str),
            )
        log.info("[%s] %s", category, message)
    except Exception as e:
        log.warning("Failed to write app log: %s", e)

def _purge_old_logs():
    """Purge logs older than retention period and trim to max rows."""
    try:
        with get_db() as conn:
            settings = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings").fetchall()}
            days = int(settings.get("log_retention_days", "30"))
            max_rows = int(settings.get("log_max_rows", "5000"))
            modifier = f"-{days} days"
            # Delete old logs
            conn.execute("DELETE FROM app_logs WHERE created_at < datetime('now', ?)", (modifier,))
            conn.execute("DELETE FROM ai_logs WHERE created_at < datetime('now', ?)", (modifier,))
            # Trim to max rows
            conn.execute("DELETE FROM app_logs WHERE id NOT IN (SELECT id FROM app_logs ORDER BY created_at DESC LIMIT ?)", (max_rows,))
            conn.execute("DELETE FROM ai_logs WHERE id NOT IN (SELECT id FROM ai_logs ORDER BY created_at DESC LIMIT ?)", (max_rows,))
    except Exception as e:
        log.warning("Log purge failed: %s", e)

def _check_db_writable() -> bool:
    """Probe that the database volume is actually writable. A read-only bind mount
    (host ./data not owned by the container's uid 1000) lets reads succeed but makes
    every write — assignments, blocks, settings — fail with a 500. Surface it loudly
    at startup instead of silently breaking on the first write."""
    try:
        with get_db() as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS _write_probe (x INTEGER)")
            conn.execute("DROP TABLE IF EXISTS _write_probe")
        return True
    except sqlite3.Error as e:
        log.error("=" * 70)
        log.error("DATABASE IS NOT WRITABLE: %s", e)
        log.error("The /app/data volume is read-only for the container user (uid 1000).")
        log.error("Reads work but all writes (assignments, blocks, settings) will 500.")
        log.error("Fix host permissions, e.g.:  sudo chown -R 1000:1000 ./data")
        log.error("=" * 70)
        return False

def get_plex_config():
    with get_db() as conn:
        rows = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings")}
    url = rows.get("plex_url") or PLEX_URL_DEFAULT
    token = rows.get("plex_token") or PLEX_TOKEN_DEFAULT
    return url.rstrip("/"), token

# ── App ───────────────────────────────────────────────────────────────────────

def _ensure_webhook_secret() -> str:
    """Get-or-create the shared secret that authenticates the Plex webhook. Plex can't
    send custom headers but lets you set the webhook URL, so the secret rides as ?token=."""
    with get_db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key='plex_webhook_secret'").fetchone()
        if row and row["value"]:
            return row["value"]
        secret = secrets.token_urlsafe(24)
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_webhook_secret', ?)", (secret,))
    return secret

def _get_mcp_token() -> str:
    """Get-or-create the bearer token that authenticates the /mcp endpoint."""
    with get_db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key='mcp_token'").fetchone()
        if row and row["value"]:
            return row["value"]
        token = secrets.token_hex(24)
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('mcp_token', ?)", (token,))
    return token

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    _check_db_writable()
    _ensure_webhook_secret()
    # Warm it at startup rather than on the first authenticated request, so a
    # first-run install writes the secret before anyone can be mid-login.
    _get_app_secret()
    _get_mcp_token()
    _purge_old_logs()
    _log_app("system", "Linearr started")
    # The MCP streamable-HTTP transport needs a running session manager for the
    # lifetime of the app. A manager instance can only be run once, so build a
    # fresh one per lifespan (the app restarts in tests / uvicorn --reload).
    # Names resolve at startup, after the module has fully loaded.
    global _mcp_session_manager
    _mcp_session_manager = _make_mcp_session_manager()
    async with _mcp_session_manager.run():
        yield

app = FastAPI(lifespan=lifespan)

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    # MCP endpoint: bearer-token auth (MCP clients can't do the cookie flow).
    if path == "/mcp" or path.startswith("/mcp/"):
        auth = request.headers.get("authorization", "")
        expected = _get_mcp_token()
        if not (auth.startswith("Bearer ") and expected
                and hmac.compare_digest(auth[7:], expected)):
            return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        # Starlette 1.x mounts only match "/mcp/..." — normalize the bare path
        # so clients configured with ".../mcp" (no slash) work too.
        if path == "/mcp":
            request.scope["path"] = "/mcp/"
        return await call_next(request)
    # Only /api/* is protected. Everything else is the static SPA shell / assets,
    # which is public by nature — this avoids the fragile suffix-allowlist foot-gun
    # where a future route like /api/export/config.json would silently become public.
    if path in _PUBLIC_PATHS or not path.startswith("/api/"):
        return await call_next(request)
    claims = _verify_session_token(request.cookies.get("session"))
    if claims is None:
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    response = await call_next(request)
    # Slide the window. Re-issuing on use is what makes the lifetime "since you
    # last used it" rather than "since you logged in" — without it an active
    # session still dies on a fixed schedule mid-session.
    #
    # Never on logout: that response deletes the cookie, and re-issuing it here
    # would hand it straight back and make logging out silently fail.
    issued, max_age = claims
    if path != "/api/auth/logout" and int(time.time()) - issued >= SESSION_REFRESH_AFTER:
        _set_session_cookie(response, _make_session_token(max_age), max_age)
    return response

@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    # Allow self + data/blob for the SPA and inline SVG editor; Plex thumbs are proxied
    # same-origin via /api/plex/thumb so img-src 'self' is sufficient.
    resp.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data: blob:; "
        "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; "
        # media-src carries blob: for the channel stream player: hls.js feeds
        # <video> through a MediaSource, whose src is a blob: URL. Without this
        # the player is blocked by default-src and fails silently.
        "media-src 'self' blob:; "
        "connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
    )
    if COOKIE_SECURE:
        resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return resp

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Log every unhandled error with a full traceback (container logs + in-app
    log viewer) and return the real message to the client instead of a bare 500."""
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    try:
        _log_app("error", f"Unhandled error: {type(exc).__name__}", level="error",
                 detail=f"{exc}", path=request.url.path)
    except Exception:
        pass
    # Don't leak internal exception text (paths, SQL, upstream URLs) to clients.
    # Full detail is in the container logs + in-app log viewer above.
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

# ── Models ────────────────────────────────────────────────────────────────────

class AssignmentIn(BaseModel):
    channel_number: int
    plex_rating_key: str
    plex_title: str
    plex_type: str
    plex_thumb: str | None = None
    plex_year: int | None = None

class SettingsIn(BaseModel):
    plex_url: str
    plex_token: str
    openai_api_key: str | None = None
    openai_base_url: str | None = None
    openai_model: str | None = None
    tunarr_url: str | None = None
    # Optional. The base URL asset links written INTO Tunarr are built on, when
    # Tunarr's own address is not reachable from the clients that read them.
    # Empty means "same as tunarr_url". See `_tunarr_asset_base`.
    tunarr_public_url: str | None = None
    # House style for generated channel icons. Stored as one JSON blob rather
    # than eight settings rows — it is read and written as a unit, and the
    # renderer that consumes it lives entirely in the frontend.
    icon_brand_defaults: dict | None = None

class TunarrChannelLinkIn(BaseModel):
    channel_number: int
    tunarr_id: str
    tunarr_name: str | None = None
    tunarr_number: int | None = None

class TunarrPushScheduleIn(BaseModel):
    preview: bool = True

class AIAutofillIn(BaseModel):
    channel_number: int | None = None

class AITestIn(BaseModel):
    openai_api_key: str
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"

class LoginIn(BaseModel):
    username: str
    password: str
    # Defaults true: this is a self-hosted app on your own network, and the
    # failure people actually hit is being logged out, not a session outliving
    # its welcome. Unticking it still gives a 7-day sliding window.
    remember: bool = True

class BlockIn(BaseModel):
    name: str
    channel_number: int | None = None
    days: list[str] = ["mon","tue","wed","thu","fri","sat","sun"]
    start_time: str = "00:00"
    end_time: str = "23:59"
    content_type: str = "both"
    notes: str = ""
    order_index: int = 0

class SlotIn(BaseModel):
    slot_time: str
    plex_rating_key: str
    plex_title: str
    plex_type: str
    plex_thumb: str | None = None
    plex_year: int | None = None
    duration_minutes: int = 60

class ChannelCollectionIn(BaseModel):
    plex_type: str
    collection_rating_key: str
    collection_title: str

class ChannelCollectionAssignIn(BaseModel):
    """Assign an EXISTING collection to a channel by reference (never copied,
    never modified). Distinct from `ChannelCollectionIn`, which drives the
    import-items route."""
    plex_type: str
    collection_rating_key: str
    collection_title: str
    is_smart: bool = False

_WATERMARK_POSITIONS = ("top-left", "top-right", "bottom-left", "bottom-right")

# Defaults for a NEW watermark. Tuned for a discreet corner bug: 7% of frame
# width, 5% margins, 20% opacity. Mirrored in
# `frontend/src/features/watermark/types.ts` (DEFAULT_WATERMARK) — keep the two
# in step. Channels with a watermark already saved keep their stored values;
# these only fill in fields a caller omits.
_WATERMARK_DEFAULTS = {
    "width": 7.0,
    "vertical_margin": 5.0,
    "horizontal_margin": 5.0,
    "opacity": 30,
}


class WatermarkFade(BaseModel):
    # Tunarr requires periodMins >= 1 and silently drops entries <= 0.
    period_mins: int = Field(ge=1)
    leading_edge: bool = True


class WatermarkIn(BaseModel):
    """Watermark config, validated against Tunarr's real constraints.

    Mirrors Tunarr's WatermarkSchema so an invalid value is rejected here with a
    clear message rather than as an opaque 400 from Tunarr. Deliberately omits
    `animated` and `fadeConfig[].programType`: both are persisted by Tunarr but
    never read by any pipeline builder at 1.3.6.
    """
    enabled: bool = False
    position: str = "bottom-right"
    # percent of frame width, strictly > 0
    width: float = Field(default=_WATERMARK_DEFAULTS["width"], gt=0)
    vertical_margin: float = Field(
        default=_WATERMARK_DEFAULTS["vertical_margin"], ge=0, le=100)
    horizontal_margin: float = Field(
        default=_WATERMARK_DEFAULTS["horizontal_margin"], ge=0, le=100)
    duration: float = Field(default=0.0, ge=0)        # seconds; 0 = always on
    # must be an int for Tunarr
    opacity: int = Field(default=_WATERMARK_DEFAULTS["opacity"], ge=0, le=100)
    fixed_size: bool = False                          # true makes `width` inert
    use_channel_icon: bool = True
    fade: WatermarkFade | None = None

    @field_validator("position")
    @classmethod
    def _check_position(cls, v: str) -> str:
        if v not in _WATERMARK_POSITIONS:
            raise ValueError(
                f"position must be one of {', '.join(_WATERMARK_POSITIONS)}"
            )
        return v

class BulkAssignmentItem(BaseModel):
    # Bulk items carry no channel_number — the channel is set once at the top
    # level of BulkAssignmentIn and applied to every item by the handler.
    plex_rating_key: str
    plex_title: str
    plex_type: str
    plex_thumb: str | None = None
    plex_year: int | None = None

class BulkAssignmentIn(BaseModel):
    channel_number: int
    items: list[BulkAssignmentItem]

# ── Auth ──────────────────────────────────────────────────────────────────────

@app.post("/api/auth/login")
def login(body: LoginIn, request: Request):
    ip = request.client.host if request.client else "unknown"
    now = time.time()
    # Prune old attempts
    _login_attempts[ip] = [t for t in _login_attempts[ip] if now - t < _LOGIN_WINDOW]
    if len(_login_attempts[ip]) >= _LOGIN_MAX:
        log.warning("Rate limited login from %s", ip)
        raise HTTPException(429, "Too many login attempts. Try again later.")
    _login_attempts[ip].append(now)

    user_ok = body.username.lower() == APP_USERNAME.lower()
    pass_ok = hmac.compare_digest(body.password, APP_PASSWORD)
    if not (user_ok and pass_ok):
        log.info("Failed login from %s", ip)
        _log_app("auth", f"Failed login attempt from {ip}", "warn")
        raise HTTPException(401, "Invalid credentials")
    log.info("Successful login from %s", ip)
    _log_app("auth", f"User logged in from {ip}")
    max_age = SESSION_REMEMBER_MAX_AGE if body.remember else SESSION_MAX_AGE
    response = JSONResponse({"ok": True, "expires_in": max_age})
    _set_session_cookie(response, _make_session_token(max_age), max_age)
    return response

@app.post("/api/auth/logout")
def logout():
    response = JSONResponse({"ok": True})
    response.delete_cookie("session", httponly=True, secure=COOKIE_SECURE, samesite="lax")
    return response

# ── Channels ──────────────────────────────────────────────────────────────────

class ChannelIn(BaseModel):
    number: int
    name: str
    tier: str = "Galaxy Main"
    vibe: str = ""
    mode: str = "Shuffle"
    style: str = ""
    color: str = "blue"
    icon: str | None = None

# ── Channel numbering + reorder math ─────────────────────────────────────────
#
# `channels.number` is the PRIMARY KEY, so "reorder" means "renumber". The math
# lives here as a pure function with no DB and no HTTP so it can be exhaustively
# tested on its own — the transactional endpoint that consumes it is trivial
# once the mapping is known to be collision-free.

# Canonical tier -> (low, high) inclusive number range. Mirrors
# `frontend/src/features/channels/presets/numbering.ts` (`TIER_RANGES`) and the
# tier structure described to the model in /api/channels/ai-suggest. The `tier`
# column is free text, so tiers absent from this map are legal — they simply
# have no preferred range and a move into one falls back to positional
# renumbering rather than raising.
TIER_RANGES: dict[str, tuple[int, int]] = {
    "Galaxy Main": (100, 119),
    "Classics": (120, 139),
    "Galaxy Premium": (140, 159),
}


def _compute_reorder(
    channels: list[dict],
    moved_number: int,
    target_index: int,
    target_tier: str | None = None,
) -> dict[int, tuple[int, str]]:
    """Work out the renumbering for a single drag-and-drop move.

    Args:
        channels: the full lineup; each row needs `number` and `tier`
            (`sqlite3.Row` or plain dict). Order is irrelevant — it is sorted
            by number internally.
        moved_number: the channel being dragged.
        target_index: the 0-based index the moved channel should occupy in the
            *resulting* lineup (so `target_index == its current index` is a
            no-op). Clamped into range.
        target_tier: destination tier, or None to keep the channel's own tier.

    Returns:
        `{old_number: (new_number, new_tier)}` containing **only** the channels
        whose number or tier actually changes. Guaranteed collision-free: no
        two channels map to the same new number, and no new number collides
        with a channel that did not move.

    Raises:
        ValueError: if `moved_number` is not in `channels`.

    Two strategies:

    * **Same tier (or a destination tier with no canonical range)** — rotate
      the numbers already held by the affected window. The number *sequence* is
      untouched, only which channel holds each number, so relative gaps are
      preserved exactly and nothing outside the source..destination window
      moves.
    * **Cross tier into a known range** — give the channel the slot right after
      the last destination-tier channel that ends up ahead of it (or the range
      floor), then bump the contiguous integer run starting at that slot so the
      new number is free. If the range is full the run simply extends past
      `high` rather than raising.
    """
    lineup = sorted(
        ({"number": int(c["number"]), "tier": c["tier"] or ""} for c in channels),
        key=lambda c: c["number"],
    )
    src_index = next(
        (i for i, c in enumerate(lineup) if c["number"] == moved_number), None
    )
    if src_index is None:
        raise ValueError(f"Channel {moved_number} is not in the lineup")

    moved = lineup[src_index]
    others = [c for c in lineup if c["number"] != moved_number]
    dst = max(0, min(int(target_index), len(others)))
    new_tier = moved["tier"] if target_tier is None else target_tier
    cross_tier = new_tier != moved["tier"]
    dest_range = TIER_RANGES.get(new_tier) if cross_tier else None

    if dest_range is None:
        if dst == src_index and not cross_tier:
            return {}
        # Rotate the window's numbers onto the reordered channels.
        new_order = others[:dst] + [moved] + others[dst:]
        lo, hi = min(src_index, dst), max(src_index, dst)
        numbers = [lineup[i]["number"] for i in range(lo, hi + 1)]
        mapping: dict[int, tuple[int, str]] = {}
        for offset, ch in enumerate(new_order[lo : hi + 1]):
            tier = new_tier if ch is moved else ch["tier"]
            number = numbers[offset]
            if number != ch["number"] or tier != ch["tier"]:
                mapping[ch["number"]] = (number, tier)
        return mapping

    # Cross-tier into a tier with a canonical range.
    low, high = dest_range
    ahead = [c["number"] for c in others[:dst] if c["tier"] == new_tier]
    desired = max(low, ahead[-1] + 1) if ahead else low

    mapping = {moved["number"]: (desired, new_tier)}
    # Anything at or above `desired` may need to shift. Only an exact hit on
    # `desired` collides (numbers are integers and the list is sorted), and the
    # bump then walks the contiguous run until a gap absorbs it.
    prev_new = desired
    for ch in (c for c in others if c["number"] >= desired):
        if ch["number"] > prev_new:
            break
        prev_new = ch["number"] + 1
        mapping[ch["number"]] = (prev_new, ch["tier"])
    return mapping


# ── The two channel_number cascade lists ──────────────────────────────────────
#
# THESE TWO LISTS ARE DELIBERATELY DIFFERENT. Do not "unify" them.
#
# Every table below carries a `channel_number` value reference to
# channels(number). There are NO foreign keys, so each has to be handled by
# hand. But a RENUMBER and a DELETE want different sets:
#
#   * RENUMBER (`_CHANNEL_REF_TABLES`) must carry EVERY referencing table, or a
#     reordered channel silently orphans rows — including `ai_logs`, whose rows
#     would otherwise point at whatever channel later took that number.
#   * DELETE (`_CHANNEL_DELETE_TABLES`) must NOT include `ai_logs`. AI
#     generation history is a write-only audit trail with no other copy, and
#     the delete confirmation never says it would be destroyed. Deleting a
#     channel keeps its logs (they carry the number as a label, not a live
#     reference).
#
# `update_channel`, the reorder endpoint (both via `_move_channel_number`) and
# `delete_channel` are the only readers, so the paths cannot drift apart again.
# (`block_slots` is absent from both: it follows `blocks` via `block_id`.)
_CHANNEL_REF_TABLES: tuple[str, ...] = (
    "assignments",
    "blocks",
    "channel_collections",
    "tunarr_channel_links",
    "tunarr_collection_links",
    "ai_logs",
)

# Renumber list minus the audit trail. See the block comment above.
_CHANNEL_DELETE_TABLES: tuple[str, ...] = tuple(
    t for t in _CHANNEL_REF_TABLES if t != "ai_logs"
)


def _present_ref_tables(conn, tables: tuple[str, ...] | None = None) -> tuple[str, ...]:
    """`tables` (default `_CHANNEL_REF_TABLES`) filtered to what this DB can use.

    Both the table AND the `channel_number` column are checked up front rather
    than swallowing `sqlite3.OperationalError` per statement: on a renumber a
    swallowed error would silently orphan rows. Checking the column too means a
    table added to either list without a `channel_number` column degrades to
    "skipped" instead of 500-ing every delete and reorder.
    """
    if tables is None:
        tables = _CHANNEL_REF_TABLES
    present = {
        r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    usable = []
    for t in tables:
        if t not in present:
            continue
        cols = {r[1] for r in conn.execute(f"PRAGMA table_info({t})")}
        if "channel_number" not in cols:
            log.warning("Table %s has no channel_number column — skipping cascade", t)
            continue
        usable.append(t)
    return tuple(usable)


def _move_channel_number(conn, old_number: int, new_number: int) -> None:
    """Move one channel to a new number, cascading to every referencing table.

    Caller owns the transaction. The target number must already be free —
    `channels.number` is the PRIMARY KEY, so a collision raises
    `sqlite3.IntegrityError` and aborts the whole renumber.
    """
    conn.execute("UPDATE channels SET number=? WHERE number=?", (new_number, old_number))
    for table in _present_ref_tables(conn):
        conn.execute(
            f"UPDATE {table} SET channel_number=? WHERE channel_number=?",
            (new_number, old_number),
        )


def _renumber_channels(conn, mapping: dict[int, tuple[int, str]]) -> None:
    """Apply a `_compute_reorder` mapping as a two-phase, collision-safe write.

    Must run inside a transaction (`with get_db() as conn:` gives one — sqlite3
    opens it implicitly before the first DML statement and rolls back on any
    exception leaving the block).

    Phase 1 parks every affected channel at a temporary negative number,
    cascading to all referencing tables. Phase 2 writes the final numbers and
    tiers, cascading again. A single-phase sequential update is wrong: a
    reorder is normally a *cycle* (A takes B's number, B takes C's, C takes
    A's), so the very first write would collide on the PRIMARY KEY.

    The parking numbers are taken from below `-max(abs(number))` rather than
    being a plain `-number`, so they cannot collide with each other *or* with
    a channel that legitimately holds a negative number.
    """
    if not mapping:
        return
    numbers = [int(r[0]) for r in conn.execute("SELECT number FROM channels")]
    park_base = max([abs(n) for n in numbers] + [0]) + 1
    parked = {old: -(park_base + i) for i, old in enumerate(sorted(mapping))}

    for old, tmp in parked.items():                      # phase 1 — park
        _move_channel_number(conn, old, tmp)
    for old, (new_number, new_tier) in mapping.items():  # phase 2 — final
        _move_channel_number(conn, parked[old], new_number)
        conn.execute("UPDATE channels SET tier=? WHERE number=?", (new_tier, new_number))


class ChannelReorderIn(BaseModel):
    moved_number: int
    target_index: int
    target_tier: str | None = None


@app.post("/api/channels/reorder")
async def reorder_channels(body: ChannelReorderIn):
    """Drag-and-drop reorder: renumber `moved_number` into `target_index`,
    shifting whatever it displaces.

    `target_index` is the 0-based index the channel should occupy in the
    resulting lineup (the same lineup `GET /api/channels` returns). Pass
    `target_tier` only for a cross-tier move.

    The local renumber is all-or-nothing. Tunarr propagation runs *after* the
    commit and can never undo it — per-channel failures come back in
    `tunarr.failed` and the caller must not read them as "the reorder failed".
    Tunarr is renumbered with the same two-phase park-then-land write the local
    transaction uses (`_tunarr_renumber_channels`), because a same-tier drag is
    a rotation and Tunarr rejects a duplicate number with a 500.
    """
    with get_db() as conn:
        lineup = [dict(r) for r in conn.execute("SELECT * FROM channels ORDER BY number")]
    if not any(c["number"] == body.moved_number for c in lineup):
        raise HTTPException(404, f"Channel {body.moved_number} not found")

    try:
        mapping = _compute_reorder(
            lineup, body.moved_number, body.target_index, body.target_tier
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    if not mapping:
        return {"changed": [], "channels": lineup, "tunarr": {"synced": 0, "failed": []}}

    try:
        with get_db() as conn:
            _renumber_channels(conn, mapping)
            channels = [dict(r) for r in conn.execute("SELECT * FROM channels ORDER BY number")]
    except Exception as e:
        # `with get_db()` already rolled the whole thing back — the lineup is
        # exactly as it was.
        log.exception("Channel reorder failed and was rolled back")
        raise HTTPException(500, f"Reorder failed and was rolled back: {e}")

    changed = [
        {"old_number": old, "new_number": new_number, "tier": new_tier}
        for old, (new_number, new_tier) in sorted(mapping.items())
    ]
    _log_app(
        "channel",
        f"Reordered channel {body.moved_number} -> {mapping[body.moved_number][0]} "
        f"({len(changed)} renumbered)",
        metadata={"moved": body.moved_number, "changed": changed},
    )

    tunarr = await _push_reorder_to_tunarr(changed)
    return {"changed": changed, "channels": channels, "tunarr": tunarr}


async def _tunarr_try_save_channel(
    client: "httpx.AsyncClient", url: str, tunarr_id: str, changes: dict
) -> tuple[bool, str]:
    """`_tunarr_save_channel` reduced to `(ok, message)`. Never raises — a
    renumber pass must keep going after one channel fails."""
    try:
        r = await _tunarr_save_channel(client, url, tunarr_id, changes)
    except Exception as e:
        return False, str(e)
    if r.status_code in (200, 204):
        return True, ""
    return False, _tunarr_write_error(r.status_code)


async def _tunarr_current_channel_numbers(client: "httpx.AsyncClient", url: str) -> dict[str, int]:
    """`{tunarr_id: number}` for every channel Tunarr currently has.

    Read live rather than assumed: the parking band has to clear channels
    Linearr does not manage as well as the ones it does.
    """
    r = await client.get(f"{url}/api/channels")
    if r.status_code != 200:
        raise RuntimeError(_tunarr_write_error(r.status_code))
    data = r.json()
    if not isinstance(data, list):
        raise RuntimeError("Tunarr returned an unreadable channel list")
    numbers: dict[str, int] = {}
    for ch in data:
        if not isinstance(ch, dict) or ch.get("id") is None:
            continue
        try:
            numbers[str(ch["id"])] = int(ch.get("number") or 0)
        except (TypeError, ValueError):
            numbers[str(ch["id"])] = 0
    return numbers


async def _tunarr_renumber_channels(
    client: "httpx.AsyncClient", url: str, moves: list[dict]
) -> dict:
    """Renumber a set of already-linked Tunarr channels, collision-free.

    `moves` is `[{"tunarr_id", "number" (final), "changes"}]` where `changes`
    is the full set of SaveableChannel keys Linearr owns (`number` included —
    it is overwritten with the final number here).

    This is the Tunarr-side twin of `_renumber_channels`. A reorder is normally
    a *rotation* (A takes B's number, B takes C's, C takes A's); Tunarr enforces
    a unique channel number, rejects a duplicate with a **500** (its channel API
    has no 409 anywhere) and offers no bulk or reorder endpoint, so writing a
    rotation sequentially always collides on at least one channel.

    So: same two phases the local transaction uses.

    * **Phase 1 — park.** Every channel whose number is actually changing is
      moved to a temporary number taken from a band starting one above the
      highest number *currently present in Tunarr* and the highest *target*
      number. Reading the live list matters — a fixed band could land on a
      channel Linearr does not manage.
    * **Phase 2 — land.** Each channel is written to its final number along
      with the rest of its metadata. Every target is free by then.

    A channel whose number is not changing skips phase 1 entirely: every
    successful write regenerates Tunarr's M3U (and possibly its XMLTV), so the
    parking round-trip is only paid where it buys something.

    Both phases go through `_tunarr_save_channel`, never a partial PUT —
    Tunarr's `PUT /api/channels/:id` body is the FULL SaveableChannel, and the
    read-modify-write is what echoes `guideMinimumDuration` and `duration` back
    untouched.

    Returns `{"ok": [final numbers written], "failed": [{number, message,
    state, parked_number?}]}` where `state` is:

    * `"unchanged"` — the write failed before the channel moved. Harmless: it
      still holds its old number in Tunarr.
    * `"parked"` — the channel is **stranded on a temporary number**. This is
      user-visible breakage, so it is called out explicitly with the number it
      is sitting on.

    A phase-1 failure never aborts the pass: everything that did park is still
    landed by phase 2.
    """
    outcome: dict = {"ok": [], "failed": []}
    if not moves:
        return outcome

    try:
        current = await _tunarr_current_channel_numbers(client, url)
    except Exception as e:
        # Without the live list there is no number known to be free, so writing
        # anything risks a collision. Touch nothing.
        log.warning("Tunarr reorder aborted — could not read the channel list: %s", e)
        for m in moves:
            outcome["failed"].append({
                "number": m["number"],
                "state": "unchanged",
                "message": f"Could not read Tunarr's channel list, so nothing was renumbered ({e})",
            })
        return outcome

    park_next = max(
        list(current.values()) + [int(m["number"]) for m in moves] + [0]
    ) + 1

    parked: dict[str, int] = {}     # tunarr_id -> parking number
    to_land: list[dict] = []
    for m in moves:                                          # phase 1 — park
        tunarr_id = m["tunarr_id"]
        if current.get(tunarr_id) == int(m["number"]):
            to_land.append(m)       # already on its number; metadata write only
            continue
        tmp = park_next
        park_next += 1
        ok, message = await _tunarr_try_save_channel(client, url, tunarr_id, {"number": tmp})
        if ok:
            parked[tunarr_id] = tmp
            to_land.append(m)
        else:
            outcome["failed"].append({
                "number": m["number"],
                "state": "unchanged",
                "message": f"Tunarr still holds its old number — the parking write failed ({message})",
            })

    for m in to_land:                                        # phase 2 — land
        tunarr_id = m["tunarr_id"]
        changes = {**m["changes"], "number": int(m["number"])}
        ok, message = await _tunarr_try_save_channel(client, url, tunarr_id, changes)
        if ok:
            outcome["ok"].append(m["number"])
        elif tunarr_id in parked:
            outcome["failed"].append({
                "number": m["number"],
                "state": "parked",
                "parked_number": parked[tunarr_id],
                "message": (
                    f"Tunarr channel is stranded at temporary number {parked[tunarr_id]} — "
                    f"the write to {m['number']} failed ({message}). "
                    "Re-run the reorder or set the number in Tunarr."
                ),
            })
        else:
            outcome["failed"].append({
                "number": m["number"],
                "state": "unchanged",
                "message": f"Tunarr write failed ({message})",
            })
    return outcome


async def _push_reorder_to_tunarr(changed: list[dict]) -> dict:
    """Propagate a committed renumber to Tunarr. Never raises — the local
    lineup is already the source of truth, so every problem is reported as a
    per-channel entry in `failed`.

    Only channels that are *already linked* are pushed. A drag must not
    provision brand-new Tunarr channels as a side effect, and an unlinked
    channel has nothing to propagate. (`tunarr_channel_links.channel_number`
    was cascaded by the local renumber, so it is keyed by the **new** number.)

    The write itself is `_tunarr_renumber_channels` — two-phase, because a
    rotation cannot be written sequentially without colliding.
    """
    result: dict = {"synced": 0, "failed": []}
    url = get_tunarr_url()
    if not changed or not url:
        return result

    with get_db() as conn:
        links = {
            int(r["channel_number"]): r["tunarr_id"]
            for r in conn.execute("SELECT channel_number, tunarr_id FROM tunarr_channel_links")
        }
        rows = {
            int(r["number"]): dict(r) for r in conn.execute("SELECT * FROM channels")
        }

    moves = [
        {
            "number": c["new_number"],
            "tunarr_id": links[c["new_number"]],
            "changes": _tunarr_channel_changes(rows[c["new_number"]]),
        }
        for c in changed
        if c["new_number"] in links and c["new_number"] in rows
    ]
    if not moves:
        return result

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            outcome = await _tunarr_renumber_channels(client, url, moves)
    except Exception as e:            # defensive: must never undo the commit
        log.warning("Tunarr reorder propagation raised: %s", e)
        return {
            "synced": 0,
            "failed": [
                {"number": m["number"], "state": "unchanged", "message": str(e)}
                for m in moves
            ],
        }

    if outcome["ok"]:
        with get_db() as conn:
            for number in outcome["ok"]:
                conn.execute(
                    "UPDATE tunarr_channel_links SET tunarr_name=?, tunarr_number=?"
                    " WHERE channel_number=?",
                    (rows[number].get("name"), number, number),
                )
    result["synced"] = len(outcome["ok"])
    result["failed"] = outcome["failed"]
    return result


@app.get("/api/channels")
def list_channels():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM channels ORDER BY number").fetchall()
    return [dict(r) for r in rows]

@app.post("/api/channels", status_code=201)
async def create_channel(body: ChannelIn):
    with get_db() as conn:
        try:
            conn.execute(
                "INSERT INTO channels (number, name, tier, vibe, mode, style, color, icon, uid) VALUES (?,?,?,?,?,?,?,?,?)",
                (body.number, body.name, body.tier, body.vibe, body.mode, body.style,
                 body.color, body.icon, _new_channel_uid())
            )
        except sqlite3.IntegrityError:
            raise HTTPException(409, f"Channel {body.number} already exists")
        row = conn.execute("SELECT * FROM channels WHERE number=?", (body.number,)).fetchone()
    result = dict(row)
    _log_app("channel", f"Created channel {body.number}: {body.name}", metadata={"number": body.number, "name": body.name, "tier": body.tier})
    # Auto-create in Tunarr
    sync = await _sync_channel_to_tunarr(body.number)
    result["tunarr_sync"] = sync
    return result

# `_tunarr_resolve_transcode_config` returns None rather than a bogus id, and a
# create without `transcodeConfigId` fails as an opaque "Tunarr 400". Both call
# sites short-circuit with this instead.
_NO_TRANSCODE_CONFIG_MSG = (
    "Tunarr has no usable transcode config — Linearr cannot create a channel "
    "without one. Open Tunarr → Settings → Transcoding and save a transcode "
    "config (or set a default), then try again."
)

def _tunarr_write_error(status: int) -> str:
    """Format a Tunarr write-failure message. Tunarr has no 409 — a duplicate
    channel number surfaces as a 500 with an empty body, so hint at that
    rather than reporting a bare status."""
    hint = " — the channel number may already be in use in Tunarr" if status >= 500 else ""
    return f"Tunarr {status}{hint}"

def _watermark_for_tunarr(ch: dict) -> dict | None:
    """Tunarr watermark payload for a channel row, or None when unset.

    Corrupt JSON is treated as unset rather than raised: a bad blob must not
    break channel metadata sync.
    """
    stored = ch.get("watermark")
    if not stored:
        return None
    try:
        wm = json.loads(stored) if isinstance(stored, str) else stored
    except (TypeError, ValueError):
        return None
    if not isinstance(wm, dict):
        return None
    # Re-based, not used verbatim: the URL was stored against whatever the asset
    # base was at upload time, and `tunarr_public_url` may have changed since.
    return _watermark_to_tunarr(wm, _tunarr_asset_url(ch.get("watermark_image_url")))

def _disabled_watermark_for_tunarr() -> dict:
    """A valid watermark payload that turns the overlay off.

    Tunarr cannot null its watermark column through the API, so the only way to
    switch one off is to write an object with `enabled: false`. It is still
    validated while disabled (`width` > 0, margins 0-100), hence the defaults.

    Used ONLY when Linearr is explicitly clearing a watermark — never as the
    fallback for an unset channel, which must leave a Tunarr-side watermark
    the user configured directly in Tunarr's own UI untouched.
    """
    return _watermark_to_tunarr({"enabled": False}, None)

def _tunarr_channel_changes(ch: dict, watermark_override: dict | None = None,
                            icon_override: dict | None = None) -> dict:
    """The SaveableChannel keys Linearr owns, for a `channels` row.

    Everything else on the Tunarr side is preserved by `_tunarr_save_channel`'s
    read-modify-write, so this is deliberately the *whole* set of fields Linearr
    is entitled to overwrite — a renumber has to carry all of them, not just
    `number`, or a reordered channel would keep stale metadata.

    `icon` and `watermark` are omitted (rather than nulled) when the channel has
    none, so an icon/watermark configured directly in Tunarr's own UI survives.
    The two `*_override` arguments are the escape hatch for the one case that
    cannot express itself that way: Linearr *deliberately* clearing one.
    """
    changes = {
        "name": ch.get("name", ""),
        "number": ch.get("number", 0),
        "groupTitle": ch.get("tier", "Linearr"),
    }
    icon_data = ch.get("icon")
    # `icon_url` is the icon uploaded to Tunarr as an ordinary HTTP asset, and is
    # strongly preferred: Tunarr copies whatever it gets into XMLTV, where a
    # data URI is unreadable to any Plex client that is not on this machine.
    # The data URI remains the fallback for when the upload could not be done —
    # it still renders locally, which beats no icon.
    icon_url = _tunarr_asset_url(ch.get("icon_url"))
    if icon_override is not None:
        changes["icon"] = icon_override
    elif icon_url:
        changes["icon"] = _tunarr_icon_obj(icon_url)
    elif icon_data and str(icon_data).startswith("data:"):
        changes["icon"] = _tunarr_icon_obj(icon_data)
    watermark = watermark_override if watermark_override is not None else _watermark_for_tunarr(ch)
    if watermark is not None:
        changes["watermark"] = watermark
    return changes

async def _sync_channel_to_tunarr(channel_number: int, *, watermark_override: dict | None = None,
                                  icon_override: dict | None = None):
    """Sync Cable Plex channel metadata to linked Tunarr channel.
    If no link exists, creates a new Tunarr channel and links it.
    `watermark_override` / `icon_override`, when given, take precedence over the
    channel row's stored value (used to push an explicit clear).
    Returns {"synced": True/False, "action": "updated"|"created"|"error", ...}"""
    with get_db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE number=?", (channel_number,)).fetchone()
        link = conn.execute("SELECT * FROM tunarr_channel_links WHERE channel_number=?", (channel_number,)).fetchone()
    if not ch:
        return {"synced": False, "action": "error", "message": "Channel not found"}
    ch = dict(ch)
    url = get_tunarr_url()
    if not url:
        return {"synced": False, "action": "error", "message": "Tunarr not configured"}

    # Upload the icon BEFORE building the payload, so the push carries an HTTP
    # URL rather than the data URI. Best-effort: a failure leaves `icon_url`
    # unset and `_tunarr_channel_changes` falls back to the data URI.
    if icon_override is None and ch.get("icon"):
        resolved_icon = await _resolve_channel_icon_url(channel_number, ch.get("icon"))
        if resolved_icon:
            ch["icon_url"] = resolved_icon

    # Only the keys Linearr owns; _tunarr_save_channel preserves everything else.
    changes = _tunarr_channel_changes(ch, watermark_override, icon_override)
    icon_data = ch.get("icon")
    watermark = changes.get("watermark")

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            if link:
                tunarr_id = link["tunarr_id"]
                r = await _tunarr_save_channel(client, url, tunarr_id, changes)
                if r.status_code in (200, 204):
                    with get_db() as conn:
                        conn.execute(
                            "UPDATE tunarr_channel_links SET tunarr_name=?, tunarr_number=? WHERE channel_number=?",
                            (ch.get("name"), ch.get("number"), channel_number)
                        )
                    return {"synced": True, "action": "updated", "tunarr_id": tunarr_id}
                return {"synced": False, "action": "error",
                        "message": _tunarr_write_error(r.status_code)}
            else:
                transcode_id = await _tunarr_resolve_transcode_config(client, url)
                if not transcode_id:
                    # Tunarr 1.3.x REQUIRES transcodeConfigId on a create, and
                    # omitting it fails as a bare 400 that says nothing about the
                    # real cause. Stop here with the actual reason.
                    return {"synced": False, "action": "error",
                            "message": _NO_TRANSCODE_CONFIG_MSG}
                channel_obj = _tunarr_channel_obj(
                    name=ch.get("name", ""),
                    number=ch.get("number", 0),
                    group_title=ch.get("tier", "Linearr"),
                    transcode_id=transcode_id,
                    icon_data=icon_data if (icon_data and icon_data.startswith("data:")) else None,
                    watermark=watermark,
                )
                r = await _tunarr_create_channel(client, url, channel_obj)
                if r.status_code in (200, 201):
                    new_ch = r.json()
                    with get_db() as conn:
                        conn.execute(
                            "INSERT OR REPLACE INTO tunarr_channel_links VALUES (?,?,?,?)",
                            (channel_number, new_ch["id"], new_ch.get("name"), new_ch.get("number"))
                        )
                    return {"synced": True, "action": "created", "tunarr_id": new_ch["id"]}
                return {"synced": False, "action": "error",
                        "message": _tunarr_write_error(r.status_code)}
    except Exception as e:
        log.warning("Tunarr sync failed for CH %s: %s", channel_number, e)
        return {"synced": False, "action": "error", "message": str(e)}

@app.put("/api/channels/{channel_number}")
async def update_channel(channel_number: int, body: ChannelIn):
    with get_db() as conn:
        existing = conn.execute("SELECT * FROM channels WHERE number=?", (channel_number,)).fetchone()
        if not existing:
            raise HTTPException(404, "Channel not found")
        conn.execute(
            """UPDATE channels SET name=?, tier=?, vibe=?, mode=?, style=?, color=?, icon=?
               WHERE number=?""",
            (body.name, body.tier, body.vibe, body.mode, body.style, body.color, body.icon, channel_number)
        )
        # If channel number changed, cascade to every table that references it
        # by value (there are no foreign keys) — see _CHANNEL_REF_TABLES.
        if body.number != channel_number:
            try:
                _move_channel_number(conn, channel_number, body.number)
            except sqlite3.IntegrityError:
                raise HTTPException(409, f"Channel number {body.number} is already in use")
        row = conn.execute("SELECT * FROM channels WHERE number=?", (body.number,)).fetchone()
    result = dict(row)
    _log_app("channel", f"Updated channel {channel_number}", metadata={"old_number": channel_number, "new_number": body.number, "name": body.name})
    # This route can change the icon too, so an icon-following watermark has to
    # be re-uploaded here as well (best-effort; never blocks the save).
    if body.icon != existing["icon"]:
        await _refollow_channel_icon_watermark(body.number)
    # Auto-sync metadata to Tunarr (creates channel if not linked)
    sync = await _sync_channel_to_tunarr(body.number)
    result["tunarr_sync"] = sync
    return result

@app.post("/api/channels/{channel_number}/sync-tunarr")
async def sync_channel_to_tunarr(channel_number: int):
    """Manually sync a Cable Plex channel to Tunarr. Creates if not linked."""
    result = await _sync_channel_to_tunarr(channel_number)
    if result.get("action") == "error":
        raise HTTPException(502, result.get("message", "Sync failed"))
    return result

async def _tunarr_delete_channel(tunarr_id: str) -> dict:
    """Best-effort delete of a Tunarr channel. Never raises.

    Deliberately tolerant of 404: a channel already gone from Tunarr is the
    desired end state, not an error worth reporting to someone who just asked
    for it to be deleted.
    """
    url = get_tunarr_url()
    if not url:
        return {"deleted": False, "message": "Tunarr not configured"}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.delete(f"{url}/api/channels/{tunarr_id}")
    except Exception as e:
        log.warning("Tunarr channel delete failed for %s: %s", tunarr_id, e)
        return {"deleted": False, "message": str(e)}
    if r.status_code in (200, 202, 204, 404):
        return {"deleted": True, "tunarr_id": tunarr_id}
    return {"deleted": False, "tunarr_id": tunarr_id,
            "message": f"Tunarr returned {r.status_code}: {r.text[:200]}"}


@app.delete("/api/channels/{channel_number}")
async def delete_channel(channel_number: int,
                         delete_tunarr: bool = Query(True)):
    """Delete a channel, and by default the Tunarr channel linked to it.

    The Tunarr side used to be left behind: this route cleared
    `tunarr_channel_links` along with every other referencing table, which
    severed the link but stranded the actual Tunarr channel — still in the
    lineup, still in the guide, no longer reachable from Linearr to clean up.

    Order matters. Linearr is authoritative, so the local delete commits first
    and the Tunarr call is best-effort afterwards; a Tunarr failure is reported
    in `tunarr` but never undoes the delete the user asked for. Pass
    `delete_tunarr=false` to keep the Tunarr channel and only unlink it.
    """
    with get_db() as conn:
        link = conn.execute(
            "SELECT tunarr_id FROM tunarr_channel_links WHERE channel_number=?",
            (channel_number,),
        ).fetchone()
        cur = conn.execute("DELETE FROM channels WHERE number=?", (channel_number,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Channel not found")
        # No FK constraints tie these tables to channels(number) — clean up
        # explicitly so a reused channel number doesn't inherit ghost data.
        # `_CHANNEL_DELETE_TABLES`, NOT `_CHANNEL_REF_TABLES`: `ai_logs` is an
        # audit trail and survives the delete (see the block comment there).
        conn.execute(
            "DELETE FROM block_slots WHERE block_id IN (SELECT id FROM blocks WHERE channel_number=?)",
            (channel_number,),
        )
        for table in _present_ref_tables(conn, _CHANNEL_DELETE_TABLES):
            conn.execute(f"DELETE FROM {table} WHERE channel_number=?", (channel_number,))
    _log_app("channel", f"Deleted channel {channel_number}", level="warn", metadata={"number": channel_number})

    tunarr: dict | None = None
    if link and delete_tunarr:
        tunarr = await _tunarr_delete_channel(link["tunarr_id"])
        _log_app(
            "channel",
            f"Deleted Tunarr channel for {channel_number}" if tunarr["deleted"]
            else f"Could not delete Tunarr channel for {channel_number}",
            level="warn" if tunarr["deleted"] else "error",
            metadata={"number": channel_number, **tunarr},
        )
    elif link:
        tunarr = {"deleted": False, "tunarr_id": link["tunarr_id"],
                  "message": "Kept in Tunarr — unlinked only"}
    return {"ok": True, "tunarr": tunarr}

# ── Channel Icons ─────────────────────────────────────────────────────────────

def _channel_icon_filename(channel_number: int, raw: bytes, mime: str) -> str:
    """Collision-free upload name for a channel icon.

    Same scheme and same reasoning as `_watermark_image_filename`: Tunarr keys
    uploads by FILENAME and silently overwrites on a repeat, so the channel
    number keeps two channels apart and the content hash keeps a channel's old
    icon intact when it gets a new one.
    """
    digest = hashlib.sha1(raw).hexdigest()[:10]
    return f"linearr-icon-ch{channel_number}-{digest}.{_MIME_EXT.get(mime, 'png')}"


async def _resolve_channel_icon_url(channel_number: int, icon_data: str | None) -> str | None:
    """Upload the channel's icon to Tunarr and return an absolute URL for it.

    Tunarr writes whatever it is given as the icon straight into XMLTV. Linearr
    used to hand it the base64 `data:` URI the icon is stored as, which renders
    in Tunarr's own UI and in Plex clients on the same machine — and nowhere
    else, because a remote client cannot resolve a data URI it was served as an
    image *source*. Uploading makes it an ordinary HTTP asset.

    Best-effort by design: on any failure the caller falls back to the data URI.
    An icon that renders only locally is better than no icon at all, and this
    must never be able to break a channel sync.

    Cached in `channels.icon_url`. The filename is content-addressed, so an
    unchanged icon short-circuits without touching Tunarr.
    """
    with get_db() as conn:
        row = conn.execute(
            "SELECT icon_url, icon_url_manual FROM channels WHERE number=?", (channel_number,)
        ).fetchone()
    # A hand-set URL is never re-derived. It may point at an entirely different
    # host, and re-uploading the stored icon over it would silently undo a
    # deliberate choice — the same reason `_refollow_channel_icon_watermark`
    # requires `use_channel_icon` to be explicitly true.
    if row is not None and row["icon_url_manual"]:
        return _tunarr_asset_url(row["icon_url"])

    if not icon_data or not str(icon_data).startswith("data:"):
        return None
    decoded = _decode_data_uri(icon_data)
    if decoded is None:
        return None
    raw, content_type, _ = decoded
    filename = _channel_icon_filename(channel_number, raw, content_type)

    cached = (row["icon_url"] if row else None) or ""
    # The digest is in the filename, so a matching tail means these exact bytes
    # are already uploaded. Re-base it in case the public URL changed since.
    if cached and cached.rsplit("/", 1)[-1] == filename:
        return _tunarr_asset_url(cached)

    tunarr_url = get_tunarr_url()
    if not tunarr_url:
        return None
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            uploaded = await _tunarr_upload_image(
                client, tunarr_url, raw, content_type, filename)
    except Exception as e:
        log.warning("Channel icon upload failed for CH %s: %s", channel_number, e)
        return None
    if not uploaded:
        return None
    public = _tunarr_asset_url(uploaded)
    with get_db() as conn:
        conn.execute("UPDATE channels SET icon_url=? WHERE number=?",
                     (public, channel_number))
    return public


async def _refollow_channel_icon_watermark(channel_number: int) -> str | None:
    """Re-upload the channel's icon as its watermark image, if it follows it.

    `use_channel_icon` used to decide only which branch of the watermark-image
    endpoint ran at the instant the user clicked Apply — so changing the icon
    afterwards left the watermark pointing at the previously uploaded copy,
    silently stale. Every icon-change path calls this so the watermark follows.

    Deliberately best-effort: returns None (never raises) so a Tunarr upload
    failure cannot break the icon update itself. `use_channel_icon` must be
    explicitly true — a missing key means "don't touch", so a hand-pasted
    absolute URL is never clobbered.
    """
    try:
        with get_db() as conn:
            row = conn.execute(
                "SELECT icon, icon_url, watermark FROM channels WHERE number=?",
                (channel_number,),
            ).fetchone()
        if row is None or not row["watermark"]:
            return None
        try:
            wm = json.loads(row["watermark"])
        except (TypeError, ValueError):
            return None
        if not isinstance(wm, dict) or wm.get("use_channel_icon") is not True:
            return None

        # Prefer the icon's OWN uploaded URL. The icon is already an HTTP asset
        # in Tunarr, and "the watermark is the channel icon" means literally the
        # same image — so uploading a second copy under a watermark filename was
        # pure duplication. It also forced a genuinely silly workflow: to point a
        # watermark at a specific domain you had to upload the icon, apply it as
        # a watermark, copy the URL that came back, then paste it into the URL
        # field. Reusing the icon URL means setting it once is enough, and a
        # hand-set icon URL now carries through to the watermark for free.
        icon_url = _tunarr_asset_url(row["icon_url"])
        if icon_url:
            with get_db() as conn:
                conn.execute("UPDATE channels SET watermark_image_url=? WHERE number=?",
                             (icon_url, channel_number))
            _log_app("channel",
                     f"Watermark image now follows the icon URL for channel {channel_number}",
                     metadata={"number": channel_number, "image_url": icon_url})
            return icon_url

        decoded = _decode_data_uri(row["icon"] or "")
        if decoded is None:
            return None
        tunarr_url = get_tunarr_url()
        if not tunarr_url:
            return None
        raw, content_type, _ = decoded
        # Channel-scoped + content-addressed: a shared filename would overwrite
        # every other channel's watermark image (see _watermark_image_filename).
        filename = _watermark_image_filename(channel_number, raw, content_type)
        async with httpx.AsyncClient(timeout=30.0) as client:
            image_url = await _tunarr_upload_image(
                client, tunarr_url, raw, content_type, filename)
        if not image_url:
            return None
        with get_db() as conn:
            conn.execute("UPDATE channels SET watermark_image_url=? WHERE number=?",
                         (image_url, channel_number))
        _log_app("channel",
                 f"Watermark image re-followed the icon for channel {channel_number}",
                 metadata={"number": channel_number, "image_url": image_url})
        return image_url
    except Exception as e:      # never break the icon write
        log.warning("Watermark image re-upload failed for CH %s: %s", channel_number, e)
        return None


@app.get("/api/channels/{channel_number}/icon")
def get_channel_icon(channel_number: int):
    """The channel's icon and the URL Tunarr is given for it.

    Two different things, deliberately. `icon` is the data URI Linearr renders
    in its own UI; `icon_url` is the absolute HTTP URL written into Tunarr and
    from there into XMLTV, which is what remote Plex clients fetch. `manual`
    says the URL was set by hand and will not be re-derived from the icon.
    """
    with get_db() as conn:
        row = conn.execute(
            "SELECT icon, icon_url, icon_url_manual FROM channels WHERE number=?",
            (channel_number,),
        ).fetchone()
    if row is None:
        raise HTTPException(404, "Channel not found")
    return {
        "icon": row["icon"],
        "icon_url": _tunarr_asset_url(row["icon_url"]),
        "manual": bool(row["icon_url_manual"]),
    }


class ChannelIconImageIn(BaseModel):
    # Omit both to (re-)derive from the channel's stored icon.
    image: str | None = None   # data URI to upload to Tunarr
    url: str | None = None     # absolute URL to use as-is


@app.post("/api/channels/{channel_number}/icon/image")
async def set_channel_icon_image(channel_number: int, body: ChannelIconImageIn):
    """Set the URL Tunarr is given for this channel's icon.

    The counterpart of `POST .../watermark/image`, and for the same reason: the
    icon Tunarr publishes has to be an HTTP URL, and which URL is sometimes a
    decision only the user can make — a reverse-proxied domain that Plex clients
    outside the LAN can actually reach, or an image hosted somewhere else
    entirely.

    - `{"url": ...}` stores an absolute URL verbatim and marks it manual, so no
      later icon change or sync overwrites it.
    - `{"image": "data:..."}` uploads those bytes to Tunarr.
    - `{}` re-derives from the stored channel icon and clears the manual flag.

    `tunarr_public_url` already re-bases Tunarr-hosted URLs globally; this is the
    per-channel override for everything that setting cannot know about.
    """
    with get_db() as conn:
        row = conn.execute(
            "SELECT icon FROM channels WHERE number=?", (channel_number,)
        ).fetchone()
    if row is None:
        raise HTTPException(404, "Channel not found")

    manual = False
    if body.url:
        parsed = _urlparse(body.url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise HTTPException(
                400, "Icon URL must be absolute (http:// or https://) — Tunarr "
                     "publishes it in the guide and clients fetch it over HTTP"
            )
        icon_url = body.url.strip()
        manual = True
    elif body.image:
        decoded = _decode_data_uri(body.image)
        if decoded is None:
            raise HTTPException(400, "`image` must be a base64 data URI")
        tunarr_url = get_tunarr_url()
        if not tunarr_url:
            raise HTTPException(400, "Tunarr not configured")
        raw, content_type, _ = decoded
        filename = _channel_icon_filename(channel_number, raw, content_type)
        async with httpx.AsyncClient(timeout=30.0) as client:
            uploaded = await _tunarr_upload_image(
                client, tunarr_url, raw, content_type, filename)
        if not uploaded:
            raise HTTPException(502, "Tunarr rejected the icon image upload")
        icon_url = _tunarr_asset_url(uploaded) or uploaded
        manual = True
    else:
        # Re-derive. Clear both first so the resolver does not short-circuit on
        # the manual flag it is being asked to drop.
        with get_db() as conn:
            conn.execute(
                "UPDATE channels SET icon_url=NULL, icon_url_manual=0 WHERE number=?",
                (channel_number,))
        icon_url = await _resolve_channel_icon_url(channel_number, row["icon"])
        if not icon_url:
            raise HTTPException(
                400, "No usable icon — set a channel icon first, or supply an "
                     "absolute URL"
            )

    with get_db() as conn:
        conn.execute(
            "UPDATE channels SET icon_url=?, icon_url_manual=? WHERE number=?",
            (icon_url, 1 if manual else 0, channel_number),
        )
    _log_app("channel", f"Set icon image URL for channel {channel_number}",
             metadata={"number": channel_number, "icon_url": icon_url, "manual": manual})
    # The watermark follows the icon when asked to, so it may need re-pointing
    # at the new URL before the sync carries both.
    await _refollow_channel_icon_watermark(channel_number)
    sync = await _sync_channel_to_tunarr(channel_number)
    return {"ok": True, "icon_url": icon_url, "manual": manual, "tunarr_sync": sync}


@app.put("/api/channels/{channel_number}/icon")
async def set_channel_icon(channel_number: int, request: Request):
    """Set channel icon (base64 PNG data URL)."""
    body = await request.json()
    icon_data = body.get("icon", "")
    with get_db() as conn:
        # Clear the cached upload URL: it points at the OLD icon, and
        # `_tunarr_channel_changes` prefers it over the data URI, so leaving it
        # would push the previous logo. The sync below re-resolves it.
        #
        # A hand-set URL is left alone — the user pointed it somewhere on
        # purpose, possibly at a host that has nothing to do with this upload.
        cur = conn.execute(
            "UPDATE channels SET icon=?, icon_url=CASE WHEN icon_url_manual THEN icon_url END "
            "WHERE number=?",
            (icon_data, channel_number),
        )
    if cur.rowcount == 0:
        raise HTTPException(404, "Channel not found")
    _log_app("channel", f"Set icon for channel {channel_number}", metadata={"number": channel_number})
    # Order matters. Resolve the icon's own URL first so the watermark — which
    # now reuses it rather than uploading a duplicate — has something to follow;
    # then re-point the watermark; then sync, so the push carries both.
    await _resolve_channel_icon_url(channel_number, icon_data)
    await _refollow_channel_icon_watermark(channel_number)
    sync = await _sync_channel_to_tunarr(channel_number)
    return {"ok": True, "tunarr_sync": sync}

@app.delete("/api/channels/{channel_number}/icon")
async def delete_channel_icon(channel_number: int):
    """Remove the channel icon, and clear it in Tunarr too.

    Channel writes are read-modify-write and `_tunarr_channel_changes` only
    emits `icon` when the row holds a `data:` icon — so simply syncing after the
    local clear sends no `icon` key and the PUT echoes Tunarr's old logo
    straight back. The only way to switch it off is to write an icon object with
    an empty path (Tunarr's "none" state), passed as an explicit override.

    The override is used ONLY here; a routine sync for a channel with no icon
    still sends no icon key, leaving one set directly in Tunarr's own UI alone.
    """
    with get_db() as conn:
        # `icon_url` goes with it — a stale one would be pushed straight back on
        # the next sync, and `_tunarr_channel_changes` prefers it over the icon.
        # `icon_url_manual` goes too: with no icon there is nothing for a manual
        # override to override, and leaving the flag set would make a later icon
        # silently keep the old URL.
        conn.execute(
            "UPDATE channels SET icon=NULL, icon_url=NULL, icon_url_manual=0 WHERE number=?",
            (channel_number,))
    _log_app("channel", f"Removed icon for channel {channel_number}", metadata={"number": channel_number})
    sync = await _sync_channel_to_tunarr(
        channel_number, icon_override=_tunarr_icon_obj(None))
    return {"ok": True, "tunarr_sync": sync}

# ── Channel watermark ─────────────────────────────────────────────────────────

@app.get("/api/channels/{channel_number}/watermark")
def get_channel_watermark(channel_number: int):
    with get_db() as conn:
        row = conn.execute(
            "SELECT watermark, watermark_image_url FROM channels WHERE number=?",
            (channel_number,),
        ).fetchone()
    if row is None:
        raise HTTPException(404, "Channel not found")
    # `image_url` is reported at the top level too, and independently of whether a
    # config exists: the image route resolves it WITHOUT writing the config blob,
    # so a channel can legitimately have a resolved image and `watermark = NULL`.
    # The editor gates its "enabled" control on a resolved image (the PUT below
    # rejects enabled-without-one), and it must be able to see that state before
    # the first config is saved.
    image_url = row["watermark_image_url"]
    stored = row["watermark"]
    if not stored:
        return {"watermark": None, "image_url": image_url}
    try:
        wm = json.loads(stored)
    except (TypeError, ValueError):
        return {"watermark": None, "image_url": image_url}
    wm["image_url"] = image_url
    return {"watermark": wm, "image_url": image_url}


@app.put("/api/channels/{channel_number}/watermark")
async def put_channel_watermark(channel_number: int, body: WatermarkIn):
    with get_db() as conn:
        existing = conn.execute(
            "SELECT watermark, watermark_image_url FROM channels WHERE number=?",
            (channel_number,)
        ).fetchone()
        if existing is None:
            raise HTTPException(404, "Channel not found")
        previous_watermark = existing["watermark"]
        conn.execute(
            "UPDATE channels SET watermark=? WHERE number=?",
            (json.dumps(body.model_dump()), channel_number),
        )

    # "Leave the image blank and it uses the channel icon" is the behaviour
    # people expect, but Tunarr does NOT do that fallback — an enabled watermark
    # with no URL kills the stream (see `_watermark_to_tunarr`). So Linearr does
    # the fallback itself: resolve the icon to a real Tunarr-hosted URL here,
    # before the sync, so what gets pushed always has an image to draw.
    #
    # The config has to be written first, because the resolver reads
    # `use_channel_icon` off the stored blob. If resolution then fails there is
    # nothing to draw, so the write is rolled back rather than left behind — a
    # stored enabled-with-no-image row is the exact state `watermark-audit`
    # exists to find, and a rejected request must not create one.
    image_url = (existing["watermark_image_url"] or "").strip()
    if body.enabled and not image_url:
        image_url = (await _refollow_channel_icon_watermark(channel_number)) or ""
        if not image_url:
            with get_db() as conn:
                conn.execute("UPDATE channels SET watermark=? WHERE number=?",
                             (previous_watermark, channel_number))
            raise HTTPException(
                400,
                "This channel has no watermark image and no icon to derive one "
                "from, so there is nothing for Tunarr to draw — an enabled "
                "watermark with no image stops the channel playing entirely. "
                "Add a channel icon (it will be used automatically) or set an "
                "image URL, then enable the watermark.",
            )

    _log_app("channel", f"Updated watermark for channel {channel_number}",
             metadata={"number": channel_number, "enabled": body.enabled})
    sync = await _sync_channel_to_tunarr(channel_number)
    return {"ok": True, "watermark": body.model_dump(), "tunarr_sync": sync,
            "image_url": image_url or None}


@app.delete("/api/channels/{channel_number}/watermark")
async def delete_channel_watermark(channel_number: int):
    """Clear the watermark and switch it off in Tunarr.

    Tunarr has no way to null the watermark column via its API, and channel
    writes are read-modify-write — omitting the key would echo Tunarr's
    existing watermark straight back and the overlay would keep rendering. So
    the sync is given an explicit `enabled: false` payload as an override. That
    override is only used here; a routine sync for a channel with no watermark
    configured still sends no watermark key, leaving one set directly in
    Tunarr's own UI untouched.
    """
    with get_db() as conn:
        cur = conn.execute(
            "UPDATE channels SET watermark=NULL, watermark_image_url=NULL WHERE number=?",
            (channel_number,),
        )
    if cur.rowcount == 0:
        raise HTTPException(404, "Channel not found")
    _log_app("channel", f"Cleared watermark for channel {channel_number}",
             level="warn", metadata={"number": channel_number})
    sync = await _sync_channel_to_tunarr(
        channel_number, watermark_override=_disabled_watermark_for_tunarr())
    return {"ok": True, "tunarr_sync": sync}


class WatermarkImageIn(BaseModel):
    # Omit both to fall back to the channel's icon.
    image: str | None = None   # data URI to upload
    url: str | None = None     # absolute URL to use as-is


@app.post("/api/channels/{channel_number}/watermark/image")
async def set_channel_watermark_image(channel_number: int, body: WatermarkImageIn):
    """Resolve the watermark image to an absolute URL Tunarr can fetch.

    An explicit absolute `url` is stored verbatim. A data URI — either supplied
    directly or taken from the channel's icon — is uploaded to Tunarr, because
    Tunarr passes this value to ffmpeg as an HTTP input and cannot read a
    `data:` URI (which is also why leaving `url` blank to inherit the channel
    icon does not work: the icon is itself stored as a data URI).
    """
    with get_db() as conn:
        row = conn.execute(
            "SELECT icon FROM channels WHERE number=?", (channel_number,)
        ).fetchone()
    if row is None:
        raise HTTPException(404, "Channel not found")

    if body.url:
        parsed = _urlparse(body.url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise HTTPException(
                400, "Watermark URL must be absolute (http:// or https://) — "
                     "Tunarr fetches it over HTTP and cannot use a relative path"
            )
        image_url = body.url
    else:
        source = body.image or row["icon"]
        decoded = _decode_data_uri(source or "")
        if decoded is None:
            raise HTTPException(
                400, "No usable image — supply a data URI, an absolute URL, or "
                     "set a channel icon first"
            )
        raw, content_type, _ = decoded
        # Channel-scoped + content-addressed: a shared filename would overwrite
        # every other channel's watermark image (see _watermark_image_filename).
        filename = _watermark_image_filename(channel_number, raw, content_type)
        tunarr_url = get_tunarr_url()
        if not tunarr_url:
            raise HTTPException(400, "Tunarr not configured")
        async with httpx.AsyncClient(timeout=30.0) as client:
            image_url = await _tunarr_upload_image(
                client, tunarr_url, raw, content_type, filename)
        if not image_url:
            raise HTTPException(502, "Tunarr rejected the watermark image upload")

    with get_db() as conn:
        conn.execute(
            "UPDATE channels SET watermark_image_url=? WHERE number=?",
            (image_url, channel_number),
        )
    _log_app("channel", f"Set watermark image for channel {channel_number}",
             metadata={"number": channel_number, "image_url": image_url})
    sync = await _sync_channel_to_tunarr(channel_number)
    return {"ok": True, "image_url": image_url, "tunarr_sync": sync}


# ── Watermark repair ─────────────────────────────────────────────────────────
# A channel with `watermark.enabled` and no image URL does not play at all:
# Tunarr builds a dangling `-i` into the ffmpeg command, the transcode exits
# 254, no playlist is ever written and the channel 404s in a retry loop. It is
# reachable by an ordinary sequence — upload an image, then clear it — so the
# app needs both a way to find channels in that state and a way to fix them.

def _find_broken_watermarks() -> list[dict]:
    """Channels whose watermark needs fixing, and why.

    Two distinct faults, both repairable by re-resolving the image:

    - `no_image` — enabled with no URL at all. The channel does not play (Tunarr
      builds a dangling ffmpeg `-i`).
    - `shared_image` — pointing at the legacy `linearr-watermark.png`, which every
      channel used to upload over. The channel plays, but draws whichever
      channel's image was applied last.
    """
    out: list[dict] = []
    with get_db() as conn:
        rows = conn.execute(
            "SELECT number, name, icon, watermark, watermark_image_url FROM channels "
            "WHERE watermark IS NOT NULL ORDER BY number"
        ).fetchall()
    for row in rows:
        try:
            wm = json.loads(row["watermark"])
        except (TypeError, ValueError):
            continue
        if not isinstance(wm, dict) or not wm.get("enabled"):
            continue
        image_url = (row["watermark_image_url"] or "").strip()
        if not image_url:
            issue = "no_image"
        elif _LEGACY_WATERMARK_FILENAME in image_url:
            issue = "shared_image"
        else:
            continue
        out.append({
            "number": row["number"],
            "name": row["name"],
            "issue": issue,
            # Repairable in place when there is an icon to upload as the image.
            "can_use_icon": bool((row["icon"] or "").strip()),
        })
    return out


@app.get("/api/channels/watermark-audit")
def watermark_audit():
    """Channels whose watermark needs fixing, with the `issue` per channel:
    `no_image` (the channel will not play at all) or `shared_image` (it plays but
    draws another channel's logo, from the legacy shared upload filename).
    `can_use_icon` marks the ones repair can fix without losing the watermark;
    the rest can only be switched off."""
    broken = _find_broken_watermarks()
    return {"broken": broken, "count": len(broken)}


@app.post("/api/channels/watermark-repair")
async def watermark_repair(channel_number: int | None = Query(None)):
    """Fix channels reported by `watermark-audit`.

    Per channel: re-upload its icon under a collision-free filename and keep the
    watermark if it has one, otherwise switch the watermark off. Either way the
    channel afterwards plays and draws its own logo. Pass `channel_number` to
    repair just one.
    """
    broken = _find_broken_watermarks()
    if channel_number is not None:
        broken = [b for b in broken if b["number"] == channel_number]
    results = []
    for entry in broken:
        n = entry["number"]
        if entry["issue"] == "shared_image":
            # Clear it first: the resolver is a no-op for a channel that already
            # has a URL, and this one is a URL we must stop trusting.
            with get_db() as conn:
                conn.execute(
                    "UPDATE channels SET watermark_image_url=NULL WHERE number=?", (n,))
        image_url = await _refollow_channel_icon_watermark(n)
        if image_url:
            action = "image_resolved_from_icon"
        else:
            with get_db() as conn:
                row = conn.execute(
                    "SELECT watermark FROM channels WHERE number=?", (n,)).fetchone()
            try:
                wm = json.loads(row["watermark"]) if row and row["watermark"] else {}
            except (TypeError, ValueError):
                wm = {}
            wm["enabled"] = False
            with get_db() as conn:
                conn.execute("UPDATE channels SET watermark=? WHERE number=?",
                             (json.dumps(wm), n))
            action = "watermark_disabled"
        sync = await _sync_channel_to_tunarr(n)
        results.append({"number": n, "name": entry["name"], "issue": entry["issue"],
                        "action": action, "image_url": image_url,
                        "tunarr_sync": sync})
        _log_app("channel",
                 f"Repaired watermark for channel {n} ({entry['issue']}): {action}",
                 level="warn",
                 metadata={"number": n, "issue": entry["issue"], "action": action})
    return {"repaired": results, "count": len(results)}


@app.get("/api/icons/export")
def export_icon_pack():
    """Export all channel icons as JSON pack."""
    with get_db() as conn:
        rows = conn.execute("SELECT number, name, icon FROM channels WHERE icon IS NOT NULL AND icon != ''").fetchall()
    pack = {str(r["number"]): {"name": r["name"], "icon": r["icon"]} for r in rows}
    return {"version": 1, "icons": pack}

@app.post("/api/icons/import")
async def import_icon_pack(request: Request):
    """Import channel icon pack JSON."""
    body = await request.json()
    icons = body.get("icons", {})
    imported = 0
    with get_db() as conn:
        for ch_num, data in icons.items():
            icon_data = data.get("icon", data) if isinstance(data, dict) else data
            if not icon_data:
                continue
            # icon_url follows the icon; a stale one would be pushed instead.
            conn.execute("UPDATE channels SET icon=?, icon_url=NULL WHERE number=?",
                         (icon_data, int(ch_num)))
            imported += 1
    _log_app("icons", f"Imported {imported} channel icons")
    return {"ok": True, "imported": imported}


@app.post("/api/channels/resync-assets")
async def resync_channel_assets(channel_number: int | None = Query(None),
                                force: bool = Query(False)):
    """Re-upload every channel's icon to Tunarr and push the result.

    The operational counterpart of the `tunarr_public_url` setting. Channels
    synced before that setting existed hold their icon in Tunarr as a `data:`
    URI, which no remote Plex client can render; this walks the lineup and
    replaces each one with a real uploaded asset. Without it, adopting the
    setting would mean re-saving every channel by hand.

    Icon uploads are content-addressed, so this is naturally idempotent — an
    unchanged icon short-circuits without touching Tunarr. `force=true` clears
    the cached URL first, for when Tunarr's upload directory has been wiped and
    the cache is lying about what exists there.

    Per-channel failures are collected rather than raised: one unreachable
    channel must not abandon the rest of the lineup half-done.
    """
    with get_db() as conn:
        if channel_number is not None:
            rows = conn.execute(
                "SELECT number FROM channels WHERE number=? AND icon IS NOT NULL AND icon != ''",
                (channel_number,)).fetchall()
        else:
            rows = conn.execute(
                "SELECT number FROM channels WHERE icon IS NOT NULL AND icon != '' "
                "ORDER BY number").fetchall()
        if force:
            numbers = [r["number"] for r in rows]
            for n in numbers:
                conn.execute("UPDATE channels SET icon_url=NULL WHERE number=?", (n,))

    results: list[dict] = []
    for row in rows:
        n = row["number"]
        url = await _resolve_channel_icon_url(
            n, _channel_icon_data(n))
        entry = {"channel_number": n, "icon_url": url, "uploaded": bool(url)}
        if url:
            sync = await _sync_channel_to_tunarr(n)
            entry["synced"] = bool(sync.get("synced"))
            if not sync.get("synced"):
                entry["message"] = sync.get("message", "")
        else:
            entry["synced"] = False
            entry["message"] = "Icon could not be uploaded to Tunarr"
        results.append(entry)

    uploaded = sum(1 for r in results if r["uploaded"])
    _log_app("icons",
             f"Re-synced assets for {uploaded}/{len(results)} channels",
             level="warn" if uploaded < len(results) else "info",
             metadata={"asset_base": _tunarr_asset_base()})
    return {"ok": True, "asset_base": _tunarr_asset_base(),
            "total": len(results), "uploaded": uploaded,
            "failed": [r for r in results if not r["uploaded"] or not r["synced"]],
            "channels": results}


def _channel_icon_data(channel_number: int) -> str | None:
    with get_db() as conn:
        row = conn.execute("SELECT icon FROM channels WHERE number=?",
                           (channel_number,)).fetchone()
    return row["icon"] if row else None

# ── Icon Library ─────────────────────────────────────────────────────────────

@app.get("/api/icons/library")
def list_saved_icons():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM saved_icons ORDER BY category, name").fetchall()
    return [dict(r) for r in rows]

@app.post("/api/icons/library", status_code=201)
async def save_icon(request: Request):
    body = await request.json()
    name = body.get("name", "Untitled")
    category = body.get("category", "custom")
    data = body.get("data", "")
    composition = body.get("composition")
    if not data:
        raise HTTPException(400, "Icon data required")
    # Composition may be a dict — store as JSON string
    comp_str = json.dumps(composition) if isinstance(composition, dict) else composition
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO saved_icons (name, category, data, composition) VALUES (?, ?, ?, ?)",
            (name, category, data, comp_str),
        )
        row = conn.execute("SELECT * FROM saved_icons WHERE id=?", (cur.lastrowid,)).fetchone()
    return dict(row)

@app.put("/api/icons/library/{icon_id}")
async def update_saved_icon(icon_id: int, request: Request):
    body = await request.json()
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM saved_icons WHERE id=?", (icon_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Icon not found")
        if "name" in body:
            conn.execute("UPDATE saved_icons SET name=? WHERE id=?", (body["name"], icon_id))
        if "category" in body:
            conn.execute("UPDATE saved_icons SET category=? WHERE id=?", (body["category"], icon_id))
        if "data" in body:
            conn.execute("UPDATE saved_icons SET data=? WHERE id=?", (body["data"], icon_id))
        if "composition" in body:
            comp = body["composition"]
            comp_str = json.dumps(comp) if isinstance(comp, dict) else comp
            conn.execute("UPDATE saved_icons SET composition=? WHERE id=?", (comp_str, icon_id))
        row = conn.execute("SELECT * FROM saved_icons WHERE id=?", (icon_id,)).fetchone()
    return dict(row)

@app.delete("/api/icons/library/{icon_id}")
def delete_saved_icon(icon_id: int):
    with get_db() as conn:
        cur = conn.execute("DELETE FROM saved_icons WHERE id=?", (icon_id,))
    if cur.rowcount == 0:
        raise HTTPException(404, "Icon not found")
    return {"ok": True}

@app.post("/api/icons/library/seed")
async def seed_icon_pack(request: Request):
    """Bulk-import an icon pack (array of {name, category, data, channel?})."""
    body = await request.json()
    icons = body.get("icons", [])
    if not icons:
        raise HTTPException(400, "No icons in pack")
    created = 0
    assigned = 0
    with get_db() as conn:
        for icon in icons:
            name = icon.get("name", "")
            category = icon.get("category", "imported")
            data = icon.get("data", "")
            if not data:
                continue
            # Check if icon with same name+category already exists
            existing = conn.execute(
                "SELECT id FROM saved_icons WHERE name=? AND category=?", (name, category)
            ).fetchone()
            if existing:
                conn.execute("UPDATE saved_icons SET data=? WHERE id=?", (data, existing["id"]))
            else:
                conn.execute(
                    "INSERT INTO saved_icons (name, category, data) VALUES (?, ?, ?)",
                    (name, category, data),
                )
            created += 1
            # Auto-assign to matching channel if specified
            channel_name = icon.get("channel")
            if channel_name:
                ch = conn.execute("SELECT number FROM channels WHERE name=?", (channel_name,)).fetchone()
                if ch:
                    conn.execute("UPDATE channels SET icon=? WHERE number=?", (data, ch["number"]))
                    assigned += 1
    _log_app("icons", f"Seeded icon pack: {created} icons, {assigned} auto-assigned")
    return {"ok": True, "created": created, "assigned": assigned}

# ── Assignments ───────────────────────────────────────────────────────────────

@app.get("/api/assignments")
def list_assignments():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM assignments ORDER BY channel_number, plex_title").fetchall()
    result: dict[int, list] = {}
    for r in rows:
        ch = r["channel_number"]
        result.setdefault(ch, []).append(dict(r))
    return result

@app.post("/api/assignments", status_code=201)
def create_assignment(body: AssignmentIn):
    try:
        with get_db() as conn:
            conn.execute(
                """INSERT INTO assignments
                   (channel_number, plex_rating_key, plex_title, plex_type, plex_thumb, plex_year)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (body.channel_number, body.plex_rating_key, body.plex_title,
                 body.plex_type, body.plex_thumb, body.plex_year),
            )
            row = conn.execute(
                "SELECT * FROM assignments WHERE channel_number=? AND plex_rating_key=?",
                (body.channel_number, body.plex_rating_key),
            ).fetchone()
        _log_app("assignment", f"Assigned '{body.plex_title}' to ch {body.channel_number}",
                 metadata={"channel": body.channel_number, "rating_key": body.plex_rating_key, "title": body.plex_title})
        return dict(row)
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Already assigned")
    except sqlite3.Error as e:
        log.exception("Failed to create assignment (ch %s, key %s)",
                      body.channel_number, body.plex_rating_key)
        _log_app("assignment", "Failed to create assignment", level="error",
                 detail=f"{type(e).__name__}: {e}",
                 metadata={"channel": body.channel_number, "rating_key": body.plex_rating_key})
        raise HTTPException(500, f"Database error: {e}")

@app.delete("/api/assignments/{assignment_id}")
def delete_assignment(assignment_id: int):
    try:
        with get_db() as conn:
            row = conn.execute("SELECT plex_title, channel_number FROM assignments WHERE id=?", (assignment_id,)).fetchone()
            cur = conn.execute("DELETE FROM assignments WHERE id=?", (assignment_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Not found")
        _log_app("assignment", f"Removed assignment {assignment_id}",
                 metadata={"id": assignment_id,
                           "title": row["plex_title"] if row else None,
                           "channel": row["channel_number"] if row else None})
        return {"ok": True}
    except HTTPException:
        raise
    except sqlite3.Error as e:
        log.exception("Failed to delete assignment %s", assignment_id)
        _log_app("assignment", "Failed to delete assignment", level="error",
                 detail=f"{type(e).__name__}: {e}", metadata={"id": assignment_id})
        raise HTTPException(500, f"Database error: {e}")

@app.post("/api/assignments/bulk", status_code=201)
def bulk_assignments(body: BulkAssignmentIn):
    added = 0
    skipped = 0
    with get_db() as conn:
        for item in body.items:
            try:
                conn.execute(
                    """INSERT INTO assignments
                       (channel_number, plex_rating_key, plex_title, plex_type, plex_thumb, plex_year)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (body.channel_number, item.plex_rating_key, item.plex_title,
                     item.plex_type, item.plex_thumb, item.plex_year),
                )
                added += 1
            except sqlite3.IntegrityError:
                skipped += 1
            except sqlite3.Error as e:
                raise HTTPException(500, f"Database error during bulk assign: {e}")
        rows = conn.execute(
            "SELECT * FROM assignments WHERE channel_number=? ORDER BY plex_title",
            (body.channel_number,)
        ).fetchall()
    _log_app("assignment", f"Bulk assign to ch {body.channel_number}: {added} added, {skipped} skipped",
             metadata={"channel": body.channel_number, "added": added, "skipped": skipped})
    return {"added": added, "skipped": skipped, "assignments": [dict(r) for r in rows]}

@app.delete("/api/assignments/channel/{channel_number}")
def purge_channel_assignments(channel_number: int, content_type: str = Query("both")):
    """Purge a channel's assigned content in bulk. content_type: movies | shows | both.
    Returns how many rows were removed."""
    if content_type not in ("movies", "shows", "both"):
        raise HTTPException(400, "content_type must be 'movies', 'shows', or 'both'")
    if not _get_channel(channel_number):
        raise HTTPException(404, f"Channel {channel_number} not found")
    try:
        with get_db() as conn:
            if content_type == "both":
                cur = conn.execute("DELETE FROM assignments WHERE channel_number=?", (channel_number,))
            else:
                # 'movies' -> plex_type 'movie', 'shows' -> 'show'
                plex_type = "movie" if content_type == "movies" else "show"
                cur = conn.execute(
                    "DELETE FROM assignments WHERE channel_number=? AND plex_type=?",
                    (channel_number, plex_type))
            removed = cur.rowcount
    except sqlite3.Error as e:
        log.exception("Failed to purge assignments for ch %s", channel_number)
        _log_app("assignment", "Failed to purge channel assignments", level="error",
                 detail=f"{type(e).__name__}: {e}", metadata={"channel": channel_number})
        raise HTTPException(500, f"Database error: {e}")
    _log_app("assignment", f"Purged {content_type} from ch {channel_number}: {removed} removed",
             level="warn", metadata={"channel": channel_number, "content_type": content_type, "removed": removed})
    return {"ok": True, "removed": removed, "content_type": content_type}

# ── Settings ──────────────────────────────────────────────────────────────────

# House style for generated channel icons: a brand line over the channel line.
# The values are the Galaxy Network defaults; every one is user-editable. Only
# the frontend renders from these — the backend just stores and serves them, so
# it deliberately knows nothing about fonts or canvases beyond these key names.
_ICON_BRAND_DEFAULTS = {
    "brand_line": "Galaxy",
    "brand_font": "Baloo Thambi",
    "brand_weight": 400,   # Baloo Thambi ships ONE weight; 500 would be faked
    "name_font": "Baloo Thambi 2",
    "name_weight": 400,
    "color": "#ffffff",
    "width": 512,
    "height": 512,
}


def _icon_brand_defaults(stored: str | None) -> dict:
    """Stored icon defaults merged over the built-ins.

    Merged rather than replaced so a blob written before a key existed still
    produces a complete config, and unknown keys are dropped rather than
    reaching the renderer.
    """
    out = dict(_ICON_BRAND_DEFAULTS)
    if not stored:
        return out
    try:
        parsed = json.loads(stored)
    except (TypeError, ValueError):
        return out
    if not isinstance(parsed, dict):
        return out
    for k in _ICON_BRAND_DEFAULTS:
        if k in parsed and parsed[k] not in (None, ""):
            out[k] = parsed[k]
    return out


@app.get("/api/settings")
def get_settings():
    with get_db() as conn:
        rows = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings")}
    url = rows.get("plex_url") or PLEX_URL_DEFAULT
    token = rows.get("plex_token") or PLEX_TOKEN_DEFAULT
    webhook_secret = rows.get("plex_webhook_secret", "")
    # Never return secrets in cleartext. Expose only whether each is configured; the UI
    # shows a "configured — leave blank to keep" placeholder and POST preserves on empty.
    return {
        "plex_url": url,
        "plex_token": "",
        "plex_token_set": bool(token),
        "openai_api_key": "",
        "openai_api_key_set": bool(rows.get("openai_api_key")),
        "openai_base_url": rows.get("openai_base_url", "https://api.openai.com/v1"),
        "openai_model": rows.get("openai_model", "gpt-4o-mini"),
        "tunarr_url": rows.get("tunarr_url", "http://tunarr:8000"),
        "tunarr_public_url": rows.get("tunarr_public_url", ""),
        "icon_brand_defaults": _icon_brand_defaults(rows.get("icon_brand_defaults")),
        "plex_webhook_path": f"/api/plex/webhook?token={webhook_secret}" if webhook_secret else "",
    }

@app.post("/api/settings")
def save_settings(body: SettingsIn):
    with get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_url', ?)", (body.plex_url,))
        # Empty secret means "keep the existing value" (the GET masks it), so a save from
        # the settings form doesn't wipe the stored token.
        if body.plex_token:
            conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_token', ?)", (body.plex_token,))
        if body.openai_api_key:
            conn.execute("INSERT OR REPLACE INTO settings VALUES ('openai_api_key', ?)", (body.openai_api_key,))
        if body.openai_base_url is not None:
            conn.execute("INSERT OR REPLACE INTO settings VALUES ('openai_base_url', ?)", (body.openai_base_url,))
        if body.openai_model is not None:
            conn.execute("INSERT OR REPLACE INTO settings VALUES ('openai_model', ?)", (body.openai_model,))
        if body.tunarr_url is not None:
            conn.execute("INSERT OR REPLACE INTO settings VALUES ('tunarr_url', ?)", (body.tunarr_url,))
        if body.tunarr_public_url is not None:
            # Stored even when blank — clearing it is a meaningful action that
            # reverts asset links to the internal Tunarr URL.
            conn.execute("INSERT OR REPLACE INTO settings VALUES ('tunarr_public_url', ?)",
                         (body.tunarr_public_url.strip().rstrip("/"),))
        if body.icon_brand_defaults is not None:
            # Merged through the same reader used on GET, so an unknown key
            # cannot be persisted and a partial write keeps the other values.
            merged = _icon_brand_defaults(json.dumps(body.icon_brand_defaults))
            conn.execute("INSERT OR REPLACE INTO settings VALUES ('icon_brand_defaults', ?)",
                         (json.dumps(merged),))
    _log_app("settings", "Settings saved")
    return {"ok": True}

# ── Plex proxy ────────────────────────────────────────────────────────────────

def plex_headers(token: str):
    return {"X-Plex-Token": token, "Accept": "application/json"}

# ── Plex OAuth helpers ─────────────────────────────────────────────────────────

PLEX_TV = "https://plex.tv"
APP_NAME = "Linearr"
# Reported to Plex as X-Plex-Version. Keep in sync with the release version.
APP_VERSION = os.getenv("APP_VERSION", "1.0.0")

def _get_client_id() -> str:
    """Return a persistent client UUID, creating one if needed."""
    with get_db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key='client_id'").fetchone()
        if row:
            return row["value"]
        new_id = str(uuid.uuid4())
        conn.execute("INSERT INTO settings VALUES ('client_id', ?)", (new_id,))
    return new_id

def _plex_client_headers() -> dict:
    return {
        "X-Plex-Client-Identifier": _get_client_id(),
        "X-Plex-Product": APP_NAME,
        "X-Plex-Version": APP_VERSION,
        "X-Plex-Platform": "Docker",
        "Accept": "application/json",
    }

# ── Plex JWT / JWK device auth ("API Unlocked", Plex Pro Week '25) ──────────────
# Modern Plex auth: the device holds an Ed25519 keypair, registers its public key
# (JWK) when requesting a PIN, then proves possession of the private key by signing
# a deviceJWT to redeem the PIN for a (7-day) token. The resulting token is used in
# the SAME X-Plex-Token header as a legacy token, so the rest of the app is
# unchanged. This whole flow is ADDITIVE — legacy long-lived tokens still work and
# remain the default until a JWT has been successfully enrolled.
#
# NOTE: the exact wire contract (XML vs JSON on PIN redeem, refresh body) follows
# Plex's documented Sept–Oct 2025 flow and should be confirmed against live
# clients.plex.tv during verification; failures here never affect the legacy path.
PLEX_CLIENTS = "https://clients.plex.tv"

def _b64url(data: bytes) -> str:
    import base64
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def _get_device_keypair():
    """Return (Ed25519PrivateKey, kid), generating + persisting one on first use."""
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives import serialization
    with get_db() as conn:
        priv_row = conn.execute("SELECT value FROM settings WHERE key='plex_device_privkey'").fetchone()
        kid_row = conn.execute("SELECT value FROM settings WHERE key='plex_device_kid'").fetchone()
    if priv_row and kid_row:
        priv = serialization.load_pem_private_key(priv_row["value"].encode(), password=None)
        return priv, kid_row["value"]
    priv = Ed25519PrivateKey.generate()
    pem = priv.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    kid = str(uuid.uuid4())
    with get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_device_privkey', ?)", (pem,))
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_device_kid', ?)", (kid,))
    return priv, kid

def _device_public_jwk(priv, kid: str) -> dict:
    from cryptography.hazmat.primitives import serialization
    raw = priv.public_key().public_bytes(
        encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw)
    return {"kty": "OKP", "crv": "Ed25519", "x": _b64url(raw), "kid": kid, "alg": "EdDSA"}

def _sign_device_jwt(priv, kid: str, client_id: str) -> str:
    """Build a compact EdDSA JWT signed with the device private key."""
    import json as _json
    header = {"alg": "EdDSA", "typ": "JWT", "kid": kid}
    payload = {"aud": "plex.tv", "iss": client_id}
    signing_input = "{}.{}".format(
        _b64url(_json.dumps(header, separators=(",", ":")).encode()),
        _b64url(_json.dumps(payload, separators=(",", ":")).encode()),
    )
    sig = priv.sign(signing_input.encode())
    return f"{signing_input}.{_b64url(sig)}"

def _extract_auth_token(resp) -> str | None:
    """Pull an auth token out of a plex.tv PIN/refresh response (JSON or XML)."""
    if "json" in resp.headers.get("content-type", ""):
        try:
            d = resp.json()
            return d.get("authToken") or d.get("auth_token") or d.get("token") or d.get("jwt")
        except Exception:
            pass
    import re
    text = resp.text or ""
    m = re.search(r'authToken="([^"]+)"', text) or re.search(r"<authToken>([^<]+)</authToken>", text)
    return m.group(1) if m else None

def _store_jwt_token(token: str) -> None:
    import time as _t
    with get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_token', ?)", (token,))
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_auth_mode', 'jwt')")
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_token_issued_at', ?)", (str(int(_t.time())),))

@app.get("/api/plex/libraries")
async def plex_libraries():
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured — open Settings")
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{url}/library/sections", headers=plex_headers(token))
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "Plex error")
    data = resp.json()
    dirs = data.get("MediaContainer", {}).get("Directory", [])
    return [{"id": d["key"], "title": d["title"], "type": d["type"]} for d in dirs
            if d["type"] in ("movie", "show")]

@app.get("/api/plex/library/{section_id}")
async def plex_library(section_id: str, type_filter: str = Query("all"),
                        genre: str | None = Query(None), year: int | None = Query(None),
                        content_rating: str | None = Query(None)):
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured — open Settings")
    params = {}
    if genre:
        params["genre"] = genre
    if year:
        params["year"] = str(year)
    if content_rating:
        params["contentRating"] = content_rating
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{url}/library/sections/{section_id}/all",
            headers=plex_headers(token),
            params=params,
        )
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "Plex error")
    items = resp.json().get("MediaContainer", {}).get("Metadata", [])
    return _format_items(items, type_filter)

@app.get("/api/plex/library/{section_id}/filters")
async def plex_library_filters(section_id: str):
    """Return available filter values (genres, years, content ratings) for a library."""
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    result = {"genres": [], "years": [], "content_ratings": []}
    async with httpx.AsyncClient(timeout=15) as client:
        for facet, key in [("genre", "genres"), ("year", "years"), ("contentRating", "content_ratings")]:
            try:
                r = await client.get(f"{url}/library/sections/{section_id}/{facet}", headers=hdrs)
                if r.status_code == 200:
                    dirs = r.json().get("MediaContainer", {}).get("Directory", [])
                    result[key] = [d.get("title") or d.get("key") for d in dirs if d.get("title") or d.get("key")]
            except Exception:
                pass
    return result

@app.get("/api/plex/search")
async def plex_search(q: str = Query(..., min_length=1), type_filter: str = Query("all")):
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured — open Settings")
    hdrs = plex_headers(token)
    async with httpx.AsyncClient(timeout=15) as client:
        # Try /library/search first (older Plex)
        resp = await client.get(f"{url}/library/search", params={"query": q, "limit": 50}, headers=hdrs)
        if resp.status_code == 200:
            items = resp.json().get("MediaContainer", {}).get("Metadata", [])
            if items:
                return _format_items(items, type_filter)
        # Fall back to /hubs/search (newer Plex — returns results in Hub objects)
        resp2 = await client.get(f"{url}/hubs/search", params={"query": q, "limit": 50}, headers=hdrs)
        if resp2.status_code == 200:
            hubs = resp2.json().get("MediaContainer", {}).get("Hub", [])
            items = []
            for hub in hubs:
                items.extend(hub.get("Metadata", []) or [])
            if items:
                return _format_items(items, type_filter)
    return []

def _format_items(items: list, type_filter: str) -> list:
    out = []
    for m in items:
        t = m.get("type", "")
        if t not in ("movie", "show"):
            continue
        if type_filter == "movie" and t != "movie":
            continue
        if type_filter == "show" and t != "show":
            continue
        out.append({
            "rating_key": m.get("ratingKey"),
            "title": m.get("title"),
            "type": t,
            "year": m.get("year"),
            "thumb": m.get("thumb"),
            "summary": (m.get("summary") or "")[:200],
            "genres": [g.get("tag") for g in m.get("Genre", []) if g.get("tag")],
            "content_rating": m.get("contentRating"),
            "user_rating": m.get("userRating"),
        })
    return out

@app.get("/api/plex/item/{rating_key}")
async def plex_item(rating_key: str):
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{url}/library/metadata/{rating_key}", headers=hdrs)
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "Plex error")
    meta = resp.json().get("MediaContainer", {}).get("Metadata", [])
    if not meta:
        raise HTTPException(404, "Item not found")
    m = meta[0]
    dur = m.get("duration")
    # Extract media quality info
    media = (m.get("Media") or [{}])[0] if m.get("Media") else {}
    media_info = None
    subtitles = []
    if media:
        media_info = {
            "resolution": media.get("videoResolution"),
            "video_codec": media.get("videoCodec"),
            "audio_codec": media.get("audioCodec"),
            "audio_channels": media.get("audioChannels"),
            "bitrate": media.get("bitrate"),
            "container": media.get("container"),
        }
        # Extract subtitle languages from streams
        parts = media.get("Part", [])
        if parts:
            for stream in parts[0].get("Stream", []):
                if stream.get("streamType") == 3:  # subtitle stream
                    lang = stream.get("language") or stream.get("languageCode") or stream.get("displayTitle")
                    if lang and lang not in subtitles:
                        subtitles.append(lang)

    # Build Plex web URL for playback
    plex_web_url = None
    try:
        async with httpx.AsyncClient(timeout=5) as mc:
            idr = await mc.get(f"{url}/identity", headers=hdrs)
            if idr.status_code == 200:
                machine_id = idr.json().get("MediaContainer", {}).get("machineIdentifier", "")
                if machine_id:
                    plex_web_url = f"https://app.plex.tv/desktop#!/server/{machine_id}/details?key=%2Flibrary%2Fmetadata%2F{rating_key}&context=library%3Acontent.library"
                    log.info("Plex web URL for %s: machineId=%s ratingKey=%s url=%s", m.get("title"), machine_id, rating_key, plex_web_url)
    except Exception as e:
        log.warning("Failed to build Plex web URL: %s", e)

    return {
        "rating_key": m.get("ratingKey"),
        "title": m.get("title"),
        "type": m.get("type"),
        "year": m.get("year"),
        "thumb": m.get("thumb"),
        "summary": (m.get("summary") or "")[:500],
        "duration_ms": dur,
        "duration_minutes": round(dur / 60000) if dur else None,
        "studio": m.get("studio"),
        "content_rating": m.get("contentRating"),
        "child_count": m.get("childCount"),
        "leaf_count": m.get("leafCount"),
        "genres": [g.get("tag") for g in m.get("Genre", []) if g.get("tag")],
        "user_rating": m.get("userRating"),
        "audience_rating": m.get("audienceRating"),
        "rating": m.get("rating"),
        "originally_available_at": m.get("originallyAvailableAt"),
        "media_info": media_info,
        "subtitles": subtitles,
        "plex_web_url": plex_web_url,
    }

@app.get("/api/plex/stream/{rating_key}")
async def plex_stream_url(rating_key: str):
    """Return playback URLs for a Plex item (web app + direct server).
    Works for movies, episodes, and any playable content."""
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    # Get machine ID for web URL
    machine_id = ""
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            idr = await client.get(f"{url}/identity", headers=hdrs)
            if idr.status_code == 200:
                machine_id = idr.json().get("MediaContainer", {}).get("machineIdentifier", "")
        except Exception:
            pass

    # Plex web app URL — works from anywhere (local + remote), opens in browser
    plex_web_url = f"https://app.plex.tv/desktop#!/server/{machine_id}/details?key=%2Flibrary%2Fmetadata%2F{rating_key}&context=library%3Acontent.library" if machine_id else None

    return {
        "plex_web": plex_web_url,
        "rating_key": rating_key,
    }

@app.get("/api/plex/show/{rating_key}/seasons")
async def plex_show_seasons(rating_key: str):
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{url}/library/metadata/{rating_key}/children", headers=hdrs)
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "Plex error")
    items = resp.json().get("MediaContainer", {}).get("Metadata", []) or []
    return [
        {"rating_key": s.get("ratingKey"), "title": s.get("title"),
         "index": s.get("index"), "leaf_count": s.get("leafCount"), "thumb": s.get("thumb")}
        for s in items if s.get("type") == "season"
    ]

@app.get("/api/plex/season/{rating_key}/episodes")
async def plex_season_episodes(rating_key: str):
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(f"{url}/library/metadata/{rating_key}/children", headers=hdrs)
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "Plex error")
    items = resp.json().get("MediaContainer", {}).get("Metadata", []) or []
    return [
        {
            "rating_key": e.get("ratingKey"),
            "title": e.get("title"),
            "index": e.get("index"),
            "season_number": e.get("parentIndex"),
            "thumb": e.get("thumb") or e.get("grandparentThumb"),
            "duration_minutes": round(e["duration"] / 60000) if e.get("duration") else None,
            "summary": (e.get("summary") or "")[:200],
        }
        for e in items if e.get("type") == "episode"
    ]

@app.get("/api/plex/collections/{rating_key}/items")
async def plex_collection_items(rating_key: str):
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{url}/library/collections/{rating_key}/children", headers=hdrs)
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "Plex error")
    items = resp.json().get("MediaContainer", {}).get("Metadata", []) or []
    return _format_items(items, "all")

@app.post("/api/plex/test")
async def plex_test():
    """Test Plex connection and return server/account info."""
    import time as _t
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    t0 = _t.monotonic()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{url}/", headers=plex_headers(token))
        ms = int((_t.monotonic() - t0) * 1000)
        if r.status_code != 200:
            raise HTTPException(502, f"Plex returned {r.status_code}")
        mc = r.json().get("MediaContainer", {})
        return {
            "ok": True,
            "latency_ms": ms,
            "server_name": mc.get("friendlyName", ""),
            "version": mc.get("version", ""),
            "platform": mc.get("platform", ""),
            "username": mc.get("myPlexUsername", ""),
            "plex_pass": bool(mc.get("myPlexSubscription")),
            "machine_id": mc.get("machineIdentifier", ""),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Cannot reach Plex: {e}")

# ── Plex server info & library stats ─────────────────────────────────────────

@app.get("/api/plex/server-info")
async def plex_server_info():
    """Return Plex server metadata and library summary."""
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{url}/", headers=hdrs)
        if r.status_code != 200:
            raise HTTPException(502, f"Plex returned {r.status_code}")
        mc = r.json().get("MediaContainer", {})
        # Also get library counts
        sec_resp = await client.get(f"{url}/library/sections", headers=hdrs)
        sections = sec_resp.json().get("MediaContainer", {}).get("Directory", []) if sec_resp.status_code == 200 else []
    libs = [{"id": s["key"], "title": s["title"], "type": s["type"]} for s in sections if s.get("type") in ("movie", "show")]
    return {
        "server_name": mc.get("friendlyName", ""),
        "version": mc.get("version", ""),
        "platform": mc.get("platform", ""),
        "username": mc.get("myPlexUsername", ""),
        "plex_pass": bool(mc.get("myPlexSubscription")),
        "machine_id": mc.get("machineIdentifier", ""),
        "library_count": len(libs),
        "libraries": libs,
    }

@app.get("/api/plex/library-stats")
async def plex_library_stats():
    """Return item counts per library section."""
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    stats = []
    async with httpx.AsyncClient(timeout=30) as client:
        sec_resp = await client.get(f"{url}/library/sections", headers=hdrs)
        if sec_resp.status_code != 200:
            raise HTTPException(502, "Could not fetch Plex libraries")
        sections = sec_resp.json().get("MediaContainer", {}).get("Directory", [])
        for s in sections:
            if s.get("type") not in ("movie", "show"):
                continue
            r = await client.get(f"{url}/library/sections/{s['key']}/all", headers=hdrs, params={"X-Plex-Container-Start": "0", "X-Plex-Container-Size": "0"})
            total = 0
            if r.status_code == 200:
                total = r.json().get("MediaContainer", {}).get("totalSize", r.json().get("MediaContainer", {}).get("size", 0))
            stats.append({
                "id": s["key"],
                "title": s["title"],
                "type": s["type"],
                "total_items": total,
            })
    return stats

@app.get("/api/plex/recently-added")
async def plex_recently_added(limit: int = Query(20)):
    """Return recently added items across all libraries."""
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    items = []
    async with httpx.AsyncClient(timeout=15) as client:
        sec_resp = await client.get(f"{url}/library/sections", headers=hdrs)
        if sec_resp.status_code != 200:
            raise HTTPException(502, "Could not fetch Plex libraries")
        sections = sec_resp.json().get("MediaContainer", {}).get("Directory", [])
        for s in sections:
            if s.get("type") not in ("movie", "show"):
                continue
            r = await client.get(
                f"{url}/library/sections/{s['key']}/recentlyAdded",
                headers=hdrs,
                params={"X-Plex-Container-Size": str(limit)},
            )
            if r.status_code == 200:
                for m in r.json().get("MediaContainer", {}).get("Metadata", []) or []:
                    t = m.get("type", "")
                    if t not in ("movie", "show"):
                        continue
                    items.append({
                        "rating_key": m.get("ratingKey"),
                        "title": m.get("title"),
                        "type": t,
                        "year": m.get("year"),
                        "thumb": m.get("thumb"),
                        "added_at": m.get("addedAt"),
                    })
    # Sort by added_at desc, take top N
    items.sort(key=lambda x: x.get("added_at") or 0, reverse=True)
    return items[:limit]

@app.get("/api/plex/on-deck")
async def plex_on_deck(limit: int = Query(20)):
    """Return on-deck (continue watching) items from Plex."""
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{url}/library/onDeck", headers=hdrs,
                             params={"X-Plex-Container-Size": str(limit)})
        if r.status_code != 200:
            return []
    items = []
    for m in r.json().get("MediaContainer", {}).get("Metadata", []) or []:
        items.append({
            "rating_key": m.get("ratingKey"),
            "title": m.get("grandparentTitle") or m.get("title"),
            "subtitle": m.get("title") if m.get("grandparentTitle") else None,
            "type": m.get("type", ""),
            "year": m.get("year"),
            "thumb": m.get("grandparentThumb") or m.get("thumb"),
            "added_at": m.get("addedAt"),
        })
    return items[:limit]

@app.get("/api/plex/popular")
async def plex_popular(limit: int = Query(30)):
    """Return most-watched items across all movie and show libraries."""
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    items = []
    async with httpx.AsyncClient(timeout=15) as client:
        sec_resp = await client.get(f"{url}/library/sections", headers=hdrs)
        if sec_resp.status_code != 200:
            return []
        sections = sec_resp.json().get("MediaContainer", {}).get("Directory", [])
        for s in sections:
            if s.get("type") not in ("movie", "show"):
                continue
            r = await client.get(
                f"{url}/library/sections/{s['key']}/all",
                headers=hdrs,
                params={"sort": "viewCount:desc", "X-Plex-Container-Size": str(limit)},
            )
            if r.status_code == 200:
                for m in r.json().get("MediaContainer", {}).get("Metadata", []) or []:
                    vc = m.get("viewCount", 0)
                    if not vc:
                        continue
                    items.append({
                        "rating_key": m.get("ratingKey"),
                        "title": m.get("title"),
                        "type": m.get("type", ""),
                        "year": m.get("year"),
                        "thumb": m.get("thumb"),
                        "view_count": vc,
                    })
    items.sort(key=lambda x: x.get("view_count", 0), reverse=True)
    return items[:limit]

@app.post("/api/plex/auth/start")
async def plex_auth_start():
    """Request a PIN from plex.tv and return the auth URL for the popup."""
    client_id = _get_client_id()
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{PLEX_TV}/api/v2/pins",
            params={"strong": "true"},
            headers=_plex_client_headers(),
        )
    if resp.status_code not in (200, 201):
        raise HTTPException(502, f"plex.tv error: {resp.status_code}")
    data = resp.json()
    pin_id = data["id"]
    pin_code = data["code"]
    # Store pin_id so status endpoint can retrieve it without a param
    with get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('pending_pin_id', ?)", (str(pin_id),))
    auth_url = (
        f"https://app.plex.tv/auth#"
        f"?clientID={client_id}"
        f"&code={pin_code}"
        f"&context[device][product]={APP_NAME}"
    )
    return {"pin_id": pin_id, "auth_url": auth_url}


@app.get("/api/plex/auth/status")
async def plex_auth_status():
    """Poll plex.tv for the pending PIN. Saves token to DB when fulfilled."""
    with get_db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key='pending_pin_id'").fetchone()
    if not row:
        raise HTTPException(400, "No pending auth — call /start first")
    pin_id = row["value"]
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{PLEX_TV}/api/v2/pins/{pin_id}",
            headers=_plex_client_headers(),
        )
    if resp.status_code != 200:
        raise HTTPException(502, f"plex.tv error: {resp.status_code}")
    data = resp.json()
    token = data.get("authToken")
    if token:
        with get_db() as conn:
            conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_token', ?)", (token,))
            conn.execute("DELETE FROM settings WHERE key='pending_pin_id'")
        return {"done": True}
    return {"done": False}


@app.post("/api/plex/auth/jwt/start")
async def plex_jwt_start():
    """Begin modern JWT/JWK auth: register the device public key and request a PIN.

    Unlike the legacy flow this needs no pre-existing token — the JWK in the PIN
    request bootstraps trust. Returns the same kind of auth_url popup target.
    """
    try:
        priv, kid = _get_device_keypair()
    except ModuleNotFoundError:
        raise HTTPException(501, "JWT auth requires the 'cryptography' package — rebuild the image")
    client_id = _get_client_id()
    jwk = _device_public_jwk(priv, kid)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{PLEX_CLIENTS}/api/v2/pins",
            json={"jwk": jwk, "strong": True},
            headers=_plex_client_headers(),
        )
    if resp.status_code not in (200, 201):
        raise HTTPException(502, f"plex.tv JWT enroll error: {resp.status_code} {resp.text[:200]}")
    data = resp.json()
    pin_id, pin_code = data["id"], data["code"]
    with get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('pending_jwt_pin_id', ?)", (str(pin_id),))
    auth_url = (
        f"https://app.plex.tv/auth#"
        f"?clientID={client_id}"
        f"&code={pin_code}"
        f"&context[device][product]={APP_NAME}"
    )
    return {"pin_id": pin_id, "auth_url": auth_url, "mode": "jwt"}


@app.get("/api/plex/auth/jwt/status")
async def plex_jwt_status():
    """Poll the pending JWT PIN, signing a deviceJWT to prove key possession."""
    with get_db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key='pending_jwt_pin_id'").fetchone()
    if not row:
        raise HTTPException(400, "No pending JWT auth — call /jwt/start first")
    pin_id = row["value"]
    priv, kid = _get_device_keypair()
    device_jwt = _sign_device_jwt(priv, kid, _get_client_id())
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{PLEX_CLIENTS}/api/v2/pins/{pin_id}",
            params={"deviceJWT": device_jwt},
            headers=_plex_client_headers(),
        )
    if resp.status_code != 200:
        raise HTTPException(502, f"plex.tv error: {resp.status_code}")
    token = _extract_auth_token(resp)
    if token:
        _store_jwt_token(token)
        with get_db() as conn:
            conn.execute("DELETE FROM settings WHERE key='pending_jwt_pin_id'")
        return {"done": True, "mode": "jwt"}
    return {"done": False}


@app.post("/api/plex/auth/jwt/refresh")
async def plex_jwt_refresh():
    """Mint a fresh token using the device key (tokens last ~7 days)."""
    priv, kid = _get_device_keypair()
    device_jwt = _sign_device_jwt(priv, kid, _get_client_id())
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{PLEX_CLIENTS}/api/v2/auth/token",
            headers={**_plex_client_headers(), "Authorization": f"Bearer {device_jwt}"},
        )
    if resp.status_code != 200:
        raise HTTPException(502, f"plex.tv refresh error: {resp.status_code} {resp.text[:200]}")
    token = _extract_auth_token(resp)
    if not token:
        raise HTTPException(502, "plex.tv refresh returned no token")
    _store_jwt_token(token)
    return {"ok": True, "mode": "jwt"}


@app.get("/api/plex/auth/info")
def plex_auth_info():
    """Report the active Plex auth mode + token age so the UI can prompt to refresh."""
    import time as _t
    with get_db() as conn:
        rows = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings")}
    mode = rows.get("plex_auth_mode", "legacy")
    issued = rows.get("plex_token_issued_at")
    age_days = round((int(_t.time()) - int(issued)) / 86400, 1) if issued else None
    # Plex JWT tokens last ~7 days; surface a refresh hint as we approach that.
    needs_refresh = bool(mode == "jwt" and age_days is not None and age_days >= 6)
    return {
        "mode": mode,
        "has_token": bool(rows.get("plex_token")),
        "token_age_days": age_days,
        "needs_refresh": needs_refresh,
    }


@app.get("/api/plex/collections")
async def plex_collections():
    """Fetch all collections from all Plex library sections."""
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured — open Settings")
    hdrs = plex_headers(token)
    async with httpx.AsyncClient(timeout=20) as client:
        sec_resp = await client.get(f"{url}/library/sections", headers=hdrs)
        if sec_resp.status_code != 200:
            raise HTTPException(502, "Could not fetch Plex libraries")
        sections = sec_resp.json()["MediaContainer"].get("Directory", [])
        result = []
        for section in sections:
            if section["type"] not in ("movie", "show"):
                continue
            cr = await client.get(
                f"{url}/library/sections/{section['key']}/collections",
                headers=hdrs,
            )
            if cr.status_code != 200:
                continue
            for c in cr.json().get("MediaContainer", {}).get("Metadata", []) or []:
                result.append({
                    "rating_key": c.get("ratingKey"),
                    "title": c.get("title"),
                    "type": section["type"],
                    "thumb": c.get("thumb"),
                    "child_count": int(c.get("childCount", c.get("leafCount", 0))),
                    "smart": bool(int(c.get("smart", 0) or 0)),
                    "section_id": section["key"],
                })
    return result


@app.get("/api/channel-collections/{channel_number}")
def get_channel_collections(channel_number: int):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM channel_collections WHERE channel_number=?", (channel_number,)
        ).fetchall()
    result = {}
    for r in rows:
        d = dict(r)
        # Normalize so the UI can always branch on these, even for rows written
        # before the columns existed.
        d["source"] = d.get("source") or "owned"
        d["is_smart"] = int(d.get("is_smart") or 0)
        # Whether Linearr created the Plex collection itself. The UI gates the
        # destructive smart-collection actions on this: Plex cannot read a smart
        # collection's rules back, so "Edit filters…" opens BLANK and replacing
        # from it would wipe a user's own rules.
        d["linearr_created"] = int(d.get("linearr_created") or 0)
        result[d["plex_type"]] = d
    return result


def _write_assigned_slot(channel_number: int, plex_type: str, rating_key: str,
                         title: str, is_smart: bool, linearr_created: bool = False) -> None:
    """Point a channel's (type) slot at an existing collection, by REFERENCE.

    Writes `source='assigned'`, `managed=0` — Linearr records that the channel
    uses this collection and never reads or edits its members. `UNIQUE(channel_
    number, plex_type)` means assigning replaces whatever held the slot.

    `linearr_created` is True only on the create-and-assign path, where Linearr
    itself built the collection in Plex. It gates the destructive smart-
    collection actions ("Edit filters…" replaces the rules from a blank form —
    Plex cannot read them back — and "Delete collection" is permanent), and it
    is deliberately reset on every write: re-pointing a slot at a different
    collection must never inherit the previous one's provenance.
    """
    with get_db() as conn:
        conn.execute(
            """INSERT INTO channel_collections
                 (channel_number, plex_type, collection_rating_key, collection_title,
                  managed, source, is_smart, linearr_created)
               VALUES (?, ?, ?, ?, 0, 'assigned', ?, ?)
               ON CONFLICT(channel_number, plex_type) DO UPDATE SET
                   collection_rating_key=excluded.collection_rating_key,
                   collection_title=excluded.collection_title,
                   managed=0,
                   source='assigned',
                   is_smart=excluded.is_smart,
                   linearr_created=excluded.linearr_created""",
            (channel_number, plex_type, str(rating_key), title,
             1 if is_smart else 0, 1 if linearr_created else 0),
        )


@app.post("/api/channel-collections/{channel_number}/assign", status_code=200)
def assign_channel_collection(channel_number: int, body: ChannelCollectionAssignIn):
    """Assign an existing Plex collection to a channel BY REFERENCE.

    Reference only: this records that the channel uses the collection. It makes
    no Plex call at all — the collection's members are never read, copied into
    `assignments`, or modified. (Contrast `POST /api/channel-collections/{n}`,
    which imports a collection's items into assignments, and
    `generate_collections`, which builds and manages Linearr's own
    '{Channel} Movies/TV' collections.)

    One active source per type: assigning replaces whatever was in that slot.

    The two owned names ('{Channel} Movies' / '{Channel} TV') are RESERVED and
    rejected: generation resolves its target purely by name, so a collection
    assigned under an owned name would be found, adopted and — on the second
    build — pruned down to the channel's assignments. (`linearr_created` is the
    second, rename-proof half of that guard.)
    """
    if body.plex_type not in _COLLECTION_SUFFIX:
        raise HTTPException(400, "plex_type must be 'movie' or 'show'")
    ch = _get_channel(channel_number)
    if not ch:
        raise HTTPException(404, "Channel not found")
    if _is_owned_title(body.collection_title, ch.get("name") or ""):
        raise HTTPException(
            400,
            f"'{body.collection_title}' is reserved for the collection Linearr "
            f"generates for this channel — assigning it would let a later build "
            f"rewrite its contents. Rename the collection in Plex first, then "
            f"assign it.",
        )
    _write_assigned_slot(channel_number, body.plex_type, body.collection_rating_key,
                         body.collection_title, body.is_smart)
    _log_app("collection", f"Assigned collection '{body.collection_title}' to ch {channel_number}",
             metadata={"channel": channel_number, "plex_type": body.plex_type,
                       "rating_key": body.collection_rating_key, "is_smart": body.is_smart})
    return {"ok": True, "channel_number": channel_number, "plex_type": body.plex_type,
            "collection_rating_key": str(body.collection_rating_key),
            "collection_title": body.collection_title,
            "source": "assigned", "is_smart": 1 if body.is_smart else 0,
            "linearr_created": 0}


@app.post("/api/channel-collections/{channel_number}", status_code=200)
async def link_channel_collection(channel_number: int, body: ChannelCollectionIn):
    """Add all items from an existing Plex collection to a channel's assignments.

    SOURCE action only: it copies items in. It deliberately does NOT mark the
    picked collection as the channel's managed target — Linearr manages its own
    '{Channel} Movies/TV' collections (see generate_collections), so a user's own
    collection can never be pruned.
    """
    added = 0
    skipped = 0
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{url}/library/collections/{body.collection_rating_key}/children", headers=hdrs,
        )
    if resp.status_code == 200:
        items = resp.json().get("MediaContainer", {}).get("Metadata", []) or []
        with get_db() as conn:
            for m in items:
                t = m.get("type", "")
                if t not in ("movie", "show"):
                    continue
                try:
                    conn.execute(
                        """INSERT INTO assignments
                           (channel_number, plex_rating_key, plex_title, plex_type, plex_thumb, plex_year)
                           VALUES (?, ?, ?, ?, ?, ?)""",
                        (channel_number, m.get("ratingKey"), m.get("title"), t, m.get("thumb"), m.get("year")),
                    )
                    added += 1
                except sqlite3.IntegrityError:
                    skipped += 1
    _log_app("assignment", f"Added {added} items from collection to ch {channel_number}")
    return {"added": added, "skipped": skipped}


@app.delete("/api/channel-collections/{channel_number}/{plex_type}")
def unlink_channel_collection(channel_number: int, plex_type: str):
    with get_db() as conn:
        cur = conn.execute(
            "DELETE FROM channel_collections WHERE channel_number=? AND plex_type=?",
            (channel_number, plex_type),
        )
    if cur.rowcount == 0:
        raise HTTPException(404, "Not found")
    _log_app("assignment", f"Unlinked {plex_type} collection from ch {channel_number}",
             metadata={"channel": channel_number, "plex_type": plex_type})
    return {"ok": True}


@app.get("/api/collections/status/{channel_number}")
async def collection_status(channel_number: int):
    """Check whether Plex collections already exist for a channel."""
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")

    ch = _get_channel(channel_number)
    if not ch:
        raise HTTPException(404, "Channel not found")

    with get_db() as conn:
        rows = conn.execute(
            "SELECT plex_type FROM assignments WHERE channel_number=?", (channel_number,)
        ).fetchall()
        linked = {r["plex_type"]: dict(r) for r in conn.execute(
            "SELECT * FROM channel_collections WHERE channel_number=?", (channel_number,)
        ).fetchall()}

    movie_count = sum(1 for r in rows if r["plex_type"] == "movie")
    show_count  = sum(1 for r in rows if r["plex_type"] == "show")
    hdrs = plex_headers(token)

    async with httpx.AsyncClient(timeout=15) as client:
        sec_resp = await client.get(f"{url}/library/sections", headers=hdrs)
        if sec_resp.status_code != 200:
            raise HTTPException(502, "Could not fetch Plex libraries")
        sections = sec_resp.json()["MediaContainer"].get("Directory", [])
        movie_section = next((s for s in sections if s["type"] == "movie"), None)
        show_section  = next((s for s in sections if s["type"] == "show"),  None)

        result = {}
        for key, section, suffix, assigned in [
            ("movie", movie_section, "Movies", movie_count),
            ("show",  show_section,  "TV",     show_count),
        ]:
            link = linked.get(key)
            coll_name = link["collection_title"] if link else f"{ch['name']} {suffix}"
            coll_rk   = link["collection_rating_key"] if link else None
            entry = {"name": coll_name, "exists": False, "plex_count": 0,
                     "assigned_count": assigned, "linked": bool(link)}
            if section:
                if coll_rk:
                    # Check by rating key directly
                    ir = await client.get(f"{url}/library/collections/{coll_rk}", headers=hdrs)
                    if ir.status_code == 200:
                        meta = ir.json().get("MediaContainer", {}).get("Metadata", [])
                        if meta:
                            entry["exists"] = True
                            entry["plex_count"] = int(meta[0].get("childCount", meta[0].get("leafCount", 0)))
                else:
                    cr = await client.get(
                        f"{url}/library/sections/{section['key']}/collections",
                        headers=hdrs,
                    )
                    if cr.status_code == 200:
                        colls = cr.json().get("MediaContainer", {}).get("Metadata", []) or []
                        match = next((c for c in colls if c.get("title") == coll_name), None)
                        if match:
                            entry["exists"] = True
                            entry["plex_count"] = int(match.get("childCount", match.get("leafCount", 0)))
            result[key] = entry

    return result


# ── Channel collection ownership helpers ──────────────────────────────────────
# Linearr only ever manages its OWN per-channel collections, named exactly like
# "{Channel} Movies" / "{Channel} TV". These names are the ownership signal: the
# generator never reads a stored rating key (which could point at a user's own
# collection) and never deletes from anything whose title isn't one of these.

_COLLECTION_SUFFIX = {"movie": "Movies", "show": "TV"}

def _owned_collection_name(channel_name: str, plex_type: str) -> str:
    suffix = _COLLECTION_SUFFIX.get(plex_type)
    if suffix is None:
        raise ValueError(f"Unsupported plex_type for collection: {plex_type}")
    return f"{channel_name} {suffix}"

def _is_owned_title(title: str, channel_name: str) -> bool:
    return title in (
        _owned_collection_name(channel_name, "movie"),
        _owned_collection_name(channel_name, "show"),
    )

def _collection_delta(desired: set[str], current: set[str], already_managed: bool) -> tuple[set[str], set[str]]:
    """Return (to_add, to_remove). On first touch (not yet managed) removals are
    suppressed — Linearr will only ADD, never strip items it didn't put there."""
    to_add = desired - current
    to_remove = (current - desired) if already_managed else set()
    return to_add, to_remove


@app.post("/api/collections/generate/{channel_number}")
async def generate_collections(channel_number: int):
    """Create or update Plex collections for a channel's assigned movies and shows.

    Linearr manages ONLY its own '{Channel} Movies' / '{Channel} TV' collections,
    resolved by name — never a user-linked collection. First touch of any
    collection is additive-only, so a user's own collection can never be pruned.

    If a type's slot currently holds an ASSIGNED collection (source='assigned'),
    generating switches that slot back to 'owned'. That is a DB-slot change
    only: the assigned collection is never read, added to, or pruned, because
    the target is still resolved purely by owned name.
    """
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured — open Settings")

    # 1. Load assignments for this channel
    with get_db() as conn:
        rows = conn.execute(
            "SELECT plex_rating_key, plex_type FROM assignments WHERE channel_number=?",
            (channel_number,)
        ).fetchall()

    if not rows:
        raise HTTPException(404, "No assignments for this channel")

    # Find channel name
    ch = _get_channel(channel_number)
    if not ch:
        raise HTTPException(404, "Channel not found")
    ch_name = ch["name"]

    # Split by type
    movie_keys = [r["plex_rating_key"] for r in rows if r["plex_type"] == "movie"]
    show_keys  = [r["plex_rating_key"] for r in rows if r["plex_type"] == "show"]
    log.info("generate_collections ch %s: %d movie + %d show assignments",
             channel_number, len(movie_keys), len(show_keys))

    hdrs = plex_headers(token)

    async with httpx.AsyncClient(timeout=30) as client:
        # 2. Get machine identifier
        id_resp = await client.get(f"{url}/identity", headers=hdrs)
        if id_resp.status_code != 200:
            raise HTTPException(502, "Could not reach Plex")
        machine_id = id_resp.json()["MediaContainer"]["machineIdentifier"]

        # 3. Get library sections
        sec_resp = await client.get(f"{url}/library/sections", headers=hdrs)
        if sec_resp.status_code != 200:
            raise HTTPException(502, "Could not fetch Plex libraries")
        sections = sec_resp.json()["MediaContainer"].get("Directory", [])
        movie_section = next((s for s in sections if s["type"] == "movie"), None)
        show_section  = next((s for s in sections if s["type"] == "show"),  None)

        result = {}

        for plex_type, keys, section, type_int in [
            ("movie", movie_keys, movie_section, 1),
            ("show",  show_keys,  show_section,  2),
        ]:
            if not keys:
                log.info("generate_collections ch %s: no %s assignments — skipping",
                         channel_number, plex_type)
                continue
            if not section:
                msg = f"No {plex_type} library found on Plex — {len(keys)} {plex_type} item(s) not synced"
                log.warning("generate_collections ch %s: %s", channel_number, msg)
                result[plex_type] = {"name": None, "created": False, "added": 0,
                                     "removed": 0, "total": len(set(keys)), "skipped": msg}
                continue

            section_id = section["key"]
            coll_name = _owned_collection_name(ch_name, plex_type)

            # 4a. Resolve target ONLY by owned name. Never trust a stored rating key
            # (it may point at one of the user's own collections).
            coll_resp = await client.get(
                f"{url}/library/sections/{section_id}/collections", headers=hdrs,
            )
            collections = []
            if coll_resp.status_code == 200:
                collections = coll_resp.json().get("MediaContainer", {}).get("Metadata", []) or []
            existing = next((c for c in collections if c.get("title") == coll_name), None)

            created = False
            if existing:
                coll_id = str(existing["ratingKey"])
                # Defensive: never manage a collection whose title isn't ours.
                if not _is_owned_title(existing.get("title", ""), ch_name):
                    raise HTTPException(500, f"Refusing to manage non-owned collection: {existing.get('title')}")
            else:
                create_resp = await client.post(
                    f"{url}/library/collections",
                    params={"type": type_int, "title": coll_name, "smart": 0, "sectionId": section_id},
                    headers=hdrs,
                )
                if create_resp.status_code not in (200, 201):
                    raise HTTPException(502, f"Failed to create collection: {coll_name}")
                coll_id = str(create_resp.json()["MediaContainer"]["Metadata"][0]["ratingKey"])
                created = True

            # 4b. Is this collection already managed by Linearr? (fresh-created => owned)
            #
            # Pruning requires ALL of: the same rating key as last time, a
            # managed slot, AND `linearr_created` — Linearr must have created
            # the Plex collection itself. The name check above is defeated by a
            # rename (a user's collection renamed to '{Channel} Movies' resolves
            # here), so provenance is the guard that actually holds: a
            # collection Linearr merely *adopted* by name stays additive-only
            # forever and can never lose the user's items.
            with get_db() as conn:
                prior = conn.execute(
                    "SELECT collection_rating_key, managed, linearr_created "
                    "FROM channel_collections WHERE channel_number=? AND plex_type=?",
                    (channel_number, plex_type),
                ).fetchone()
            same_collection = bool(prior and str(prior["collection_rating_key"]) == coll_id)
            prior_linearr_created = bool(
                same_collection and (prior["linearr_created"] or 0) == 1)
            linearr_created = created or prior_linearr_created
            already_managed = bool(
                created
                or (same_collection and prior["managed"] == 1 and prior_linearr_created)
            )

            # 4c. Current items
            items_resp = await client.get(
                f"{url}/library/collections/{coll_id}/children", headers=hdrs,
            )
            current_keys: set[str] = set()
            if items_resp.status_code == 200:
                for item in items_resp.json().get("MediaContainer", {}).get("Metadata", []) or []:
                    current_keys.add(str(item["ratingKey"]))

            desired_keys = {str(k) for k in keys}
            to_add, to_remove = _collection_delta(desired_keys, current_keys, already_managed)

            # 4d. Apply add
            added = 0
            for rk in to_add:
                uri = f"server://{machine_id}/com.plexapp.plugins.library/library/metadata/{rk}"
                add_resp = await client.put(
                    f"{url}/library/collections/{coll_id}/items", params={"uri": uri}, headers=hdrs,
                )
                if add_resp.status_code in (200, 201):
                    added += 1
                else:
                    log.warning("generate_collections ch %s: failed to add %s to '%s' (%s): %s",
                                channel_number, rk, coll_name, add_resp.status_code, add_resp.text[:200])

            # 4e. Apply remove (always empty on first touch — see _collection_delta)
            removed = 0
            for rk in to_remove:
                del_resp = await client.delete(
                    f"{url}/library/collections/{coll_id}/items", params={"items": rk}, headers=hdrs,
                )
                if del_resp.status_code in (200, 204):
                    removed += 1

            # 4f. Persist as managed (owned collection only).
            # If the slot currently holds an ASSIGNED collection, generating
            # switches it back to 'owned' — the intentional, documented way to
            # return to a Linearr-managed collection. Note this only rewrites
            # the DB slot: the assigned collection itself was never read or
            # edited above, because the target is resolved by NAME (4a).
            with get_db() as conn:
                conn.execute(
                    """INSERT INTO channel_collections
                       (channel_number, plex_type, collection_rating_key, collection_title,
                        managed, source, is_smart, linearr_created)
                       VALUES (?, ?, ?, ?, 1, 'owned', 0, ?)
                       ON CONFLICT(channel_number, plex_type) DO UPDATE SET
                           collection_rating_key=excluded.collection_rating_key,
                           collection_title=excluded.collection_title,
                           managed=1,
                           source='owned',
                           is_smart=0,
                           linearr_created=excluded.linearr_created""",
                    (channel_number, plex_type, coll_id, coll_name,
                     1 if linearr_created else 0),
                )

            log.info("generate_collections ch %s: %s '%s' +%d/-%d (%d desired, additive_only=%s)",
                     channel_number, plex_type, coll_name, added, removed, len(desired_keys), not already_managed)
            result[plex_type] = {
                "name": coll_name,
                "created": created,
                "added": added,
                "removed": removed,
                "total": len(desired_keys),
                "additive_only": not already_managed,
            }

    _log_app("collection", f"Built Plex collections for ch {channel_number}",
             metadata={"channel": channel_number,
                       "results": {pt: {"name": r.get("name"), "created": r.get("created"),
                                        "added": r.get("added"), "removed": r.get("removed"),
                                        "total": r.get("total")}
                                   for pt, r in result.items()}})

    # ── Auto-sync to Tunarr if a channel link exists ──────────────────────────
    tunarr_result: dict = {}
    try:
        with get_db() as conn:
            tunarr_link = conn.execute(
                "SELECT tunarr_id FROM tunarr_channel_links WHERE channel_number=?",
                (channel_number,)
            ).fetchone()

        if tunarr_link:
            tunarr_url = get_tunarr_url()
            # Reload fresh plex collections from DB (just saved above)
            with get_db() as conn:
                plex_cols = conn.execute(
                    "SELECT * FROM channel_collections WHERE channel_number=?", (channel_number,)
                ).fetchall()

            async with httpx.AsyncClient(timeout=15.0) as tc:
                version = await _fetch_tunarr_version(tc, tunarr_url)
                # Scan Tunarr's libraries FIRST (and wait) so the Plex collections
                # just created/updated exist as tags before the smart collections
                # that query those tags are written.
                scan_ok = await _tunarr_scan_libraries(tc, tunarr_url, wait=True)
                sc_path = _TUNARR_SC_PATH
                # Fetch existing Tunarr smart collections
                sr = await tc.get(f"{tunarr_url}{sc_path}")
                existing_sc = {sc["name"]: sc for sc in (sr.json() if sr.status_code == 200 else [])}

                created_sc, updated_sc = [], []
                for col in plex_cols:
                    col = dict(col)
                    sc_name = col["collection_title"]
                    structured = _tunarr_tags_filter(sc_name)
                    if sc_name in existing_sc:
                        sc = existing_sc[sc_name]
                        # Always re-write the structured search to ensure it's correct
                        await _tunarr_write_smart_collection(
                            tc, tunarr_url, sc_path, name=sc_name, structured=structured,
                            uuid=sc["uuid"], version=version)
                        updated_sc.append(sc_name)
                        with get_db() as conn:
                            conn.execute(
                                "INSERT OR REPLACE INTO tunarr_collection_links VALUES (?,?,?,?)",
                                (channel_number, col["plex_type"], sc["uuid"], sc_name)
                            )
                    else:
                        cr = await _tunarr_write_smart_collection(
                            tc, tunarr_url, sc_path, name=sc_name, structured=structured, version=version)
                        if cr is not None and cr.status_code in (200, 201):
                            sc = cr.json()
                            with get_db() as conn:
                                conn.execute(
                                    "INSERT OR REPLACE INTO tunarr_collection_links VALUES (?,?,?,?)",
                                    (channel_number, col["plex_type"], sc["uuid"], sc_name)
                                )
                            created_sc.append(sc_name)

            tunarr_result = {
                "synced": True,
                "smart_collections_created": created_sc,
                "smart_collections_updated": updated_sc,
                "library_scan_completed": scan_ok,
            }
            _log_app("tunarr", f"Tunarr auto-sync for ch {channel_number}: {len(created_sc)} created, {len(updated_sc)} updated",
                     metadata={"channel": channel_number, "created": created_sc, "updated": updated_sc,
                               "library_scan_completed": scan_ok})
    except Exception as e:
        tunarr_result = {"synced": False, "error": str(e)[:200]}

    return {**result, "tunarr": tunarr_result}


_THUMB_ALLOWED_PREFIXES = ("/library/", "/photo/", "/metadata/")

# In-memory LRU for transcoded thumbs: repeat navigations hit RAM instead of
# re-proxying Plex. Transcoded thumbs are ~10-30 KB, so 1500 entries ≈ 30-45 MB.
_THUMB_CACHE: "OrderedDict[tuple, tuple[str, bytes]]" = OrderedDict()
_THUMB_CACHE_MAX_ENTRIES = 1500
_THUMB_HEADERS = {
    "Cache-Control": "public, max-age=604800, immutable",
    "Vary": "Accept",
}

def _thumb_cache_get(key: tuple) -> "tuple[str, bytes] | None":
    val = _THUMB_CACHE.get(key)
    if val is not None:
        _THUMB_CACHE.move_to_end(key)
    return val

def _thumb_cache_put(key: tuple, content_type: str, body: bytes) -> None:
    _THUMB_CACHE[key] = (content_type, body)
    _THUMB_CACHE.move_to_end(key)
    while len(_THUMB_CACHE) > _THUMB_CACHE_MAX_ENTRIES:
        _THUMB_CACHE.popitem(last=False)

@app.get("/api/plex/thumb")
async def plex_thumb(path: str = Query(...), w: int = Query(240), h: int = Query(360)):
    # SSRF hardening: `path` is caller-controlled. Only allow Plex media/photo paths,
    # reject anything that could re-point the host (//, @, backslash, scheme), send the
    # token as a header (never appended to a user-influenced URL), and don't follow
    # redirects (an upstream 3xx must not bounce the token to an external host).
    path_only = path.split("?", 1)[0]
    if (not path.startswith("/") or path.startswith("//") or "://" in path
            or any(c in path for c in ("@", "\\"))
            or not path_only.startswith(_THUMB_ALLOWED_PREFIXES)):
        raise HTTPException(400, "Invalid thumb path")
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    # Clamp dimensions: keeps payloads small and stops cache-busting via
    # arbitrary size permutations.
    w = max(40, min(w, 1200))
    h = max(40, min(h, 1800))

    cache_key = (path, w, h)
    cached = _thumb_cache_get(cache_key)
    if cached is not None:
        content_type, body = cached
        return Response(content=body, media_type=content_type, headers=_THUMB_HEADERS)

    async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
        # Plex only resizes via its transcoder — the raw thumb path ignores
        # width/height and returns the FULL-SIZE poster (often 0.5–2 MB for a
        # 150px grid cell). Transcoded thumbs are ~10–30 KB.
        resp = await client.get(
            f"{url}/photo/:/transcode",
            headers=plex_headers(token),
            params={"url": path, "width": w, "height": h, "minSize": 1, "upscale": 1},
        )
        if resp.status_code != 200 or not resp.content:
            # Some art paths don't transcode — fall back to the raw image.
            resp = await client.get(f"{url}{path}", headers=plex_headers(token))
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "Plex thumb error")
    content_type = resp.headers.get("content-type", "image/jpeg")
    _thumb_cache_put(cache_key, content_type, resp.content)
    return Response(content=resp.content, media_type=content_type, headers=_THUMB_HEADERS)

@app.get("/api/plex/sessions")
async def plex_sessions():
    """Return active Plex streams/sessions."""
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{url}/status/sessions", headers=hdrs)
    if resp.status_code != 200:
        return []
    items = resp.json().get("MediaContainer", {}).get("Metadata", []) or []
    sessions = []
    for s in items:
        user = s.get("User", {})
        player = s.get("Player", {})
        media = (s.get("Media") or [{}])[0]
        transcode = s.get("TranscodeSession", {})
        sessions.append({
            "rating_key": str(s.get("ratingKey") or s.get("grandparentRatingKey", "")),
            "title": s.get("grandparentTitle") or s.get("title", ""),
            "subtitle": s.get("title") if s.get("grandparentTitle") else None,
            "type": s.get("type", ""),
            "thumb": s.get("grandparentThumb") or s.get("thumb"),
            "user": user.get("title", ""),
            "player": player.get("title", ""),
            "platform": player.get("platform", ""),
            "state": player.get("state", ""),
            "progress_pct": round(int(s.get("viewOffset", 0)) / max(int(s.get("duration", 1)), 1) * 100),
            "transcode": bool(transcode),
            "transcode_decision": transcode.get("transcodeHwDecoding", "") if transcode else "",
            "video_resolution": media.get("videoResolution", ""),
            "bandwidth_kbps": int(transcode.get("bandwidth", 0)) if transcode else None,
        })
    return sessions

@app.get("/api/plex/history")
async def plex_history(limit: int = Query(50)):
    """Return recent watch history."""
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{url}/status/sessions/history/all",
            headers=hdrs,
            params={"sort": "viewedAt:desc", "X-Plex-Container-Start": 0, "X-Plex-Container-Size": limit},
        )
    if resp.status_code != 200:
        return []
    items = resp.json().get("MediaContainer", {}).get("Metadata", []) or []
    return [{
        "rating_key": str(h.get("ratingKey", "")),
        "title": h.get("grandparentTitle") or h.get("title", ""),
        "subtitle": h.get("title") if h.get("grandparentTitle") else None,
        "type": h.get("type", ""),
        "thumb": h.get("grandparentThumb") or h.get("thumb"),
        "viewed_at": h.get("viewedAt"),
        "account_id": h.get("accountID"),
    } for h in items]

@app.get("/api/plex/playlists")
async def plex_playlists():
    """Return all Plex playlists."""
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{url}/playlists", headers=hdrs)
    if resp.status_code != 200:
        return []
    items = resp.json().get("MediaContainer", {}).get("Metadata", []) or []
    return [{
        "rating_key": str(p.get("ratingKey", "")),
        "title": p.get("title", ""),
        "type": p.get("playlistType", ""),
        "item_count": int(p.get("leafCount", 0)),
        "duration_ms": int(p.get("duration", 0)),
        "thumb": p.get("composite") or p.get("thumb"),
        "smart": bool(p.get("smart")),
    } for p in items]

@app.post("/api/plex/scan-library/{section_id}")
async def plex_scan_library(section_id: str):
    """Trigger a library scan/refresh for a Plex section."""
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{url}/library/sections/{section_id}/refresh", headers=hdrs)
    if resp.status_code not in (200, 202):
        raise HTTPException(resp.status_code, "Failed to trigger library scan")
    _log_app("plex", f"Triggered Plex library scan for section {section_id}", metadata={"section_id": section_id})
    return {"ok": True, "message": f"Library scan triggered for section {section_id}"}

class PlexRateIn(BaseModel):
    rating: float  # 0-10 (0 clears)

@app.put("/api/plex/item/{rating_key}/rate")
async def plex_rate_item(rating_key: str, body: PlexRateIn):
    """Set user rating for a Plex item (0 clears, 1-10 sets)."""
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    params = {
        "key": rating_key,
        "identifier": "com.plexapp.plugins.library",
        "rating": str(body.rating),
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.put(f"{url}/:/rate", headers=hdrs, params=params)
    if resp.status_code not in (200, 204):
        raise HTTPException(resp.status_code, "Failed to set rating")
    _log_app("plex", f"Rated item {rating_key}: {body.rating}", metadata={"rating_key": rating_key, "rating": body.rating})
    return {"ok": True}

@app.get("/api/plex/hubs")
async def plex_hubs():
    """Return Plex discovery hubs (Continue Watching, Recommended, etc.)."""
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(f"{url}/hubs", headers=hdrs)
    if resp.status_code != 200:
        return {"hubs": []}
    hubs_raw = resp.json().get("MediaContainer", {}).get("Hub", [])
    hubs = []
    for h in hubs_raw:
        items = []
        for m in h.get("Metadata", []) or []:
            t = m.get("type", "")
            if t not in ("movie", "show", "episode"):
                continue
            items.append({
                "rating_key": m.get("ratingKey"),
                "title": m.get("grandparentTitle") or m.get("title"),
                "subtitle": m.get("title") if m.get("grandparentTitle") else None,
                "type": "show" if t == "episode" else t,
                "year": m.get("year"),
                "thumb": m.get("grandparentThumb") or m.get("thumb"),
            })
        if items:
            hubs.append({
                "title": h.get("title", ""),
                "type": h.get("type", ""),
                "hub_key": h.get("hubKey", ""),
                "items": items,
            })
    return {"hubs": hubs}

@app.get("/api/plex/hubs/library/{section_id}")
async def plex_library_hubs(section_id: str):
    """Return library-specific Plex hubs."""
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(f"{url}/hubs/sections/{section_id}", headers=hdrs)
    if resp.status_code != 200:
        return {"hubs": []}
    hubs_raw = resp.json().get("MediaContainer", {}).get("Hub", [])
    hubs = []
    for h in hubs_raw:
        items = []
        for m in h.get("Metadata", []) or []:
            t = m.get("type", "")
            if t not in ("movie", "show", "episode"):
                continue
            items.append({
                "rating_key": m.get("ratingKey"),
                "title": m.get("grandparentTitle") or m.get("title"),
                "subtitle": m.get("title") if m.get("grandparentTitle") else None,
                "type": "show" if t == "episode" else t,
                "year": m.get("year"),
                "thumb": m.get("grandparentThumb") or m.get("thumb"),
            })
        if items:
            hubs.append({
                "title": h.get("title", ""),
                "type": h.get("type", ""),
                "hub_key": h.get("hubKey", ""),
                "items": items,
            })
    return {"hubs": hubs}

# ── Plex Webhooks ─────────────────────────────────────────────────────────────

@app.post("/api/plex/webhook")
async def plex_webhook(request: Request, token: str = Query("")):
    """Receive Plex webhook events. Requires Plex Pass on the Plex server side.
    Plex sends multipart/form-data with a 'payload' JSON field. The endpoint is
    unauthenticated by cookie (Plex can't log in), so it's gated by a shared ?token=
    secret — see plex_webhook_path in GET /api/settings for the URL to configure in Plex."""
    expected = _ensure_webhook_secret()
    if not hmac.compare_digest(token, expected):
        raise HTTPException(401, "Invalid webhook token")
    try:
        form = await request.form()
        payload_raw = form.get("payload", "")
        if not payload_raw:
            return {"ok": True}
        payload = json.loads(str(payload_raw))
        event_type = payload.get("event", "")
        if not event_type:
            return {"ok": True}

        metadata = payload.get("Metadata", {})
        account = payload.get("Account", {})
        player = payload.get("Player", {})

        rating_key = str(metadata.get("ratingKey", "")) if metadata.get("ratingKey") else None
        title = metadata.get("grandparentTitle") or metadata.get("title") or ""
        plex_type = metadata.get("type", "")
        if plex_type == "episode":
            plex_type = "show"
        user_name = account.get("title", "")
        player_title = player.get("title", "")

        with get_db() as conn:
            conn.execute(
                "INSERT INTO plex_events (event_type, rating_key, title, plex_type, user_name, player) VALUES (?,?,?,?,?,?)",
                (event_type, rating_key, title, plex_type, user_name, player_title),
            )
        _log_app("plex-webhook", f"{event_type}: {title}" + (f" by {user_name}" if user_name else ""))
    except Exception as e:
        log.warning("Plex webhook parse error: %s", e)
    # Always return 200 so Plex doesn't retry
    return {"ok": True}

@app.get("/api/plex/events")
def plex_events(event_type: str | None = Query(None), limit: int = Query(50)):
    """Return recent Plex webhook events."""
    with get_db() as conn:
        if event_type:
            rows = conn.execute(
                "SELECT * FROM plex_events WHERE event_type=? ORDER BY created_at DESC LIMIT ?",
                (event_type, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM plex_events ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
    return [dict(r) for r in rows]

@app.delete("/api/plex/events")
def clear_plex_events():
    """Clear all Plex webhook events."""
    with get_db() as conn:
        conn.execute("DELETE FROM plex_events")
    return {"ok": True}

# ── Plex Collection CRUD ─────────────────────────────────────────────────────

@app.post("/api/plex/collections")
async def plex_create_collection(request: Request):
    """Create a new Plex collection."""
    body = await request.json()
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    title = body.get("title", "")
    section_id = body.get("section_id", "")
    collection_type = body.get("type", "movie")
    if not title or not section_id:
        raise HTTPException(400, "title and section_id required")
    plex_type = "1" if collection_type == "movie" else "2"
    async with httpx.AsyncClient(timeout=10) as client:
        # Get machine ID for URI
        identity_r = await client.get(f"{url}/identity", headers=hdrs)
        machine_id = identity_r.json().get("MediaContainer", {}).get("machineIdentifier", "") if identity_r.status_code == 200 else ""
        resp = await client.post(
            f"{url}/library/collections",
            headers=hdrs,
            params={"type": plex_type, "title": title, "smart": "0", "sectionId": section_id},
        )
    if resp.status_code not in (200, 201):
        raise HTTPException(resp.status_code, f"Plex error: {resp.text[:200]}")
    coll = (resp.json().get("MediaContainer", {}).get("Metadata", [{}]) or [{}])[0]
    _log_app("collection", f"Created Plex collection '{title}'",
             metadata={"rating_key": coll.get("ratingKey"), "title": title, "type": collection_type, "section_id": section_id})
    return {
        "rating_key": coll.get("ratingKey"),
        "title": coll.get("title", title),
        "type": collection_type,
        "machine_id": machine_id,
    }

@app.delete("/api/plex/collections/{rating_key}")
async def plex_delete_collection(rating_key: str):
    """Delete a Plex collection."""
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.delete(f"{url}/library/collections/{rating_key}", headers=hdrs)
    if resp.status_code not in (200, 204):
        raise HTTPException(resp.status_code, "Failed to delete collection")
    # Clean up any channel_collections references
    with get_db() as conn:
        conn.execute("DELETE FROM channel_collections WHERE collection_rating_key=?", (rating_key,))
    _log_app("collection", f"Deleted Plex collection {rating_key}", level="warn", metadata={"rating_key": rating_key})
    return {"ok": True}

@app.put("/api/plex/collections/{rating_key}/items")
async def plex_add_collection_items(rating_key: str, request: Request):
    """Add items to a Plex collection."""
    body = await request.json()
    item_keys = body.get("items", [])
    if not item_keys:
        raise HTTPException(400, "items list required")
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    async with httpx.AsyncClient(timeout=10) as client:
        identity_r = await client.get(f"{url}/identity", headers=hdrs)
        machine_id = identity_r.json().get("MediaContainer", {}).get("machineIdentifier", "") if identity_r.status_code == 200 else ""
        if not machine_id:
            # Without the machine id every generated URI is malformed and every
            # PUT silently fails — report the real problem instead of ok/added:0.
            raise HTTPException(502, "Could not reach Plex to resolve the server identity")
        added = 0
        for rk in item_keys:
            uri = f"server://{machine_id}/com.plexapp.plugins.library/library/metadata/{rk}"
            resp = await client.put(
                f"{url}/library/collections/{rating_key}/items",
                headers=hdrs,
                params={"uri": uri},
            )
            if resp.status_code in (200, 201):
                added += 1
    _log_app("collection", f"Added {added}/{len(item_keys)} items to Plex collection {rating_key}",
             metadata={"collection": rating_key, "added": added, "requested": len(item_keys)})
    return {"ok": True, "added": added}

@app.delete("/api/plex/collections/{rating_key}/items/{item_key}")
async def plex_remove_collection_item(rating_key: str, item_key: str):
    """Remove an item from a Plex collection."""
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.delete(
            f"{url}/library/collections/{rating_key}/items/{item_key}",
            headers=hdrs,
        )
    if resp.status_code not in (200, 204):
        raise HTTPException(resp.status_code, "Failed to remove item")
    _log_app("collection", f"Removed item {item_key} from collection {rating_key}",
             metadata={"collection": rating_key, "item_key": item_key})
    return {"ok": True}

@app.put("/api/plex/collections/{rating_key}")
async def plex_update_collection(rating_key: str, request: Request):
    """Update a Plex collection's metadata (title, summary)."""
    body = await request.json()
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    params = {}
    if "title" in body:
        params["title.value"] = body["title"]
    if "summary" in body:
        params["summary.value"] = body["summary"]
    if not params:
        return {"ok": True}
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.put(f"{url}/library/metadata/{rating_key}", headers=hdrs, params=params)
    if resp.status_code not in (200, 204):
        raise HTTPException(resp.status_code, "Failed to update collection")
    _log_app("collection", f"Updated Plex collection {rating_key}",
             metadata={"rating_key": rating_key, "fields": [k.split(".")[0] for k in params]})
    return {"ok": True}

# ── Plex smart collections ────────────────────────────────────────────────────
# Rule-based, self-updating Plex collections (smart=1 + a filter URI), built on
# the same /library/collections API used above for regular collections.

class SmartCollectionFilters(BaseModel):
    genres: list[str] = []          # genre names, resolved to Plex tag IDs
    year_min: int | None = None     # inclusive
    year_max: int | None = None     # inclusive
    decade: int | None = None       # e.g. 1980
    unwatched: bool = False
    content_rating: str | None = None   # e.g. "PG", "TV-14"
    title_contains: str | None = None

class SmartCollectionIn(BaseModel):
    section_id: str
    type: str = "movie"             # movie | show
    title: str
    filters: SmartCollectionFilters = SmartCollectionFilters()
    sort: str | None = None         # title_asc|title_desc|year_asc|year_desc|added_desc|random
    limit: int | None = None

class SmartCollectionUpdateIn(BaseModel):
    section_id: str
    type: str = "movie"
    title: str | None = None
    filters: SmartCollectionFilters | None = None
    sort: str | None = None
    limit: int | None = None

_SMART_SORT = {
    "title_asc": "titleSort:asc", "title_desc": "titleSort:desc",
    "year_asc": "year:asc", "year_desc": "year:desc",
    "added_desc": "addedAt:desc", "random": "random",
}

async def _resolve_genre_ids(client, url: str, hdrs: dict, section_id: str,
                             type_int: str, names: list[str]) -> tuple[list[str], list[str]]:
    """Resolve genre names (case-insensitive) to Plex tag IDs for a section."""
    r = await client.get(f"{url}/library/sections/{section_id}/genre",
                         headers=hdrs, params={"type": type_int})
    dirs = r.json().get("MediaContainer", {}).get("Directory", []) if r.status_code == 200 else []
    by_name: dict[str, str] = {}
    for d in dirs:
        title = (d.get("title") or "").lower()
        key = str(d.get("key") or "")
        if "genre=" in key:  # some servers return a fastKey-style path
            key = key.split("genre=")[-1].split("&")[0]
        if title and key:
            by_name[title] = key
    ids, missing = [], []
    for n in names:
        k = by_name.get(n.strip().lower())
        (ids.append(k) if k else missing.append(n))
    return ids, missing

async def _build_smart_uri(client, url: str, hdrs: dict, section_id: str, plex_type: str,
                           filters: SmartCollectionFilters, sort: str | None,
                           limit: int | None) -> tuple[str, list[str]]:
    """Build a Plex smart-filter URI. Returns (uri, unresolved_genre_names)."""
    type_int = "1" if plex_type == "movie" else "2"
    idr = await client.get(f"{url}/identity", headers=hdrs)
    machine_id = idr.json().get("MediaContainer", {}).get("machineIdentifier", "") if idr.status_code == 200 else ""
    if not machine_id:
        raise HTTPException(502, "Could not read Plex server identity")
    params: list[tuple[str, str]] = [("type", type_int)]
    missing: list[str] = []
    if filters.genres:
        ids, missing = await _resolve_genre_ids(client, url, hdrs, section_id, type_int, filters.genres)
        if not ids:
            raise HTTPException(400, f"None of the genres matched this library: {', '.join(filters.genres)}")
        params.append(("genre", ",".join(ids)))
    # Plex's >>= / <<= operators are strict greater/less-than; offset by 1 so
    # year_min/year_max behave inclusively.
    if filters.year_min is not None:
        params.append(("year>>", str(filters.year_min - 1)))
    if filters.year_max is not None:
        params.append(("year<<", str(filters.year_max + 1)))
    if filters.decade is not None:
        params.append(("decade", str(filters.decade)))
    if filters.unwatched:
        params.append(("unwatched", "1"))
    if filters.content_rating:
        params.append(("contentRating", filters.content_rating))
    if filters.title_contains:
        params.append(("title", filters.title_contains))
    if sort:
        mapped = _SMART_SORT.get(sort)
        if not mapped:
            raise HTTPException(400, f"Unknown sort '{sort}' — use one of {', '.join(_SMART_SORT)}")
        params.append(("sort", mapped))
    if limit:
        params.append(("limit", str(limit)))
    query = _urlencode(params)
    uri = f"server://{machine_id}/com.plexapp.plugins.library/library/sections/{section_id}/all?{query}"
    return uri, missing

@app.post("/api/plex/smart-collections", status_code=201)
async def plex_create_smart_collection(body: SmartCollectionIn):
    """Create a rule-based (smart) Plex collection that stays current automatically."""
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured — open Settings")
    if body.type not in ("movie", "show"):
        raise HTTPException(400, "type must be 'movie' or 'show'")
    hdrs = plex_headers(token)
    async with httpx.AsyncClient(timeout=15) as client:
        uri, missing = await _build_smart_uri(client, url, hdrs, body.section_id,
                                              body.type, body.filters, body.sort, body.limit)
        resp = await client.post(
            f"{url}/library/collections",
            headers=hdrs,
            params={"type": "1" if body.type == "movie" else "2", "title": body.title,
                    "smart": "1", "sectionId": body.section_id, "uri": uri},
        )
    if resp.status_code not in (200, 201):
        raise HTTPException(resp.status_code, f"Plex error: {resp.text[:200]}")
    coll = (resp.json().get("MediaContainer", {}).get("Metadata", [{}]) or [{}])[0]
    _log_app("collection", f"Created smart collection '{body.title}'",
             metadata={"section_id": body.section_id, "type": body.type})
    return {
        "rating_key": coll.get("ratingKey"),
        "title": coll.get("title", body.title),
        "type": body.type,
        "smart": True,
        "unresolved_genres": missing,
    }

async def _best_effort_delete_plex_collection(rating_key: str) -> bool:
    """Delete a Plex collection without ever raising — used to roll back a
    just-created collection when the follow-up assign fails."""
    try:
        url, token = get_plex_config()
        if not token:
            return False
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.delete(f"{url}/library/collections/{rating_key}",
                                    headers=plex_headers(token))
        return r.status_code in (200, 204)
    except Exception as e:  # noqa: BLE001 — rollback must never mask the original error
        log.warning("Rollback delete of Plex collection %s failed: %s", rating_key, e)
        return False


@app.post("/api/channels/{channel_number}/smart-collection", status_code=201)
async def create_and_assign_smart_collection(channel_number: int, body: SmartCollectionIn):
    """Create a Plex smart collection AND assign it to a channel, atomically.

    Reuses `plex_create_smart_collection` (and therefore `_build_smart_uri`) for
    the Plex side, then records the slot with `source='assigned'`, `is_smart=1`.
    Either both halves land or neither does:
      - channel + type are validated BEFORE anything is created in Plex, so a
        bad request can't orphan a collection;
      - if the assign write fails, the freshly created collection is deleted
        again and any partial slot is cleared — no orphaned collection left
        assigned, no assignment pointing at nothing.

    Assigned means REFERENCE ONLY: Linearr never edits the collection's members
    (it's a smart collection — Plex keeps it current from its rules).
    """
    if body.type not in _COLLECTION_SUFFIX:
        raise HTTPException(400, "type must be 'movie' or 'show'")
    ch = _get_channel(channel_number)
    if not ch:
        raise HTTPException(404, "Channel not found")
    # Same reserved-name rule as the plain assign: '{Channel} Movies/TV' is the
    # name generation resolves by, and a smart collection cannot be added to.
    # Checked BEFORE anything is created in Plex so nothing is orphaned.
    if _is_owned_title(body.title, ch.get("name") or ""):
        raise HTTPException(
            400,
            f"'{body.title}' is reserved for the collection Linearr generates "
            f"for this channel — pick a different name.",
        )

    created = await plex_create_smart_collection(body)
    rating_key = created.get("rating_key")
    if not rating_key:
        # Nothing usable to assign, and nothing to roll back by (no key) — fail
        # loudly rather than writing a dangling reference.
        raise HTTPException(502, "Plex created the smart collection but returned no rating key")

    try:
        _write_assigned_slot(channel_number, body.type, rating_key,
                             created.get("title") or body.title, is_smart=True,
                             linearr_created=True)
    except Exception as e:  # noqa: BLE001 — must roll the Plex side back
        rolled_back = await _best_effort_delete_plex_collection(rating_key)
        with get_db() as conn:
            conn.execute(
                "DELETE FROM channel_collections WHERE channel_number=? AND plex_type=? "
                "AND collection_rating_key=?",
                (channel_number, body.type, str(rating_key)),
            )
        log.warning("smart-collection assign failed for ch %s (%s): %s (rolled_back=%s)",
                    channel_number, rating_key, e, rolled_back)
        raise HTTPException(
            500,
            f"Created the Plex smart collection but could not assign it: {e}. "
            + ("It was deleted again." if rolled_back
               else f"It could NOT be deleted — remove '{created.get('title')}' in Plex manually."),
        )

    _log_app("collection",
             f"Created + assigned smart collection '{created.get('title')}' to ch {channel_number}",
             metadata={"channel": channel_number, "plex_type": body.type,
                       "rating_key": rating_key, "unresolved_genres": created.get("unresolved_genres")})
    return {**created, "assigned": True, "channel_number": channel_number,
            "plex_type": body.type, "source": "assigned", "is_smart": 1,
            "linearr_created": 1}


@app.put("/api/plex/smart-collections/{rating_key}")
async def plex_update_smart_collection(rating_key: str, body: SmartCollectionUpdateIn):
    """Update a smart collection's title and/or filter rules."""
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured — open Settings")
    if body.type not in ("movie", "show"):
        raise HTTPException(400, "type must be 'movie' or 'show'")
    hdrs = plex_headers(token)
    updated: list[str] = []
    missing: list[str] = []
    async with httpx.AsyncClient(timeout=15) as client:
        if body.filters is not None:
            uri, missing = await _build_smart_uri(client, url, hdrs, body.section_id,
                                                  body.type, body.filters, body.sort, body.limit)
            r = await client.put(f"{url}/library/collections/{rating_key}/items",
                                 headers=hdrs, params={"uri": uri})
            if r.status_code not in (200, 201, 204):
                raise HTTPException(r.status_code, f"Failed to update filters: {r.text[:200]}")
            updated.append("filters")
        if body.title:
            r = await client.put(f"{url}/library/metadata/{rating_key}",
                                 headers=hdrs, params={"title.value": body.title})
            if r.status_code not in (200, 204):
                raise HTTPException(r.status_code, "Failed to update title")
            updated.append("title")
    if not updated:
        raise HTTPException(400, "Nothing to update — provide filters and/or title")
    _log_app("collection", f"Updated smart collection {rating_key}",
             metadata={"rating_key": rating_key, "updated": updated, "unresolved_genres": missing})
    return {"ok": True, "updated": updated, "unresolved_genres": missing}

# ── Blocks ────────────────────────────────────────────────────────────────────

import json as _json
import re as _re
import unicodedata as _unicodedata

def _normalize_title(title: str) -> str:
    """Normalize a show title for fuzzy comparison."""
    t = title.lower()
    t = _re.sub(r'\s*\(\d{4}\)\s*$', '', t)           # strip year suffix (1996)
    t = _re.sub(r'\s*[-–:]\s*(book|season|series|part|vol\.?|volume)\s*\d+.*$', '', t)
    t = _re.sub(r"[^\w\s]", '', t)
    t = _re.sub(r'\s+', ' ', t).strip()
    t = _re.sub(r'^(the|a|an)\s+', '', t)
    t = _unicodedata.normalize('NFKD', t)
    return ''.join(c for c in t if not _unicodedata.combining(c))

def _title_match_score(plex_title: str, canonical_titles: list[str]) -> tuple[float, str | None]:
    """Return (best_score 0–1, matched_canonical) for a Plex title vs known show list."""
    plex_norm = _normalize_title(plex_title)
    plex_tokens = set(plex_norm.split())
    best_score, best_match = 0.0, None
    for canonical in canonical_titles:
        cn = _normalize_title(canonical)
        if plex_norm == cn:
            return 1.0, canonical
        if plex_norm.startswith(cn) or cn.startswith(plex_norm):
            shorter = min(len(plex_norm), len(cn))
            longer  = max(len(plex_norm), len(cn))
            score = 0.85 + 0.10 * (shorter / longer)
            if score > best_score:
                best_score, best_match = score, canonical
            continue
        if cn in plex_norm or plex_norm in cn:
            score = 0.75
            if score > best_score:
                best_score, best_match = score, canonical
            continue
        cn_tokens = set(cn.split())
        if not plex_tokens or not cn_tokens:
            continue
        meaningful = {tok for tok in (plex_tokens & cn_tokens) if len(tok) > 3}
        if not meaningful:
            continue
        jaccard = len(plex_tokens & cn_tokens) / len(plex_tokens | cn_tokens)
        score = 0.50 + 0.25 * jaccard
        if score > best_score:
            best_score, best_match = score, canonical
    return best_score, best_match

_NETWORK_BLOCKS_PATH = Path("/app/network_blocks.json")
_network_blocks_cache: dict | None = None

def _load_network_blocks() -> dict:
    global _network_blocks_cache
    if _network_blocks_cache is None:
        if not _NETWORK_BLOCKS_PATH.exists():
            _network_blocks_cache = {"networks": []}
        else:
            with open(_NETWORK_BLOCKS_PATH) as f:
                _network_blocks_cache = _json.load(f)
    return _network_blocks_cache

@app.get("/api/blocks/network-suggestions")
def network_block_suggestions(channel_number: int | None = Query(None)):
    MATCH_THRESHOLD = 0.65
    with get_db() as conn:
        if channel_number:
            rows = conn.execute(
                "SELECT plex_title, plex_type FROM assignments WHERE channel_number=?",
                (channel_number,)
            ).fetchall()
        else:
            # Generic: use all assignments across all channels (deduplicated)
            rows = conn.execute("SELECT DISTINCT plex_title, plex_type FROM assignments").fetchall()
    assignments = [dict(r) for r in rows]
    if not assignments:
        return []

    nb = _load_network_blocks()
    results = []
    for network in nb.get("networks", []):
        for block in network.get("blocks", []):
            content_type = block.get("content_type", "both")
            if content_type == "shows":
                relevant = [a for a in assignments if a["plex_type"] == "show"]
            elif content_type == "movies":
                relevant = [a for a in assignments if a["plex_type"] == "movie"]
            else:
                relevant = assignments

            canonical_titles = block.get("shows", [])
            matching = []
            for assignment in relevant:
                score, matched = _title_match_score(assignment["plex_title"], canonical_titles)
                if score >= MATCH_THRESHOLD:
                    matching.append({"plex_title": assignment["plex_title"], "matched_as": matched, "score": round(score, 3)})

            seen: set[str] = set()
            deduped = []
            for m in sorted(matching, key=lambda x: -x["score"]):
                if m["plex_title"] not in seen:
                    seen.add(m["plex_title"])
                    deduped.append(m)

            results.append({
                "block_id": block["id"],
                "network_id": network["id"],
                "network_name": network["name"],
                "network_color": network.get("color", "slate"),
                "name": block["name"],
                "start_time": block["start_time"],
                "end_time": block["end_time"],
                "days": block["days"],
                "content_type": block["content_type"],
                "notes": block.get("notes", ""),
                "match_count": len(deduped),
                "total_shows": len(canonical_titles),
                "match_pct": round(len(deduped) / len(canonical_titles) * 100) if canonical_titles else 0,
                "matching_shows": deduped,
            })

    results.sort(key=lambda x: (-x["match_count"], -x["match_pct"]))
    return results

def _row_to_block(r) -> dict:
    d = dict(r)
    d["days"] = _json.loads(d["days"]) if isinstance(d["days"], str) else d["days"]
    return d

@app.get("/api/blocks/channel/{channel_number}")
def list_channel_blocks(channel_number: int):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM blocks WHERE channel_number=? ORDER BY order_index, start_time",
            (channel_number,)
        ).fetchall()
    return [_row_to_block(r) for r in rows]

@app.get("/api/blocks/generic")
def list_generic_blocks():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM blocks WHERE channel_number IS NULL ORDER BY order_index, name"
        ).fetchall()
    return [_row_to_block(r) for r in rows]

@app.post("/api/blocks", status_code=201)
def create_block(body: BlockIn):
    with get_db() as conn:
        cur = conn.execute(
            """INSERT INTO blocks (name, channel_number, days, start_time, end_time, content_type, notes, order_index)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (body.name, body.channel_number, _json.dumps(body.days),
             body.start_time, body.end_time, body.content_type, body.notes, body.order_index)
        )
        row = conn.execute("SELECT * FROM blocks WHERE id=?", (cur.lastrowid,)).fetchone()
    _log_app("block", f"Created block '{body.name}'",
             metadata={"block_id": row["id"], "channel_number": body.channel_number, "days": body.days})
    return _row_to_block(row)

@app.put("/api/blocks/{block_id}")
def update_block(block_id: int, body: BlockIn):
    with get_db() as conn:
        cur = conn.execute(
            """UPDATE blocks SET name=?, channel_number=?, days=?, start_time=?, end_time=?,
               content_type=?, notes=?, order_index=? WHERE id=?""",
            (body.name, body.channel_number, _json.dumps(body.days),
             body.start_time, body.end_time, body.content_type, body.notes, body.order_index, block_id)
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Block not found")
        row = conn.execute("SELECT * FROM blocks WHERE id=?", (block_id,)).fetchone()
    _log_app("block", f"Updated block {block_id}",
             metadata={"block_id": block_id, "name": body.name, "channel_number": body.channel_number})
    return _row_to_block(row)

@app.delete("/api/blocks/{block_id}")
def delete_block(block_id: int):
    with get_db() as conn:
        cur = conn.execute("DELETE FROM blocks WHERE id=?", (block_id,))
    if cur.rowcount == 0:
        raise HTTPException(404, "Block not found")
    _log_app("block", f"Deleted block {block_id}", level="warn", metadata={"block_id": block_id})
    return {"ok": True}

@app.get("/api/blocks/{block_id}/slots")
def list_block_slots(block_id: int):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM block_slots WHERE block_id=? ORDER BY slot_time",
            (block_id,)
        ).fetchall()
    return [dict(r) for r in rows]

@app.post("/api/blocks/{block_id}/slots", status_code=201)
def add_block_slot(block_id: int, body: SlotIn):
    with get_db() as conn:
        cur = conn.execute(
            """INSERT INTO block_slots
               (block_id, slot_time, plex_rating_key, plex_title, plex_type, plex_thumb, plex_year, duration_minutes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (block_id, body.slot_time, body.plex_rating_key, body.plex_title,
             body.plex_type, body.plex_thumb, body.plex_year, body.duration_minutes)
        )
        row = conn.execute("SELECT * FROM block_slots WHERE id=?", (cur.lastrowid,)).fetchone()
    _log_app("block", f"Added slot {body.slot_time} '{body.plex_title}' to block {block_id}",
             metadata={"block_id": block_id, "slot_id": row["id"], "slot_time": body.slot_time, "title": body.plex_title})
    return dict(row)

@app.put("/api/block-slots/{slot_id}")
def update_block_slot(slot_id: int, body: dict):
    """Update a slot's time (for drag reorder)."""
    with get_db() as conn:
        slot = conn.execute("SELECT * FROM block_slots WHERE id=?", (slot_id,)).fetchone()
        if not slot:
            raise HTTPException(404, "Slot not found")
        new_time = body.get("slot_time", slot["slot_time"])
        conn.execute("UPDATE block_slots SET slot_time=? WHERE id=?", (new_time, slot_id))
        row = conn.execute("SELECT * FROM block_slots WHERE id=?", (slot_id,)).fetchone()
    _log_app("block", f"Moved slot {slot_id} to {new_time}",
             metadata={"slot_id": slot_id, "slot_time": new_time})
    return dict(row)

@app.post("/api/blocks/{block_id}/swap-slots")
def swap_block_slots(block_id: int, body: dict):
    """Swap slot_time between two slots in a block."""
    id_a = body.get("slot_a")
    id_b = body.get("slot_b")
    if not id_a or not id_b:
        raise HTTPException(400, "slot_a and slot_b required")
    with get_db() as conn:
        a = conn.execute("SELECT * FROM block_slots WHERE id=? AND block_id=?", (id_a, block_id)).fetchone()
        b = conn.execute("SELECT * FROM block_slots WHERE id=? AND block_id=?", (id_b, block_id)).fetchone()
        if not a or not b:
            raise HTTPException(404, "Slot not found in this block")
        conn.execute("UPDATE block_slots SET slot_time=? WHERE id=?", (b["slot_time"], id_a))
        conn.execute("UPDATE block_slots SET slot_time=? WHERE id=?", (a["slot_time"], id_b))
    _log_app("block", f"Swapped slots {id_a} and {id_b} in block {block_id}",
             metadata={"block_id": block_id, "slot_a": id_a, "slot_b": id_b})
    return {"ok": True}

@app.delete("/api/block-slots/{slot_id}")
def delete_block_slot(slot_id: int):
    with get_db() as conn:
        cur = conn.execute("DELETE FROM block_slots WHERE id=?", (slot_id,))
    if cur.rowcount == 0:
        raise HTTPException(404, "Slot not found")
    _log_app("block", f"Deleted slot {slot_id}", metadata={"slot_id": slot_id})
    return {"ok": True}

@app.delete("/api/blocks/{block_id}/slots")
def clear_block_slots(block_id: int):
    """Delete all slots for a block (for clear+redo AI fill)."""
    with get_db() as conn:
        block = conn.execute("SELECT id FROM blocks WHERE id=?", (block_id,)).fetchone()
        if not block:
            raise HTTPException(404, "Block not found")
        cur = conn.execute("DELETE FROM block_slots WHERE block_id=?", (block_id,))
    _log_app("block", f"Cleared slots for block {block_id}", level="warn",
             metadata={"block_id": block_id, "count": cur.rowcount})
    return {"ok": True, "deleted": cur.rowcount}

@app.get("/api/blocks/{block_id}/suggestions")
def block_suggestions(block_id: int):
    """Return channel assignments filtered by block content_type, unscheduled items first."""
    with get_db() as conn:
        block = conn.execute("SELECT * FROM blocks WHERE id=?", (block_id,)).fetchone()
        if not block:
            raise HTTPException(404, "Block not found")
        scheduled_keys = {r["plex_rating_key"] for r in conn.execute(
            "SELECT DISTINCT plex_rating_key FROM block_slots WHERE block_id=?", (block_id,)
        ).fetchall()}
        if block["channel_number"] is not None:
            rows = conn.execute(
                "SELECT * FROM assignments WHERE channel_number=? ORDER BY plex_type, plex_title",
                (block["channel_number"],)
            ).fetchall()
        else:
            rows = []
    content_type = block["content_type"]
    result = []
    for r in rows:
        if content_type == "movies" and r["plex_type"] != "movie":
            continue
        if content_type == "shows" and r["plex_type"] != "show":
            continue
        item = dict(r)
        item["already_scheduled"] = r["plex_rating_key"] in scheduled_keys
        result.append(item)
    result.sort(key=lambda x: (x["already_scheduled"], x["plex_title"]))
    return result

@app.post("/api/blocks/{block_id}/apply/{channel_number}", status_code=201)
def apply_block(block_id: int, channel_number: int):
    """Clone a generic block onto a specific channel, copy slots, auto-add missing shows."""
    with get_db() as conn:
        src = conn.execute("SELECT * FROM blocks WHERE id=?", (block_id,)).fetchone()
        if not src:
            raise HTTPException(404, "Block not found")
        # Create the block copy
        cur = conn.execute(
            """INSERT INTO blocks (name, channel_number, days, start_time, end_time, content_type, notes, order_index)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (src["name"], channel_number, src["days"], src["start_time"],
             src["end_time"], src["content_type"], src["notes"], src["order_index"])
        )
        new_block_id = cur.lastrowid

        # Copy slots from source block
        src_slots = conn.execute(
            "SELECT * FROM block_slots WHERE block_id=? ORDER BY slot_time", (block_id,)
        ).fetchall()
        slots_copied = 0
        shows_added = []
        if src_slots:
            # Get current assignments for this channel
            existing_keys = {str(r["plex_rating_key"]) for r in conn.execute(
                "SELECT plex_rating_key FROM assignments WHERE channel_number=?", (channel_number,)
            ).fetchall()}

            for s in src_slots:
                # Copy the slot
                conn.execute(
                    """INSERT INTO block_slots
                       (block_id, slot_time, plex_rating_key, plex_title, plex_type, plex_thumb, plex_year, duration_minutes)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (new_block_id, s["slot_time"], s["plex_rating_key"], s["plex_title"],
                     s["plex_type"], s["plex_thumb"], s["plex_year"], s["duration_minutes"])
                )
                slots_copied += 1

                # Auto-add show to channel assignments if missing
                rk = str(s["plex_rating_key"])
                if rk not in existing_keys:
                    try:
                        conn.execute(
                            """INSERT INTO assignments (channel_number, plex_rating_key, plex_title, plex_type, plex_thumb, plex_year)
                               VALUES (?, ?, ?, ?, ?, ?)""",
                            (channel_number, s["plex_rating_key"], s["plex_title"],
                             s["plex_type"], s["plex_thumb"], s["plex_year"])
                        )
                        existing_keys.add(rk)
                        shows_added.append(s["plex_title"])
                    except sqlite3.IntegrityError:
                        pass  # already exists

        row = conn.execute("SELECT * FROM blocks WHERE id=?", (new_block_id,)).fetchone()
    result = _row_to_block(row)
    result["slots_copied"] = slots_copied
    result["shows_added"] = shows_added
    _log_app("block", f"Applied block {block_id} to ch {channel_number}",
             metadata={"block_id": block_id, "new_block_id": new_block_id, "channel": channel_number,
                       "slots_copied": slots_copied, "shows_added": shows_added})
    return result

# ── AI helpers ────────────────────────────────────────────────────────────────

def _extract_ai_content(resp_json: dict) -> str:
    """Extract and validate the AI response content. Raises HTTPException on failure."""
    choice = resp_json.get("choices", [{}])[0]
    finish = choice.get("finish_reason", "")
    content = (choice.get("message") or {}).get("content") or ""
    content = content.strip()
    if not content:
        if finish == "length":
            raise HTTPException(502, "AI response was truncated (token limit reached). Try a simpler request or increase the model's token limit.")
        if finish == "content_filter":
            raise HTTPException(502, "AI response was blocked by content filter.")
        raise HTTPException(502, "AI returned an empty response. The model may be overloaded — try again.")
    return content

def _parse_ai_json(content: str) -> dict | list:
    """Strip markdown fences and parse JSON from AI response content."""
    text = content
    if "```" in text:
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.split("```")[0]
    text = text.strip()
    if not text:
        raise HTTPException(502, "AI returned empty content after stripping markdown fences.")
    return _json.loads(text)

# ── AI channel & package suggestions ──────────────────────────────────────────

@app.post("/api/channels/ai-suggest")
async def ai_suggest_channels():
    """AI analyzes the Plex library and existing channels to suggest new channels and packages."""
    with get_db() as conn:
        settings_rows = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings")}
        existing_channels = [dict(r) for r in conn.execute("SELECT * FROM channels ORDER BY number").fetchall()]
        all_assignments = {}
        for r in conn.execute("SELECT channel_number, plex_title, plex_type FROM assignments"):
            cn = r["channel_number"]
            if cn not in all_assignments:
                all_assignments[cn] = []
            all_assignments[cn].append({"title": r["plex_title"], "type": r["plex_type"]})
        # Get ALL unique content across all channels for the AI to reference
        all_content = []
        seen_titles: set[str] = set()
        for r in conn.execute("SELECT DISTINCT plex_title, plex_type FROM assignments ORDER BY plex_type, plex_title"):
            t = r["plex_title"]
            if t.lower() not in seen_titles:
                seen_titles.add(t.lower())
                all_content.append({"title": t, "type": r["plex_type"]})

    api_key  = settings_rows.get("openai_api_key", "")
    base_url = (settings_rows.get("openai_base_url") or "https://api.openai.com/v1").rstrip("/")
    model    = settings_rows.get("openai_model", "gpt-4o-mini")
    if not api_key:
        raise HTTPException(400, "AI API key not configured in Settings")

    # Build summary of existing channels
    ch_summary = []
    used_numbers = {ch["number"] for ch in existing_channels}
    for ch in existing_channels:
        items = all_assignments.get(ch["number"], [])
        shows = [i["title"] for i in items if i["type"] == "show"]
        movies_count = sum(1 for i in items if i["type"] == "movie")
        ch_summary.append(f"Ch {ch['number']} {ch['name']} ({ch['tier']}) — {len(shows)} shows, {movies_count} movies. Shows: {', '.join(shows[:10])}")

    # Find available numbers per tier
    main_avail = sorted(n for n in range(100, 120) if n not in used_numbers)
    classic_avail = sorted(n for n in range(120, 140) if n not in used_numbers)
    premium_avail = sorted(n for n in range(140, 160) if n not in used_numbers)

    # Content summary
    all_shows = [c["title"] for c in all_content if c["type"] == "show"]
    all_movies = [c["title"] for c in all_content if c["type"] == "movie"]

    prompt = f"""You are a veteran cable TV network executive planning a premium multiplex service called "Galaxy Network". Think like Comcast, DirecTV, or Dish Network — you're building a complete channel lineup that covers every viewer demographic.

CURRENT LINEUP ({len(existing_channels)} channels):
{chr(10).join(ch_summary)}

AVAILABLE CONTENT IN PLEX LIBRARY:
TV Shows ({len(all_shows)}): {', '.join(all_shows[:60])}{'...' if len(all_shows) > 60 else ''}
Movies ({len(all_movies)}): {', '.join(all_movies[:60])}{'...' if len(all_movies) > 60 else ''}

TIER STRUCTURE:
- Galaxy Main (100-119): Core channels, general entertainment. Available numbers: {main_avail[:8]}
- Classics (120-139): Nostalgia, retro, branded networks. Available numbers: {classic_avail[:8]}
- Galaxy Premium (140-159): Premium/prestige content, specialized. Available numbers: {premium_avail[:8]}

YOUR TASK — suggest A LOT of options. Be creative and thorough:

1. **8-15 NEW CHANNEL IDEAS** across all three tiers. Think about:
   - Genre gaps (sci-fi, reality, documentary, sports-adjacent, music, news-style, etc.)
   - Demographic gaps (teens, women, men, families, seniors, Spanish-language)
   - Format gaps (movie marathons, binge channels, 24/7 single-show channels)
   - Era gaps (70s/80s retro, 2000s nostalgia, modern prestige)
   - Mood gaps (relaxation, comedy-only, thriller-only, date-night)
   - Real cable inspiration (think: FX, TNT, TBS, Bravo, E!, Lifetime, SyFy, History, Discovery)
   - Use content from the Plex library above when possible — mention specific shows/movies that would fit

2. **3-5 PACKAGE IDEAS** like real cable bundles:
   - Basic Package, Family Package, Entertainment Package, Premium Package, Sports/Action Pack
   - Each with 4-8 channels that make sense together
   - Include a price-tier feel (basic = essential channels, premium = specialized)

For each channel: number (from available list), name (Galaxy [Theme] or branded), tier, vibe (2-4 words), description (1 sentence), suggested_content (6-12 specific genres or show types)
For each package: name, description, channel_numbers (from existing + suggested), highlights (selling point)

Reply with ONLY this JSON (no markdown, no text):
{{"channels":[{{"number":117,"name":"Galaxy Sci-Fi","tier":"Galaxy Main","vibe":"Science Fiction / Fantasy","description":"From space operas to dystopian thrillers — the best of sci-fi and fantasy","suggested_content":["Battlestar Galactica","The Expanse","Doctor Who","sci-fi films","fantasy series","space movies"]}}],"packages":[{{"name":"Galaxy Basic","description":"Essential entertainment for every household","channel_numbers":[100,101,108,112],"highlights":"4 core channels covering drama, comedy, and kids"}}]}}"""

    import time as _t
    t0 = _t.monotonic()
    try:
        async with httpx.AsyncClient(timeout=240) as client:
            r = await client.post(f"{base_url}/chat/completions", json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.9,
            }, headers={"Authorization": f"Bearer {api_key}"})
        ms = int((_t.monotonic() - t0) * 1000)
        if r.status_code != 200:
            raise HTTPException(502, f"AI error: {r.text[:200]}")
        raw = _extract_ai_content(r.json())
        data = _parse_ai_json(raw)
        return {"suggestions": data, "duration_ms": ms}
    except _json.JSONDecodeError as e:
        raise HTTPException(502, f"AI returned invalid JSON: {str(e)[:100]}")
    except Exception as e:
        raise HTTPException(502, f"AI error: {str(e)[:200]}")

# ── AI Channel Content Advisor ────────────────────────────────────────────────

@app.post("/api/channels/{channel_number}/ai-content-suggestions")
async def ai_content_suggestions(channel_number: int):
    """AI suggests shows/movies to add and programming blocks for a specific channel."""
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")

    with get_db() as conn:
        settings_rows = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings")}
        ch_row = conn.execute("SELECT * FROM channels WHERE number=?", (channel_number,)).fetchone()
        if not ch_row:
            raise HTTPException(404, "Channel not found")
        ch = dict(ch_row)

        # Target channel's current assignments
        my_assignments = [dict(r) for r in conn.execute(
            "SELECT * FROM assignments WHERE channel_number=? ORDER BY plex_type, plex_title",
            (channel_number,)
        ).fetchall()]
        my_keys = {str(a["plex_rating_key"]) for a in my_assignments}

        # All other channels' assignments (for cross-channel awareness)
        all_channels = [dict(r) for r in conn.execute("SELECT * FROM channels ORDER BY number").fetchall()]
        other_assignments: dict[int, list[dict]] = {}
        for r in conn.execute("SELECT channel_number, plex_rating_key, plex_title, plex_type FROM assignments WHERE channel_number != ?", (channel_number,)):
            cn = r["channel_number"]
            if cn not in other_assignments:
                other_assignments[cn] = []
            other_assignments[cn].append({"title": r["plex_title"], "type": r["plex_type"], "rk": r["plex_rating_key"]})

        # Build reverse map: rating_key -> list of channel names it appears on
        rk_to_channels: dict[str, list[str]] = {}
        for cn, items in other_assignments.items():
            ch_info = next((c for c in all_channels if c["number"] == cn), None)
            ch_label = f"{ch_info['name']} (#{cn})" if ch_info else f"#{cn}"
            for item in items:
                rk = str(item["rk"])
                if rk not in rk_to_channels:
                    rk_to_channels[rk] = []
                rk_to_channels[rk].append(ch_label)

    api_key = settings_rows.get("openai_api_key", "")
    base_url = (settings_rows.get("openai_base_url") or "https://api.openai.com/v1").rstrip("/")
    model = settings_rows.get("openai_model", "gpt-4o-mini")
    if not api_key:
        raise HTTPException(400, "AI API key not configured in Settings")

    # Fetch all Plex library content
    hdrs = plex_headers(token)
    plex_items: list[dict] = []
    async with httpx.AsyncClient(timeout=30) as client:
        sec_resp = await client.get(f"{url}/library/sections", headers=hdrs)
        if sec_resp.status_code != 200:
            raise HTTPException(502, "Could not reach Plex")
        sections = sec_resp.json().get("MediaContainer", {}).get("Directory", [])
        for section in sections:
            if section.get("type") not in ("show", "movie"):
                continue
            resp = await client.get(f"{url}/library/sections/{section['key']}/all", headers=hdrs)
            if resp.status_code != 200:
                continue
            for m in resp.json().get("MediaContainer", {}).get("Metadata", []):
                t = m.get("type", "")
                if t not in ("movie", "show"):
                    continue
                plex_items.append({
                    "rating_key": str(m.get("ratingKey", "")),
                    "title": m.get("title", ""),
                    "type": t,
                    "year": m.get("year"),
                    "thumb": m.get("thumb"),
                })

    # Filter: items NOT already on this channel
    available = [p for p in plex_items if p["rating_key"] not in my_keys]

    # Build current content summary
    my_shows = [a["plex_title"] for a in my_assignments if a["plex_type"] == "show"]
    my_movies = [a["plex_title"] for a in my_assignments if a["plex_type"] == "movie"]

    # Build other channels summary (up to 20 channels, 15 titles each)
    other_summary = []
    for oc in all_channels:
        if oc["number"] == channel_number:
            continue
        items = other_assignments.get(oc["number"], [])
        if not items:
            continue
        titles = [i["title"] for i in items[:15]]
        extra = f" (+{len(items)-15} more)" if len(items) > 15 else ""
        other_summary.append(f"- Ch {oc['number']} {oc['name']} ({oc.get('vibe','')}) [{oc['tier']}]: {', '.join(titles)}{extra}")
    other_summary = other_summary[:20]

    # Build available content list (up to 80 shows + 80 movies)
    avail_shows = [a for a in available if a["type"] == "show"][:80]
    avail_movies = [a for a in available if a["type"] == "movie"][:80]
    avail_show_lines = "\n".join(f"{a['rating_key']} | {a['title']} | {a.get('year','')}" for a in avail_shows)
    avail_movie_lines = "\n".join(f"{a['rating_key']} | {a['title']} | {a.get('year','')}" for a in avail_movies)

    prompt = f"""You are the Head of Programming at a premium cable TV network. You've been asked to strengthen a channel's lineup by finding content that belongs on it.

CHANNEL: {ch.get('name', '')} (#{channel_number}) — "{ch.get('vibe', '')}" [{ch.get('tier', '')}]
Style: {ch.get('style', 'General entertainment')}

CURRENTLY ON THIS CHANNEL (this defines the channel's identity — study it carefully):
TV Shows ({len(my_shows)}): {', '.join(my_shows)}
Movies ({len(my_movies)}): {', '.join(my_movies)}

OTHER CHANNELS IN THE NETWORK (for context — avoid putting a show on 3+ channels):
{chr(10).join(other_summary) if other_summary else 'No other channels yet'}

AVAILABLE CONTENT NOT YET ON THIS CHANNEL:
TV Shows ({len(avail_shows)}):
{avail_show_lines or 'None available'}

Movies ({len(avail_movies)}):
{avail_movie_lines or 'None available'}

YOUR TASK — two categories of suggestions, in order of priority:

CATEGORY A — "PERFECT FIT" (suggest 5-10):
Content that is OBVIOUSLY a match for this channel based on what's already assigned. Look at the existing shows and find content that shares the same genre, era, tone, audience, or franchise. These are no-brainers — if someone saw this channel's current lineup, they would expect these shows to be on it too. Example: if the channel has Breaking Bad, suggest Better Call Saul. If it has SpongeBob, suggest The Fairly OddParents.

CATEGORY B — "WOULD STRENGTHEN" (suggest 5-8):
Content that doesn't directly match what's there but would round out the channel, fill a gap, or attract a broader audience while staying on-brand. These are more creative picks that a smart programmer would add to diversify the schedule.

For EVERY suggestion: use EXACT rating_key and title from the available lists. Explain why in 1 sentence. Mark category as "perfect_fit" or "would_strengthen".

Also suggest 3-5 PROGRAMMING BLOCKS based on ALL content (existing + suggested), emulating real high-end cable networks:
- Think TNT Primetime, FX Late Night, Cartoon Network's Toonami, Adult Swim, TBS Afternoon Block
- Morning: lighter/classic reruns. Afternoon: themed marathons. Primetime 8-11PM: flagship shows. Late Night: edgier/cult content
- Include which shows (existing + suggested) slot into each block

Reply with ONLY this JSON (no markdown, no text):
{{"shows":[{{"plex_rating_key":"12345","plex_title":"Exact Title","plex_type":"show","reason":"Why it belongs","category":"perfect_fit"}}],"blocks":[{{"name":"Block Name","start_time":"HH:MM","end_time":"HH:MM","days":["mon","tue","wed","thu","fri","sat","sun"],"content_type":"shows","notes":"Block description and programming philosophy","suggested_shows":["Title 1","Title 2"]}}]}}"""

    import time as _t
    t0 = _t.monotonic()
    try:
        async with httpx.AsyncClient(timeout=240) as client:
            r = await client.post(f"{base_url}/chat/completions", json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.7,
            }, headers={"Authorization": f"Bearer {api_key}"})
        ms = int((_t.monotonic() - t0) * 1000)
        if r.status_code != 200:
            raise HTTPException(502, f"AI error: {r.text[:200]}")
        raw = _extract_ai_content(r.json())
        data = _parse_ai_json(raw)

        # Build lookup from available Plex items
        plex_map = {str(p["rating_key"]): p for p in plex_items}

        # Enrich show suggestions
        enriched_shows = []
        for s in data.get("shows", []):
            rk = str(s.get("plex_rating_key", ""))
            match = plex_map.get(rk)
            if not match:
                # Fuzzy match by title
                title_lower = s.get("plex_title", "").lower().strip()
                match = next((p for p in plex_items if p["title"].lower().strip() == title_lower), None)
                if match:
                    rk = match["rating_key"]
                    s["plex_rating_key"] = rk
            valid = match is not None
            enriched_shows.append({
                "plex_rating_key": rk,
                "plex_title": match["title"] if match else s.get("plex_title", ""),
                "plex_type": match["type"] if match else s.get("plex_type", "show"),
                "plex_thumb": match.get("thumb") if match else None,
                "plex_year": match.get("year") if match else None,
                "reason": s.get("reason", ""),
                "category": s.get("category", "would_strengthen"),
                "already_on": rk_to_channels.get(rk, []),
                "valid": valid,
            })

        _log_ai(None, "content-advisor", channel_number, model, base_url,
                 prompt[:500], raw[:1000], _json.dumps(enriched_shows), None, ms)

        return {
            "suggestions": {
                "shows": enriched_shows,
                "blocks": data.get("blocks", []),
            },
            "duration_ms": ms,
        }
    except _json.JSONDecodeError as e:
        _log_ai(None, "content-advisor", channel_number, model, base_url,
                 prompt[:500], raw[:1000] if "raw" in dir() else None, None,
                 f"JSON parse error: {e}", int((_t.monotonic() - t0) * 1000))
        raise HTTPException(502, f"AI returned invalid JSON: {str(e)[:100]}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"AI content advisor error: {str(e)[:200]}")

# ── Full Network AI Advisor ───────────────────────────────────────────────────

@app.post("/api/network/ai-advisor")
async def network_ai_advisor():
    """AI reviews the entire channel lineup and suggests content placement across all channels."""
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")

    with get_db() as conn:
        settings_rows = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings")}
        all_channels = [dict(r) for r in conn.execute("SELECT * FROM channels ORDER BY number").fetchall()]
        # All assignments grouped by channel
        channel_assignments: dict[int, list[dict]] = {}
        for r in conn.execute("SELECT channel_number, plex_rating_key, plex_title, plex_type FROM assignments ORDER BY channel_number, plex_title"):
            cn = r["channel_number"]
            if cn not in channel_assignments:
                channel_assignments[cn] = []
            channel_assignments[cn].append({"rk": r["plex_rating_key"], "title": r["plex_title"], "type": r["plex_type"]})
        all_assigned_keys = set()
        for items in channel_assignments.values():
            for i in items:
                all_assigned_keys.add(str(i["rk"]))

    api_key = settings_rows.get("openai_api_key", "")
    base_url = (settings_rows.get("openai_base_url") or "https://api.openai.com/v1").rstrip("/")
    model = settings_rows.get("openai_model", "gpt-4o-mini")
    if not api_key:
        raise HTTPException(400, "AI API key not configured in Settings")
    if not all_channels:
        raise HTTPException(400, "No channels configured")

    # Fetch full Plex library
    hdrs = plex_headers(token)
    plex_items: list[dict] = []
    async with httpx.AsyncClient(timeout=30) as client:
        sec_resp = await client.get(f"{url}/library/sections", headers=hdrs)
        if sec_resp.status_code != 200:
            raise HTTPException(502, "Could not reach Plex")
        sections = sec_resp.json().get("MediaContainer", {}).get("Directory", [])
        for section in sections:
            if section.get("type") not in ("show", "movie"):
                continue
            resp = await client.get(f"{url}/library/sections/{section['key']}/all", headers=hdrs)
            if resp.status_code != 200:
                continue
            for m in resp.json().get("MediaContainer", {}).get("Metadata", []):
                t = m.get("type", "")
                if t not in ("movie", "show"):
                    continue
                plex_items.append({
                    "rating_key": str(m.get("ratingKey", "")),
                    "title": m.get("title", ""),
                    "type": t,
                    "year": m.get("year"),
                    "thumb": m.get("thumb"),
                })

    # Unassigned content
    unassigned = [p for p in plex_items if p["rating_key"] not in all_assigned_keys]

    # Build channel lineup summary
    lineup_lines = []
    for ch in all_channels:
        items = channel_assignments.get(ch["number"], [])
        shows = [i["title"] for i in items if i["type"] == "show"]
        movies = [i["title"] for i in items if i["type"] == "movie"]
        show_str = ", ".join(shows[:20]) + (f" (+{len(shows)-20} more)" if len(shows) > 20 else "")
        movie_str = f"{len(movies)} movies" if movies else "0 movies"
        lineup_lines.append(
            f"Ch {ch['number']} {ch['name']} [{ch['tier']}] — \"{ch.get('vibe', '')}\" | "
            f"{len(shows)} shows: {show_str} | {movie_str}"
        )

    # Unassigned content list
    un_shows = [u for u in unassigned if u["type"] == "show"][:100]
    un_movies = [u for u in unassigned if u["type"] == "movie"][:100]
    un_show_lines = "\n".join(f"{u['rating_key']} | {u['title']} | {u.get('year','')}" for u in un_shows)
    un_movie_lines = "\n".join(f"{u['rating_key']} | {u['title']} | {u.get('year','')}" for u in un_movies)

    prompt = f"""You are the VP of Programming for "Galaxy Network", a premium cable TV multiplex. Your job is to review the ENTIRE channel lineup and make it world-class — like Comcast, DirecTV, or a major streaming service's live TV offering.

CURRENT NETWORK LINEUP ({len(all_channels)} channels):
{chr(10).join(lineup_lines)}

UNASSIGNED CONTENT IN LIBRARY (not on any channel yet):
TV Shows ({len(un_shows)}):
{un_show_lines or 'None'}

Movies ({len(un_movies)}):
{un_movie_lines or 'None'}

TOTAL LIBRARY: {len(plex_items)} items ({len([p for p in plex_items if p['type']=='show'])} shows, {len([p for p in plex_items if p['type']=='movie'])} movies)
ASSIGNED: {len(all_assigned_keys)} | UNASSIGNED: {len(unassigned)}

YOUR TASK — think like a cable network executive doing a quarterly programming review:

1. CHANNEL-BY-CHANNEL RECOMMENDATIONS:
   For each channel that could be improved, suggest 3-8 specific shows/movies to add from the UNASSIGNED list.
   - Use EXACT rating_key and title from the unassigned lists
   - Focus on channels that are empty, weak, or have content gaps
   - Match content to each channel's vibe and tier
   - Don't recommend the same content for multiple channels
   - Skip channels that already have a strong, complete lineup

2. NETWORK HEALTH ASSESSMENT:
   - Which channels are strongest?
   - Which need the most work?
   - Any channels with misplaced content? (wrong genre for the vibe)
   - Overall coverage gaps (genres/demographics not served)

3. CONTENT PLACEMENT for unassigned shows (where do they belong?):
   For unassigned content that clearly belongs somewhere, recommend which channel number it should go on.

Reply with ONLY this JSON (no markdown):
{{"channel_recommendations":[{{"channel_number":100,"channel_name":"Galaxy Prime","assessment":"Brief assessment of this channel","suggestions":[{{"plex_rating_key":"12345","plex_title":"Exact Title","plex_type":"show","reason":"Why it belongs here"}}]}}],"network_health":{{"strongest_channels":[{{"number":100,"name":"Galaxy Prime","why":"reason"}}],"weakest_channels":[{{"number":115,"name":"Galaxy X","why":"reason"}}],"coverage_gaps":["genre or demographic gap"],"misplaced_content":[{{"title":"Show Name","current_channel":100,"suggested_channel":105,"reason":"why"}}]}},"unassigned_placements":[{{"plex_rating_key":"12345","plex_title":"Title","plex_type":"show","suggested_channel":100,"reason":"why"}}]}}"""

    import time as _t
    t0 = _t.monotonic()
    try:
        async with httpx.AsyncClient(timeout=300) as client:
            r = await client.post(f"{base_url}/chat/completions", json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.6,
            }, headers={"Authorization": f"Bearer {api_key}"})
        ms = int((_t.monotonic() - t0) * 1000)
        if r.status_code != 200:
            raise HTTPException(502, f"AI error: {r.text[:200]}")
        raw = _extract_ai_content(r.json())
        data = _parse_ai_json(raw)

        # Enrich suggestions with plex metadata
        plex_map = {str(p["rating_key"]): p for p in plex_items}
        for rec in data.get("channel_recommendations", []):
            for s in rec.get("suggestions", []):
                rk = str(s.get("plex_rating_key", ""))
                match = plex_map.get(rk)
                if not match:
                    title_lower = s.get("plex_title", "").lower().strip()
                    match = next((p for p in plex_items if p["title"].lower().strip() == title_lower), None)
                    if match:
                        s["plex_rating_key"] = match["rating_key"]
                if match:
                    s["plex_thumb"] = match.get("thumb")
                    s["plex_year"] = match.get("year")
                    s["plex_title"] = match["title"]
                    s["valid"] = True
                else:
                    s["plex_thumb"] = None
                    s["plex_year"] = None
                    s["valid"] = False

        for p in data.get("unassigned_placements", []):
            rk = str(p.get("plex_rating_key", ""))
            match = plex_map.get(rk)
            if not match:
                title_lower = p.get("plex_title", "").lower().strip()
                match = next((pi for pi in plex_items if pi["title"].lower().strip() == title_lower), None)
                if match:
                    p["plex_rating_key"] = match["rating_key"]
            if match:
                p["plex_thumb"] = match.get("thumb")
                p["plex_year"] = match.get("year")
                p["plex_title"] = match["title"]
                p["valid"] = True
            else:
                p["plex_thumb"] = None
                p["plex_year"] = None
                p["valid"] = False

        _log_ai(None, "network-advisor", None, model, base_url,
                 prompt[:500], raw[:1500], None, None, ms)

        return {
            "data": data,
            "stats": {
                "total_channels": len(all_channels),
                "total_library": len(plex_items),
                "total_assigned": len(all_assigned_keys),
                "total_unassigned": len(unassigned),
            },
            "duration_ms": ms,
        }
    except _json.JSONDecodeError as e:
        _log_ai(None, "network-advisor", None, model, base_url,
                 prompt[:500], raw[:1500] if "raw" in dir() else None, None,
                 f"JSON parse error: {e}", int((_t.monotonic() - t0) * 1000))
        raise HTTPException(502, f"AI returned invalid JSON: {str(e)[:100]}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Network advisor error: {str(e)[:200]}")

@app.get("/api/channels/suggest-247")
async def suggest_247_channels():
    """Suggest 24/7 single-show/franchise channels based on Plex library content."""
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    with get_db() as conn:
        existing_channels = {r["name"].lower() for r in conn.execute("SELECT name FROM channels")}
        used_numbers = {r["number"] for r in conn.execute("SELECT number FROM channels")}

    suggestions = []
    async with httpx.AsyncClient(timeout=30) as client:
        # Get all library sections
        sec_resp = await client.get(f"{url}/library/sections", headers=hdrs)
        if sec_resp.status_code != 200:
            raise HTTPException(502, "Could not reach Plex")
        sections = sec_resp.json().get("MediaContainer", {}).get("Directory", [])

        for section in sections:
            sec_type = section.get("type")
            sec_id = section.get("key")
            if sec_type not in ("show", "movie"):
                continue

            resp = await client.get(f"{url}/library/sections/{sec_id}/all", headers=hdrs)
            if resp.status_code != 200:
                continue
            items = resp.json().get("MediaContainer", {}).get("Metadata", [])

            for item in items:
                title = item.get("title", "")
                thumb = item.get("thumb")
                year = item.get("year")
                rating = item.get("rating")
                rk = item.get("ratingKey")

                if sec_type == "show":
                    episodes = int(item.get("leafCount", 0))
                    seasons = int(item.get("childCount", 0))
                    if episodes < 1:
                        continue
                    # Estimate hours of content
                    hours = round(episodes * 0.5, 1)  # ~30min avg per episode
                    desc = f"24/7 {title} — {episodes} episodes across {seasons} season{'s' if seasons != 1 else ''} ({hours}h of content)"
                    content_type = "shows"
                    sort_score = episodes  # More episodes = better candidate
                else:
                    # For movies, check if it's part of a collection/franchise
                    # Single movies aren't great for 24/7, skip them
                    continue

                ch_name = f"Galaxy {title}" if not title.lower().startswith("the ") else f"Galaxy {title[4:]}"
                if ch_name.lower() in existing_channels:
                    continue

                suggestions.append({
                    "title": title,
                    "channel_name": ch_name,
                    "type": content_type,
                    "episodes": episodes if sec_type == "show" else 0,
                    "seasons": seasons if sec_type == "show" else 0,
                    "hours": hours if sec_type == "show" else 0,
                    "description": desc,
                    "thumb": thumb,
                    "rating_key": rk,
                    "year": year,
                    "rating": rating,
                    "sort_score": sort_score,
                })

    # Also find movie franchises from collections
    # Use the same httpx client from above — reopen since we closed it
    async with httpx.AsyncClient(timeout=60) as client:
        for section in sections:
            sec_type = section.get("type")
            if sec_type != "movie":
                continue
            sec_id = section.get("key")

            # Try multiple collection endpoints — Plex varies by version
            colls = []
            for coll_path in [
                f"{url}/library/sections/{sec_id}/collections",
                f"{url}/library/sections/{sec_id}/all?type=18",
            ]:
                try:
                    coll_resp = await client.get(coll_path, headers=hdrs)
                    if coll_resp.status_code == 200:
                        found = coll_resp.json().get("MediaContainer", {}).get("Metadata", []) or []
                        if found:
                            colls = found
                            break
                except Exception:
                    continue

            for coll in colls:
                coll_title = coll.get("title", "")
                if not coll_title:
                    continue
                rk = coll.get("ratingKey", "")
                child_count = int(coll.get("childCount", 0) or 0)
                leaf_count = int(coll.get("leafCount", 0) or 0)
                child_count = max(child_count, leaf_count)

                # If count is still 0, fetch children to get actual count
                if child_count == 0 and rk:
                    try:
                        cr = await client.get(f"{url}/library/collections/{rk}/children", headers=hdrs)
                        if cr.status_code == 200:
                            mc = cr.json().get("MediaContainer", {})
                            child_count = int(mc.get("size", 0) or 0)
                            if child_count == 0:
                                child_count = len(mc.get("Metadata", []) or [])
                    except Exception:
                        pass

                if child_count < 2:
                    continue
                hours = round(child_count * 2, 1)
                ch_name = f"Galaxy {coll_title}" if not coll_title.lower().startswith("the ") else f"Galaxy {coll_title[4:]}"
                if ch_name.lower() in existing_channels:
                    continue
                suggestions.append({
                    "title": coll_title,
                    "channel_name": ch_name,
                    "type": "movies",
                    "episodes": child_count,
                    "seasons": 0,
                    "hours": hours,
                    "description": f"24/7 {coll_title} Marathon — {child_count} films ({hours}h of content)",
                    "thumb": coll.get("thumb"),
                    "rating_key": rk,
                    "year": None,
                    "rating": None,
                    "sort_score": child_count * 3,
                })

    # Sort by score (most content first) and find available numbers
    suggestions.sort(key=lambda x: -x["sort_score"])
    avail_numbers = sorted(n for n in range(200, 300) if n not in used_numbers)

    for i, s in enumerate(suggestions):
        s["suggested_number"] = avail_numbers[i] if i < len(avail_numbers) else 200 + i
    return suggestions

@app.post("/api/channels/create-package")
def create_channel_package(body: dict):
    """Create multiple channels at once from a package definition."""
    channels_to_create = body.get("channels", [])
    created = []
    with get_db() as conn:
        for ch in channels_to_create:
            try:
                conn.execute(
                    "INSERT INTO channels (number, name, tier, vibe, mode, style, color, uid) VALUES (?,?,?,?,?,?,?,?)",
                    (ch["number"], ch["name"], ch.get("tier", "Galaxy Main"),
                     ch.get("vibe", ""), ch.get("mode", "Shuffle"),
                     ch.get("description", ""), ch.get("color", "blue"),
                     _new_channel_uid())
                )
                created.append(ch["number"])
            except sqlite3.IntegrityError:
                pass  # skip existing
    return {"created": created}

# ── AI full-day schedule generator ─────────────────────────────────────────────

class AIFullDayIn(BaseModel):
    channel_number: int
    style: str = "cable"  # cable, kids, anime, movies

@app.post("/api/blocks/ai-generate-day")
async def ai_generate_full_day(body: AIFullDayIn):
    """AI generates a full day of blocks with show assignments for a channel."""
    with get_db() as conn:
        settings_rows = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings")}
        ch_row = conn.execute("SELECT * FROM channels WHERE number=?", (body.channel_number,)).fetchone()
        assignments = [dict(a) for a in conn.execute(
            "SELECT * FROM assignments WHERE channel_number=? ORDER BY plex_type, plex_title",
            (body.channel_number,)
        ).fetchall()]
        existing_blocks = [_row_to_block(r) for r in conn.execute(
            "SELECT * FROM blocks WHERE channel_number=? ORDER BY start_time",
            (body.channel_number,)
        ).fetchall()]

    ch = dict(ch_row) if ch_row else {}
    api_key  = settings_rows.get("openai_api_key", "")
    base_url = (settings_rows.get("openai_base_url") or "https://api.openai.com/v1").rstrip("/")
    model    = settings_rows.get("openai_model", "gpt-4o-mini")
    if not api_key:
        raise HTTPException(400, "AI API key not configured in Settings")
    if not assignments:
        raise HTTPException(400, "No content assigned to this channel — add shows first")

    shows = [a for a in assignments if a["plex_type"] == "show"]
    movies = [a for a in assignments if a["plex_type"] == "movie"]
    existing_info = "\n".join(f"- {b['name']}: {b['start_time']}-{b['end_time']}" for b in existing_blocks) or "None"

    content_list = "\n".join(
        f"{a['plex_rating_key']} | {a['plex_title']} | {a['plex_type']}"
        for a in assignments
    )

    prompt = f"""You are a TV network programmer. Design a complete daily schedule of programming blocks for a cable channel.

Channel: {ch.get('name', 'Channel ' + str(body.channel_number))}
Vibe: {ch.get('vibe', 'General entertainment')}
Style: {body.style}
Available: {len(shows)} TV shows, {len(movies)} movies

Content list (rating_key | title | type):
{content_list}

Existing blocks (avoid overlapping): {existing_info}

Create 4-8 blocks that cover the full 24-hour day. Each block should have a name, time range, content type, and 2-6 shows/movies assigned to time slots within it.

Rules:
- Blocks must not overlap with each other or existing blocks
- Use real TV programming patterns (morning light, afternoon reruns, primetime flagship, late night)
- plex_rating_key and plex_title must come EXACTLY from the content list
- slot times must be within the block's start_time/end_time range
- shows: duration_minutes=60, movies: duration_minutes=120
- Give blocks descriptive names like "Morning Block", "Primetime", "Late Night"

Reply with ONLY this JSON (no markdown):
{{"blocks":[{{"name":"Block Name","start_time":"HH:MM","end_time":"HH:MM","days":["mon","tue","wed","thu","fri","sat","sun"],"content_type":"shows","notes":"description","slots":[{{"slot_time":"HH:MM","plex_rating_key":"1234","plex_title":"Exact Title","plex_type":"show","duration_minutes":60}}]}}]}}"""

    import time as _time
    t0 = _time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            r = await client.post(f"{base_url}/chat/completions", json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.7,
            }, headers={"Authorization": f"Bearer {api_key}"})
        ms = int((_time.monotonic() - t0) * 1000)
        if r.status_code != 200:
            raise HTTPException(502, f"AI API error: {r.text[:200]}")
        raw = _extract_ai_content(r.json())
        data = _parse_ai_json(raw)
        blocks = data.get("blocks", []) if isinstance(data, dict) else data

        # Log
        _log_ai(None, "full-day", body.channel_number, model, base_url, prompt[:500], raw[:1000], _json.dumps(blocks), None, ms)

        return {"blocks": blocks, "duration_ms": ms}
    except _json.JSONDecodeError as e:
        _log_ai(None, "full-day", body.channel_number, model, base_url, prompt[:500], raw[:1000] if 'raw' in dir() else None, None, f"JSON parse error: {e}", int((_time.monotonic() - t0) * 1000))
        raise HTTPException(502, f"AI returned invalid JSON: {str(e)[:100]}")
    except Exception as e:
        raise HTTPException(502, f"AI error: {str(e)[:200]}")

_SCHEDULE_TEMPLATES_PATH = Path("/app/schedule_templates.json")

@app.get("/api/schedule-templates")
def get_schedule_templates():
    """Return the curated schedule templates library."""
    if not _SCHEDULE_TEMPLATES_PATH.exists():
        raise HTTPException(404, "schedule_templates.json not found")
    with open(_SCHEDULE_TEMPLATES_PATH) as f:
        return _json.load(f)

# ── AI Autofill ────────────────────────────────────────────────────────────────

def _hours_in_block(start_t: str, end_t: str) -> list[str]:
    h, m = map(int, start_t.split(":"))
    eh, em = map(int, end_t.split(":"))
    start_mins = h * 60 + m
    end_mins = eh * 60 + em
    if end_mins <= start_mins:
        end_mins += 24 * 60
    hours = []
    cur = start_mins
    while cur < end_mins:
        hh = (cur // 60) % 24
        hours.append(f"{hh:02d}:{cur % 60:02d}")
        cur += 60
    return hours

def _log_ai(block_id, block_name, channel_number, model, base_url, prompt, raw, slots, error, duration_ms):
    try:
        with get_db() as conn:
            conn.execute(
                """INSERT INTO ai_logs
                   (block_id, block_name, channel_number, model, base_url, prompt, response_raw, slots_json, error, duration_ms)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (block_id, block_name, channel_number, model, base_url,
                 prompt, raw, _json.dumps(slots) if slots else None, error, duration_ms)
            )
    except Exception:
        pass

@app.post("/api/blocks/{block_id}/ai-autofill")
async def ai_autofill_block(block_id: int, body: AIAutofillIn):
    with get_db() as conn:
        settings_rows = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings")}
        block_row = conn.execute("SELECT * FROM blocks WHERE id=?", (block_id,)).fetchone()
        if not block_row:
            raise HTTPException(404, "Block not found")
        block = _row_to_block(block_row)
        existing_slots = [dict(s) for s in conn.execute(
            "SELECT * FROM block_slots WHERE block_id=? ORDER BY slot_time", (block_id,)
        ).fetchall()]
        channel_number = body.channel_number or block.get("channel_number")
        content_type = block.get("content_type", "both")
        type_filter = ("AND plex_type='show'" if content_type == "shows"
                       else "AND plex_type='movie'" if content_type == "movies" else "")
        if channel_number:
            assignments = [dict(a) for a in conn.execute(
                f"SELECT * FROM assignments WHERE channel_number=? {type_filter} ORDER BY plex_title",
                (channel_number,)
            ).fetchall()]
        else:
            # Generic block: use ALL assignments across all channels (deduplicated by rating key)
            all_rows = conn.execute(
                f"SELECT * FROM assignments WHERE 1=1 {type_filter} ORDER BY plex_title"
            ).fetchall()
            seen_keys: set[str] = set()
            assignments = []
            for a in all_rows:
                rk = str(a["plex_rating_key"])
                if rk not in seen_keys:
                    seen_keys.add(rk)
                    assignments.append(dict(a))
        if not assignments:
            raise HTTPException(400, "No content available — assign shows to channels first")

    api_key  = settings_rows.get("openai_api_key", "")
    base_url = (settings_rows.get("openai_base_url") or "https://api.openai.com/v1").rstrip("/")
    model    = settings_rows.get("openai_model", "gpt-4o-mini")
    if not api_key:
        _log_ai(block_id, block.get("name"), channel_number, model, base_url, None, None, None, "AI API key not configured in Settings", 0)
        raise HTTPException(400, "AI API key not configured in Settings")

    existing_times = {s["slot_time"] for s in existing_slots}
    empty_hours = [h for h in _hours_in_block(block["start_time"], block["end_time"])
                   if h not in existing_times]
    if not empty_hours:
        _log_ai(block_id, block.get("name"), channel_number, model, base_url, None, None, None, "No empty slots to fill", 0)
        return {"slots": [], "message": "No empty slots to fill"}

    ch = _get_channel(channel_number) or {}
    content_lines = "\n".join(
        f"{a['plex_rating_key']} | {a['plex_title']} | {a['plex_type']}"
        for a in assignments
    ) or "No content assigned yet"
    existing_lines = "\n".join(
        f"- {s['slot_time']}: {s['plex_title']} ({s['duration_minutes']}min)"
        for s in existing_slots
    ) or "None"

    prompt = f"""You are a TV scheduler. Assign content to time slots. Reply with ONLY a JSON array.

Block: "{block['name']}" on {ch.get('name','channel')} | {block['start_time']}-{block['end_time']} | {content_type}

Content list (rating_key | title | type):
{content_lines}

Slots already filled: {existing_lines}
Empty slots to fill: {', '.join(empty_hours)}

Rules:
- plex_rating_key and plex_title must come exactly from the content list above (do NOT modify titles)
- Vary content, no back-to-back repeats
- shows: duration_minutes=60, movies: duration_minutes=120

Reply with ONLY this JSON (no markdown, no text before or after):
[{{"slot_time":"HH:MM","plex_rating_key":"1234","plex_title":"Exact Title","plex_type":"show","duration_minutes":60}}]"""

    import time as _time
    t0 = _time.monotonic()
    raw = ""
    error_msg = None
    slots = []
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.5,
                    "stream": False,
                },
            )
        if resp.status_code != 200:
            error_msg = resp.text[:500]
            try:
                error_msg = resp.json().get("error", {}).get("message", error_msg)
            except Exception:
                pass
            raise HTTPException(502, f"AI error: {error_msg}")
        resp_json = resp.json()
        raw = _extract_ai_content(resp_json)
        cleaned = raw
        # Strip markdown code fences
        if "```" in cleaned:
            cleaned = cleaned.split("```")[1]
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]
            cleaned = cleaned.split("```")[0]
        cleaned = cleaned.strip()
        # Try full parse first
        try:
            slots = _json.loads(cleaned)
        except _json.JSONDecodeError:
            # Truncated response — extract all complete objects using regex
            import re as _re
            objects = _re.findall(r'\{[^{}]+\}', cleaned, _re.DOTALL)
            slots = []
            for obj in objects:
                try:
                    slots.append(_json.loads(obj))
                except _json.JSONDecodeError:
                    pass
            if not slots:
                error_msg = f"Could not parse AI response:\n{raw[:500]}"
                raise HTTPException(502, "AI returned unparseable response")
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        raise HTTPException(502, f"AI autofill failed: {e}")
    finally:
        duration_ms = int((_time.monotonic() - t0) * 1000)
        _log_ai(block_id, block.get("name"), channel_number, model, base_url, prompt, raw, slots, error_msg, duration_ms)

    # Enrich AI slots with full Plex metadata (plex_thumb, plex_year) from assignments table
    assignment_map = {str(a["plex_rating_key"]): a for a in assignments}
    enriched = []
    for s in slots:
        rk = str(s.get("plex_rating_key", ""))
        match = assignment_map.get(rk)
        if not match:
            # Fallback: fuzzy match by title if AI slightly altered the rating_key
            title_lower = s.get("plex_title", "").lower().strip()
            match = next((a for a in assignments if a["plex_title"].lower().strip() == title_lower), None)
            if match:
                s["plex_rating_key"] = match["plex_rating_key"]
        if match:
            s["plex_thumb"] = match.get("plex_thumb")
            s["plex_year"]  = match.get("plex_year")
            s["plex_title"] = match["plex_title"]  # use exact DB title
        enriched.append(s)
    slots = enriched

    return {"slots": slots}

# ── AI Models + Test ────────────────────────────────────────────────────────────

@app.post("/api/ai-models")
async def ai_list_models(body: AITestIn):
    base_url = body.openai_base_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{base_url}/models",
                headers={"Authorization": f"Bearer {body.openai_api_key}"},
            )
        if resp.status_code != 200:
            raise HTTPException(502, resp.text[:200])
        data = resp.json()
        # OpenAI format: {"data": [{"id": "gpt-4o", ...}]}
        models = [m["id"] for m in data.get("data", [])]
        models.sort()
        return {"models": models}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, str(e))

@app.post("/api/ai-test")
async def ai_test(body: AITestIn):
    import time as _time
    base_url = body.openai_base_url.rstrip("/")
    t0 = _time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {body.openai_api_key}", "Content-Type": "application/json"},
                json={"model": body.openai_model, "messages": [{"role": "user", "content": "Reply with the single word OK"}], "stream": False},
            )
        duration_ms = int((_time.monotonic() - t0) * 1000)
        if resp.status_code != 200:
            detail = resp.json().get("error", {}).get("message", resp.text)
            raise HTTPException(502, detail)
        reply = _extract_ai_content(resp.json())
        return {"ok": True, "model": body.openai_model, "reply": reply, "duration_ms": duration_ms}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, str(e))

# ── AI Logs ────────────────────────────────────────────────────────────────────

@app.get("/api/ai-logs")
def get_ai_logs(limit: int = Query(50)):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM ai_logs ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]

@app.delete("/api/ai-logs")
def clear_ai_logs():
    with get_db() as conn:
        conn.execute("DELETE FROM ai_logs")
    _log_app("logs", "AI logs cleared")
    return {"ok": True}

# ── App Logs ─────────────────────────────────────────────────────────────────

@app.get("/api/app-logs")
def get_app_logs(limit: int = Query(100)):
    try:
        with get_db() as conn:
            rows = conn.execute(
                # id DESC tiebreaks rows sharing a created_at second so
                # newest-first is deterministic (CURRENT_TIMESTAMP is 1s-granular).
                "SELECT * FROM app_logs ORDER BY created_at DESC, id DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]
    except sqlite3.OperationalError:
        return []

@app.delete("/api/app-logs")
def clear_app_logs():
    with get_db() as conn:
        conn.execute("DELETE FROM app_logs")
    return {"ok": True}

@app.post("/api/logs/purge")
def purge_logs(days: int = Query(30)):
    """Purge logs older than N days."""
    with get_db() as conn:
        modifier = f"-{int(days)} days"
        conn.execute("DELETE FROM app_logs WHERE created_at < datetime('now', ?)", (modifier,))
        conn.execute("DELETE FROM ai_logs WHERE created_at < datetime('now', ?)", (modifier,))
    _log_app("logs", f"Purged logs older than {days} days")
    return {"ok": True}

@app.get("/api/logs/stats")
def log_stats():
    """Return log counts and oldest entries."""
    with get_db() as conn:
        app_count = conn.execute("SELECT COUNT(*) FROM app_logs").fetchone()[0]
        ai_count = conn.execute("SELECT COUNT(*) FROM ai_logs").fetchone()[0]
        app_oldest = conn.execute("SELECT MIN(created_at) FROM app_logs").fetchone()[0]
        ai_oldest = conn.execute("SELECT MIN(created_at) FROM ai_logs").fetchone()[0]
    return {
        "app_logs": {"count": app_count, "oldest": app_oldest},
        "ai_logs": {"count": ai_count, "oldest": ai_oldest},
    }

# ── Tunarr Integration ────────────────────────────────────────────────────────

# Oldest Tunarr release whose API we still support, and the newest release we've
# verified against. Support is a FLOOR (>= MIN), not a ceiling — newer Tunarr
# releases are considered supported until proven otherwise.
TUNARR_MIN_VERSION = "1.2.10"
TUNARR_TESTED_VERSION = "1.3.6"
# Tunarr 1.3.0 reworked smart-collection bodies and channel/slot schemas.
TUNARR_V13 = "1.3.0"
# Back-compat alias (referenced by older call sites / logs).
TUNARR_SUPPORTED_VERSION = TUNARR_TESTED_VERSION

def _previous_sunday_midnight_ms() -> int:
    """Unix epoch milliseconds for the most recent Sunday at 00:00:00 UTC.

    This is a CHANNEL's programming start, and it must always land on 12:00AM —
    Linearr pushes `period: "day"` time-slot schedules whose slot times are
    offsets from midnight, so a channel anchored anywhere else shifts every slot
    on that channel by the same amount. `test_tunarr_channel_writer.py` asserts
    the midnight invariant directly.

    Do NOT reuse this for a slot's `startTime`: a slot start is an offset within
    the period (see `_hhmm_to_ms`), not an absolute timestamp.
    """
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    days_since_sunday = now.weekday() + 1  # Monday=0, Sunday=6 → +1 gives days since Sunday
    if days_since_sunday == 7:
        days_since_sunday = 0  # today is Sunday
    sunday = now - timedelta(days=days_since_sunday)
    midnight = sunday.replace(hour=0, minute=0, second=0, microsecond=0)
    return int(midnight.timestamp() * 1000)

def _parse_version(v: str) -> tuple[int, ...]:
    """Parse a version string like '1.2.10' or 'v1.2.10' into a tuple of ints."""
    v = v.lstrip("v").split("-")[0]  # strip 'v' prefix and any pre-release suffix
    try:
        return tuple(int(x) for x in v.split("."))
    except (ValueError, AttributeError):
        return (0,)

def get_tunarr_url() -> str:
    with get_db() as conn:
        rows = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings")}
    return rows.get("tunarr_url", "http://tunarr:8000").rstrip("/")


def get_tunarr_public_url() -> str:
    """The configured public base, or "" when none is set."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT value FROM settings WHERE key='tunarr_public_url'").fetchone()
    return (row["value"] if row else "").strip().rstrip("/")


def _tunarr_asset_base() -> str:
    """Base URL for asset links written INTO Tunarr — icons and watermarks.

    Distinct from `get_tunarr_url`, which is where Linearr sends API requests.
    The two differ because they are read by different things: Linearr talks to
    Tunarr container-to-container (`http://tunarr:8000`), but the URLs Tunarr
    stores end up in XMLTV and in ffmpeg command lines, where they are fetched
    by Plex clients that may be nowhere near this network. A LAN-only address
    there is why icons render locally and nowhere else.

    Falls back to the internal URL, so an install that never sets this behaves
    exactly as before.
    """
    return get_tunarr_public_url() or get_tunarr_url()


def _tunarr_asset_url(stored: str | None) -> str | None:
    """Re-base a stored Tunarr asset URL onto the CURRENT asset base.

    Stored URLs are absolute and already in the database, so changing
    `tunarr_public_url` must not require a migration or leave a row pointing at
    the old host. Rather than rewrite rows, every read passes through here.

    Only Tunarr's own uploads are re-based: the path must live under
    `/images/` AND the host must be one we recognise as Tunarr. That second
    condition is the important one — a user may paste a third-party watermark
    URL (`https://example.com/logo.png`), and rewriting that onto the Tunarr
    domain would silently point at a 404.
    """
    if not stored or not str(stored).strip():
        return None
    stored = str(stored).strip()
    parsed = _urlparse(stored)
    path = parsed.path or ""
    if not path.startswith(tuple(_TUNARR_IMAGE_ALLOWED_PREFIXES)):
        return stored
    known = {
        _urlparse(u).netloc
        for u in (get_tunarr_url(), get_tunarr_public_url())
        if u
    }
    if parsed.netloc and parsed.netloc not in known:
        return stored
    suffix = path
    if parsed.query:
        suffix = f"{suffix}?{parsed.query}"
    return f"{_tunarr_asset_base().rstrip('/')}{suffix}"

_DATA_URI_RE = _re.compile(r"^data:(?P<mime>[\w.+/-]+);base64,(?P<b64>.+)$", _re.DOTALL)

_MIME_EXT = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
    "image/svg+xml": "svg", "image/gif": "gif",
}


def _decode_data_uri(data_uri: str) -> tuple[bytes, str, str] | None:
    """Decode a base64 data URI into (bytes, content_type, filename).

    Returns None for anything that is not a base64 data URI, including the
    absolute URLs a user may paste as a watermark override.
    """
    if not isinstance(data_uri, str):
        return None
    m = _DATA_URI_RE.match(data_uri.strip())
    if not m:
        return None
    mime = m.group("mime").lower()
    try:
        raw = base64.b64decode(m.group("b64"), validate=True)
    except Exception:
        return None
    if not raw:
        return None
    return raw, mime, f"linearr-watermark.{_MIME_EXT.get(mime, 'png')}"


# Legacy shared filename. Every channel's watermark image used to upload under
# this one name, and Tunarr keys uploads by filename — so each new upload
# OVERWROTE the previous one and every channel ended up drawing whichever image
# was applied last. `watermark-audit` reports channels still pointing at it.
_LEGACY_WATERMARK_FILENAME = "linearr-watermark."


def _watermark_image_filename(channel_number: int, raw: bytes, mime: str) -> str:
    """A filename no other channel can collide with.

    Tunarr's `POST /api/upload/image` stores by filename and returns the same
    `fileUrl` for a repeat name, overwriting what was there (verified against
    1.3.10). So the name has to carry both the channel and the image:

    - the channel number keeps two channels apart, and keeps the uploads
      directory readable when you are staring at an ffmpeg command;
    - the content hash keeps one channel's *old* image intact when it gets a new
      one, and makes re-applying an unchanged image a no-op rather than a new file.
    """
    digest = hashlib.sha1(raw).hexdigest()[:10]
    return f"linearr-ch{channel_number}-{digest}.{_MIME_EXT.get(mime, 'png')}"


async def _tunarr_upload_image(
    client: "httpx.AsyncClient", url: str, raw: bytes,
    content_type: str, filename: str,
) -> str | None:
    """Upload an image to Tunarr and return an absolute, reachable URL.

    Tunarr builds `fileUrl` from the inbound Host header, so the URL it returns
    is often unreachable from Linearr (which talks to `http://tunarr:8000`).
    The path is kept and the host rewritten onto the configured base URL.
    """
    try:
        r = await client.post(
            f"{url}/api/upload/image",
            files={"file": (filename, raw, content_type)},
        )
    except Exception as e:
        log.warning("Tunarr image upload failed: %s", e)
        return None
    if r.status_code not in (200, 201):
        log.warning("Tunarr rejected image upload: %s %s", r.status_code, r.text[:200])
        return None
    try:
        file_url = (r.json() or {}).get("fileUrl") or ""
    except Exception:
        return None
    if not file_url:
        return None
    path = _urlparse(file_url).path or ""
    if not path:
        return None
    return f"{url.rstrip('/')}{path}"


# Tunarr's upload directory — the only prefix `/api/tunarr/image` will fetch, so
# the route cannot be used as a general-purpose proxy.
_TUNARR_IMAGE_ALLOWED_PREFIXES = ("/images/",)

# Raster only, deliberately. This route serves bytes from Tunarr's upload
# directory on LINEARR's origin, so honouring the upstream Content-Type blindly
# would let an `image/svg+xml` (or anything Tunarr's `image/*` sniff lets in)
# execute script against the session cookie — stored XSS. Linearr's own icon
# upload accepts SVG, so that path is real, not theoretical. SVG is no loss
# here: ffmpeg cannot use one as an overlay input anyway.
_TUNARR_IMAGE_TYPES = frozenset({"image/png", "image/jpeg", "image/gif", "image/webp"})
_TUNARR_IMAGE_HEADERS = {
    "Cache-Control": "public, max-age=604800, immutable",
    # Belt and braces even with the allow-list: never let a sniffer re-interpret
    # the body, and give the response no privileges if it is ever framed.
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
}


# ── Tunarr stream proxy (for the browser) ────────────────────────────────────
# Tunarr serves a channel at `{tunarr}/stream/channels/{uuid}?streamMode=hls`,
# and the playlist it returns points at segments with ABSOLUTE urls on Tunarr's
# own configured base — `http://tunarr:8000/...` in a default Docker deploy. A
# LAN browser cannot resolve that hostname, so playing the URL directly is a
# guaranteed failure. These two routes are the browser-facing pair: fetch the
# playlist server-side, rewrite every URI back through Linearr, then stream the
# segments.

_HLS_CONTENT_TYPE = "application/vnd.apple.mpegurl"
# Prefixes a rewritten segment path is allowed to live under. Tunarr's HLS
# segments and playlists all hang off /stream/.
_TUNARR_STREAM_PREFIXES = ("/stream/",)


def _is_safe_tunarr_path(path: str, prefixes: tuple[str, ...]) -> bool:
    """SSRF guard shared by the stream routes — same rules as /api/tunarr/image.

    `path` is caller-controlled, so only a plain path under an allow-listed
    prefix is accepted: no scheme, no `//`, no `@`, no backslash, no traversal.
    The Tunarr base is prefixed server-side, never taken from the caller.
    """
    path_only = path.split("?", 1)[0]
    return not (
        not path.startswith("/") or path.startswith("//") or "://" in path
        or any(c in path for c in ("@", "\\"))
        or ".." in path_only
        or not path_only.startswith(prefixes)
    )


def _rewrite_hls_playlist(text: str, tunarr_base: str) -> str:
    """Point every URI in an HLS playlist back at `/api/tunarr/stream-segment`.

    Two kinds of reference need rewriting: bare URI lines (segments, and variant
    playlists in a master), and `URI="..."` attributes on tags like
    EXT-X-KEY and EXT-X-MAP. Anything already relative is resolved against
    Tunarr's base first, so the proxy only ever forwards an absolute Tunarr path.
    """
    from urllib.parse import quote, urljoin, urlsplit

    def to_proxy(ref: str) -> str:
        absolute = urljoin(tunarr_base + "/stream/", ref)
        split = urlsplit(absolute)
        path_q = split.path + (f"?{split.query}" if split.query else "")
        return f"/api/tunarr/stream-segment?path={quote(path_q, safe='')}"

    out: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            out.append(line)
        elif stripped.startswith("#"):
            # Rewrite any URI="..." attribute in place, leave the rest of the tag.
            def _attr(m):
                return f'URI="{to_proxy(m.group(1))}"'
            out.append(_re.sub(r'URI="([^"]+)"', _attr, line))
        else:
            out.append(to_proxy(stripped))
    return "\n".join(out) + "\n"


@app.get("/api/tunarr/stream/{tunarr_id}")
async def tunarr_stream(tunarr_id: str):
    """HLS playlist for a Tunarr channel, rewritten to play in the browser.

    Tunarr spins up ffmpeg on first request, so this can take several seconds —
    hence the long read timeout. Redirects ARE followed here (Tunarr may bounce
    to a session-specific playlist), but only the final playlist body is used and
    every URI in it is rewritten to a same-origin path.
    """
    if not _UUID_RE.match(tunarr_id):
        raise HTTPException(400, "Invalid Tunarr channel id")
    url = get_tunarr_url()
    if not url:
        raise HTTPException(400, "Tunarr not configured")
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(60.0, connect=10.0), follow_redirects=True
        ) as client:
            resp = await client.get(f"{url}/stream/channels/{tunarr_id}",
                                    params={"streamMode": "hls"})
    except Exception as e:
        log.warning("Tunarr stream proxy failed for %s: %s", tunarr_id, e)
        raise HTTPException(502, f"Could not start the Tunarr stream: {e}")
    if resp.status_code != 200:
        raise HTTPException(resp.status_code,
                            f"Tunarr stream error: {resp.text[:200]}")
    body = _rewrite_hls_playlist(resp.text, url.rstrip("/"))
    _log_app("tunarr", f"Started stream proxy for Tunarr channel {tunarr_id}",
             metadata={"tunarr_id": tunarr_id})
    return Response(
        content=body,
        media_type=_HLS_CONTENT_TYPE,
        # A live playlist must never be cached — it changes every segment.
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


@app.get("/api/tunarr/stream-segment")
async def tunarr_stream_segment(path: str = Query(...)):
    """Stream one HLS segment (or a nested playlist) from Tunarr.

    Only reached via a path this server wrote into a rewritten playlist, but the
    guard is applied anyway — the query string is still caller-controlled.
    Nested playlists are rewritten in turn so a master/variant chain keeps
    working; everything else is streamed through untouched.
    """
    if not _is_safe_tunarr_path(path, _TUNARR_STREAM_PREFIXES):
        raise HTTPException(400, "Invalid Tunarr stream path")
    url = get_tunarr_url()
    if not url:
        raise HTTPException(400, "Tunarr not configured")

    client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0),
                               follow_redirects=True)
    try:
        resp = await client.get(f"{url}{path}")
    except Exception as e:
        await client.aclose()
        log.warning("Tunarr segment proxy failed for %s: %s", path, e)
        raise HTTPException(502, "Tunarr segment fetch failed")
    if resp.status_code != 200:
        status = resp.status_code
        await client.aclose()
        raise HTTPException(status, "Tunarr segment error")

    content_type = resp.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type in (_HLS_CONTENT_TYPE, "application/x-mpegurl", "audio/x-mpegurl"):
        text = resp.text
        await client.aclose()
        return Response(
            content=_rewrite_hls_playlist(text, url.rstrip("/")),
            media_type=_HLS_CONTENT_TYPE,
            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
        )

    body = resp.content
    await client.aclose()
    return Response(
        content=body,
        media_type=content_type or "video/mp2t",
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


@app.get("/api/tunarr/image")
async def tunarr_image(path: str = Query(...)):
    """Proxy an image hosted by Tunarr, for the BROWSER.

    `watermark_image_url` is stored as an absolute URL on the configured Tunarr
    base — `http://tunarr:8000/...` on a default Docker deployment — because
    ffmpeg *inside the Tunarr container* is what fetches it. The user's browser
    is on the LAN and cannot resolve that container hostname, so rendering the
    stored value directly in an <img> is a guaranteed broken image. This route is
    the browser-facing equivalent: same-origin in, server-side fetch out.

    SSRF hardening mirrors `/api/plex/thumb`: `path` is caller-controlled, so only
    a plain path under Tunarr's `/images/` directory is accepted (no scheme, no
    `//`, no `@`, no backslash, no `..` traversal) and the Tunarr base URL is
    prefixed here rather than taken from the caller. Redirects are not followed.
    """
    path_only = path.split("?", 1)[0]
    if (not path.startswith("/") or path.startswith("//") or "://" in path
            or any(c in path for c in ("@", "\\"))
            or ".." in path_only
            or not path_only.startswith(_TUNARR_IMAGE_ALLOWED_PREFIXES)):
        raise HTTPException(400, "Invalid Tunarr image path")
    url = get_tunarr_url()
    if not url:
        raise HTTPException(400, "Tunarr not configured")
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            resp = await client.get(f"{url}{path}")
    except Exception as e:
        log.warning("Tunarr image proxy failed for %s: %s", path, e)
        raise HTTPException(502, "Tunarr image fetch failed")
    if resp.status_code != 200 or not resp.content:
        raise HTTPException(resp.status_code if resp.status_code != 200 else 502,
                            "Tunarr image error")
    content_type = resp.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type not in _TUNARR_IMAGE_TYPES:
        raise HTTPException(415, f"Unsupported Tunarr image type: {content_type or 'unknown'}")
    return Response(
        content=resp.content,
        media_type=content_type,
        headers=_TUNARR_IMAGE_HEADERS,
    )


def _watermark_to_tunarr(wm: dict, image_url: str | None) -> dict:
    """Map stored watermark config to Tunarr's WatermarkSchema.

    Only `fadeConfig[0]` is ever applied by Tunarr, so at most one entry is
    sent. `animated` and `fadeConfig[].programType` are omitted: Tunarr
    persists both but no pipeline builder reads them (1.3.6).

    **An enabled watermark is never emitted without an image URL.** Tunarr's API
    happily accepts one (both `url: ""` and an absent `url` return 200), but its
    ffmpeg pipeline then builds a command with a dangling `-i` and no path:

        ... input.mkv -i  -filter_complex [0:0]hwdownload...

    ffmpeg consumes `-filter_complex` as the input filename and exits 254, the
    filter graph still references `[1:0]` for the overlay, and the channel never
    writes a playlist — so the stream 404s and retries forever. Diagnosed on a
    real deployment (Tunarr's own Program Playback Troubleshooter) against two
    channels that had an enabled watermark with a blank URL; an otherwise
    identical channel with a valid URL transcoded fine.

    So the mapper degrades instead: no URL means `enabled: false` goes to Tunarr.
    That also self-heals a row already in the bad state — the next sync turns a
    dead channel back into a working one with no overlay, rather than leaving it
    unplayable. The image is resolved upstream (the watermark PUT uploads the
    channel icon), so a channel with an icon still gets its overlay.
    """
    image_url = (image_url or "").strip() or None
    enabled = bool(wm.get("enabled", False)) and image_url is not None
    out: dict = {
        "enabled": enabled,
        "position": wm.get("position", "bottom-right"),
        "width": float(wm.get("width", _WATERMARK_DEFAULTS["width"])),
        "verticalMargin": float(wm.get("vertical_margin",
                                       _WATERMARK_DEFAULTS["vertical_margin"])),
        "horizontalMargin": float(wm.get("horizontal_margin",
                                         _WATERMARK_DEFAULTS["horizontal_margin"])),
        "duration": float(wm.get("duration", 0.0)),
        "opacity": int(wm.get("opacity", _WATERMARK_DEFAULTS["opacity"])),
        "fixedSize": bool(wm.get("fixed_size", False)),
    }
    if image_url is not None:
        out["url"] = image_url
    fade = wm.get("fade")
    if isinstance(fade, dict) and int(fade.get("period_mins", 0)) >= 1:
        out["fadeConfig"] = [{
            "periodMins": int(fade["period_mins"]),
            "leadingEdge": bool(fade.get("leading_edge", True)),
        }]
    return out


_UUID_RE = _re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


async def _tunarr_resolve_transcode_config(
    client: "httpx.AsyncClient", url: str
) -> str | None:
    """Resolve a transcode-config uuid Tunarr will actually accept.

    Tunarr 1.3.x validates `transcodeConfigId` as a uuid AND checks it exists;
    both failures are a 400. Prefers the config flagged default, else the first
    one with a uuid-shaped id, else `/api/ffmpeg-settings`. Returns None rather
    than a bogus value — the caller must not send a non-uuid.
    """
    def _uuid_or_none(value) -> str | None:
        return value if isinstance(value, str) and _UUID_RE.match(value) else None

    try:
        r = await client.get(f"{url}/api/transcode_configs")
        if r.status_code == 200:
            data = r.json()
            configs = data if isinstance(data, list) else data.get("data", [])
            if isinstance(configs, list) and configs:
                for cfg in configs:
                    if isinstance(cfg, dict) and cfg.get("isDefault"):
                        found = _uuid_or_none(cfg.get("id"))
                        if found:
                            return found
                for cfg in configs:
                    if isinstance(cfg, dict):
                        found = _uuid_or_none(cfg.get("id"))
                        if found:
                            return found
    except Exception as e:
        log.debug("transcode_configs lookup failed: %s", e)

    try:
        r = await client.get(f"{url}/api/ffmpeg-settings")
        if r.status_code == 200:
            fj = r.json()
            if isinstance(fj, dict):
                for key in ("defaultTranscodeConfigId", "transcodeConfigId", "configId", "id"):
                    found = _uuid_or_none(fj.get(key))
                    if found:
                        return found
    except Exception as e:
        log.debug("ffmpeg-settings lookup failed: %s", e)

    return None

def _tunarr_icon_obj(data_uri: str | None) -> dict:
    """Channel icon write object. A data:/http path sets a custom icon; an empty
    path renders as none. (Tunarr 1.3 has three icon states custom/default/none —
    an empty path is the "none" case and is accepted by 1.2.x too.)"""
    return {"path": data_uri or "", "duration": 0, "width": 0, "position": "bottom-right"}

def _tunarr_channel_obj(*, name: str, number: int, group_title: str,
                        channel_id: str | None = None, transcode_id: str | None = None,
                        icon_data: str | None = None,
                        watermark: dict | None = None) -> dict:
    """Build a Tunarr channel object for create/update using fields valid across 1.2.x–1.3.x."""
    obj = {
        "name": name,
        "number": number,
        "duration": 0,
        "startTime": _previous_sunday_midnight_ms(),
        "groupTitle": group_title,
        "icon": _tunarr_icon_obj(icon_data),
        "offline": {"mode": "pic"},
        "stealth": False,
        "disableFillerOverlay": True,
        "guideMinimumDuration": 30000,
        "streamMode": "hls",
        "subtitlesEnabled": False,
    }
    if watermark is not None:
        obj["watermark"] = watermark
    if channel_id:
        obj["id"] = channel_id
    if transcode_id:
        obj["transcodeConfigId"] = transcode_id
    # No `transcoding` fallback: it is read-only in Tunarr's SaveableChannel
    # (stripped on write) while transcodeConfigId is required. Sending it in
    # place of a real config id guarantees a 400 — the caller must resolve one
    # via _tunarr_resolve_transcode_config.
    return obj

async def _tunarr_create_channel(client: "httpx.AsyncClient", url: str, channel_obj: dict):
    """POST a new channel.

    Tunarr's create body is a discriminated union — `{"type":"new","channel":{…}}`
    — in every 1.x release (verified against v1.0.0 through v1.3.9); there has
    never been a flat-object form. The client must supply `channel.id` because
    the schema requires it, but Tunarr ignores the value and assigns its own
    uuid, so the real id must be read from the response.
    """
    obj = dict(channel_obj)
    obj.setdefault("id", str(uuid.uuid4()))
    return await client.post(f"{url}/api/channels", json={"type": "new", "channel": obj})


# Tunarr's ChannelSchema exposes these but SaveableChannel omits them — they are
# stripped by its zod object, so sending them is harmless but pointless. We drop
# them explicitly so a read-modify-write PUT carries only writable fields.
_TUNARR_READONLY_CHANNEL_KEYS = frozenset(
    {"programCount", "transcoding", "sessions", "fallback", "programs"}
)


async def _tunarr_save_channel(
    client: "httpx.AsyncClient", url: str, tunarr_id: str, changes: dict
) -> "httpx.Response":
    """Update a Tunarr channel by read-modify-write.

    Tunarr's `PUT /api/channels/:id` body is the FULL SaveableChannel — only
    `onDemand` is partial — so a body carrying just the changed keys is a 400.
    Read the channel, apply `changes`, and write the whole object back.

    Values we do not touch are echoed verbatim, which is required for
    `guideMinimumDuration` (whose unit is inconsistent inside Tunarr) and
    `duration` (server-maintained; sending 0 zeroes it).

    Returns the PUT response, or the failing GET response when the read fails
    (so the caller sees one status either way).
    """
    r = await client.get(f"{url}/api/channels/{tunarr_id}")
    if r.status_code != 200:
        return r
    try:
        current = r.json()
    except Exception:
        current = None
    if not isinstance(current, dict):
        return httpx.Response(
            502,
            json={"error": "Tunarr returned an unreadable channel body; nothing was written"},
            request=r.request,
        )

    payload = {**current, **changes}
    payload = {k: v for k, v in payload.items() if k not in _TUNARR_READONLY_CHANNEL_KEYS}
    payload.setdefault("id", tunarr_id)
    return await client.put(f"{url}/api/channels/{tunarr_id}", json=payload)


class TunarrTestIn(BaseModel):
    url: str | None = None

@app.post("/api/tunarr/test")
async def tunarr_test(body: TunarrTestIn | None = None):
    import time as _t
    url = (body.url.rstrip("/") if body and body.url else None) or get_tunarr_url()
    t0 = _t.monotonic()
    # Try multiple paths — Tunarr version differences
    async with httpx.AsyncClient(timeout=8.0) as client:
        for path in ("/health", "/api/health", "/api/channels"):
            try:
                r = await client.get(f"{url}{path}")
                ms = int((_t.monotonic() - t0) * 1000)
                if r.status_code in (200, 204):
                    # Fetch extra info: version + channel count
                    version = ""
                    channel_count = 0
                    try:
                        vr = await client.get(f"{url}/api/version")
                        if vr.status_code == 200:
                            version = vr.json().get("tunarr", vr.json().get("version", ""))
                    except Exception:
                        pass
                    try:
                        cr = await client.get(f"{url}/api/channels")
                        if cr.status_code == 200:
                            channel_count = len(cr.json()) if isinstance(cr.json(), list) else 0
                    except Exception:
                        pass
                    return {"ok": True, "latency_ms": ms, "url": url, "path": path,
                            "version": version, "channels": channel_count}
            except (httpx.ConnectError, httpx.TimeoutException):
                continue
            except Exception:
                continue
    raise HTTPException(503, f"Cannot reach Tunarr at {url} — check the URL in Settings. If running in Docker use http://tunarr:8000 (not localhost)")

@app.get("/api/tunarr/version-check")
async def tunarr_version_check():
    url = get_tunarr_url()
    version = ""
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            vr = await client.get(f"{url}/api/version")
            if vr.status_code == 200:
                data = vr.json()
                version = data.get("tunarr", data.get("version", ""))
    except Exception:
        pass
    if not version:
        return {"version": None, "min_version": TUNARR_MIN_VERSION,
                "tested_version": TUNARR_TESTED_VERSION, "supported_version": TUNARR_TESTED_VERSION,
                "is_supported": None, "tunarr_url": url}
    parsed = _parse_version(version)
    is_supported = parsed >= _parse_version(TUNARR_MIN_VERSION)
    # Newer than what we've verified against — supported, but flag it for the UI.
    is_newer_than_tested = parsed > _parse_version(TUNARR_TESTED_VERSION)
    return {"version": version, "min_version": TUNARR_MIN_VERSION,
            "tested_version": TUNARR_TESTED_VERSION, "supported_version": TUNARR_TESTED_VERSION,
            "is_supported": is_supported, "is_newer_than_tested": is_newer_than_tested,
            "tunarr_url": url}

@app.get("/api/tunarr/channels")
async def tunarr_list_channels():
    url = get_tunarr_url()
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(f"{url}/api/channels")
    if r.status_code != 200:
        raise HTTPException(r.status_code, "Tunarr error")
    return r.json()

@app.post("/api/icons/import-from-tunarr")
async def import_icons_from_tunarr():
    """Fetch icons from ALL Tunarr channels and import into icon library.
    Auto-assigns to linked Linearr channels where a link exists."""
    import base64
    url = get_tunarr_url()

    # Get all channel links for auto-assignment
    with get_db() as conn:
        links = {r["tunarr_id"]: dict(r) for r in conn.execute("SELECT * FROM tunarr_channel_links").fetchall()}

    imported = 0
    assigned = 0
    skipped = 0
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Fetch ALL Tunarr channels
        r = await client.get(f"{url}/api/channels")
        if r.status_code != 200:
            raise HTTPException(502, "Cannot fetch Tunarr channels")
        tunarr_channels = r.json() if isinstance(r.json(), list) else []

        for ch in tunarr_channels:
            tunarr_id = ch.get("id", "")
            icon_info = ch.get("icon") or {}
            icon_path = icon_info.get("path", "") if isinstance(icon_info, dict) else ""
            if not icon_path:
                skipped += 1
                continue

            try:
                icon_url = icon_path if icon_path.startswith("http") else f"{url}{icon_path}"
                ir = await client.get(icon_url)
                if ir.status_code != 200:
                    skipped += 1
                    continue
                ct = ir.headers.get("content-type", "image/png")
                mime = ct.split(";")[0].strip()
                b64 = base64.b64encode(ir.content).decode()
                data_url = f"data:{mime};base64,{b64}"

                ch_name = ch.get("name", f"Tunarr {ch.get('number', '?')}")

                with get_db() as conn:
                    existing = conn.execute(
                        "SELECT id FROM saved_icons WHERE name=? AND category=?",
                        (ch_name, "tunarr"),
                    ).fetchone()
                    if existing:
                        conn.execute("UPDATE saved_icons SET data=? WHERE id=?", (data_url, existing["id"]))
                    else:
                        conn.execute(
                            "INSERT INTO saved_icons (name, category, data) VALUES (?, ?, ?)",
                            (ch_name, "tunarr", data_url),
                        )
                    imported += 1
                    # Auto-assign if this Tunarr channel is linked to a Linearr channel
                    link = links.get(tunarr_id)
                    if link:
                        conn.execute("UPDATE channels SET icon=? WHERE number=?", (data_url, link["channel_number"]))
                        assigned += 1
            except Exception as e:
                log.warning("Failed to import icon for Tunarr channel %s: %s", tunarr_id, e)
                skipped += 1
                continue

    _log_app("icons", f"Imported {imported} icons from Tunarr, {assigned} assigned, {skipped} skipped")
    return {"ok": True, "imported": imported, "assigned": assigned, "skipped": skipped}

@app.post("/api/tunarr/channels", status_code=201)
async def tunarr_create_channel(body: dict):
    """Create a new channel in Tunarr with HLS + Default transcode config."""
    url = get_tunarr_url()
    channel_id = str(uuid.uuid4())

    async with httpx.AsyncClient(timeout=15.0) as client:
        transcode_id = await _tunarr_resolve_transcode_config(client, url)
        if not transcode_id:
            # Required by Tunarr 1.3.x; without it the create comes back as an
            # unexplained 400. Say what is actually wrong.
            raise HTTPException(502, _NO_TRANSCODE_CONFIG_MSG)

        icon_in = body.get("icon")
        channel_obj = _tunarr_channel_obj(
            name=body.get("name", "New Channel"),
            number=body.get("number", 1),
            group_title=body.get("groupTitle", "Galaxy Network"),
            channel_id=channel_id,
            transcode_id=transcode_id,
            icon_data=icon_in if isinstance(icon_in, str) else None,
        )
        r = await _tunarr_create_channel(client, url, channel_obj)
    if r.status_code not in (200, 201):
        raise HTTPException(r.status_code, f"Tunarr error: {r.text[:300]}")
    return r.json()

@app.get("/api/tunarr/channels/{tunarr_id}/detail")
async def tunarr_get_channel_detail(tunarr_id: str):
    url = get_tunarr_url()
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(f"{url}/api/channels/{tunarr_id}")
    if r.status_code == 404:
        return None
    if r.status_code != 200:
        raise HTTPException(r.status_code, "Tunarr error")
    return r.json()

def _extract_schedule_items(data) -> list[dict]:
    """Extract schedule items from Tunarr response (may be list or dict)."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        # Tunarr may return { "items": [...] }, { "programs": [...] }, or { "slots": [...] }
        for key in ("items", "programs", "slots", "lineup", "schedule"):
            if key in data and isinstance(data[key], list):
                return data[key]
        # Programming endpoint returns {type: "time", timeSlots: [...], ...}
        if "timeSlots" in data and isinstance(data["timeSlots"], list):
            return data["timeSlots"]
        # If it has schedule-like fields directly, wrap it
        if "startTime" in data or "start_time" in data or "startTimeMs" in data:
            return [data]
    return []

@app.get("/api/tunarr/channels/{tunarr_id}/schedule")
async def tunarr_get_schedule(tunarr_id: str, hours: int = Query(6)):
    """Get materialized lineup for a Tunarr channel (what's actually playing)."""
    url = get_tunarr_url()
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    date_from = now.isoformat()
    date_to = (now + timedelta(hours=hours)).isoformat()
    async with httpx.AsyncClient(timeout=15.0) as client:
        # 1. Try the guide API (returns lineup with startTimeMs)
        try:
            r = await client.get(f"{url}/api/guide/channels/{tunarr_id}",
                                 params={"dateFrom": date_from, "dateTo": date_to})
            if r.status_code == 200:
                data = r.json()
                programs = data.get("programs", []) if isinstance(data, dict) else []
                if not programs and isinstance(data, list):
                    programs = data
                if programs:
                    result = _normalize_guide_programs(programs)
                    # If programs lack titles, try to enrich from programming endpoint
                    if result and not result[0].get("title") or result[0].get("title") == "Program":
                        try:
                            pr = await client.get(f"{url}/api/channels/{tunarr_id}/programming")
                            if pr.status_code == 200:
                                prog_data = _extract_schedule_items(pr.json())
                                enriched = _normalize_guide_programs(prog_data)
                                if enriched and enriched[0].get("title") and enriched[0]["title"] != "Program":
                                    return enriched
                        except Exception:
                            pass
                    return result
        except Exception as e:
            log.warning("Tunarr guide API failed for %s: %s", tunarr_id, e)
        # 2. Try the lineup API
        try:
            r = await client.get(f"{url}/api/channels/{tunarr_id}/lineup",
                                 params={"from": date_from, "to": date_to})
            if r.status_code == 200:
                raw = r.json()
                items = raw if isinstance(raw, list) else raw.get("items", raw.get("programs", []))
                if items:
                    return _normalize_guide_programs(items)
        except Exception as e:
            log.warning("Tunarr lineup API failed for %s: %s", tunarr_id, e)
        # 3. Try programming endpoint (often has titles)
        try:
            r = await client.get(f"{url}/api/channels/{tunarr_id}/programming")
            if r.status_code == 200:
                raw = r.json()
                items = _extract_schedule_items(raw)
                if items:
                    return _normalize_guide_programs(items)
        except Exception as e:
            log.warning("Tunarr programming API failed for %s: %s", tunarr_id, e)
        # 4. Last fallback: schedule config
        try:
            r = await client.get(f"{url}/api/channels/{tunarr_id}/schedule")
            if r.status_code == 200:
                return _extract_schedule_items(r.json())
        except Exception as e:
            log.warning("Tunarr schedule API failed for %s: %s", tunarr_id, e)
    return []

def _normalize_guide_programs(programs: list) -> list[dict]:
    """Normalize Tunarr guide/lineup programs to a consistent format.

    Handles multiple Tunarr response formats:
    - New format: {startTimeMs, lineupItem: {type, id, durationMs, title?, ...}, listing: {title, ...}}
    - Old format: {start/startTime, duration, title, ...}
    """
    # Log first item for debugging
    if programs:
        sample = programs[0]
        log.debug("Guide program sample keys: %s", list(sample.keys()) if isinstance(sample, dict) else type(sample).__name__)
        lineup_sample = sample.get("lineupItem", {}) if isinstance(sample, dict) else {}
        if lineup_sample:
            log.debug("  lineupItem keys: %s", list(lineup_sample.keys()))
        listing_sample = sample.get("listing", {}) if isinstance(sample, dict) else {}
        if listing_sample:
            log.debug("  listing keys: %s", list(listing_sample.keys()))

    items = []
    for p in programs:
        lineup = p.get("lineupItem") or {}
        listing = p.get("listing") or {}
        program = p.get("program") or {}

        # ── Start time ──
        start_val = p.get("startTimeMs") or 0
        if not start_val:
            start = p.get("start") or p.get("startTime") or p.get("start_time") or ""
            if isinstance(start, (int, float)):
                start_val = int(start)
            elif isinstance(start, str) and start:
                try:
                    from datetime import datetime
                    start_val = int(datetime.fromisoformat(start.replace("Z", "+00:00")).timestamp() * 1000)
                except Exception:
                    start_val = 0

        # ── Duration ──
        duration = lineup.get("durationMs") or p.get("duration") or p.get("durationMs") or 0
        if not duration:
            stop = p.get("stop") or p.get("endTime") or p.get("end_time") or ""
            if stop and start_val:
                try:
                    from datetime import datetime
                    e = datetime.fromisoformat(str(stop).replace("Z", "+00:00"))
                    duration = int(e.timestamp() * 1000) - start_val
                except Exception:
                    pass

        # ── Title (check all possible locations) ──
        title = (
            listing.get("title")
            or listing.get("showTitle")
            or program.get("title")
            or program.get("showTitle")
            or p.get("title")
            or p.get("programTitle")
            or p.get("showTitle")
            or lineup.get("title")
            or lineup.get("showTitle")
            or lineup.get("programTitle")
            or ""
        )

        # ── Episode info ──
        episode = p.get("episode") or lineup.get("episode") or listing.get("episode")
        ep_title = (
            listing.get("episodeTitle")
            or program.get("episodeTitle")
            or p.get("episodeTitle")
            or lineup.get("episodeTitle")
            or listing.get("title")  # for episodes, listing.title is often the episode title
            or ""
        )
        # `p.get("seasonNumber")` is where the bulk EPG puts it — without it the
        # episode label came out as "S?E1", since the episode chain already
        # covered `p` but the season chain stopped at the older `p["season"]`.
        season_num = (listing.get("seasonNumber") or program.get("seasonNumber")
                      or lineup.get("seasonNumber") or p.get("seasonNumber")
                      or p.get("season"))
        episode_num = (listing.get("episodeNumber") or program.get("episodeNumber")
                       or lineup.get("episodeNumber") or p.get("episode_number")
                       or p.get("episodeNumber"))

        # For shows: if listing has showTitle, the title is the show, ep_title is the episode
        show_title = listing.get("showTitle") or program.get("showTitle") or ""
        if show_title and not title:
            title = show_title
        if show_title and ep_title and ep_title != show_title:
            if not episode:
                episode = {"title": ep_title, "season": season_num, "episode": episode_num}
        elif not episode and (ep_title or season_num):
            episode = {
                "title": ep_title if ep_title != title else "",
                "season": season_num,
                "episode": episode_num,
            }

        # ── Type ──
        item_type = lineup.get("type") or p.get("type") or listing.get("type") or ""

        # If no title, build one from what we have
        if not title:
            if item_type == "flex":
                title = "Flex"
            elif item_type == "redirect":
                title = "Redirect"
            elif item_type == "offline":
                title = "Offline"
            else:
                title = "Program"

        items.append({
            "startTime": start_val,
            "duration": duration,
            "type": item_type,
            "title": title,
            "episode": episode,
        })
    return items

@app.get("/api/tunarr/debug")
async def tunarr_debug_api():
    """Debug: discover Tunarr API structure by probing many possible paths."""
    url = get_tunarr_url()
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    date_from = now.isoformat()
    date_to = (now + timedelta(hours=6)).isoformat()
    with get_db() as conn:
        links = [dict(r) for r in conn.execute("SELECT * FROM tunarr_channel_links").fetchall()]
    tid = links[0]["tunarr_id"] if links else "unknown"

    # Probe many possible API paths to discover which ones exist
    probe_paths = [
        # Root / version
        ("GET /api", f"{url}/api", None),
        ("GET /api/version", f"{url}/api/version", None),
        ("GET /api/v2", f"{url}/api/v2", None),
        # Channels
        ("GET /api/channels", f"{url}/api/channels", None),
        ("GET /api/v2/channels", f"{url}/api/v2/channels", None),
        # Single channel
        ("GET /api/channels/{id}", f"{url}/api/channels/{tid}", None),
        ("GET /api/v2/channels/{id}", f"{url}/api/v2/channels/{tid}", None),
        # Guide
        ("GET /api/guide", f"{url}/api/guide", None),
        ("GET /api/guide/channels", f"{url}/api/guide/channels", {"dateFrom": date_from, "dateTo": date_to}),
        ("GET /api/guide/channels/{id}", f"{url}/api/guide/channels/{tid}", {"dateFrom": date_from, "dateTo": date_to}),
        ("GET /api/v2/guide", f"{url}/api/v2/guide", None),
        ("GET /api/v2/guide/channels", f"{url}/api/v2/guide/channels", {"dateFrom": date_from, "dateTo": date_to}),
        # Programming / lineup / schedule
        ("GET /api/channels/{id}/programming", f"{url}/api/channels/{tid}/programming", None),
        ("GET /api/channels/{id}/lineup", f"{url}/api/channels/{tid}/lineup", {"from": date_from, "to": date_to}),
        ("GET /api/channels/{id}/schedule", f"{url}/api/channels/{tid}/schedule", None),
        ("GET /api/v2/channels/{id}/programming", f"{url}/api/v2/channels/{tid}/programming", None),
        ("GET /api/v2/channels/{id}/lineup", f"{url}/api/v2/channels/{tid}/lineup", {"from": date_from, "to": date_to}),
        ("GET /api/v2/channels/{id}/schedule", f"{url}/api/v2/channels/{tid}/schedule", None),
        # Lineup with dateFrom (alt params)
        ("GET /api/channels/{id}/lineup?dateFrom", f"{url}/api/channels/{tid}/lineup", {"dateFrom": date_from, "dateTo": date_to}),
        # Shows
        ("GET /api/channels/{id}/shows", f"{url}/api/channels/{tid}/shows", None),
        ("GET /api/shows", f"{url}/api/shows", None),
        # XMLTV / EPG
        ("GET /api/xmltv.xml", f"{url}/api/xmltv.xml", None),
        # Health
        ("GET /api/health", f"{url}/api/health", None),
        ("GET /health", f"{url}/health", None),
    ]

    results = {"tunarr_url": url, "channel_id_used": tid, "links_count": len(links)}
    api_results = {}
    async with httpx.AsyncClient(timeout=10.0) as client:
        for name, path, params in probe_paths:
            try:
                if params:
                    r = await client.get(path, params=params)
                else:
                    r = await client.get(path)
                info = {"status": r.status_code}
                if r.status_code == 200:
                    ct = r.headers.get("content-type", "")
                    if "json" in ct:
                        body = r.json()
                        info["type"] = type(body).__name__
                        if isinstance(body, list):
                            info["count"] = len(body)
                            if body:
                                info["first_keys"] = list(body[0].keys()) if isinstance(body[0], dict) else str(type(body[0]))
                                info["sample"] = body[0] if isinstance(body[0], dict) and len(str(body[0])) < 500 else "..."
                        elif isinstance(body, dict):
                            info["keys"] = list(body.keys())
                            # Show short values
                            for k, v in body.items():
                                if isinstance(v, list):
                                    info[f"len({k})"] = len(v)
                                    if v and isinstance(v[0], dict) and len(str(v[0])) < 500:
                                        info[f"first_{k}"] = v[0]
                                elif isinstance(v, (str, int, float, bool)):
                                    info[k] = v
                    elif "xml" in ct:
                        info["type"] = "xml"
                        info["size"] = len(r.text)
                    else:
                        info["type"] = ct
                api_results[name] = info
            except Exception as e:
                api_results[name] = {"status": "error", "error": str(e)[:100]}
    results["api_probes"] = api_results
    return results

@app.get("/api/tunarr/channels/{tunarr_id}/shows")
async def tunarr_get_channel_shows(tunarr_id: str):
    url = get_tunarr_url()
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(f"{url}/api/channels/{tunarr_id}/shows")
    if r.status_code == 404:
        return []
    if r.status_code != 200:
        raise HTTPException(r.status_code, "Tunarr error")
    return r.json()

@app.get("/api/tunarr/guide")
async def tunarr_guide(hours: int = Query(24)):
    """Fetch materialized EPG data from Tunarr's guide API for all linked channels."""
    from datetime import datetime, timezone, timedelta
    url = get_tunarr_url()
    with get_db() as conn:
        links = [dict(r) for r in conn.execute("SELECT * FROM tunarr_channel_links").fetchall()]
    if not links:
        return {"channels": []}

    now = datetime.now(timezone.utc)
    date_from = now.isoformat()
    date_to = (now + timedelta(hours=hours)).isoformat()
    link_by_tunarr_id = {l["tunarr_id"]: l for l in links}
    linked_ids = set(link_by_tunarr_id.keys())

    # The BULK guide is the primary source, and the per-channel endpoint is not a
    # fallback for it at all.
    #
    # `GET /api/guide/channels/{id}` returns the channel's LINEUP, not its EPG:
    # `[{index, startTimeMs, lineupItem: {durationMs, type}}]`. `lineupItem`
    # carries no title — so every entry fell through the title chain below to the
    # literal string "Program", which is what the guide used to render for every
    # programme. `GET /api/guide/channels` (no id) is the materialized EPG:
    # `{<channelId>: {id, name, number, icon, programs: [{title, start, stop,
    # duration, type}]}}`. Verified against Tunarr 1.3.10.
    #
    # It is also one request instead of one per channel, which for a 40-channel
    # lineup is the difference between 1 and 40 round trips.
    bulk_by_channel: dict[str, list] = {}
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            r = await client.get(f"{url}/api/guide/channels",
                                 params={"dateFrom": date_from, "dateTo": date_to})
            if r.status_code == 200:
                bulk = r.json()
                if isinstance(bulk, dict):
                    # Either keyed directly by channel id, or nested under
                    # "channels" — accept both, then read `.programs`.
                    source = bulk.get("channels") if isinstance(
                        bulk.get("channels"), dict) else bulk
                    for cid, entry in (source or {}).items():
                        if isinstance(entry, dict):
                            bulk_by_channel[cid] = entry.get("programs") or []
                        elif isinstance(entry, list):
                            bulk_by_channel[cid] = entry
        except Exception as e:
            log.warning("Tunarr bulk guide failed: %s", e)

    guide_channels = []
    async with httpx.AsyncClient(timeout=15.0) as client:
        for link in links:
            tunarr_id = link["tunarr_id"]
            items = _normalize_guide_programs(bulk_by_channel.get(tunarr_id) or [])

            # Fallback: the channel's lineup. Titleless by nature, so entries come
            # out as "Program" — only worth showing when the EPG has not
            # materialized yet and the alternative is an empty row.
            if not items:
                try:
                    r = await client.get(f"{url}/api/channels/{tunarr_id}/lineup",
                                         params={"from": date_from, "to": date_to})
                    if r.status_code == 200:
                        raw = r.json()
                        raw_items = raw if isinstance(raw, list) else raw.get("items", raw.get("programs", []))
                        items = _normalize_guide_programs(raw_items)
                        if items:
                            log.debug("Tunarr lineup fallback returned %d titleless "
                                      "items for %s", len(items), tunarr_id)
                except Exception as e:
                    log.warning("Tunarr lineup for %s failed: %s", tunarr_id, e)

            guide_channels.append({
                "channel_number": link["channel_number"],
                "tunarr_id": tunarr_id,
                "tunarr_name": link.get("tunarr_name", ""),
                "tunarr_number": link.get("tunarr_number"),
                "schedule": items,
            })
            if items:
                log.info("Guide: CH %s (%s) — %d programs", link["channel_number"], link.get("tunarr_name", ""), len(items))
            else:
                log.warning("Guide: CH %s (%s) — no programs found", link["channel_number"], link.get("tunarr_name", ""))

    return {"channels": guide_channels}

# ── Tunarr channel import/export ─────────────────────────────────────────────

class TunarrImportAction(BaseModel):
    tunarr_id: str
    action: str  # "link", "create", "skip"
    cable_plex_number: int | None = None

class TunarrImportRequest(BaseModel):
    actions: list[TunarrImportAction]

@app.post("/api/tunarr/import-channels/preview")
async def tunarr_import_preview(body: dict | None = None):
    """Preview how Tunarr channels would map to Cable Plex channels."""
    url = get_tunarr_url()
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(f"{url}/api/channels")
    if r.status_code != 200:
        raise HTTPException(r.status_code, "Could not fetch Tunarr channels")
    tunarr_channels = r.json() if isinstance(r.json(), list) else []

    # Filter by IDs if provided
    channel_ids = (body or {}).get("channel_ids")
    if channel_ids and channel_ids != "all":
        id_set = set(channel_ids)
        tunarr_channels = [c for c in tunarr_channels if c.get("id") in id_set]

    # Load Cable Plex channels and existing links
    with get_db() as conn:
        cp_rows = conn.execute("SELECT * FROM channels").fetchall()
        links = conn.execute("SELECT * FROM tunarr_channel_links").fetchall()
    cp_by_number = {r["number"]: dict(r) for r in cp_rows}
    cp_by_name = {r["name"].lower(): dict(r) for r in cp_rows}
    linked_tunarr_ids = {r["tunarr_id"] for r in links}
    linked_cp_numbers = {r["channel_number"] for r in links}

    preview = []
    for tc in tunarr_channels:
        tid = tc.get("id", "")
        tnum = tc.get("number", 0)
        tname = tc.get("name", "")

        if tid in linked_tunarr_ids:
            match_type = "already_linked"
            matched_channel = None
        elif tnum in cp_by_number and tnum not in linked_cp_numbers:
            match_type = "number"
            matched_channel = cp_by_number[tnum]
        elif tname.lower() in cp_by_name:
            candidate = cp_by_name[tname.lower()]
            if candidate["number"] not in linked_cp_numbers:
                match_type = "name"
                matched_channel = candidate
            else:
                match_type = None
                matched_channel = None
        else:
            match_type = None
            matched_channel = None

        preview.append({
            "tunarr_id": tid,
            "tunarr_name": tname,
            "tunarr_number": tnum,
            "match": match_type,
            "cable_plex_channel": {"number": matched_channel["number"], "name": matched_channel["name"]} if matched_channel else None,
        })

    return {"channels": preview}

@app.post("/api/tunarr/import-channels")
async def tunarr_import_channels(body: TunarrImportRequest):
    """Execute channel import from Tunarr into Cable Plex."""
    url = get_tunarr_url()
    # Fetch Tunarr channel details for creates
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(f"{url}/api/channels")
    tunarr_map = {}
    if r.status_code == 200:
        for c in (r.json() if isinstance(r.json(), list) else []):
            tunarr_map[c.get("id", "")] = c

    results = {"linked": 0, "created": 0, "skipped": 0, "details": []}

    with get_db() as conn:
        for act in body.actions:
            if act.action == "skip":
                results["skipped"] += 1
                results["details"].append({"tunarr_id": act.tunarr_id, "action": "skipped"})
                continue

            tc = tunarr_map.get(act.tunarr_id, {})
            tname = tc.get("name", "Channel")
            tnum = tc.get("number", 0)

            if act.action == "link" and act.cable_plex_number:
                cp_num = act.cable_plex_number
            elif act.action == "create":
                cp_num = tnum or (max((r["number"] for r in conn.execute("SELECT number FROM channels")), default=99) + 1)
                conn.execute(
                    "INSERT OR IGNORE INTO channels (number, name, tier, vibe, mode, style, color, uid) VALUES (?,?,?,?,?,?,?,?)",
                    (cp_num, tname, "Galaxy Main", "", "Shuffle", "", "blue",
                     _new_channel_uid()),
                )
                results["created"] += 1
            else:
                results["skipped"] += 1
                continue

            conn.execute(
                "INSERT OR REPLACE INTO tunarr_channel_links (channel_number, tunarr_id, tunarr_name, tunarr_number) VALUES (?,?,?,?)",
                (cp_num, act.tunarr_id, tname, tnum),
            )
            results["linked"] += 1
            results["details"].append({"tunarr_id": act.tunarr_id, "action": act.action, "channel_number": cp_num})

    return results

class TunarrExportRequest(BaseModel):
    channel_numbers: list[int] | str  # list of numbers or "all"
    sync_collections: bool = False

@app.post("/api/tunarr/export-channels")
async def tunarr_export_channels(body: TunarrExportRequest):
    """Export Cable Plex channels to Tunarr (create or link)."""
    url = get_tunarr_url()

    with get_db() as conn:
        if body.channel_numbers == "all":
            cp_channels = [dict(r) for r in conn.execute("SELECT * FROM channels").fetchall()]
        else:
            placeholders = ",".join("?" * len(body.channel_numbers))
            cp_channels = [dict(r) for r in conn.execute(
                f"SELECT * FROM channels WHERE number IN ({placeholders})", body.channel_numbers
            ).fetchall()]
        existing_links = {r["channel_number"]: dict(r) for r in conn.execute("SELECT * FROM tunarr_channel_links").fetchall()}


    # Fetch existing Tunarr channels for matching
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(f"{url}/api/channels")
    tunarr_channels = r.json() if r.status_code == 200 and isinstance(r.json(), list) else []
    tunarr_by_number = {c.get("number"): c for c in tunarr_channels}

    # Get ffmpeg settings for channel creation
    async with httpx.AsyncClient(timeout=5) as client:
        ffmpeg_r = await client.get(f"{url}/api/ffmpeg-settings")
    transcode_id = None
    if ffmpeg_r.status_code == 200:
        transcode_id = ffmpeg_r.json().get("defaultTranscodeConfigId") or ffmpeg_r.json().get("configId")

    results = {"exported": 0, "linked": 0, "created": 0, "skipped": 0, "details": []}

    for cp in cp_channels:
        cp_num = cp["number"]
        if cp_num in existing_links:
            results["skipped"] += 1
            results["details"].append({"channel_number": cp_num, "action": "already_linked"})
            continue

        # Try match by number in Tunarr
        if cp_num in tunarr_by_number:
            tc = tunarr_by_number[cp_num]
            with get_db() as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO tunarr_channel_links VALUES (?,?,?,?)",
                    (cp_num, tc["id"], tc.get("name"), tc.get("number")),
                )
            results["linked"] += 1
            results["details"].append({"channel_number": cp_num, "action": "linked", "tunarr_id": tc["id"]})
        else:
            # Create new Tunarr channel
            channel_obj = _tunarr_channel_obj(
                name=cp.get("name", f"Channel {cp_num}"),
                number=cp_num,
                group_title=cp.get("tier", "Linearr"),
                transcode_id=transcode_id,
            )
            async with httpx.AsyncClient(timeout=10.0) as client:
                cr = await _tunarr_create_channel(client, url, channel_obj)
            if cr.status_code in (200, 201):
                new_ch = cr.json()
                with get_db() as conn:
                    conn.execute(
                        "INSERT OR REPLACE INTO tunarr_channel_links VALUES (?,?,?,?)",
                        (cp_num, new_ch["id"], new_ch.get("name"), new_ch.get("number")),
                    )
                results["created"] += 1
                results["details"].append({"channel_number": cp_num, "action": "created", "tunarr_id": new_ch["id"]})
            else:
                results["skipped"] += 1
                results["details"].append({"channel_number": cp_num, "action": "error", "message": cr.text[:200]})

        results["exported"] += 1

    return results

# ── Tunarr XMLTV/M3U ──────────────────────────────────────────────────────────

@app.get("/api/tunarr/xmltv")
async def tunarr_xmltv():
    """Proxy the Tunarr XMLTV file download."""
    url = get_tunarr_url()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{url}/api/xmltv.xml")
    if r.status_code != 200:
        raise HTTPException(r.status_code, "Tunarr XMLTV error")
    return StreamingResponse(
        iter([r.content]),
        media_type="application/xml",
        headers={"Content-Disposition": "attachment; filename=xmltv.xml"},
    )

@app.get("/api/tunarr/m3u")
async def tunarr_m3u():
    """Proxy the Tunarr M3U playlist download."""
    url = get_tunarr_url()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{url}/api/channels.m3u")
    if r.status_code != 200:
        raise HTTPException(r.status_code, "Tunarr M3U error")
    return StreamingResponse(
        iter([r.content]),
        media_type="audio/x-mpegurl",
        headers={"Content-Disposition": "attachment; filename=channels.m3u"},
    )

@app.post("/api/tunarr/xmltv/refresh")
async def tunarr_xmltv_refresh():
    """Force XMLTV guide refresh in Tunarr."""
    url = get_tunarr_url()
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{url}/api/xmltv/refresh")
    return {"ok": r.status_code in (200, 204)}

@app.get("/api/tunarr/xmltv-settings")
async def tunarr_get_xmltv_settings():
    """Get Tunarr XMLTV settings."""
    url = get_tunarr_url()
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{url}/api/xmltv-settings")
    if r.status_code != 200:
        return {}
    return r.json()

@app.put("/api/tunarr/xmltv-settings")
async def tunarr_update_xmltv_settings(request: Request):
    """Update Tunarr XMLTV settings."""
    body = await request.json()
    url = get_tunarr_url()
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.put(f"{url}/api/xmltv-settings", json=body)
    if r.status_code not in (200, 204):
        raise HTTPException(r.status_code, "Failed to update XMLTV settings")
    return {"ok": True}

# ── Tunarr Sessions ───────────────────────────────────────────────────────────

@app.get("/api/tunarr/sessions")
async def tunarr_sessions():
    """Get active streaming sessions from Tunarr."""
    url = get_tunarr_url()
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{url}/api/sessions")
    if r.status_code != 200:
        return {}
    return r.json()

@app.delete("/api/tunarr/sessions/{channel_id}")
async def tunarr_kill_sessions(channel_id: str):
    """Kill all sessions for a Tunarr channel."""
    url = get_tunarr_url()
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.delete(f"{url}/api/channels/{channel_id}/sessions")
    return {"ok": r.status_code in (200, 204)}

# ── Tunarr Filler Lists ──────────────────────────────────────────────────────

@app.get("/api/tunarr/filler-lists")
async def tunarr_filler_lists():
    """List all filler lists from Tunarr."""
    url = get_tunarr_url()
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{url}/api/filler-lists")
    if r.status_code != 200:
        return []
    return r.json() if isinstance(r.json(), list) else []

@app.get("/api/tunarr/filler-lists/{filler_id}")
async def tunarr_filler_list_detail(filler_id: str):
    """Get a filler list with its programs."""
    url = get_tunarr_url()
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{url}/api/filler-lists/{filler_id}")
    if r.status_code != 200:
        raise HTTPException(r.status_code, "Filler list not found")
    return r.json()

@app.post("/api/tunarr/filler-lists")
async def tunarr_create_filler_list(request: Request):
    """Create a new filler list in Tunarr."""
    body = await request.json()
    url = get_tunarr_url()
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{url}/api/filler-lists", json=body)
    if r.status_code not in (200, 201):
        raise HTTPException(r.status_code, f"Tunarr error: {r.text[:200]}")
    return r.json()

@app.put("/api/tunarr/filler-lists/{filler_id}")
async def tunarr_update_filler_list(filler_id: str, request: Request):
    """Update a filler list in Tunarr."""
    body = await request.json()
    url = get_tunarr_url()
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.put(f"{url}/api/filler-lists/{filler_id}", json=body)
    if r.status_code not in (200, 204):
        raise HTTPException(r.status_code, "Failed to update filler list")
    return r.json() if r.status_code == 200 else {"ok": True}

@app.delete("/api/tunarr/filler-lists/{filler_id}")
async def tunarr_delete_filler_list(filler_id: str):
    """Delete a filler list from Tunarr."""
    url = get_tunarr_url()
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.delete(f"{url}/api/filler-lists/{filler_id}")
    if r.status_code not in (200, 204):
        raise HTTPException(r.status_code, "Failed to delete filler list")
    return {"ok": True}

@app.get("/api/tunarr/filler-lists/{filler_id}/programs")
async def tunarr_filler_list_programs(filler_id: str):
    """Get programs in a filler list."""
    url = get_tunarr_url()
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{url}/api/filler-lists/{filler_id}/programs")
    if r.status_code != 200:
        return []
    return r.json() if isinstance(r.json(), list) else []

# Tunarr's smart-collections route is underscored in every supported version
# (verified in server/src/api/smartCollectionsApi.ts at v1.2.10 and v1.3.6).
# There is no hyphenated alias — a wrong separator is a plain 404.
_TUNARR_SC_PATH = "/api/smart_collections"

@app.get("/api/tunarr/smart-collections")
async def tunarr_list_smart_collections():
    url = get_tunarr_url()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{url}{_TUNARR_SC_PATH}")
        if r.status_code != 200:
            raise HTTPException(r.status_code, f"Tunarr error: {r.text[:200]}")
        return r.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Cannot reach Tunarr: {e}")

@app.get("/api/tunarr/custom-shows")
async def tunarr_list_custom_shows():
    """List Tunarr custom shows (added in 1.3). Returns [] on older Tunarr.

    Custom shows are user-curated program sequences; surfacing them lets a
    channel be backed by one. Tries the hyphen route then the underscore variant.
    """
    url = get_tunarr_url()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{url}/api/custom-shows")
            if r.status_code == 404:
                r = await client.get(f"{url}/api/custom_shows")
        if r.status_code == 404:
            return []  # Tunarr too old to have custom shows
        if r.status_code != 200:
            raise HTTPException(r.status_code, f"Tunarr error: {r.text[:200]}")
        data = r.json()
        return data if isinstance(data, list) else data.get("data", [])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Cannot reach Tunarr: {e}")

_FILTER_STRING_RE = _re.compile(r'^\s*([A-Za-z_][\w.]*)\s*=\s*"([^"]+)"\s*$')

def _parse_filter_string(s: str | None) -> dict | None:
    """Translate a simple `field = "value"` filterString into the structured
    search object Tunarr's write path actually honors (it IGNORES filterString
    on writes — the string is only a derived display column). Returns None for
    anything more complex than a single faceted equality."""
    if not s:
        return None
    m = _FILTER_STRING_RE.match(s)
    if not m:
        return None
    field, value = m.group(1), m.group(2)
    return {
        "type": "value",
        "fieldSpec": {
            "type": "faceted_string",
            "key": field,
            "name": field,
            "op": "=",
            "value": [value],
        },
    }

@app.post("/api/tunarr/smart-collections", status_code=201)
async def tunarr_create_smart_collection(body: dict):
    """Create a Tunarr smart collection. Accepts a structured `filter` (or
    `query`) object, or a simple `filterString` like `tags = "Name"` which is
    translated — Tunarr ignores filterString on writes, so passing it through
    verbatim would create a collection with NO rules."""
    url = get_tunarr_url()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name required")
    structured = body.get("filter") or body.get("query") or _parse_filter_string(body.get("filterString"))
    if structured is None:
        raise HTTPException(400, 'Provide a structured "filter" object or a simple filterString like: tags = "My Collection"')
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await _tunarr_write_smart_collection(
            client, url, _TUNARR_SC_PATH, name=name, structured=structured)
    if r is None or r.status_code not in (200, 201):
        raise HTTPException(r.status_code if r is not None else 502,
                            r.text[:300] if r is not None else "No response from Tunarr")
    if not _sc_response_has_search(r):
        raise HTTPException(502, "Tunarr accepted the smart collection but dropped its rules — not created correctly")
    _log_app("tunarr", f"Created Tunarr smart collection '{name}'", metadata={"name": name})
    return r.json()

@app.put("/api/tunarr/smart-collections/{sc_id}")
async def tunarr_update_smart_collection(sc_id: str, body: dict):
    """Update a Tunarr smart collection. Structured `filter`/`query` (or a
    translatable `filterString`) rewrites the rules through the verified
    writer; a name/keywords-only body is passed through as a plain rename."""
    url = get_tunarr_url()
    structured = body.get("filter") or body.get("query") or _parse_filter_string(body.get("filterString"))
    passthrough = {k: v for k, v in body.items() if k in ("name", "keywords")}
    async with httpx.AsyncClient(timeout=10.0) as client:
        if structured is not None:
            r = await _tunarr_write_smart_collection(
                client, url, _TUNARR_SC_PATH,
                name=passthrough.get("name") or "", structured=structured,
                uuid=sc_id, extra=passthrough)
            if r is not None and r.status_code not in (404,) and r.status_code in (200, 201, 204) \
                    and not _sc_response_has_search(r):
                raise HTTPException(502, "Tunarr accepted the update but dropped the rules — not saved correctly")
        else:
            if body.get("filterString"):
                raise HTTPException(400, 'This filter expression is too complex to translate — use a structured "filter" object, or a simple one like: tags = "My Collection"')
            if not passthrough:
                raise HTTPException(400, "Nothing to update")
            r = await client.put(f"{url}{_TUNARR_SC_PATH}/{sc_id}", json=passthrough)
    if r is None:
        raise HTTPException(502, "No response from Tunarr")
    if r.status_code == 404:
        raise HTTPException(404, "Smart collection not found in Tunarr")
    if r.status_code not in (200, 201, 204):
        raise HTTPException(r.status_code, r.text[:300])
    _log_app("tunarr", f"Updated Tunarr smart collection {sc_id}",
             metadata={"uuid": sc_id, "rules_rewritten": structured is not None})
    return r.json() if r.status_code != 204 else {"ok": True}

@app.delete("/api/tunarr/smart-collections/{sc_id}")
async def tunarr_delete_smart_collection(sc_id: str):
    url = get_tunarr_url()
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.delete(f"{url}{_TUNARR_SC_PATH}/{sc_id}")
    if r.status_code == 404:
        raise HTTPException(404, "Smart collection not found in Tunarr")
    if r.status_code not in (200, 204):
        raise HTTPException(r.status_code, r.text[:300])
    # Also remove any local collection links referencing this UUID
    with get_db() as conn:
        conn.execute("DELETE FROM tunarr_collection_links WHERE tunarr_collection_id=?", (sc_id,))
    _log_app("tunarr", f"Deleted Tunarr smart collection {sc_id}", level="warn", metadata={"uuid": sc_id})
    return {"ok": True}

@app.post("/api/tunarr/smart-collections/purge")
async def tunarr_purge_smart_collections():
    """Delete EVERY Tunarr smart collection and clear `tunarr_collection_links`.

    Destructive and global, so it is an explicit endpoint of its own and is
    never a side effect of any other action (sync, generate, assign).

    Failures are reported per item rather than aborting the run: one collection
    Tunarr refuses to delete must not strand the rest. Link rows are cleared for
    everything that actually went away — a link is retained only when its
    collection survived in Tunarr, so the local state still matches the server.

    Returns {"deleted": int, "failed": [{"id", "name", "error"}, ...]}.
    """
    url = get_tunarr_url()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{url}{_TUNARR_SC_PATH}")
            if r.status_code != 200:
                raise HTTPException(r.status_code, f"Tunarr error: {r.text[:200]}")
            data = r.json()
            items = data if isinstance(data, list) else data.get("data", []) or []

            deleted = 0
            failed: list[dict] = []
            failed_ids: list[str] = []
            for sc in items:
                sc_id = str(sc.get("uuid") or sc.get("id") or "")
                name = sc.get("name")
                if not sc_id:
                    failed.append({"id": None, "name": name, "error": "no uuid in Tunarr response"})
                    continue
                try:
                    dr = await client.delete(f"{url}{_TUNARR_SC_PATH}/{sc_id}")
                except Exception as e:  # noqa: BLE001 — keep purging the rest
                    failed.append({"id": sc_id, "name": name, "error": str(e)[:200]})
                    failed_ids.append(sc_id)
                    continue
                # 404 counts as gone: the goal state is "not in Tunarr".
                if dr.status_code in (200, 204, 404):
                    deleted += 1
                else:
                    failed.append({"id": sc_id, "name": name,
                                   "error": f"{dr.status_code}: {dr.text[:200]}"})
                    failed_ids.append(sc_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Cannot reach Tunarr: {e}")

    with get_db() as conn:
        if failed_ids:
            placeholders = ",".join("?" for _ in failed_ids)
            conn.execute(
                f"DELETE FROM tunarr_collection_links WHERE tunarr_collection_id NOT IN ({placeholders})",
                failed_ids,
            )
        else:
            conn.execute("DELETE FROM tunarr_collection_links")

    _log_app("tunarr", f"Purged Tunarr smart collections: {deleted} deleted, {len(failed)} failed",
             level="warn", metadata={"deleted": deleted, "failed": failed})
    return {"deleted": deleted, "failed": failed}

# ── Tunarr tasks (guide refresh, library scan) ───────────────────────────────

@app.post("/api/tunarr/tasks/{task_name}")
async def tunarr_run_task(task_name: str, body: dict | None = None):
    """Trigger a Tunarr task (UpdateXmlTvTask, ScanLibrariesTask, etc.).

    Sends no body for argless tasks — Tunarr validates the body against the
    task's own schema and 400s on a spurious `{}` (_tunarr_run_task_request
    handles the fallback both ways).
    """
    url = get_tunarr_url()
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await _tunarr_run_task_request(client, url, task_name, body=body)
    if r.status_code not in (200, 202, 204):
        raise HTTPException(r.status_code, f"Tunarr task failed: {r.text[:200]}")
    _log_app("tunarr", f"Ran Tunarr task {task_name}", metadata={"task": task_name})
    return {"ok": True, "task": task_name}

# ── Tunarr link management ────────────────────────────────────────────────────

@app.get("/api/tunarr/channel-links")
def tunarr_get_channel_links():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM tunarr_channel_links").fetchall()
    return [dict(r) for r in rows]

@app.post("/api/tunarr/channel-links")
def tunarr_save_channel_link(body: TunarrChannelLinkIn):
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO tunarr_channel_links (channel_number, tunarr_id, tunarr_name, tunarr_number) VALUES (?,?,?,?)",
            (body.channel_number, body.tunarr_id, body.tunarr_name, body.tunarr_number)
        )
    _log_app("tunarr", f"Linked ch {body.channel_number} to Tunarr channel {body.tunarr_id}",
             metadata={"channel": body.channel_number, "tunarr_id": body.tunarr_id, "tunarr_name": body.tunarr_name})
    return {"ok": True}

@app.delete("/api/tunarr/channel-links/{channel_number}")
def tunarr_delete_channel_link(channel_number: int):
    with get_db() as conn:
        conn.execute("DELETE FROM tunarr_channel_links WHERE channel_number=?", (channel_number,))
    _log_app("tunarr", f"Unlinked ch {channel_number} from Tunarr", metadata={"channel": channel_number})
    return {"ok": True}

@app.get("/api/tunarr/collection-links")
def tunarr_get_collection_links():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM tunarr_collection_links").fetchall()
    return [dict(r) for r in rows]

class TunarrCollectionLinkIn(BaseModel):
    channel_number: int
    plex_type: str  # 'show' or 'movie'
    tunarr_collection_id: str
    tunarr_collection_name: str | None = None

@app.post("/api/tunarr/collection-links")
def tunarr_save_collection_link(body: TunarrCollectionLinkIn):
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO tunarr_collection_links VALUES (?,?,?,?)",
            (body.channel_number, body.plex_type, body.tunarr_collection_id, body.tunarr_collection_name)
        )
    _log_app("tunarr", f"Linked collection to ch {body.channel_number}",
             metadata={"channel": body.channel_number, "plex_type": body.plex_type,
                       "collection_id": body.tunarr_collection_id, "collection_name": body.tunarr_collection_name})
    return {"ok": True}

@app.delete("/api/tunarr/collection-links/{channel_number}/{plex_type}")
def tunarr_delete_collection_link(channel_number: int, plex_type: str):
    with get_db() as conn:
        conn.execute(
            "DELETE FROM tunarr_collection_links WHERE channel_number=? AND plex_type=?",
            (channel_number, plex_type)
        )
    _log_app("tunarr", f"Removed Tunarr collection link for ch {channel_number}",
             metadata={"channel": channel_number, "plex_type": plex_type})
    return {"ok": True}

# ── Tunarr smart collection sync ──────────────────────────────────────────────

@app.post("/api/tunarr/channel-links/{channel_number}/sync-collections")
async def tunarr_sync_collections(channel_number: int):
    # Get Plex collections linked to this channel
    with get_db() as conn:
        plex_cols = conn.execute(
            "SELECT * FROM channel_collections WHERE channel_number=?", (channel_number,)
        ).fetchall()
    if not plex_cols:
        raise HTTPException(400, "No Plex collections linked to this channel — generate Plex collections first")

    url = get_tunarr_url()

    sc_path = _TUNARR_SC_PATH
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{url}{sc_path}")
        existing = r.json() if r.status_code == 200 else []
    except Exception as e:
        log.warning("Failed to fetch Tunarr smart collections: %s", e)
        raise HTTPException(502, f"Cannot reach Tunarr smart collections API: {e}")

    existing_by_name = {sc["name"]: sc for sc in existing}

    created, updated = [], []
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            version = await _fetch_tunarr_version(client, url)
            # Scan first (and wait) so the Plex collection tags exist in Tunarr's
            # index before the tag-based smart collections are written.
            await _tunarr_scan_libraries(client, url, wait=True)
            for col in plex_cols:
                col = dict(col)
                name = col["collection_title"]
                structured = _tunarr_tags_filter(name)
                if name in existing_by_name:
                    sc = existing_by_name[name]
                    await _tunarr_write_smart_collection(
                        client, url, sc_path, name=name, structured=structured,
                        uuid=sc["uuid"], version=version)
                    updated.append({"name": name, "id": sc["uuid"]})
                    with get_db() as conn:
                        conn.execute(
                            "INSERT OR REPLACE INTO tunarr_collection_links VALUES (?,?,?,?)",
                            (channel_number, col["plex_type"], sc["uuid"], name)
                        )
                else:
                    r2 = await _tunarr_write_smart_collection(
                        client, url, sc_path, name=name, structured=structured, version=version)
                    if r2 is not None and r2.status_code in (200, 201):
                        sc = r2.json()
                        with get_db() as conn:
                            conn.execute(
                                "INSERT OR REPLACE INTO tunarr_collection_links VALUES (?,?,?,?)",
                                (channel_number, col["plex_type"], sc["uuid"], name)
                            )
                        created.append({"name": name, "id": sc["uuid"]})
                    else:
                        detail = r2.text[:200] if r2 is not None else "no response"
                        log.warning("Tunarr rejected smart collection %s: %s", name, detail)
    except HTTPException:
        raise
    except Exception as e:
        log.warning("Error during Tunarr collection sync: %s", e)
        raise HTTPException(502, f"Tunarr sync error: {e}")

    _log_app("tunarr", f"Tunarr collection sync for ch {channel_number}: {len(created)} created, {len(updated)} updated",
             metadata={"channel": channel_number, "created": created, "updated": updated})
    return {"created": created, "updated": updated}

# ── Tunarr time slot push ─────────────────────────────────────────────────────

def _tunarr_tags_filter(collection_name: str) -> dict:
    """Build the structured search object Tunarr requires for tags-based smart collections.

    Tunarr's DAO ignores filterString on writes — it only uses the structured
    search object (converted back to a string via searchFilterToString).
    Shape matches what Tunarr's own UI produces (fieldSpec carries both key and name).
    """
    return {
        "type": "value",
        "fieldSpec": {
            "type": "faceted_string",
            "key": "tags",
            "name": "tags",
            "op": "=",
            "value": [collection_name],
        },
    }

# Tunarr's API schema names the smart-collection search field `filter`
# (types/src/schemas/collectionsSchema.ts: SmartCollection.filter — the `query`
# name is only the DB column). Crucially, `filter` is OPTIONAL in the schema, so
# a write using the wrong key is silently accepted (zod strips it) and the
# collection is created with NO rules — no error, no retry. That is why
# _tunarr_write_smart_collection must verify the response actually carries the
# search object back, not just trust a 2xx.
_SC_FIELDS = ("filter", "query")

async def _fetch_tunarr_version(client: "httpx.AsyncClient", url: str) -> str | None:
    try:
        vr = await client.get(f"{url}/api/version")
        if vr.status_code == 200:
            d = vr.json()
            return d.get("tunarr", d.get("version")) or None
    except Exception:
        pass
    return None

def _sc_response_has_search(resp: "httpx.Response") -> bool:
    """True if a smart-collection write response carries the search object back.

    Tunarr's schema marks the search field optional, so a body using the wrong
    key gets a 2xx while the collection is saved with NO rules. The write only
    counts if the returned object (or a 204) proves the search stuck.
    """
    if resp.status_code == 204:
        return True  # no body to inspect — trust the status
    try:
        data = resp.json()
    except Exception:
        return False
    return bool(data.get("filter") or data.get("query") or data.get("filterString"))

async def _tunarr_write_smart_collection(
    client: "httpx.AsyncClient", url: str, sc_path: str, *,
    name: str, structured: dict, uuid: str | None = None, version: str | None = None,
    extra: dict | None = None,
):
    """Create (uuid=None) or update a Tunarr smart collection.

    Sends the search object as `filter` (Tunarr's actual API field), retrying
    with `query` for hypothetical other builds. Because `filter` is optional in
    Tunarr's schema, a 2xx alone doesn't prove the rules were saved — the
    response must echo the search object back, otherwise we retry with the
    other field name. `extra` fields (e.g. a rename riding along with a rules
    rewrite) are merged into the body. Returns the final httpx.Response (or
    None on hard failure).
    """
    last = None
    for field in _SC_FIELDS:
        body = {**(extra or {}), field: structured}
        if uuid is None:
            body = {"name": name, "keywords": "", **(extra or {}), field: structured}
            resp = await client.post(f"{url}{sc_path}", json=body)
        else:
            resp = await client.put(f"{url}{sc_path}/{uuid}", json=body)
        last = resp
        if resp.status_code in (200, 201, 204):
            if _sc_response_has_search(resp):
                return resp
            # 2xx but the rules didn't stick (wrong field name, zod stripped it).
            # If we just POSTed, the empty collection now exists — switch to
            # updating it by uuid so the retry doesn't create a duplicate.
            if uuid is None and resp.status_code in (200, 201):
                try:
                    uuid = resp.json().get("uuid") or uuid
                except Exception:
                    pass
            log.warning("Tunarr accepted smart collection '%s' but dropped the %s rules — retrying with the other field", name, field)
            continue
        # A schema/server rejection is worth retrying with the other field name.
        if resp.status_code not in (400, 422, 500):
            break
    return last

async def _tunarr_run_task_request(
    client: "httpx.AsyncClient", url: str, task_name: str, *,
    background: bool = True, body: dict | None = None,
    timeout: "httpx.Timeout | None" = None,
) -> "httpx.Response":
    """POST a Tunarr task run, tolerating Tunarr's per-task body validation.

    Tunarr validates the request body against each task's own schema; argless
    tasks (ScanLibrariesTask, UpdateXmlTvTask) reject a `{}` body with a bare
    400 but accept an empty body — so send no body first and fall back to `{}`
    (and vice versa when an explicit body is given).
    """
    kwargs: dict = {"params": {"background": "true" if background else "false"}}
    if timeout is not None:
        kwargs["timeout"] = timeout
    if body:
        r = await client.post(f"{url}/api/tasks/{task_name}/run", json=body, **kwargs)
        if r.status_code == 400:
            r = await client.post(f"{url}/api/tasks/{task_name}/run", **kwargs)
    else:
        r = await client.post(f"{url}/api/tasks/{task_name}/run", **kwargs)
        if r.status_code == 400:
            r = await client.post(f"{url}/api/tasks/{task_name}/run", json={}, **kwargs)
    return r

async def _tunarr_scan_libraries(client: "httpx.AsyncClient", url: str, wait: bool = True) -> bool:
    """Trigger Tunarr's library scan so new/updated Plex collections exist as
    tags in Tunarr's index BEFORE tag-based smart collections are written.

    wait=True runs the task in the foreground (Tunarr returns when the scan is
    done) with a generous timeout; falls back to a fire-and-forget background
    run if that fails. Returns True if a scan was triggered.
    """
    try:
        if wait:
            r = await _tunarr_run_task_request(
                client, url, "ScanLibrariesTask", background=False,
                timeout=httpx.Timeout(120.0, connect=10.0))
            if r.status_code in (200, 202):
                return True
        r = await _tunarr_run_task_request(client, url, "ScanLibrariesTask")
        return r.status_code in (200, 202)
    except Exception as e:
        log.warning("Tunarr library scan trigger failed: %s", e)
        return False

def _hhmm_to_ms(hhmm: str) -> int:
    """Convert HH:MM to milliseconds from midnight."""
    h, m = map(int, hhmm.split(":"))
    return (h * 3600 + m * 60) * 1000

def _add_show_key(mapping: dict, show: dict) -> None:
    """Map a Plex rating key -> Tunarr show UUID from a Tunarr show object.

    Handles both older flat field names and the Tunarr 1.3 media-source model,
    where external IDs are exposed as a nested array (program_grouping_external_id:
    source_type/external_key). Plex-sourced IDs are preferred when present.
    """
    show_uuid = show.get("uuid") or show.get("id") or ""
    if not show_uuid:
        return

    # 1) Nested external-id list (Tunarr 1.3): prefer a Plex-sourced entry.
    ext_list = show.get("externalIds") or show.get("externalIdList") or show.get("external_ids")
    if isinstance(ext_list, list) and ext_list:
        def _is_plex(e: dict) -> bool:
            src = str(e.get("sourceType") or e.get("source") or e.get("source_type") or "").lower()
            return src.startswith("plex")
        for e in sorted((x for x in ext_list if isinstance(x, dict)), key=lambda e: 0 if _is_plex(e) else 1):
            val = e.get("externalKey") or e.get("external_key") or e.get("id") or e.get("key")
            if val:
                mapping[str(val).strip()] = show_uuid
                return

    # 2) Flat field names (older Tunarr / simplified responses).
    for field in ("externalKey", "external_key", "plex_rating_key", "plexRatingKey", "ratingKey", "key"):
        val = show.get(field)
        if val:
            mapping[str(val).strip()] = show_uuid
            break

@app.post("/api/tunarr/channel-links/{channel_number}/push-schedule")
async def tunarr_push_schedule(channel_number: int, body: TunarrPushScheduleIn):
    # Get linked Tunarr channel
    with get_db() as conn:
        link = conn.execute(
            "SELECT * FROM tunarr_channel_links WHERE channel_number=?", (channel_number,)
        ).fetchone()
    if not link:
        raise HTTPException(400, "No Tunarr channel linked — link a channel first")

    tunarr_id = link["tunarr_id"]

    # Get smart collection links for this channel
    with get_db() as conn:
        col_links = conn.execute(
            "SELECT * FROM tunarr_collection_links WHERE channel_number=?", (channel_number,)
        ).fetchall()
    col_links = {r["plex_type"]: dict(r) for r in col_links}

    # Get our blocks for this channel
    with get_db() as conn:
        blocks = conn.execute(
            "SELECT * FROM blocks WHERE channel_number=? ORDER BY order_index, start_time",
            (channel_number,)
        ).fetchall()

    # Build slots — start with smart collection at midnight as base
    slots: list[dict] = []

    # Base: smart collection at midnight — shuffles all day as fallback.
    #
    # A slot's `startTime` in a `period: "day"` schedule is an OFFSET FROM
    # MIDNIGHT (0 .. 86_400_000), the same unit `_hhmm_to_ms` produces for the
    # block slots below — not an absolute epoch timestamp. This slot used to be
    # built from `_previous_sunday_midnight_ms()`, an epoch value ~1.7e12, which
    # put the "midnight" base slot roughly 20,000 days into the period and sorted
    # it last instead of first. Programming start is always 12:00AM.
    base_col = col_links.get("show") or col_links.get("movie")
    if base_col:
        slots.append({
            "id": str(uuid.uuid4()),  # Tunarr 1.3 lineup migration: linkable slots carry an id
            "type": "smart-collection",
            "smartCollectionId": base_col["tunarr_collection_id"],
            "startTime": _hhmm_to_ms("00:00"),
            "order": "ordered_shuffle",
            "direction": "asc",
            "padMs": 0,
        })

    # Build externalKey→Tunarr UUID map.
    # Try channel-specific shows first, then fall back to global show library.
    tunarr_shows_by_key: dict[str, str] = {}
    shows_source = "none"
    try:
        url_base = get_tunarr_url()
        async with httpx.AsyncClient(timeout=10.0) as client:
            # 1) Channel-specific shows endpoint
            r = await client.get(f"{url_base}/api/channels/{tunarr_id}/shows")
            if r.status_code == 200:
                items = r.json()
                if isinstance(items, list) and items:
                    shows_source = "channel"
                    for show in items:
                        _add_show_key(tunarr_shows_by_key, show)
            # 2) Global show library (works if Tunarr has indexed Plex content)
            if not tunarr_shows_by_key:
                r2 = await client.get(f"{url_base}/api/shows")
                if r2.status_code == 200:
                    data = r2.json()
                    items2 = data if isinstance(data, list) else data.get("data", [])
                    if items2:
                        shows_source = "global"
                        for show in items2:
                            _add_show_key(tunarr_shows_by_key, show)
    except Exception:
        pass  # Falls back to smart collection for all slots

    # Add specific time slots from our block slots
    if blocks:
        with get_db() as conn:
            block_ids = [b["id"] for b in blocks]
            placeholders = ",".join("?" * len(block_ids))
            block_slots = conn.execute(
                f"SELECT * FROM block_slots WHERE block_id IN ({placeholders}) ORDER BY slot_time",
                block_ids
            ).fetchall()

        seen_times: set[int] = set()
        for s in block_slots:
            start_ms = _hhmm_to_ms(s["slot_time"])
            if start_ms in seen_times:
                continue
            seen_times.add(start_ms)
            content_type = s["plex_type"]
            rating_key = str(s["plex_rating_key"]).strip() if s["plex_rating_key"] else ""
            # Try to resolve to a Tunarr show UUID for show-type slots
            if content_type == "show" and rating_key and rating_key in tunarr_shows_by_key:
                slots.append({
                    "id": str(uuid.uuid4()),
                    "type": "show",
                    "showId": tunarr_shows_by_key[rating_key],
                    "startTime": start_ms,
                    "order": "next",
                    "direction": "asc",
                    "seasonFilter": [],
                    "padMs": 0,
                })
            else:
                # Fall back to smart collection (match content type if available)
                col = col_links.get(content_type) or col_links.get("show") or col_links.get("movie")
                if col:
                    slots.append({
                        "id": str(uuid.uuid4()),
                        "type": "smart-collection",
                        "smartCollectionId": col["tunarr_collection_id"],
                        "startTime": start_ms,
                        "order": "next",
                        "direction": "asc",
                        "padMs": 0,
                    })

    # Sort slots by startTime
    slots.sort(key=lambda x: x["startTime"])

    schedule = {
        "type": "time",
        "flexPreference": "distribute",
        "latenessMs": 1800000,
        "maxDays": 30,
        "padMs": 0,
        "period": "day",
        "timeZoneOffset": 0,
        "startTomorrow": False,
        "slots": slots,
    }

    if body.preview:
        # Fetch current Tunarr schedule for comparison (GET /schedule returns saved config)
        url_base = get_tunarr_url()
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{url_base}/api/channels/{tunarr_id}/schedule")
        current = r.json() if r.status_code == 200 else None
        show_slots = sum(1 for s in slots if s["type"] == "show")
        sc_slots = sum(1 for s in slots if s["type"] == "smart-collection")
        return {
            "schedule": schedule,
            "current": current,
            "debug": {
                "shows_found_in_tunarr": len(tunarr_shows_by_key),
                "shows_source": shows_source,
                "show_slots_resolved": show_slots,
                "smart_collection_slots": sc_slots,
            }
        }

    # Actual push — POST /api/channels/:id/programming with type:'time'
    # schedule-time-slots is preview-only; programming is the real save endpoint.
    # programs: list of Tunarr show UUIDs for show-type slots (empty = smart collections only)
    programs_list = list({s["showId"] for s in slots if s.get("type") == "show" and s.get("showId")})
    url_base = get_tunarr_url()
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(
            f"{url_base}/api/channels/{tunarr_id}/programming",
            json={
                "type": "time",
                "schedule": schedule,
                "programs": programs_list,
            }
        )
    if r.status_code not in (200, 201):
        raise HTTPException(502, f"Tunarr rejected programming update: {r.text[:300]}")
    _log_app("tunarr", f"Pushed schedule to Tunarr for ch {channel_number}",
             metadata={"channel": channel_number, "tunarr_id": tunarr_id, "slots": len(slots)})
    return {"ok": True, "slots_pushed": len(slots)}

# ── Health check ─────────────────────────────────────────────────────────────

@app.get("/api/health", tags=["system"])
def health_check():
    """Health check endpoint for Docker HEALTHCHECK and monitoring."""
    db_ok = False
    try:
        with get_db() as conn:
            conn.execute("SELECT 1")
        db_ok = True
    except Exception:
        pass
    return {
        "status": "ok" if db_ok else "degraded",
        "version": "1.0.0",
        "db": "ok" if db_ok else "error",
    }

# ── Export / Import ─────────────────────────────────────────────────────────

@app.get("/api/export/lineup")
def export_lineup():
    """Export full channel lineup as JSON (channels, assignments, blocks, slots)."""
    with get_db() as conn:
        channels = [dict(r) for r in conn.execute("SELECT * FROM channels ORDER BY number").fetchall()]
        assignments = [dict(r) for r in conn.execute("SELECT * FROM assignments ORDER BY channel_number, plex_title").fetchall()]
        blocks = [dict(r) for r in conn.execute("SELECT * FROM blocks ORDER BY channel_number, start_time").fetchall()]
        slots = [dict(r) for r in conn.execute("SELECT * FROM block_slots ORDER BY block_id, slot_time").fetchall()]
        collections = [dict(r) for r in conn.execute("SELECT * FROM channel_collections").fetchall()]
    _log_app("export", f"Exported lineup: {len(channels)} channels, {len(assignments)} assignments")
    return {
        "version": 1,
        "exported_at": __import__("datetime").datetime.utcnow().isoformat(),
        "channels": channels,
        "assignments": assignments,
        "blocks": blocks,
        "block_slots": slots,
        "channel_collections": collections,
    }

@app.get("/api/export/channel/{channel_number}")
def export_channel(channel_number: int):
    """Export a single channel with its assignments, blocks, and slots."""
    with get_db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE number=?", (channel_number,)).fetchone()
        if not ch:
            raise HTTPException(404, "Channel not found")
        assignments = [dict(r) for r in conn.execute("SELECT * FROM assignments WHERE channel_number=?", (channel_number,)).fetchall()]
        blocks = [dict(r) for r in conn.execute("SELECT * FROM blocks WHERE channel_number=?", (channel_number,)).fetchall()]
        block_ids = [b["id"] for b in blocks]
        slots = []
        for bid in block_ids:
            slots.extend([dict(r) for r in conn.execute("SELECT * FROM block_slots WHERE block_id=?", (bid,)).fetchall()])
        collections = [dict(r) for r in conn.execute("SELECT * FROM channel_collections WHERE channel_number=?", (channel_number,)).fetchall()]
    return {
        "version": 1,
        "channel": dict(ch),
        "assignments": assignments,
        "blocks": blocks,
        "block_slots": slots,
        "channel_collections": collections,
    }

def _presets_dir() -> Path:
    """User-writable preset directory in the data volume.
    Users can drop custom lineup JSON files here to make them importable."""
    d = DB_PATH.parent / "presets"
    d.mkdir(parents=True, exist_ok=True)
    return d

@app.get("/api/presets/lineups")
def list_preset_lineups():
    """List lineup JSON files in the user's data/presets/ directory."""
    presets_dir = _presets_dir()
    out = []
    for p in presets_dir.glob("*.json"):
        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
            out.append({
                "id": p.stem,
                "name": data.get("name", p.stem),
                "description": data.get("description", ""),
                "channel_count": len(data.get("channels", [])),
            })
        except Exception:
            continue
    return out

@app.post("/api/presets/lineups/{lineup_id}/import")
async def import_preset_lineup(lineup_id: str, request: Request):
    """Import a shipped preset lineup (e.g., the Galaxy Network lineup).
    Body: {mode: 'merge'|'replace'} (default 'merge')."""
    # Sanitize lineup_id to prevent path traversal
    if not lineup_id.replace("-", "").replace("_", "").isalnum():
        raise HTTPException(400, "Invalid lineup id")
    file_path = _presets_dir() / f"{lineup_id}.json"
    if not file_path.exists():
        raise HTTPException(404, f"Preset lineup '{lineup_id}' not found")
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        raise HTTPException(500, f"Failed to read preset: {e}")

    body = await request.json() if request.headers.get("content-length", "0") != "0" else {}
    mode = body.get("mode", "merge")
    return _import_lineup_data(data, mode)

def _import_lineup_data(data: dict, mode: str) -> dict:
    """Shared lineup import logic used by both /api/import/lineup and preset imports."""
    channels = data.get("channels", [])
    assignments = data.get("assignments", [])
    blocks = data.get("blocks", [])
    block_slots = data.get("block_slots", [])

    stats = {"channels_added": 0, "assignments_added": 0, "blocks_added": 0, "slots_added": 0}
    with get_db() as conn:
        if mode == "replace":
            conn.execute("DELETE FROM block_slots")
            conn.execute("DELETE FROM blocks")
            conn.execute("DELETE FROM assignments")
            conn.execute("DELETE FROM channels")

        for ch in channels:
            try:
                # An imported channel always gets a LOCAL uid — an exported one
                # would collide with the source install's identity.
                conn.execute(
                    "INSERT OR IGNORE INTO channels (number, name, tier, vibe, mode, style, color, icon, uid) VALUES (?,?,?,?,?,?,?,?,?)",
                    (ch["number"], ch["name"], ch.get("tier", "Galaxy Main"), ch.get("vibe", ""),
                     ch.get("mode", "Shuffle"), ch.get("style", ""), ch.get("color", "blue"),
                     ch.get("icon"), _new_channel_uid()),
                )
                stats["channels_added"] += 1
            except Exception:
                pass

        block_id_map = {}
        for blk in blocks:
            try:
                old_id = blk.get("id")
                cur = conn.execute(
                    "INSERT INTO blocks (name, channel_number, days, start_time, end_time, content_type, notes, order_index) VALUES (?,?,?,?,?,?,?,?)",
                    (blk["name"], blk.get("channel_number"), blk.get("days", "[]"),
                     blk.get("start_time", "00:00"), blk.get("end_time", "23:59"),
                     blk.get("content_type", "both"), blk.get("notes", ""), blk.get("order_index", 0)),
                )
                if old_id is not None:
                    block_id_map[old_id] = cur.lastrowid
                stats["blocks_added"] += 1
            except Exception:
                pass

        for slot in block_slots:
            try:
                block_id = block_id_map.get(slot.get("block_id"), slot.get("block_id"))
                if block_id is None:
                    continue
                conn.execute(
                    "INSERT INTO block_slots (block_id, slot_time, plex_rating_key, plex_title, plex_type, plex_thumb, plex_year, duration_minutes) VALUES (?,?,?,?,?,?,?,?)",
                    (block_id, slot["slot_time"], slot["plex_rating_key"], slot["plex_title"],
                     slot["plex_type"], slot.get("plex_thumb"), slot.get("plex_year"),
                     slot.get("duration_minutes", 60)),
                )
                stats["slots_added"] += 1
            except Exception:
                pass

        for a in assignments:
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO assignments (channel_number, plex_rating_key, plex_title, plex_type, plex_thumb, plex_year) VALUES (?,?,?,?,?,?)",
                    (a["channel_number"], a["plex_rating_key"], a["plex_title"], a["plex_type"],
                     a.get("plex_thumb"), a.get("plex_year")),
                )
                stats["assignments_added"] += 1
            except Exception:
                pass

    return {"ok": True, "mode": mode, "stats": stats}

@app.post("/api/import/lineup")
async def import_lineup(request: Request):
    """Import a full lineup JSON. Mode: 'merge' (add new, skip existing) or 'replace' (wipe and re-create)."""
    body = await request.json()
    mode = body.get("mode", "merge")
    data = body.get("data", body)
    channels = data.get("channels", [])
    assignments = data.get("assignments", [])
    blocks = data.get("blocks", [])
    block_slots = data.get("block_slots", [])

    stats = {"channels_added": 0, "assignments_added": 0, "blocks_added": 0, "slots_added": 0}
    with get_db() as conn:
        if mode == "replace":
            conn.execute("DELETE FROM block_slots")
            conn.execute("DELETE FROM blocks")
            conn.execute("DELETE FROM assignments")
            conn.execute("DELETE FROM channels")

        for ch in channels:
            try:
                # Fresh local uid, never the exported one (see _import_lineup_data).
                conn.execute(
                    "INSERT OR IGNORE INTO channels (number, name, tier, vibe, mode, style, color, uid) VALUES (?,?,?,?,?,?,?,?)",
                    (ch["number"], ch["name"], ch.get("tier", "Galaxy Main"), ch.get("vibe", ""),
                     ch.get("mode", "Shuffle"), ch.get("style", ""), ch.get("color", "blue"),
                     _new_channel_uid()),
                )
                stats["channels_added"] += 1
            except Exception:
                pass

        # Build block ID mapping (old ID → new ID) for slot import
        block_id_map = {}
        for blk in blocks:
            try:
                old_id = blk.get("id")
                cur = conn.execute(
                    "INSERT INTO blocks (name, channel_number, days, start_time, end_time, content_type, notes, order_index) VALUES (?,?,?,?,?,?,?,?)",
                    (blk["name"], blk.get("channel_number"), blk.get("days", "[]"),
                     blk.get("start_time", "00:00"), blk.get("end_time", "23:59"),
                     blk.get("content_type", "both"), blk.get("notes", ""), blk.get("order_index", 0)),
                )
                if old_id is not None:
                    block_id_map[old_id] = cur.lastrowid
                stats["blocks_added"] += 1
            except Exception:
                pass

        for a in assignments:
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO assignments (channel_number, plex_rating_key, plex_title, plex_type, plex_thumb, plex_year) VALUES (?,?,?,?,?,?)",
                    (a["channel_number"], a["plex_rating_key"], a["plex_title"],
                     a.get("plex_type", "show"), a.get("plex_thumb"), a.get("plex_year")),
                )
                stats["assignments_added"] += 1
            except Exception:
                pass

        for s in block_slots:
            new_block_id = block_id_map.get(s.get("block_id"))
            if not new_block_id:
                continue
            try:
                conn.execute(
                    "INSERT INTO block_slots (block_id, slot_time, plex_rating_key, plex_title, plex_type, plex_thumb, plex_year, duration_minutes) VALUES (?,?,?,?,?,?,?,?)",
                    (new_block_id, s.get("slot_time", "00:00"), s.get("plex_rating_key", ""),
                     s.get("plex_title", ""), s.get("plex_type", "show"),
                     s.get("plex_thumb"), s.get("plex_year"), s.get("duration_minutes", 60)),
                )
                stats["slots_added"] += 1
            except Exception:
                pass

    _log_app("import", f"Imported lineup ({mode}): {stats}")
    return {"ok": True, "mode": mode, "stats": stats}

@app.post("/api/import/channel")
async def import_channel(request: Request):
    """Import a single channel from JSON export."""
    data = await request.json()
    ch = data.get("channel", data)
    if not ch.get("number") or not ch.get("name"):
        raise HTTPException(400, "Channel must have number and name")
    assignments = data.get("assignments", [])
    blocks = data.get("blocks", [])
    block_slots = data.get("block_slots", [])

    with get_db() as conn:
        # INSERT OR REPLACE deletes the old row, so an existing channel's uid
        # would be lost — re-importing over a channel must not change its
        # identity. Keep it when the number is already taken, mint one otherwise.
        prior = conn.execute(
            "SELECT uid FROM channels WHERE number=?", (ch["number"],)
        ).fetchone()
        uid = (prior["uid"] if prior and prior["uid"] else None) or _new_channel_uid()
        conn.execute(
            "INSERT OR REPLACE INTO channels (number, name, tier, vibe, mode, style, color, uid) VALUES (?,?,?,?,?,?,?,?)",
            (ch["number"], ch["name"], ch.get("tier", "Galaxy Main"), ch.get("vibe", ""),
             ch.get("mode", "Shuffle"), ch.get("style", ""), ch.get("color", "blue"), uid),
        )
        for a in assignments:
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO assignments (channel_number, plex_rating_key, plex_title, plex_type, plex_thumb, plex_year) VALUES (?,?,?,?,?,?)",
                    (ch["number"], a["plex_rating_key"], a["plex_title"],
                     a.get("plex_type", "show"), a.get("plex_thumb"), a.get("plex_year")),
                )
            except Exception:
                pass
        block_id_map = {}
        for blk in blocks:
            old_id = blk.get("id")
            try:
                cur = conn.execute(
                    "INSERT INTO blocks (name, channel_number, days, start_time, end_time, content_type, notes, order_index) VALUES (?,?,?,?,?,?,?,?)",
                    (blk["name"], ch["number"], blk.get("days", "[]"),
                     blk.get("start_time", "00:00"), blk.get("end_time", "23:59"),
                     blk.get("content_type", "both"), blk.get("notes", ""), blk.get("order_index", 0)),
                )
            except Exception:
                continue
            if old_id is not None:
                block_id_map[old_id] = cur.lastrowid
        for s in block_slots:
            new_block_id = block_id_map.get(s.get("block_id"))
            if not new_block_id:
                continue
            try:
                conn.execute(
                    "INSERT INTO block_slots (block_id, slot_time, plex_rating_key, plex_title, plex_type, plex_thumb, plex_year, duration_minutes) VALUES (?,?,?,?,?,?,?,?)",
                    (new_block_id, s.get("slot_time", "00:00"), s.get("plex_rating_key", ""),
                     s.get("plex_title", ""), s.get("plex_type", "show"),
                     s.get("plex_thumb"), s.get("plex_year"), s.get("duration_minutes", 60)),
                )
            except Exception:
                pass
    _log_app("import", f"Imported channel #{ch['number']} {ch['name']}")
    return {"ok": True, "channel_number": ch["number"]}

# ── Backup / Restore ────────────────────────────────────────────────────────

@app.get("/api/backup", tags=["system"])
def backup_db():
    """Download a snapshot of the SQLite database."""
    if not DB_PATH.exists():
        raise HTTPException(404, "No database found")
    backup_path = DB_PATH.parent / "backup.db"
    # Use SQLite online backup API to get a consistent snapshot
    src = sqlite3.connect(DB_PATH)
    dst = sqlite3.connect(backup_path)
    src.backup(dst)
    dst.close()
    src.close()
    log.info("Database backup created")
    _log_app("backup", "Database backup downloaded")
    return FileResponse(
        backup_path,
        media_type="application/octet-stream",
        filename="linearr-backup.db",
    )

@app.post("/api/restore", tags=["system"])
async def restore_db(request: Request):
    """Upload a SQLite database to restore from backup.
    Send the .db file as the raw request body.
    """
    body = await request.body()
    if len(body) < 100:
        raise HTTPException(400, "Uploaded file too small to be a valid database")
    # Validate it's a real SQLite file (magic bytes)
    if body[:16] != b"SQLite format 3\x00":
        raise HTTPException(400, "Not a valid SQLite database")
    restore_path = DB_PATH.parent / "restore.db"
    restore_path.write_bytes(body)
    # Swap in the restored database
    shutil.move(str(restore_path), str(DB_PATH))
    # Re-run schema migrations so a backup from an older version gets any
    # columns/tables added since — otherwise the app 500s until a restart.
    init_db()
    log.info("Database restored from upload (%d bytes)", len(body))
    _log_app("backup", f"Database restored from upload ({len(body)} bytes)", "warn")
    return {"ok": True, "size": len(body)}

# ── MCP server ────────────────────────────────────────────────────────────────
# Streamable-HTTP Model Context Protocol endpoint at /mcp. Lets AI assistants
# (Claude Code, Claude Desktop, any MCP client) drive Linearr. Tools live in the
# `linearr_mcp` package, one module per toolset; they call the route handlers in
# this module directly — no HTTP-to-self loop. Auth: bearer token (settings key
# `mcp_token`), enforced in auth_middleware.

import sys

from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.server.transport_security import TransportSecuritySettings

from linearr_mcp import build_mcp_server

mcp_server, MCP_TOOLSET_INFO = build_mcp_server(sys.modules[__name__])

_mcp_session_manager: StreamableHTTPSessionManager | None = None

def _make_mcp_session_manager() -> StreamableHTTPSessionManager:
    """One manager per app lifecycle — an instance can only be run once."""
    return StreamableHTTPSessionManager(
        app=mcp_server._mcp_server,
        json_response=True,
        stateless=True,
        # We do our own bearer auth in auth_middleware; Linearr is reached by
        # arbitrary LAN hostnames so Host-header pinning would break setups.
        security_settings=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )

async def _mcp_asgi(scope, receive, send):
    """Thin delegate so the mount always talks to the CURRENT session manager
    (a fresh one is created per app lifecycle in lifespan)."""
    if _mcp_session_manager is None:
        raise RuntimeError("MCP session manager not started")
    await _mcp_session_manager.handle_request(scope, receive, send)

app.mount("/mcp", _mcp_asgi)

# ---- MCP management (session-cookie auth, like the rest of /api) --------------

class McpToolsetsIn(BaseModel):
    toolsets: list[str]


@app.get("/api/mcp/info")
def mcp_info():
    """Connection info for the MCP endpoint (shown in Settings)."""
    return {
        "endpoint": "/mcp",
        "token": _get_mcp_token(),
        "tool_count": len(mcp_server._tool_manager.list_tools()),
        "toolsets": MCP_TOOLSET_INFO,
    }


@app.put("/api/mcp/toolsets")
def mcp_set_toolsets(body: McpToolsetsIn):
    """Choose which MCP toolsets are registered.

    Tools are registered at import, so a change takes effect on the next app
    start — the response says so rather than pretending it was live.
    """
    from linearr_mcp.registry import TOOLSETS as _ALL
    chosen = [t.strip().lower() for t in body.toolsets if t.strip()]
    unknown = [t for t in chosen if t not in _ALL]
    if unknown:
        raise HTTPException(400, f"Unknown toolset(s): {', '.join(unknown)}")
    if not chosen:
        raise HTTPException(400, "Select at least one toolset")
    value = ",".join(t for t in _ALL if t in chosen)
    with get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('mcp_toolsets', ?)", (value,))
    _log_app("system", f"MCP toolsets set to: {value}", "warn")
    return {"ok": True, "toolsets": value.split(","), "restart_required": True}

@app.post("/api/mcp/regenerate-token")
def mcp_regenerate_token():
    """Rotate the MCP bearer token (invalidates the old one immediately)."""
    token = secrets.token_hex(24)
    with get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('mcp_token', ?)", (token,))
    _log_app("system", "MCP token regenerated", "warn")
    return {"token": token}

# ── Frontend (SPA catch-all — must be last) ───────────────────────────────────
# Handles both /assets/* static files and all SPA routes.
# We cannot use app.mount() for /assets because mounts added after route
# registration lose priority to this catch-all in Starlette's route list.

DIST_DIR = Path("/app/dist")

# Built-output subdirectories served as files rather than falling through to the
# SPA shell. `fonts/` is here because the editor fonts are self-hosted (the CSP
# blocks Google Fonts); without it a request for a .woff2 would be answered with
# index.html and every face would fail to parse — a failure that looks exactly
# like the CSP bug it was meant to fix.
_STATIC_PREFIXES = ("assets/", "fonts/")


def _dist_file(rel: str) -> Path | None:
    """Resolve a path under DIST_DIR, or None if it escapes or does not exist.

    The traversal check is on the RESOLVED path: `full_path` arrives from the
    URL, and `DIST_DIR / "../.."` would otherwise walk out of the served tree.
    """
    try:
        candidate = (DIST_DIR / rel).resolve()
        candidate.relative_to(DIST_DIR.resolve())
    except (ValueError, OSError):
        return None
    return candidate if candidate.is_file() else None


@app.get("/{full_path:path}", include_in_schema=False)
def spa_fallback(full_path: str = ""):
    # Serve built static assets (JS, CSS, fonts) directly
    if full_path.startswith(_STATIC_PREFIXES):
        asset = _dist_file(full_path)
        if asset:
            return FileResponse(asset)
    # Serve root-level static files (favicon, manifest, icons, sw.js)
    if full_path and "/" not in full_path:
        root_file = _dist_file(full_path)
        if root_file:
            return FileResponse(root_file)
    # All other paths → SPA shell
    if INDEX_HTML.exists():
        return FileResponse(INDEX_HTML)
    return JSONResponse({"error": "Frontend not built. Run: cd frontend && npm run build"}, status_code=404)
