"""Watermark config: storage, validation, and the Tunarr payload mapping.

Validation mirrors Tunarr's real zod constraints so users get a clear message
instead of an opaque 400 from Tunarr:
  width strictly > 0, opacity an integer 0-100, margins 0-100,
  duration >= 0, fade period >= 1 minute.
"""
import pytest


def _make_channel(auth_client, number=701, *, with_image=False):
    r = auth_client.post("/api/channels", json={
        "number": number, "name": f"WM {number}", "tier": "Galaxy Main",
        "vibe": "", "mode": "Shuffle", "style": "", "color": "blue", "icon": None,
    })
    assert r.status_code in (201, 409), r.text
    if with_image:
        _set_image_url(number, f"http://tunarr:8000/images/uploads/wm-{number}.png")
    return number


def _set_image_url(number: int, url: str | None) -> None:
    """Set the resolved watermark image directly.

    Enabling a watermark requires one (see `test_enabling_without_an_image_is_rejected`),
    and the real resolve path needs a live Tunarr to upload to.
    """
    import main
    with main.get_db() as conn:
        conn.execute("UPDATE channels SET watermark_image_url=? WHERE number=?",
                     (url, number))


def test_watermark_defaults_to_absent(auth_client):
    n = _make_channel(auth_client, 701)
    r = auth_client.get(f"/api/channels/{n}/watermark")
    assert r.status_code == 200
    assert r.json() == {"watermark": None}


def test_put_and_get_watermark_roundtrip(auth_client):
    n = _make_channel(auth_client, 702, with_image=True)
    payload = {
        "enabled": True, "position": "top-left", "width": 12.5,
        "vertical_margin": 2, "horizontal_margin": 3, "duration": 0,
        "opacity": 80, "fixed_size": False,
        "fade": {"period_mins": 5, "leading_edge": True},
    }
    r = auth_client.put(f"/api/channels/{n}/watermark", json=payload)
    assert r.status_code == 200, r.text
    got = auth_client.get(f"/api/channels/{n}/watermark").json()["watermark"]
    assert got["enabled"] is True
    assert got["position"] == "top-left"
    assert got["width"] == 12.5
    assert got["opacity"] == 80
    assert got["fade"] == {"period_mins": 5, "leading_edge": True}


def test_delete_watermark_clears_it(auth_client):
    n = _make_channel(auth_client, 703, with_image=True)
    auth_client.put(f"/api/channels/{n}/watermark", json={
        "enabled": True, "width": 10, "vertical_margin": 1,
        "horizontal_margin": 1, "position": "bottom-right",
    })
    r = auth_client.delete(f"/api/channels/{n}/watermark")
    assert r.status_code == 200
    assert auth_client.get(f"/api/channels/{n}/watermark").json() == {"watermark": None}


@pytest.mark.parametrize("bad,field", [
    ({"width": 0}, "width"),
    ({"width": -5}, "width"),
    ({"opacity": 101}, "opacity"),
    ({"opacity": -1}, "opacity"),
    ({"vertical_margin": 101}, "vertical_margin"),
    ({"horizontal_margin": -1}, "horizontal_margin"),
    ({"duration": -1}, "duration"),
    ({"position": "center"}, "position"),
])
def test_watermark_validation_rejects_values_tunarr_would_reject(auth_client, bad, field):
    n = _make_channel(auth_client, 704)
    payload = {
        "enabled": True, "width": 10, "vertical_margin": 1,
        "horizontal_margin": 1, "position": "bottom-right", "duration": 0,
        "opacity": 100,
    }
    payload.update(bad)
    r = auth_client.put(f"/api/channels/{n}/watermark", json=payload)
    assert r.status_code == 422, f"{field}={bad[field]!r} should be rejected"


def test_fade_period_must_be_at_least_one_minute(auth_client):
    n = _make_channel(auth_client, 705)
    r = auth_client.put(f"/api/channels/{n}/watermark", json={
        "enabled": True, "width": 10, "vertical_margin": 1, "horizontal_margin": 1,
        "position": "bottom-right", "fade": {"period_mins": 0},
    })
    assert r.status_code == 422


def test_enabling_without_an_image_is_rejected(auth_client):
    """An enabled watermark with no resolved image would be pushed as
    `url: ""`. Every channel write is a full SaveableChannel PUT, so if Tunarr
    rejects that, EVERY later save for the channel fails — name/number/tier
    included. Gate it at the route with an actionable message.
    """
    n = _make_channel(auth_client, 706)
    _set_image_url(n, None)
    r = auth_client.put(f"/api/channels/{n}/watermark", json={
        "enabled": True, "width": 10, "vertical_margin": 1,
        "horizontal_margin": 1, "position": "bottom-right",
    })
    assert r.status_code == 400, r.text
    assert "image" in r.json()["detail"].lower()
    # Nothing was stored, so the channel is still watermark-free.
    assert auth_client.get(f"/api/channels/{n}/watermark").json() == {"watermark": None}


def test_disabled_watermark_without_an_image_is_still_allowed(auth_client):
    """The gate is only on `enabled` — saving a draft config is fine."""
    n = _make_channel(auth_client, 707)
    _set_image_url(n, None)
    r = auth_client.put(f"/api/channels/{n}/watermark", json={
        "enabled": False, "width": 10, "vertical_margin": 1,
        "horizontal_margin": 1, "position": "top-left",
    })
    assert r.status_code == 200, r.text
    assert auth_client.get(f"/api/channels/{n}/watermark").json()["watermark"]["position"] \
        == "top-left"


def test_enabling_with_a_blank_image_url_is_rejected(auth_client):
    n = _make_channel(auth_client, 708)
    _set_image_url(n, "   ")
    r = auth_client.put(f"/api/channels/{n}/watermark", json={
        "enabled": True, "width": 10, "vertical_margin": 1,
        "horizontal_margin": 1, "position": "bottom-right",
    })
    assert r.status_code == 400, r.text


def test_watermark_404_for_unknown_channel(auth_client):
    r = auth_client.put("/api/channels/99999/watermark", json={
        "enabled": True, "width": 10, "vertical_margin": 1,
        "horizontal_margin": 1, "position": "bottom-right",
    })
    assert r.status_code == 404


def test_tunarr_payload_uses_tunarr_field_names_and_types():
    """Maps snake_case storage to Tunarr's camelCase, and only fadeConfig[0]."""
    import main
    out = main._watermark_to_tunarr({
        "enabled": True, "position": "top-right", "width": 10.0,
        "vertical_margin": 1.0, "horizontal_margin": 2.0, "duration": 30.0,
        "opacity": 75, "fixed_size": True,
        "fade": {"period_mins": 5, "leading_edge": False},
    }, "http://tunarr:8000/images/uploads/logo.png")

    assert out["enabled"] is True
    assert out["position"] == "top-right"
    assert out["width"] == 10.0
    assert out["verticalMargin"] == 1.0
    assert out["horizontalMargin"] == 2.0
    assert out["duration"] == 30.0
    assert out["opacity"] == 75
    assert isinstance(out["opacity"], int)
    assert out["fixedSize"] is True
    assert out["url"] == "http://tunarr:8000/images/uploads/logo.png"
    assert out["fadeConfig"] == [{"periodMins": 5, "leadingEdge": False}]
    # programType is never read by Tunarr's pipeline — don't send it
    assert "programType" not in out["fadeConfig"][0]
    # animated is persisted but never read at 1.3.6 — don't send it
    assert "animated" not in out


def test_tunarr_payload_omits_fade_when_unset():
    import main
    out = main._watermark_to_tunarr({
        "enabled": True, "position": "bottom-right", "width": 10.0,
        "vertical_margin": 1.0, "horizontal_margin": 1.0, "duration": 0.0,
        "opacity": 100, "fixed_size": False, "fade": None,
    }, None)
    assert "fadeConfig" not in out
    assert out.get("url", "") == ""


import base64

import httpx


@pytest.fixture
def anyio_backend():
    return "asyncio"


# 1x1 transparent PNG
_PNG_B64 = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGMAAQAABQAB"
            "oIJXOQAAAABJRU5ErkJggg==")
_PNG_DATA_URI = f"data:image/png;base64,{_PNG_B64}"


def test_decode_data_uri_extracts_bytes_and_type():
    import main
    got = main._decode_data_uri(_PNG_DATA_URI)
    assert got is not None
    raw, content_type, filename = got
    assert raw == base64.b64decode(_PNG_B64)
    assert content_type == "image/png"
    assert filename.endswith(".png")


def test_decode_data_uri_rejects_non_data_uri():
    import main
    assert main._decode_data_uri("http://example.com/x.png") is None
    assert main._decode_data_uri("") is None


@pytest.mark.anyio
async def test_upload_image_rewrites_the_returned_host():
    """Tunarr builds fileUrl from the inbound Host header, so the URL it returns
    is unreachable when Linearr talks to it as http://tunarr:8000."""
    import main

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/upload/image"
        return httpx.Response(200, json={
            "name": "logo.png",
            "fileUrl": "http://localhost:8000/images/uploads/logo.png",
        })

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://tunarr:8000") as client:
        got = await main._tunarr_upload_image(
            client, "http://tunarr:8000", b"\x89PNG", "image/png", "logo.png")
    assert got == "http://tunarr:8000/images/uploads/logo.png"


@pytest.mark.anyio
async def test_upload_image_returns_none_on_rejection():
    import main

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://tunarr:8000") as client:
        got = await main._tunarr_upload_image(
            client, "http://tunarr:8000", b"nope", "image/png", "logo.png")
    assert got is None


def test_watermark_for_tunarr_reads_the_channel_row():
    import json as _json

    import main
    ch = {
        "watermark": _json.dumps({
            "enabled": True, "position": "top-left", "width": 15.0,
            "vertical_margin": 2.0, "horizontal_margin": 2.0, "duration": 0.0,
            "opacity": 90, "fixed_size": False, "fade": None,
        }),
        "watermark_image_url": "http://tunarr:8000/images/uploads/a.png",
    }
    out = main._watermark_for_tunarr(ch)
    assert out is not None
    assert out["enabled"] is True
    assert out["position"] == "top-left"
    assert out["url"] == "http://tunarr:8000/images/uploads/a.png"


def test_watermark_for_tunarr_is_none_when_unset():
    import main
    assert main._watermark_for_tunarr({"watermark": None}) is None
    assert main._watermark_for_tunarr({}) is None


def test_watermark_for_tunarr_survives_corrupt_json():
    import main
    assert main._watermark_for_tunarr({"watermark": "{not json"}) is None


# ── Clearing a watermark must reach Tunarr ────────────────────────────────────
#
# Tunarr offers no way to null the watermark column through its API, and channel
# writes are read-modify-write — so simply omitting the key means the GET echoes
# Tunarr's existing watermark straight back and the overlay keeps rendering. The
# only off switch is writing a watermark object with `enabled: false`.
#
# `_sync_channel_to_tunarr` builds its own `httpx.AsyncClient`, so we monkeypatch
# `main.httpx.AsyncClient` with a factory returning a real client wired to a
# MockTransport (same pattern as tests/test_tunarr_sync.py).

_WM_CH_UUID = "cccccccc-dddd-eeee-ffff-000000000000"


def _install_wm_mock_client(monkeypatch, handler):
    import main
    calls: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return handler(request)

    transport = httpx.MockTransport(_handler)
    # Capture the real class first — `main.httpx` IS the httpx module, so
    # patching its AsyncClient would otherwise make this factory recurse.
    real_async_client = httpx.AsyncClient

    def _factory(*args, **kwargs):
        return real_async_client(transport=transport)

    monkeypatch.setattr(main.httpx, "AsyncClient", _factory)
    return calls


def _seed_wm_channel(number: int, name: str, watermark_json=None, image_url=None,
                     tunarr_id: str | None = None):
    import main
    with main.get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO channels (number, name, tier, watermark, watermark_image_url)"
            " VALUES (?, ?, ?, ?, ?)",
            (number, name, "Galaxy Main", watermark_json, image_url),
        )
        conn.execute("DELETE FROM tunarr_channel_links WHERE channel_number=?", (number,))
        if tunarr_id:
            conn.execute(
                "INSERT OR REPLACE INTO tunarr_channel_links VALUES (?,?,?,?)",
                (number, tunarr_id, name, number),
            )


def _existing_wm_tunarr_channel(number: int, watermark: dict | None) -> dict:
    base = {
        "id": _WM_CH_UUID,
        "name": "WM Channel",
        "number": number,
        "groupTitle": "Galaxy Main",
        "duration": 86400000,
        "startTime": 1700000000000,
        "stealth": False,
        "disableFillerOverlay": True,
        "guideMinimumDuration": 30000,
        "streamMode": "hls",
        "subtitlesEnabled": False,
        "transcodeConfigId": "11111111-2222-3333-4444-555555555555",
        "icon": {"path": "", "width": 0, "duration": 0, "position": "bottom-right"},
        "offline": {"mode": "pic"},
        "onDemand": {"enabled": False},
    }
    if watermark is not None:
        base["watermark"] = watermark
    return base


def test_delete_watermark_disables_it_in_tunarr(monkeypatch, auth_client):
    """Regression: DELETE must push `watermark.enabled == False` to Tunarr.

    Before the fix the key was absent from `changes`, so the read-modify-write
    PUT echoed Tunarr's still-enabled watermark back and the overlay survived.
    """
    import json as _json

    n = 7101
    _seed_wm_channel(
        n, "WM Channel",
        watermark_json=_json.dumps({
            "enabled": True, "position": "bottom-right", "width": 10.0,
            "vertical_margin": 1.0, "horizontal_margin": 1.0, "duration": 0.0,
            "opacity": 100, "fixed_size": False, "fade": None,
        }),
        image_url="http://tunarr:8000/images/uploads/logo.png",
        tunarr_id=_WM_CH_UUID,
    )

    live_watermark = {
        "enabled": True, "position": "bottom-right", "width": 10.0,
        "verticalMargin": 1.0, "horizontalMargin": 1.0, "duration": 0.0,
        "opacity": 100, "fixedSize": False,
        "url": "http://tunarr:8000/images/uploads/logo.png",
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path == f"/api/channels/{_WM_CH_UUID}":
            return httpx.Response(200, json=_existing_wm_tunarr_channel(n, live_watermark))
        if request.method == "PUT" and request.url.path == f"/api/channels/{_WM_CH_UUID}":
            return httpx.Response(200, json=_json.loads(request.content or b"{}"))
        return httpx.Response(404, json={})

    calls = _install_wm_mock_client(monkeypatch, handler)

    r = auth_client.delete(f"/api/channels/{n}/watermark")
    assert r.status_code == 200, r.text
    assert r.json()["tunarr_sync"] == {
        "synced": True, "action": "updated", "tunarr_id": _WM_CH_UUID}

    put_req = next(c for c in calls
                   if c.method == "PUT" and c.url.path == f"/api/channels/{_WM_CH_UUID}")
    put_body = _json.loads(put_req.content or b"{}")
    assert "watermark" in put_body, "clearing must send a watermark object, not omit the key"
    assert put_body["watermark"]["enabled"] is False
    # Must still satisfy Tunarr's validation even while disabled.
    assert put_body["watermark"]["width"] > 0
    assert 0 <= put_body["watermark"]["verticalMargin"] <= 100
    assert 0 <= put_body["watermark"]["horizontalMargin"] <= 100
    assert put_body["watermark"]["duration"] >= 0
    assert 0 <= put_body["watermark"]["opacity"] <= 100
    assert "animated" not in put_body["watermark"]


def test_put_watermark_enables_it_in_tunarr(monkeypatch, auth_client):
    """The other half of the clear test: PUT must push an ENABLED watermark.

    Without this, only "cleared" and "absent" were covered — nothing proved a
    configured watermark ever reaches Tunarr at all.
    """
    import json as _json

    n = 7103
    _seed_wm_channel(n, "WM On", watermark_json=None,
                     image_url="http://tunarr:8000/images/uploads/on.png",
                     tunarr_id=_WM_CH_UUID)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path == f"/api/channels/{_WM_CH_UUID}":
            return httpx.Response(200, json=_existing_wm_tunarr_channel(n, None))
        if request.method == "PUT" and request.url.path == f"/api/channels/{_WM_CH_UUID}":
            return httpx.Response(200, json=_json.loads(request.content or b"{}"))
        return httpx.Response(404, json={})

    calls = _install_wm_mock_client(monkeypatch, handler)

    r = auth_client.put(f"/api/channels/{n}/watermark", json={
        "enabled": True, "position": "top-right", "width": 12.5,
        "vertical_margin": 2, "horizontal_margin": 3, "duration": 0,
        "opacity": 80, "fixed_size": False,
        "fade": {"period_mins": 5, "leading_edge": True},
    })
    assert r.status_code == 200, r.text
    assert r.json()["tunarr_sync"] == {
        "synced": True, "action": "updated", "tunarr_id": _WM_CH_UUID}

    put_req = next(c for c in calls
                   if c.method == "PUT" and c.url.path == f"/api/channels/{_WM_CH_UUID}")
    put_body = _json.loads(put_req.content or b"{}")
    assert "watermark" in put_body, "enabling must send a watermark object"
    wm = put_body["watermark"]
    assert wm["enabled"] is True
    assert wm["position"] == "top-right"
    assert wm["width"] == 12.5
    assert wm["verticalMargin"] == 2.0
    assert wm["horizontalMargin"] == 3.0
    assert wm["opacity"] == 80 and isinstance(wm["opacity"], int)
    assert wm["url"] == "http://tunarr:8000/images/uploads/on.png"
    assert wm["fadeConfig"] == [{"periodMins": 5, "leadingEdge": True}]
    assert "animated" not in wm


@pytest.mark.anyio
async def test_sync_without_watermark_does_not_send_the_key(monkeypatch, client):
    """A routine sync for a channel Linearr has no watermark for must leave a
    Tunarr-side watermark alone: no `watermark` key in `changes`, and the
    read-modify-write PUT echoes Tunarr's own watermark back untouched."""
    import json as _json

    import main

    n = 7102
    _seed_wm_channel(n, "No WM Channel", watermark_json=None, tunarr_id=_WM_CH_UUID)

    live_watermark = {
        "enabled": True, "position": "top-left", "width": 20.0,
        "verticalMargin": 2.0, "horizontalMargin": 2.0, "duration": 0.0,
        "opacity": 90, "fixedSize": False,
        "url": "http://tunarr:8000/images/uploads/user-set.png",
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path == f"/api/channels/{_WM_CH_UUID}":
            return httpx.Response(200, json=_existing_wm_tunarr_channel(n, live_watermark))
        if request.method == "PUT" and request.url.path == f"/api/channels/{_WM_CH_UUID}":
            return httpx.Response(200, json=_json.loads(request.content or b"{}"))
        return httpx.Response(404, json={})

    calls = _install_wm_mock_client(monkeypatch, handler)

    # Spy on the changes dict handed to the writer — that is where "don't touch
    # the watermark" actually lives.
    seen: list[dict] = []
    real_save = main._tunarr_save_channel

    async def _spy(client_, url, tunarr_id, changes):
        seen.append(dict(changes))
        return await real_save(client_, url, tunarr_id, changes)

    monkeypatch.setattr(main, "_tunarr_save_channel", _spy)

    result = await main._sync_channel_to_tunarr(n)
    assert result == {"synced": True, "action": "updated", "tunarr_id": _WM_CH_UUID}

    assert seen, "the update branch should have been taken"
    assert "watermark" not in seen[0], "a routine sync must not write a watermark key"

    put_req = next(c for c in calls
                   if c.method == "PUT" and c.url.path == f"/api/channels/{_WM_CH_UUID}")
    put_body = _json.loads(put_req.content or b"{}")
    assert put_body["watermark"] == live_watermark
