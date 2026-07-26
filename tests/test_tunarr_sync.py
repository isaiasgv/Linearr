"""Integration tests for `_sync_channel_to_tunarr` — the wiring point that calls
`_tunarr_resolve_transcode_config` (create branch) and `_tunarr_save_channel`
(update branch). Those two helpers are unit-tested in isolation in
`test_tunarr_channel_writer.py`; these tests pin the call site itself so a
transposition bug (swapped args, a typo in a `changes` key, the DB link-update
not firing, the error hint not reaching the returned dict) would be caught.

`_sync_channel_to_tunarr` builds its own `httpx.AsyncClient(timeout=15.0)`
internally rather than accepting one, so we monkeypatch `main.httpx.AsyncClient`
to return a real AsyncClient wired to an `httpx.MockTransport` — that still
supports `async with`, so the call site is untouched.
"""
import json

import httpx
import pytest

import main


@pytest.fixture
def anyio_backend():
    return "asyncio"


CH_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
NEW_TUNARR_ID = "99999999-8888-7777-6666-555555555555"
TC_UUID = "11111111-2222-3333-4444-555555555555"


def _install_mock_client(monkeypatch, handler):
    """Replace `main.httpx.AsyncClient` so the internal
    `httpx.AsyncClient(timeout=15.0)` call in `_sync_channel_to_tunarr` returns
    a MockTransport-backed client instead of touching the network. Records
    every request in the returned list."""
    calls: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return handler(request)

    transport = httpx.MockTransport(_handler)
    # `main.httpx` IS the `httpx` module (same object) — patching
    # `main.httpx.AsyncClient` patches it everywhere, including inside this
    # factory's own reference. Capture the real class first to avoid recursion.
    real_async_client = httpx.AsyncClient

    def _factory(*args, **kwargs):
        # Real AsyncClient, just pointed at the mock transport — still a
        # valid async context manager, matching the real thing exactly.
        return real_async_client(transport=transport)

    monkeypatch.setattr(main.httpx, "AsyncClient", _factory)
    return calls


def _seed_channel(number: int, name: str, tier: str = "Galaxy Main"):
    with main.get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO channels (number, name, tier) VALUES (?, ?, ?)",
            (number, name, tier),
        )
        conn.execute("DELETE FROM tunarr_channel_links WHERE channel_number=?", (number,))


def _seed_link(number: int, tunarr_id: str, tunarr_name: str | None = None, tunarr_number: int | None = None):
    with main.get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO tunarr_channel_links VALUES (?,?,?,?)",
            (number, tunarr_id, tunarr_name, tunarr_number),
        )


def _get_link(number: int):
    with main.get_db() as conn:
        row = conn.execute(
            "SELECT * FROM tunarr_channel_links WHERE channel_number=?", (number,)
        ).fetchone()
    return dict(row) if row else None


def _existing_tunarr_channel(**overrides) -> dict:
    base = {
        "id": CH_UUID,
        "name": "Old Name",
        "number": 601,
        "groupTitle": "Old Group",
        "duration": 86400000,
        "startTime": 1700000000000,
        "stealth": False,
        "disableFillerOverlay": True,
        "guideMinimumDuration": 30000,
        "streamMode": "hls",
        "subtitlesEnabled": False,
        "transcodeConfigId": TC_UUID,
        "icon": {"path": "", "width": 0, "duration": 0, "position": "bottom-right"},
        "offline": {"mode": "pic"},
        "onDemand": {"enabled": False},
    }
    base.update(overrides)
    return base


# ── 1. UPDATE path ────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_sync_update_path(monkeypatch, client):
    number = 60101
    _seed_channel(number, "My Channel", tier="Sci-Fi")
    _seed_link(number, CH_UUID, tunarr_name="Old Name", tunarr_number=number)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path == f"/api/channels/{CH_UUID}":
            return httpx.Response(200, json=_existing_tunarr_channel(number=number))
        if request.method == "PUT" and request.url.path == f"/api/channels/{CH_UUID}":
            body = json.loads(request.content or b"{}")
            return httpx.Response(200, json=body)
        return httpx.Response(404, json={})

    calls = _install_mock_client(monkeypatch, handler)

    result = await main._sync_channel_to_tunarr(number)

    assert result == {"synced": True, "action": "updated", "tunarr_id": CH_UUID}

    methods = [(c.method, c.url.path) for c in calls]
    assert ("GET", f"/api/channels/{CH_UUID}") in methods
    assert ("PUT", f"/api/channels/{CH_UUID}") in methods
    # GET must precede PUT (read-modify-write)
    assert methods.index(("GET", f"/api/channels/{CH_UUID}")) < methods.index(("PUT", f"/api/channels/{CH_UUID}"))

    put_req = next(c for c in calls if c.method == "PUT")
    put_body = json.loads(put_req.content or b"{}")
    assert put_body["name"] == "My Channel"
    assert put_body["number"] == number
    assert put_body["groupTitle"] == "Sci-Fi"

    link = _get_link(number)
    assert link["tunarr_name"] == "My Channel"
    assert link["tunarr_number"] == number


# ── 2. CREATE path ────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_sync_create_path(monkeypatch, client):
    number = 60102
    _seed_channel(number, "Brand New Channel", tier="Classics")
    # No link row — forces the create branch.

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path == "/api/transcode_configs":
            return httpx.Response(200, json=[{"id": TC_UUID, "name": "Default", "isDefault": True}])
        if request.method == "POST" and request.url.path == "/api/channels":
            return httpx.Response(201, json={
                "id": NEW_TUNARR_ID,
                "name": "Brand New Channel",
                "number": number,
                "groupTitle": "Classics",
            })
        return httpx.Response(404, json={})

    calls = _install_mock_client(monkeypatch, handler)

    result = await main._sync_channel_to_tunarr(number)

    assert result == {"synced": True, "action": "created", "tunarr_id": NEW_TUNARR_ID}

    post_req = next(c for c in calls if c.method == "POST" and c.url.path == "/api/channels")
    post_body = json.loads(post_req.content or b"{}")
    assert post_body["type"] == "new"
    assert "channel" in post_body
    assert post_body["channel"]["name"] == "Brand New Channel"
    assert post_body["channel"]["number"] == number
    # The client must send *some* id (schema requires it) but Tunarr assigns its
    # own — the row stored must use the uuid from the response, not this one.
    client_sent_id = post_body["channel"]["id"]
    assert client_sent_id != NEW_TUNARR_ID

    link = _get_link(number)
    assert link is not None
    assert link["tunarr_id"] == NEW_TUNARR_ID
    assert link["tunarr_name"] == "Brand New Channel"
    assert link["tunarr_number"] == number


# ── 2b. No usable transcode config on the create path ─────────────────────────

@pytest.mark.anyio
async def test_sync_create_path_explains_a_missing_transcode_config(monkeypatch, client):
    """`_tunarr_resolve_transcode_config` returning None used to fall through:
    the create went out without `transcodeConfigId` (required by 1.3.x) and came
    back as a bare "Tunarr 400" with no clue about the cause."""
    number = 60104
    _seed_channel(number, "No Transcode Config")

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path == "/api/transcode_configs":
            return httpx.Response(200, json=[])          # nothing usable
        if request.method == "GET" and request.url.path == "/api/ffmpeg-settings":
            return httpx.Response(200, json={})          # ...and no fallback
        if request.method == "POST":
            raise AssertionError("must not attempt a create without a transcode config")
        return httpx.Response(404, json={})

    _install_mock_client(monkeypatch, handler)

    result = await main._sync_channel_to_tunarr(number)

    assert result["synced"] is False
    assert result["action"] == "error"
    assert "transcode config" in result["message"]
    assert "400" not in result["message"]
    assert _get_link(number) is None


def test_tunarr_create_channel_route_explains_a_missing_transcode_config(
        monkeypatch, auth_client):
    """The second call site: POST /api/tunarr/channels."""
    monkeypatch.setattr(main, "get_tunarr_url", lambda: "http://t.test")

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            raise AssertionError("must not attempt a create without a transcode config")
        return httpx.Response(200, json=[] if request.url.path == "/api/transcode_configs" else {})

    _install_mock_client(monkeypatch, handler)

    r = auth_client.post("/api/tunarr/channels", json={"name": "X", "number": 60105})
    assert r.status_code == 502, r.text
    assert "transcode config" in r.json()["detail"]


# ── 3. 500 on update path ─────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_sync_update_path_surfaces_500(monkeypatch, client):
    number = 60103
    _seed_channel(number, "Dup Number Channel")
    _seed_link(number, CH_UUID, tunarr_name="Whatever", tunarr_number=number)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path == f"/api/channels/{CH_UUID}":
            return httpx.Response(200, json=_existing_tunarr_channel(number=number))
        if request.method == "PUT" and request.url.path == f"/api/channels/{CH_UUID}":
            return httpx.Response(500, json={})
        return httpx.Response(404, json={})

    _install_mock_client(monkeypatch, handler)

    result = await main._sync_channel_to_tunarr(number)

    assert result["synced"] is False
    assert result["action"] == "error"
    assert "500" in result["message"]
    assert "already be in use" in result["message"]


# ── 4. Channel not found ──────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_sync_channel_not_found_makes_no_http_call(monkeypatch, client):
    number = 60199  # never seeded

    with main.get_db() as conn:
        conn.execute("DELETE FROM channels WHERE number=?", (number,))

    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"no HTTP call should be made, got {request.method} {request.url}")

    _install_mock_client(monkeypatch, handler)

    result = await main._sync_channel_to_tunarr(number)

    assert result == {"synced": False, "action": "error", "message": "Channel not found"}
