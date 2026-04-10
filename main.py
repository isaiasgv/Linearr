import hashlib
import hmac
import json
import logging
import os
import shutil
import sqlite3
import time
import uuid
from collections import defaultdict
import httpx
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-5s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("linearr")

from channels import CHANNELS, CHANNELS_BY_NUMBER

def _get_channel(channel_number: int) -> dict | None:
    """Look up a channel from DB first, then fall back to static CHANNELS list."""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM channels WHERE number=?", (channel_number,)).fetchone()
    if row:
        return dict(row)
    return CHANNELS_BY_NUMBER.get(channel_number)

# ── Config ────────────────────────────────────────────────────────────────────

DB_PATH = Path("/app/data/assignments.db")
INDEX_HTML = Path("/app/dist/index.html")
PLEX_URL_DEFAULT = os.getenv("PLEX_URL", "http://plex:32400")
PLEX_TOKEN_DEFAULT = os.getenv("PLEX_TOKEN", "")

APP_USERNAME = os.getenv("APP_USERNAME", "admin")
APP_PASSWORD = os.getenv("APP_PASSWORD", "changeme")
APP_SECRET   = os.getenv("APP_SECRET", "default-secret-change-me")

# ── Auth helpers ───────────────────────────────────────────────────────────────

def _session_token() -> str:
    return hmac.new(APP_SECRET.encode(), f"{APP_USERNAME}:{APP_PASSWORD}".encode(), hashlib.sha256).hexdigest()

_PUBLIC_PATHS = {"/", "/api/auth/login", "/api/health", "/docs", "/openapi.json"}

# ── Rate limiting (login) ────────────────────────────────────────────────────
_login_attempts: dict[str, list[float]] = defaultdict(list)
_LOGIN_WINDOW = 300   # 5 minutes
_LOGIN_MAX = 10       # max attempts per window

# ── DB ────────────────────────────────────────────────────────────────────────

def get_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

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
        # Seed channels from channels.py if table is empty
        try:
            count = conn.execute("SELECT COUNT(*) FROM channels").fetchone()[0]
            if count == 0:
                for ch in CHANNELS:
                    conn.execute(
                        "INSERT OR IGNORE INTO channels (number, name, tier, vibe, mode, style, color) VALUES (?,?,?,?,?,?,?)",
                        (ch["number"], ch["name"], ch.get("tier", "Galaxy Main"),
                         ch.get("vibe", ""), ch.get("mode", "Shuffle"),
                         ch.get("style", ""), ch.get("color", "blue"))
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

def _log_app(category: str, message: str, level: str = "info", detail: str | None = None):
    """Insert an app-level log entry."""
    try:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO app_logs (level, category, message, detail) VALUES (?, ?, ?, ?)",
                (level, category, message, detail),
            )
        log.info("[%s] %s", category, message)
    except Exception as e:
        log.warning("Failed to write app log: %s", e)

def get_plex_config():
    with get_db() as conn:
        rows = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings")}
    url = rows.get("plex_url") or PLEX_URL_DEFAULT
    token = rows.get("plex_token") or PLEX_TOKEN_DEFAULT
    return url.rstrip("/"), token

# ── App ───────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    _log_app("system", "Linearr started")
    yield

app = FastAPI(lifespan=lifespan)

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if path in _PUBLIC_PATHS or path.startswith("/assets/") or path.startswith("/icon-") or path.endswith((".svg", ".ico", ".png", ".webmanifest", ".js", ".json")):
        return await call_next(request)
    session = request.cookies.get("session")
    if session != _session_token():
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    return await call_next(request)

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

class BulkAssignmentIn(BaseModel):
    channel_number: int
    items: list[AssignmentIn]

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

    if body.username != APP_USERNAME or body.password != APP_PASSWORD:
        log.info("Failed login from %s", ip)
        _log_app("auth", f"Failed login attempt from {ip}", "warn")
        raise HTTPException(401, "Invalid credentials")
    log.info("Successful login from %s", ip)
    _log_app("auth", f"User logged in from {ip}")
    response = JSONResponse({"ok": True})
    response.set_cookie("session", _session_token(), httponly=True, samesite="lax", max_age=86400 * 30)
    return response

@app.post("/api/auth/logout")
def logout():
    response = JSONResponse({"ok": True})
    response.delete_cookie("session")
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

@app.get("/api/channels")
def list_channels():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM channels ORDER BY number").fetchall()
    if rows:
        return [dict(r) for r in rows]
    return CHANNELS

@app.post("/api/channels", status_code=201)
async def create_channel(body: ChannelIn):
    with get_db() as conn:
        try:
            conn.execute(
                "INSERT INTO channels (number, name, tier, vibe, mode, style, color) VALUES (?,?,?,?,?,?,?)",
                (body.number, body.name, body.tier, body.vibe, body.mode, body.style, body.color)
            )
        except sqlite3.IntegrityError:
            raise HTTPException(409, f"Channel {body.number} already exists")
        row = conn.execute("SELECT * FROM channels WHERE number=?", (body.number,)).fetchone()
    result = dict(row)
    # Auto-create in Tunarr
    sync = await _sync_channel_to_tunarr(body.number)
    result["tunarr_sync"] = sync
    return result

async def _sync_channel_to_tunarr(channel_number: int):
    """Sync Cable Plex channel metadata to linked Tunarr channel.
    If no link exists, creates a new Tunarr channel and links it.
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

    # Build metadata payload for Tunarr
    update_data = {
        "name": ch.get("name", ""),
        "number": ch.get("number", 0),
        "groupTitle": ch.get("tier", "Linearr"),
    }
    # Sync icon if present
    icon_data = ch.get("icon")
    if icon_data and icon_data.startswith("data:"):
        update_data["icon"] = {"path": icon_data, "duration": 0, "width": 0, "position": "bottom-right"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            if link:
                # Update existing Tunarr channel
                tunarr_id = link["tunarr_id"]
                r = await client.put(f"{url}/api/channels/{tunarr_id}", json=update_data)
                if r.status_code in (200, 204):
                    # Update cached name/number in link
                    with get_db() as conn:
                        conn.execute(
                            "UPDATE tunarr_channel_links SET tunarr_name=?, tunarr_number=? WHERE channel_number=?",
                            (ch.get("name"), ch.get("number"), channel_number)
                        )
                    return {"synced": True, "action": "updated", "tunarr_id": tunarr_id}
                return {"synced": False, "action": "error", "message": f"Tunarr {r.status_code}"}
            else:
                # Create new Tunarr channel
                ffmpeg_r = await client.get(f"{url}/api/ffmpeg-settings")
                transcode_id = None
                if ffmpeg_r.status_code == 200:
                    transcode_id = ffmpeg_r.json().get("defaultTranscodeConfigId") or ffmpeg_r.json().get("configId")
                payload = {
                    **update_data,
                    "transcoding": {"targetResolution": "1920x1080"},
                    "offline": {"mode": "pic"},
                    "stealth": False,
                    "disableFillerOverlay": True,
                    "guideMinimumDuration": 30000,
                    "streamMode": "hls",
                }
                if transcode_id:
                    payload["transcodeConfigId"] = transcode_id
                r = await client.post(f"{url}/api/channels", json=payload)
                if r.status_code in (200, 201):
                    new_ch = r.json()
                    with get_db() as conn:
                        conn.execute(
                            "INSERT OR REPLACE INTO tunarr_channel_links VALUES (?,?,?,?)",
                            (channel_number, new_ch["id"], new_ch.get("name"), new_ch.get("number"))
                        )
                    return {"synced": True, "action": "created", "tunarr_id": new_ch["id"]}
                return {"synced": False, "action": "error", "message": f"Tunarr {r.status_code}"}
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
            """UPDATE channels SET name=?, tier=?, vibe=?, mode=?, style=?, color=?
               WHERE number=?""",
            (body.name, body.tier, body.vibe, body.mode, body.style, body.color, channel_number)
        )
        # If channel number changed, update all related tables
        if body.number != channel_number:
            conn.execute("UPDATE channels SET number=? WHERE number=?", (body.number, channel_number))
            for table in ("assignments", "blocks", "channel_collections", "tunarr_channel_links", "tunarr_collection_links"):
                try:
                    conn.execute(f"UPDATE {table} SET channel_number=? WHERE channel_number=?", (body.number, channel_number))
                except sqlite3.OperationalError:
                    pass
        row = conn.execute("SELECT * FROM channels WHERE number=?", (body.number,)).fetchone()
    result = dict(row)
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

@app.delete("/api/channels/{channel_number}")
def delete_channel(channel_number: int):
    with get_db() as conn:
        cur = conn.execute("DELETE FROM channels WHERE number=?", (channel_number,))
    if cur.rowcount == 0:
        raise HTTPException(404, "Channel not found")
    return {"ok": True}

# ── Channel Icons ─────────────────────────────────────────────────────────────

@app.put("/api/channels/{channel_number}/icon")
async def set_channel_icon(channel_number: int, request: Request):
    """Set channel icon (base64 PNG data URL)."""
    body = await request.json()
    icon_data = body.get("icon", "")
    with get_db() as conn:
        cur = conn.execute("UPDATE channels SET icon=? WHERE number=?", (icon_data, channel_number))
    if cur.rowcount == 0:
        raise HTTPException(404, "Channel not found")
    sync = await _sync_channel_to_tunarr(channel_number)
    return {"ok": True, "tunarr_sync": sync}

@app.delete("/api/channels/{channel_number}/icon")
async def delete_channel_icon(channel_number: int):
    """Remove channel icon."""
    with get_db() as conn:
        conn.execute("UPDATE channels SET icon=NULL WHERE number=?", (channel_number,))
    await _sync_channel_to_tunarr(channel_number)
    return {"ok": True}

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
            conn.execute("UPDATE channels SET icon=? WHERE number=?", (icon_data, int(ch_num)))
            imported += 1
    _log_app("icons", f"Imported {imported} channel icons")
    return {"ok": True, "imported": imported}

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
    if not data:
        raise HTTPException(400, "Icon data required")
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO saved_icons (name, category, data) VALUES (?, ?, ?)",
            (name, category, data),
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
        return dict(row)
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Already assigned")

@app.delete("/api/assignments/{assignment_id}")
def delete_assignment(assignment_id: int):
    with get_db() as conn:
        cur = conn.execute("DELETE FROM assignments WHERE id=?", (assignment_id,))
    if cur.rowcount == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}

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
        rows = conn.execute(
            "SELECT * FROM assignments WHERE channel_number=? ORDER BY plex_title",
            (body.channel_number,)
        ).fetchall()
    return {"added": added, "skipped": skipped, "assignments": [dict(r) for r in rows]}

# ── Settings ──────────────────────────────────────────────────────────────────

@app.get("/api/settings")
def get_settings():
    with get_db() as conn:
        rows = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings")}
    url = rows.get("plex_url") or PLEX_URL_DEFAULT
    token = rows.get("plex_token") or PLEX_TOKEN_DEFAULT
    return {
        "plex_url": url,
        "plex_token": token,
        "openai_api_key": rows.get("openai_api_key", ""),
        "openai_base_url": rows.get("openai_base_url", "https://api.openai.com/v1"),
        "openai_model": rows.get("openai_model", "gpt-4o-mini"),
        "tunarr_url": rows.get("tunarr_url", "http://tunarr:8000"),
    }

@app.post("/api/settings")
def save_settings(body: SettingsIn):
    with get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_url', ?)", (body.plex_url,))
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_token', ?)", (body.plex_token,))
        if body.openai_api_key is not None:
            conn.execute("INSERT OR REPLACE INTO settings VALUES ('openai_api_key', ?)", (body.openai_api_key,))
        if body.openai_base_url is not None:
            conn.execute("INSERT OR REPLACE INTO settings VALUES ('openai_base_url', ?)", (body.openai_base_url,))
        if body.openai_model is not None:
            conn.execute("INSERT OR REPLACE INTO settings VALUES ('openai_model', ?)", (body.openai_model,))
        if body.tunarr_url is not None:
            conn.execute("INSERT OR REPLACE INTO settings VALUES ('tunarr_url', ?)", (body.tunarr_url,))
    _log_app("settings", "Settings saved")
    return {"ok": True}

# ── Plex proxy ────────────────────────────────────────────────────────────────

def plex_headers(token: str):
    return {"X-Plex-Token": token, "Accept": "application/json"}

# ── Plex OAuth helpers ─────────────────────────────────────────────────────────

PLEX_TV = "https://plex.tv"
APP_NAME = "Linearr"

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
        "X-Plex-Version": "1.0.0",
        "X-Plex-Platform": "Docker",
        "Accept": "application/json",
    }

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
async def plex_library(section_id: str, type_filter: str = Query("all")):
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured — open Settings")
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{url}/library/sections/{section_id}/all",
            headers=plex_headers(token),
        )
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "Plex error")
    items = resp.json().get("MediaContainer", {}).get("Metadata", [])
    return _format_items(items, type_filter)

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
        result[r["plex_type"]] = dict(r)
    return result


@app.post("/api/channel-collections/{channel_number}", status_code=201)
async def link_channel_collection(channel_number: int, body: ChannelCollectionIn):
    with get_db() as conn:
        conn.execute(
            """INSERT INTO channel_collections (channel_number, plex_type, collection_rating_key, collection_title)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(channel_number, plex_type) DO UPDATE SET
                   collection_rating_key=excluded.collection_rating_key,
                   collection_title=excluded.collection_title""",
            (channel_number, body.plex_type, body.collection_rating_key, body.collection_title),
        )
        row = conn.execute(
            "SELECT * FROM channel_collections WHERE channel_number=? AND plex_type=?",
            (channel_number, body.plex_type),
        ).fetchone()

    # Auto-assign collection items to the channel
    added = 0
    skipped = 0
    try:
        url, token = get_plex_config()
        if token:
            hdrs = plex_headers(token)
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(f"{url}/library/collections/{body.collection_rating_key}/children", headers=hdrs)
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
                                (channel_number, m.get("ratingKey"), m.get("title"),
                                 t, m.get("thumb"), m.get("year")),
                            )
                            added += 1
                        except sqlite3.IntegrityError:
                            skipped += 1
    except Exception:
        pass  # linking succeeded, assignment is best-effort

    result = dict(row)
    result["assigned"] = {"added": added, "skipped": skipped}
    return result


@app.delete("/api/channel-collections/{channel_number}/{plex_type}")
def unlink_channel_collection(channel_number: int, plex_type: str):
    with get_db() as conn:
        cur = conn.execute(
            "DELETE FROM channel_collections WHERE channel_number=? AND plex_type=?",
            (channel_number, plex_type),
        )
    if cur.rowcount == 0:
        raise HTTPException(404, "Not found")
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


@app.post("/api/collections/generate/{channel_number}")
async def generate_collections(channel_number: int):
    """Create or update Plex collections for a channel's assigned movies and shows."""
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

    # Load any user-linked collections
    with get_db() as conn:
        linked = {r["plex_type"]: dict(r) for r in conn.execute(
            "SELECT * FROM channel_collections WHERE channel_number=?", (channel_number,)
        ).fetchall()}

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

        for plex_type, keys, section, suffix, type_int in [
            ("movie", movie_keys, movie_section, "Movies", 1),
            ("show",  show_keys,  show_section,  "TV",     2),
        ]:
            if not keys or not section:
                continue

            section_id = section["key"]
            link = linked.get(plex_type)
            coll_name  = link["collection_title"] if link else f"{ch_name} {suffix}"

            # 4a. Find existing collection — by linked rating key or by title
            existing = None
            created = False
            if link:
                # Verify the linked collection still exists
                ir = await client.get(f"{url}/library/collections/{link['collection_rating_key']}", headers=hdrs)
                if ir.status_code == 200:
                    meta = ir.json().get("MediaContainer", {}).get("Metadata", [])
                    if meta:
                        existing = meta[0]
            else:
                coll_resp = await client.get(
                    f"{url}/library/sections/{section_id}/collections",
                    headers=hdrs,
                )
                collections = []
                if coll_resp.status_code == 200:
                    collections = coll_resp.json().get("MediaContainer", {}).get("Metadata", []) or []
                existing = next((c for c in collections if c.get("title") == coll_name), None)

            if existing:
                coll_id = existing["ratingKey"]
            else:
                # 4b. Create collection
                create_resp = await client.post(
                    f"{url}/library/collections",
                    params={"type": type_int, "title": coll_name, "smart": 0, "sectionId": section_id},
                    headers=hdrs,
                )
                if create_resp.status_code not in (200, 201):
                    raise HTTPException(502, f"Failed to create collection: {coll_name}")
                coll_id = create_resp.json()["MediaContainer"]["Metadata"][0]["ratingKey"]
                created = True

            # Always save the resolved collection link so future operations use the rating key
            with get_db() as conn:
                conn.execute(
                    """INSERT INTO channel_collections (channel_number, plex_type, collection_rating_key, collection_title)
                       VALUES (?, ?, ?, ?)
                       ON CONFLICT(channel_number, plex_type) DO UPDATE SET
                           collection_rating_key=excluded.collection_rating_key,
                           collection_title=excluded.collection_title""",
                    (channel_number, plex_type, str(coll_id), coll_name),
                )

            # 4c. Get current items
            items_resp = await client.get(
                f"{url}/library/collections/{coll_id}/children",
                headers=hdrs,
            )
            current_keys: set[str] = set()
            if items_resp.status_code == 200:
                for item in items_resp.json().get("MediaContainer", {}).get("Metadata", []) or []:
                    current_keys.add(str(item["ratingKey"]))

            desired_keys = set(keys)

            # 4d. Add missing
            to_add = desired_keys - current_keys
            added = 0
            for rk in to_add:
                uri = f"server://{machine_id}/com.plexapp.plugins.library/library/metadata/{rk}"
                add_resp = await client.put(
                    f"{url}/library/collections/{coll_id}/items",
                    params={"uri": uri},
                    headers=hdrs,
                )
                if add_resp.status_code in (200, 201):
                    added += 1

            # 4d. Remove stale
            to_remove = current_keys - desired_keys
            removed = 0
            for rk in to_remove:
                del_resp = await client.delete(
                    f"{url}/library/collections/{coll_id}/items",
                    params={"items": rk},
                    headers=hdrs,
                )
                if del_resp.status_code in (200, 204):
                    removed += 1

            result[plex_type] = {
                "name": coll_name,
                "created": created,
                "added": added,
                "removed": removed,
                "total": len(desired_keys),
            }

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
                # Fetch existing Tunarr smart collections
                sr = await tc.get(f"{tunarr_url}/api/smart_collections")
                existing_sc = {sc["name"]: sc for sc in (sr.json() if sr.status_code == 200 else [])}

                created_sc, updated_sc = [], []
                for col in plex_cols:
                    col = dict(col)
                    sc_name = col["collection_title"]
                    structured_filter = _tunarr_tags_filter(sc_name)
                    if sc_name in existing_sc:
                        sc = existing_sc[sc_name]
                        # Always PUT structured filter to ensure it's correct
                        await tc.put(f"{tunarr_url}/api/smart_collections/{sc['uuid']}", json={
                            "filter": structured_filter,
                        })
                        updated_sc.append(sc_name)
                        with get_db() as conn:
                            conn.execute(
                                "INSERT OR REPLACE INTO tunarr_collection_links VALUES (?,?,?,?)",
                                (channel_number, col["plex_type"], sc["uuid"], sc_name)
                            )
                    else:
                        cr = await tc.post(f"{tunarr_url}/api/smart_collections", json={
                            "name": sc_name,
                            "filter": structured_filter,
                            "keywords": "",
                        })
                        if cr.status_code in (200, 201):
                            sc = cr.json()
                            with get_db() as conn:
                                conn.execute(
                                    "INSERT OR REPLACE INTO tunarr_collection_links VALUES (?,?,?,?)",
                                    (channel_number, col["plex_type"], sc["uuid"], sc_name)
                                )
                            created_sc.append(sc_name)

                # Trigger Tunarr library scan so it picks up the updated collection tags
                await tc.post(f"{tunarr_url}/api/tasks/ScanLibrariesTask/run")

            tunarr_result = {
                "synced": True,
                "smart_collections_created": created_sc,
                "smart_collections_updated": updated_sc,
                "library_scan_triggered": True,
            }
    except Exception as e:
        tunarr_result = {"synced": False, "error": str(e)[:200]}

    return {**result, "tunarr": tunarr_result}


@app.get("/api/plex/thumb")
async def plex_thumb(path: str = Query(...)):
    url, token = get_plex_config()
    full_url = f"{url}{path}?X-Plex-Token={token}&width=200&height=300"
    async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
        resp = await client.get(full_url)
    return StreamingResponse(
        resp.aiter_bytes(),
        media_type=resp.headers.get("content-type", "image/jpeg"),
    )

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
    return _row_to_block(row)

@app.delete("/api/blocks/{block_id}")
def delete_block(block_id: int):
    with get_db() as conn:
        cur = conn.execute("DELETE FROM blocks WHERE id=?", (block_id,))
    if cur.rowcount == 0:
        raise HTTPException(404, "Block not found")
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
    return {"ok": True}

@app.delete("/api/block-slots/{slot_id}")
def delete_block_slot(slot_id: int):
    with get_db() as conn:
        cur = conn.execute("DELETE FROM block_slots WHERE id=?", (slot_id,))
    if cur.rowcount == 0:
        raise HTTPException(404, "Slot not found")
    return {"ok": True}

@app.delete("/api/blocks/{block_id}/slots")
def clear_block_slots(block_id: int):
    """Delete all slots for a block (for clear+redo AI fill)."""
    with get_db() as conn:
        block = conn.execute("SELECT id FROM blocks WHERE id=?", (block_id,)).fetchone()
        if not block:
            raise HTTPException(404, "Block not found")
        cur = conn.execute("DELETE FROM block_slots WHERE block_id=?", (block_id,))
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
    return result

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
        raw = r.json()["choices"][0]["message"]["content"].strip()
        text = raw
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        data = _json.loads(text)
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
        raw = r.json()["choices"][0]["message"]["content"].strip()
        text = raw
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.split("```")[0]
        data = _json.loads(text.strip())

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
        raw = r.json()["choices"][0]["message"]["content"].strip()
        text = raw
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.split("```")[0]
        data = _json.loads(text.strip())

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
                    "INSERT INTO channels (number, name, tier, vibe, mode, style, color) VALUES (?,?,?,?,?,?,?)",
                    (ch["number"], ch["name"], ch.get("tier", "Galaxy Main"),
                     ch.get("vibe", ""), ch.get("mode", "Shuffle"),
                     ch.get("description", ""), ch.get("color", "blue"))
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
        raw = r.json()["choices"][0]["message"]["content"].strip()
        # Parse JSON from response
        text = raw
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        data = _json.loads(text)
        blocks = data.get("blocks", []) if isinstance(data, dict) else data

        # Log
        _log_ai(None, "full-day", body.channel_number, model, base_url, prompt[:500], raw[:1000], _json.dumps(blocks), None, ms)

        return {"blocks": blocks, "duration_ms": ms}
    except _json.JSONDecodeError as e:
        _log_ai(None, "full-day", body.channel_number, model, base_url, prompt[:500], raw[:1000] if 'raw' in dir() else None, None, f"JSON parse error: {e}", int((_time.monotonic() - t0) * 1000))
        raise HTTPException(502, f"AI returned invalid JSON: {str(e)[:100]}")
    except Exception as e:
        raise HTTPException(502, f"AI error: {str(e)[:200]}")

# ── Channel block templates ────────────────────────────────────────────────────

_DAYPART_TIMES = {
    "Early Morning": ("06:00", "09:00"),
    "Morning":       ("09:00", "12:00"),
    "Afternoon":     ("12:00", "17:00"),
    "Prime Time":    ("17:00", "22:00"),
    "Late Night":    ("22:00", "02:00"),
    "Overnight":     ("02:00", "06:00"),
    "All Day":       ("06:00", "23:00"),
}

_ALL_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

def _infer_content_type(desc: str) -> str:
    d = desc.lower()
    is_movie = any(w in d for w in ["movie", "film", "feature", "cinema"])
    is_show  = any(w in d for w in ["series", "episode", "sitcom", "cartoon",
                                     "anime", "animation", "documentary",
                                     "reality", "competition", "reruns", "block"])
    if is_movie and not is_show: return "movies"
    if is_show and not is_movie: return "shows"
    return "both"

def _daypart_to_template(daypart_name: str, desc: str) -> dict | None:
    for key, (start, end) in _DAYPART_TIMES.items():
        if daypart_name.startswith(key):
            label = daypart_name.split("(")[0].strip()
            return {
                "name": label,
                "start_time": start,
                "end_time": end,
                "content_type": _infer_content_type(desc),
                "days": _ALL_DAYS,
                "notes": desc,
            }
    return None

@app.get("/api/channels/{channel_number}/block-templates")
def channel_block_templates(channel_number: int):
    ch = _get_channel(channel_number)
    if not ch:
        raise HTTPException(404, "Channel not found")
    templates = []
    for name, desc in ch.get("dayparts", {}).items():
        t = _daypart_to_template(name, desc)
        if t:
            templates.append(t)
    return templates

@app.post("/api/channels/{channel_number}/block-templates/apply", status_code=201)
def apply_channel_block_templates(channel_number: int):
    ch = _get_channel(channel_number)
    if not ch:
        raise HTTPException(404, "Channel not found")
    created = []
    skipped = []
    with get_db() as conn:
        existing_names = {r["name"] for r in conn.execute(
            "SELECT name FROM blocks WHERE channel_number=?", (channel_number,)
        ).fetchall()}
        for name, desc in ch.get("dayparts", {}).items():
            t = _daypart_to_template(name, desc)
            if not t:
                continue
            if t["name"] in existing_names:
                skipped.append(t["name"])
                continue
            cur = conn.execute(
                """INSERT INTO blocks
                   (name, channel_number, days, start_time, end_time, content_type, notes, order_index)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (t["name"], channel_number, _json.dumps(t["days"]),
                 t["start_time"], t["end_time"], t["content_type"], t["notes"], 0),
            )
            row = conn.execute("SELECT * FROM blocks WHERE id=?", (cur.lastrowid,)).fetchone()
            created.append(_row_to_block(row))
    return {"created": created, "skipped": skipped}

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
        raw = resp_json["choices"][0]["message"]["content"].strip()
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
        reply = resp.json()["choices"][0]["message"]["content"].strip()
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
                "SELECT * FROM app_logs ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]
    except sqlite3.OperationalError:
        return []

@app.delete("/api/app-logs")
def clear_app_logs():
    with get_db() as conn:
        conn.execute("DELETE FROM app_logs")
    return {"ok": True}

# ── Tunarr Integration ────────────────────────────────────────────────────────

TUNARR_SUPPORTED_VERSION = "1.2.10"

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
        return {"version": None, "supported_version": TUNARR_SUPPORTED_VERSION,
                "is_supported": None, "tunarr_url": url}
    is_supported = _parse_version(version) <= _parse_version(TUNARR_SUPPORTED_VERSION)
    return {"version": version, "supported_version": TUNARR_SUPPORTED_VERSION,
            "is_supported": is_supported, "tunarr_url": url}

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
        # Fetch the actual default transcode config ID from Tunarr
        transcode_id = "default"
        try:
            tr = await client.get(f"{url}/api/ffmpeg-settings")
            if tr.status_code == 200:
                data = tr.json()
                # Could be a list or a single object — get the first/default
                if isinstance(data, list) and data:
                    transcode_id = data[0].get("id", "default")
                elif isinstance(data, dict):
                    transcode_id = data.get("id", "default")
        except Exception:
            pass

        # Also copy settings from an existing channel if available
        existing_channel = None
        try:
            cr = await client.get(f"{url}/api/channels")
            if cr.status_code == 200:
                channels = cr.json()
                if channels:
                    existing_channel = channels[0]
                    transcode_id = existing_channel.get("transcodeConfigId", transcode_id)
        except Exception:
            pass

        payload = {
            "type": "new",
            "channel": {
                "id": channel_id,
                "name": body.get("name", "New Channel"),
                "number": body.get("number", 1),
                "duration": 0,
                "startTime": 0,
                "groupTitle": body.get("groupTitle", "Galaxy Network"),
                "icon": {"path": "", "duration": 0, "width": 0, "position": "bottom-right"},
                "offline": {"mode": "pic"},
                "stealth": False,
                "disableFillerOverlay": True,
                "guideMinimumDuration": 30000,
                "streamMode": "hls",
                "transcodeConfigId": transcode_id,
                "subtitlesEnabled": False,
            }
        }

        r = await client.post(f"{url}/api/channels", json=payload)
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
        for key in ("items", "programs", "slots", "lineup"):
            if key in data and isinstance(data[key], list):
                return data[key]
        # If it has schedule-like fields directly (startTime, duration), wrap it
        if "startTime" in data or "start_time" in data:
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
    async with httpx.AsyncClient(timeout=10.0) as client:
        # Try the guide API first (returns materialized lineup)
        r = await client.get(f"{url}/api/guide/channels/{tunarr_id}",
                             params={"dateFrom": date_from, "dateTo": date_to})
        if r.status_code == 200:
            data = r.json()
            programs = data.get("programs", []) if isinstance(data, dict) else []
            if not programs and isinstance(data, list):
                programs = data
            return _normalize_guide_programs(programs)
        # Fallback: try the lineup API
        r = await client.get(f"{url}/api/channels/{tunarr_id}/lineup",
                             params={"from": date_from, "to": date_to})
        if r.status_code == 200:
            items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
            return _normalize_guide_programs(items)
        # Last fallback: schedule config (may not have timestamps)
        r = await client.get(f"{url}/api/channels/{tunarr_id}/schedule")
        if r.status_code == 200:
            return _extract_schedule_items(r.json())
    return []

def _normalize_guide_programs(programs: list) -> list[dict]:
    """Normalize Tunarr guide/lineup programs to a consistent format."""
    items = []
    for p in programs:
        start = p.get("start") or p.get("startTime") or p.get("start_time") or ""
        stop = p.get("stop") or p.get("endTime") or p.get("end_time") or ""
        # Calculate duration from start/stop if not provided directly
        duration = p.get("duration", 0)
        if not duration and start and stop:
            try:
                from datetime import datetime
                s = datetime.fromisoformat(str(start).replace("Z", "+00:00"))
                e = datetime.fromisoformat(str(stop).replace("Z", "+00:00"))
                duration = int((e - s).total_seconds() * 1000)
            except Exception:
                pass
        # Handle numeric timestamps (milliseconds)
        if isinstance(start, (int, float)):
            start_val = start
        elif isinstance(start, str) and start:
            try:
                from datetime import datetime
                start_val = int(datetime.fromisoformat(start.replace("Z", "+00:00")).timestamp() * 1000)
            except Exception:
                start_val = start
        else:
            start_val = start
        title = p.get("title") or p.get("programTitle") or "Unknown"
        episode = p.get("episode")
        if not episode and p.get("episodeTitle"):
            episode = {"title": p.get("episodeTitle"), "season": p.get("season"), "episode": p.get("episode_number") or p.get("episodeNumber")}
        items.append({
            "startTime": start_val,
            "duration": duration,
            "type": p.get("type", ""),
            "title": title,
            "episode": episode,
        })
    return items

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

    guide_channels = []
    async with httpx.AsyncClient(timeout=15.0) as client:
        # Try Tunarr's guide API (returns all channels at once)
        try:
            r = await client.get(f"{url}/api/guide/channels",
                                 params={"dateFrom": date_from, "dateTo": date_to})
            if r.status_code == 200:
                guide_data = r.json()
                channels_data = guide_data if isinstance(guide_data, list) else guide_data.get("channels", [])
                for ch in channels_data:
                    ch_id = ch.get("id", "")
                    if ch_id not in linked_ids:
                        continue
                    link = link_by_tunarr_id[ch_id]
                    programs = ch.get("programs", []) if isinstance(ch, dict) else []
                    guide_channels.append({
                        "channel_number": link["channel_number"],
                        "tunarr_id": ch_id,
                        "tunarr_name": link.get("tunarr_name") or ch.get("name", ""),
                        "tunarr_number": link.get("tunarr_number") or ch.get("number"),
                        "schedule": _normalize_guide_programs(programs),
                    })
                # Add channels that weren't in guide response (may not have programming)
                found_ids = {c["tunarr_id"] for c in guide_channels}
                for link in links:
                    if link["tunarr_id"] not in found_ids:
                        guide_channels.append({
                            "channel_number": link["channel_number"],
                            "tunarr_id": link["tunarr_id"],
                            "tunarr_name": link.get("tunarr_name", ""),
                            "tunarr_number": link.get("tunarr_number"),
                            "schedule": [],
                        })
                return {"channels": guide_channels}
        except Exception:
            pass

        # Fallback: fetch per-channel lineup
        for link in links:
            tunarr_id = link["tunarr_id"]
            try:
                r = await client.get(f"{url}/api/guide/channels/{tunarr_id}",
                                     params={"dateFrom": date_from, "dateTo": date_to})
                if r.status_code == 200:
                    data = r.json()
                    programs = data.get("programs", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
                    items = _normalize_guide_programs(programs)
                else:
                    items = []
            except Exception:
                items = []
            guide_channels.append({
                "channel_number": link["channel_number"],
                "tunarr_id": tunarr_id,
                "tunarr_name": link.get("tunarr_name", ""),
                "tunarr_number": link.get("tunarr_number"),
                "schedule": items,
            })
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

    # If DB is empty, use static CHANNELS
    if not cp_by_number:
        from channels import CHANNELS
        for ch in CHANNELS:
            cp_by_number[ch["number"]] = ch
            cp_by_name[ch["name"].lower()] = ch

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
                    "INSERT OR IGNORE INTO channels (number, name, tier, vibe, mode, style, color) VALUES (?,?,?,?,?,?,?)",
                    (cp_num, tname, "Galaxy Main", "", "Shuffle", "", "blue"),
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

    # If DB channels empty, use static CHANNELS
    if not cp_channels:
        from channels import CHANNELS
        if body.channel_numbers == "all":
            cp_channels = CHANNELS
        else:
            cp_channels = [c for c in CHANNELS if c["number"] in body.channel_numbers]

    # Fetch existing Tunarr channels for matching
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(f"{url}/api/channels")
    tunarr_channels = r.json() if r.status_code == 200 and isinstance(r.json(), list) else []
    tunarr_by_number = {c.get("number"): c for c in tunarr_channels}

    # Get ffmpeg settings for channel creation
    ffmpeg_r = await httpx.AsyncClient(timeout=5).get(f"{url}/api/ffmpeg-settings")
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
            payload = {
                "name": cp.get("name", f"Channel {cp_num}"),
                "number": cp_num,
                "groupTitle": cp.get("tier", "Linearr"),
                "transcoding": {"targetResolution": "1920x1080"},
                "offline": {"mode": "pic"},
                "stealth": False,
                "disableFillerOverlay": True,
                "guideMinimumDuration": 30000,
                "streamMode": "hls",
            }
            if transcode_id:
                payload["transcodeConfigId"] = transcode_id
            async with httpx.AsyncClient(timeout=10.0) as client:
                cr = await client.post(f"{url}/api/channels", json=payload)
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

@app.get("/api/tunarr/smart-collections")
async def tunarr_list_smart_collections():
    url = get_tunarr_url()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{url}/api/smart_collections")
            if r.status_code == 404:
                r = await client.get(f"{url}/api/smart-collections")
        if r.status_code != 200:
            raise HTTPException(r.status_code, f"Tunarr error: {r.text[:200]}")
        return r.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Cannot reach Tunarr: {e}")

@app.post("/api/tunarr/smart-collections", status_code=201)
async def tunarr_create_smart_collection(body: dict):
    url = get_tunarr_url()
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(f"{url}/api/smart_collections", json=body)
    if r.status_code not in (200, 201):
        raise HTTPException(r.status_code, r.text[:300])
    return r.json()

@app.put("/api/tunarr/smart-collections/{sc_id}")
async def tunarr_update_smart_collection(sc_id: str, body: dict):
    url = get_tunarr_url()
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.put(f"{url}/api/smart_collections/{sc_id}", json=body)
    if r.status_code == 404:
        raise HTTPException(404, "Smart collection not found in Tunarr")
    if r.status_code not in (200, 201):
        raise HTTPException(r.status_code, r.text[:300])
    return r.json()

@app.delete("/api/tunarr/smart-collections/{sc_id}")
async def tunarr_delete_smart_collection(sc_id: str):
    url = get_tunarr_url()
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.delete(f"{url}/api/smart_collections/{sc_id}")
    if r.status_code == 404:
        raise HTTPException(404, "Smart collection not found in Tunarr")
    if r.status_code not in (200, 204):
        raise HTTPException(r.status_code, r.text[:300])
    # Also remove any local collection links referencing this UUID
    with get_db() as conn:
        conn.execute("DELETE FROM tunarr_collection_links WHERE tunarr_collection_id=?", (sc_id,))
    return {"ok": True}

# ── Tunarr tasks (guide refresh, library scan) ───────────────────────────────

@app.post("/api/tunarr/tasks/{task_name}")
async def tunarr_run_task(task_name: str, body: dict | None = None):
    """Trigger a Tunarr task (UpdateXmlTvTask, ScanLibrariesTask, etc.)."""
    url = get_tunarr_url()
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(
            f"{url}/api/tasks/{task_name}/run",
            params={"background": "true"},
            json=body or {},
        )
    if r.status_code not in (200, 202, 204):
        raise HTTPException(r.status_code, f"Tunarr task failed: {r.text[:200]}")
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
    return {"ok": True}

@app.delete("/api/tunarr/channel-links/{channel_number}")
def tunarr_delete_channel_link(channel_number: int):
    with get_db() as conn:
        conn.execute("DELETE FROM tunarr_channel_links WHERE channel_number=?", (channel_number,))
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
    return {"ok": True}

@app.delete("/api/tunarr/collection-links/{channel_number}/{plex_type}")
def tunarr_delete_collection_link(channel_number: int, plex_type: str):
    with get_db() as conn:
        conn.execute(
            "DELETE FROM tunarr_collection_links WHERE channel_number=? AND plex_type=?",
            (channel_number, plex_type)
        )
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

    # Resolve the correct smart collections endpoint (underscore vs hyphen varies by Tunarr version)
    sc_path = "/api/smart_collections"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{url}{sc_path}")
            if r.status_code == 404:
                sc_path = "/api/smart-collections"
                r = await client.get(f"{url}{sc_path}")
        existing = r.json() if r.status_code == 200 else []
    except Exception as e:
        log.warning("Failed to fetch Tunarr smart collections: %s", e)
        raise HTTPException(502, f"Cannot reach Tunarr smart collections API: {e}")

    existing_by_name = {sc["name"]: sc for sc in existing}

    created, updated = [], []
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            for col in plex_cols:
                col = dict(col)
                name = col["collection_title"]
                structured_filter = _tunarr_tags_filter(name)
                if name in existing_by_name:
                    sc = existing_by_name[name]
                    await client.put(f"{url}{sc_path}/{sc['uuid']}", json={
                        "filter": structured_filter,
                    })
                    updated.append({"name": name, "id": sc["uuid"]})
                    with get_db() as conn:
                        conn.execute(
                            "INSERT OR REPLACE INTO tunarr_collection_links VALUES (?,?,?,?)",
                            (channel_number, col["plex_type"], sc["uuid"], name)
                        )
                else:
                    r2 = await client.post(f"{url}{sc_path}", json={
                        "name": name,
                        "filter": structured_filter,
                        "keywords": "",
                    })
                    if r2.status_code in (200, 201):
                        sc = r2.json()
                        with get_db() as conn:
                            conn.execute(
                                "INSERT OR REPLACE INTO tunarr_collection_links VALUES (?,?,?,?)",
                                (channel_number, col["plex_type"], sc["uuid"], name)
                            )
                        created.append({"name": name, "id": sc["uuid"]})
                    else:
                        log.warning("Tunarr rejected smart collection %s: %s", name, r2.text[:200])
    except HTTPException:
        raise
    except Exception as e:
        log.warning("Error during Tunarr collection sync: %s", e)
        raise HTTPException(502, f"Tunarr sync error: {e}")

    return {"created": created, "updated": updated}

# ── Tunarr time slot push ─────────────────────────────────────────────────────

def _tunarr_tags_filter(collection_name: str) -> dict:
    """Build the structured filter object Tunarr requires for tags-based smart collections.

    Tunarr's DAO ignores filterString on writes — it only uses the structured
    `filter` field (converted back to a string via searchFilterToString).
    """
    return {
        "type": "value",
        "fieldSpec": {
            "type": "faceted_string",
            "key": "tags",
            "op": "=",
            "value": [collection_name],
        },
    }

def _hhmm_to_ms(hhmm: str) -> int:
    """Convert HH:MM to milliseconds from midnight."""
    h, m = map(int, hhmm.split(":"))
    return (h * 3600 + m * 60) * 1000

def _add_show_key(mapping: dict, show: dict) -> None:
    """Extract Plex rating key and Tunarr UUID from a Tunarr show object."""
    uuid = show.get("uuid") or show.get("id") or ""
    # Try multiple field names Tunarr may use for the Plex rating key
    for field in ("externalKey", "plex_rating_key", "plexRatingKey", "ratingKey", "key"):
        val = show.get(field)
        if val:
            mapping[str(val).strip()] = uuid
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

    # Base: smart collection at midnight — shuffles all day as fallback
    base_col = col_links.get("show") or col_links.get("movie")
    if base_col:
        slots.append({
            "type": "smart-collection",
            "smartCollectionId": base_col["tunarr_collection_id"],
            "startTime": 0,
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
                conn.execute(
                    "INSERT OR IGNORE INTO channels (number, name, tier, vibe, mode, style, color) VALUES (?,?,?,?,?,?,?)",
                    (ch["number"], ch["name"], ch.get("tier", "Galaxy Main"), ch.get("vibe", ""),
                     ch.get("mode", "Shuffle"), ch.get("style", ""), ch.get("color", "blue")),
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
        conn.execute(
            "INSERT OR REPLACE INTO channels (number, name, tier, vibe, mode, style, color) VALUES (?,?,?,?,?,?,?)",
            (ch["number"], ch["name"], ch.get("tier", "Galaxy Main"), ch.get("vibe", ""),
             ch.get("mode", "Shuffle"), ch.get("style", ""), ch.get("color", "blue")),
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
            cur = conn.execute(
                "INSERT INTO blocks (name, channel_number, days, start_time, end_time, content_type, notes, order_index) VALUES (?,?,?,?,?,?,?,?)",
                (blk["name"], ch["number"], blk.get("days", "[]"),
                 blk.get("start_time", "00:00"), blk.get("end_time", "23:59"),
                 blk.get("content_type", "both"), blk.get("notes", ""), blk.get("order_index", 0)),
            )
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
    log.info("Database restored from upload (%d bytes)", len(body))
    _log_app("backup", f"Database restored from upload ({len(body)} bytes)", "warn")
    return {"ok": True, "size": len(body)}

# ── Frontend (SPA catch-all — must be last) ───────────────────────────────────
# Handles both /assets/* static files and all SPA routes.
# We cannot use app.mount() for /assets because mounts added after route
# registration lose priority to this catch-all in Starlette's route list.

DIST_DIR = Path("/app/dist")

@app.get("/{full_path:path}", include_in_schema=False)
def spa_fallback(full_path: str = ""):
    # Serve built static assets (JS, CSS, etc.) directly
    if full_path.startswith("assets/"):
        asset = DIST_DIR / full_path
        if asset.exists():
            return FileResponse(asset)
    # Serve root-level static files (favicon, manifest, icons, sw.js)
    if full_path and not "/" in full_path:
        root_file = DIST_DIR / full_path
        if root_file.exists() and root_file.is_file():
            return FileResponse(root_file)
    # All other paths → SPA shell
    if INDEX_HTML.exists():
        return FileResponse(INDEX_HTML)
    return JSONResponse({"error": "Frontend not built. Run: cd frontend && npm run build"}, status_code=404)
