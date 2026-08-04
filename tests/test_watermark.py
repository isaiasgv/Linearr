"""Watermark config: storage, validation, and the Tunarr payload mapping.

Validation mirrors Tunarr's real zod constraints so users get a clear message
instead of an opaque 400 from Tunarr:
  width strictly > 0, opacity an integer 0-100, margins 0-100,
  duration >= 0, fade period >= 1 minute.
"""
import json

import pytest

import main


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
    """Set the resolved watermark image directly — the real resolve path uploads
    to a live Tunarr, which these tests do not have."""
    with main.get_db() as conn:
        conn.execute("UPDATE channels SET watermark_image_url=? WHERE number=?",
                     (url, number))


def test_watermark_defaults_to_absent(auth_client):
    n = _make_channel(auth_client, 701)
    r = auth_client.get(f"/api/channels/{n}/watermark")
    assert r.status_code == 200
    assert r.json() == {"watermark": None, "image_url": None}


def test_get_reports_a_resolved_image_before_any_config_is_saved(auth_client):
    """The image route resolves an image without writing the config blob, so the
    editor can read it back while `watermark` is still NULL and show which image
    a watermark would draw."""
    n = _make_channel(auth_client, 711)
    _set_image_url(n, "http://tunarr:8000/images/uploads/wm-711.png")
    body = auth_client.get(f"/api/channels/{n}/watermark").json()
    assert body["watermark"] is None
    assert body["image_url"] == "http://tunarr:8000/images/uploads/wm-711.png"


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
    assert auth_client.get(f"/api/channels/{n}/watermark").json()["watermark"] is None


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


def test_enabling_with_no_image_resolves_the_channel_icon(auth_client, monkeypatch):
    """"Leave the image blank and it uses the channel icon" — done by LINEARR.

    Tunarr has no such fallback: an enabled watermark with no URL makes it build
    a dangling `-i` and the channel stops playing. So the PUT resolves the icon
    into a real Tunarr-hosted URL first, and the user never has to visit the
    image step at all.
    """
    n = _make_channel(auth_client, 706)
    _set_image_url(n, None)
    resolved = "http://tunarr:8000/images/uploads/icon-706.png"

    async def fake_refollow(channel_number: int):
        assert channel_number == n
        _set_image_url(n, resolved)
        return resolved

    monkeypatch.setattr(main, "_refollow_channel_icon_watermark", fake_refollow)
    r = auth_client.put(f"/api/channels/{n}/watermark", json={
        "enabled": True, "width": 7, "vertical_margin": 5,
        "horizontal_margin": 5, "position": "bottom-right",
    })
    assert r.status_code == 200, r.text
    assert r.json()["image_url"] == resolved
    assert auth_client.get(f"/api/channels/{n}/watermark").json()["watermark"]["enabled"] is True


def test_disabled_watermark_without_an_image_is_allowed(auth_client):
    n = _make_channel(auth_client, 707)
    _set_image_url(n, None)
    r = auth_client.put(f"/api/channels/{n}/watermark", json={
        "enabled": False, "width": 7, "vertical_margin": 5,
        "horizontal_margin": 5, "position": "top-left",
    })
    assert r.status_code == 200, r.text
    assert auth_client.get(f"/api/channels/{n}/watermark").json()["watermark"]["position"] \
        == "top-left"


def test_a_whitespace_only_image_url_counts_as_no_url(auth_client, monkeypatch):
    """"   " must not be treated as an image — it would reach ffmpeg as nothing."""
    n = _make_channel(auth_client, 708)
    _set_image_url(n, "   ")
    resolved = "http://tunarr:8000/images/uploads/icon-708.png"

    async def fake_refollow(channel_number: int):
        _set_image_url(n, resolved)
        return resolved

    monkeypatch.setattr(main, "_refollow_channel_icon_watermark", fake_refollow)
    r = auth_client.put(f"/api/channels/{n}/watermark", json={
        "enabled": True, "width": 7, "vertical_margin": 5,
        "horizontal_margin": 5, "position": "bottom-right",
    })
    assert r.status_code == 200, r.text
    assert r.json()["image_url"] == resolved, "blank must trigger icon resolution"
    assert main._watermark_to_tunarr({"enabled": True}, "   ").get("url") is None


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
    # No resolved image -> the key is OMITTED, never sent as "". With `url`
    # absent Tunarr draws the channel's own icon; an explicit "" has nothing to
    # fall back on.
    assert "url" not in out


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


# ── An enabled watermark is never pushed without an image ────────────────────
#
# Tunarr's API accepts one (200 for both `url: ""` and an absent `url`), but its
# ffmpeg pipeline then emits a dangling `-i` with no path: ffmpeg eats
# `-filter_complex` as the filename, exits 254, no playlist is written, and the
# channel 404s in a retry loop. Diagnosed on a real deployment with Tunarr's
# Program Playback Troubleshooter. These tests pin the degradation so a blank
# image can never take a channel off the air.

def test_enabled_watermark_without_an_image_is_pushed_disabled():
    out = main._watermark_to_tunarr({"enabled": True, "position": "top-left"}, None)
    assert out["enabled"] is False, "an imageless watermark must never be enabled"
    assert "url" not in out


def test_enabled_watermark_with_a_blank_image_is_pushed_disabled():
    for blank in ("", "   "):
        out = main._watermark_to_tunarr({"enabled": True}, blank)
        assert out["enabled"] is False, f"blank url {blank!r} must disable"
        assert "url" not in out


def test_enabled_watermark_with_an_image_stays_enabled():
    out = main._watermark_to_tunarr(
        {"enabled": True}, "http://tunarr:8000/images/uploads/logo.png")
    assert out["enabled"] is True
    assert out["url"] == "http://tunarr:8000/images/uploads/logo.png"


def test_watermark_audit_finds_a_broken_channel(auth_client):
    n = _make_channel(auth_client, 741)
    try:
        with main.get_db() as conn:
            conn.execute(
                "UPDATE channels SET watermark=?, watermark_image_url=NULL WHERE number=?",
                (json.dumps({"enabled": True, "width": 7}), n),
            )
        audit = auth_client.get("/api/channels/watermark-audit").json()
        entry = next((b for b in audit["broken"] if b["number"] == n), None)
        assert entry is not None, "an enabled imageless watermark must be reported"
        assert entry["can_use_icon"] is False
    finally:
        auth_client.delete(f"/api/channels/{n}")


def test_watermark_audit_ignores_healthy_channels(auth_client):
    n = _make_channel(auth_client, 742)
    try:
        with main.get_db() as conn:
            conn.execute(
                "UPDATE channels SET watermark=?, watermark_image_url=? WHERE number=?",
                (json.dumps({"enabled": True}), "http://tunarr:8000/images/a.png", n),
            )
        audit = auth_client.get("/api/channels/watermark-audit").json()
        assert not any(b["number"] == n for b in audit["broken"])
    finally:
        auth_client.delete(f"/api/channels/{n}")


def test_watermark_audit_ignores_a_disabled_watermark(auth_client):
    n = _make_channel(auth_client, 743)
    try:
        with main.get_db() as conn:
            conn.execute(
                "UPDATE channels SET watermark=?, watermark_image_url=NULL WHERE number=?",
                (json.dumps({"enabled": False}), n),
            )
        audit = auth_client.get("/api/channels/watermark-audit").json()
        assert not any(b["number"] == n for b in audit["broken"])
    finally:
        auth_client.delete(f"/api/channels/{n}")


def test_watermark_repair_disables_when_there_is_no_icon(auth_client):
    """No icon means nothing to draw — switching it off is the only repair that
    gets the channel playing again."""
    n = _make_channel(auth_client, 744)
    try:
        with main.get_db() as conn:
            conn.execute(
                "UPDATE channels SET watermark=?, watermark_image_url=NULL, icon=NULL"
                " WHERE number=?",
                (json.dumps({"enabled": True, "width": 7}), n),
            )
        r = auth_client.post(f"/api/channels/watermark-repair?channel_number={n}")
        assert r.status_code == 200, r.text
        assert [x["action"] for x in r.json()["repaired"]] == ["watermark_disabled"]

        stored = auth_client.get(f"/api/channels/{n}/watermark").json()["watermark"]
        assert stored["enabled"] is False
        audit = auth_client.get("/api/channels/watermark-audit").json()
        assert not any(b["number"] == n for b in audit["broken"])
    finally:
        auth_client.delete(f"/api/channels/{n}")


def test_enabling_without_an_image_or_icon_is_refused(auth_client):
    """The only remaining refusal: nothing to draw and nothing to derive from."""
    n = _make_channel(auth_client, 745)
    try:
        with main.get_db() as conn:
            conn.execute(
                "UPDATE channels SET icon=NULL, watermark_image_url=NULL WHERE number=?",
                (n,))
        r = auth_client.put(f"/api/channels/{n}/watermark", json={
            "enabled": True, "width": 7, "vertical_margin": 5,
            "horizontal_margin": 5, "position": "bottom-right",
        })
        assert r.status_code == 400, r.text
        detail = r.json()["detail"].lower()
        assert "icon" in detail and "playing" in detail
        # A rejected request must not leave the poison row behind.
        assert auth_client.get(f"/api/channels/{n}/watermark").json()["watermark"] is None
        audit = auth_client.get("/api/channels/watermark-audit").json()
        assert not any(b["number"] == n for b in audit["broken"])
    finally:
        auth_client.delete(f"/api/channels/{n}")


# ── One watermark image per channel ──────────────────────────────────────────
#
# Tunarr's POST /api/upload/image stores by filename and returns the SAME
# fileUrl for a repeat name, overwriting whatever was there (verified against
# 1.3.10 by uploading two different PNGs as one name — the second won). Every
# channel used to upload as "linearr-watermark.png", so applying a watermark
# anywhere replaced the image every other channel was drawing.

_PNG_A = b"\x89PNG\r\n\x1a\n" + b"A" * 40
_PNG_B = b"\x89PNG\r\n\x1a\n" + b"B" * 40


def test_watermark_filenames_differ_per_channel():
    a = main._watermark_image_filename(131, _PNG_A, "image/png")
    b = main._watermark_image_filename(132, _PNG_A, "image/png")
    assert a != b, "two channels must never share an upload filename"
    assert "ch131" in a and "ch132" in b


def test_watermark_filenames_differ_per_image():
    a = main._watermark_image_filename(131, _PNG_A, "image/png")
    b = main._watermark_image_filename(131, _PNG_B, "image/png")
    assert a != b, "a new image must not overwrite the channel's previous one"


def test_watermark_filename_is_stable_for_the_same_image():
    """Re-applying an unchanged icon should reuse the file, not pile up copies."""
    a = main._watermark_image_filename(131, _PNG_A, "image/png")
    b = main._watermark_image_filename(131, _PNG_A, "image/png")
    assert a == b


def test_watermark_filename_keeps_the_extension():
    assert main._watermark_image_filename(1, _PNG_A, "image/png").endswith(".png")
    assert main._watermark_image_filename(1, _PNG_A, "image/jpeg").endswith(".jpg")


def test_watermark_filename_is_not_the_legacy_shared_name():
    name = main._watermark_image_filename(131, _PNG_A, "image/png")
    assert main._LEGACY_WATERMARK_FILENAME not in name


def test_audit_flags_a_channel_on_the_shared_legacy_image(auth_client):
    """These channels play, but draw whichever channel uploaded last."""
    n = _make_channel(auth_client, 746)
    try:
        with main.get_db() as conn:
            conn.execute(
                "UPDATE channels SET watermark=?, watermark_image_url=? WHERE number=?",
                (json.dumps({"enabled": True, "width": 7}),
                 "http://tunarr:8000/images/uploads/linearr-watermark.png", n),
            )
        audit = auth_client.get("/api/channels/watermark-audit").json()
        entry = next((b for b in audit["broken"] if b["number"] == n), None)
        assert entry is not None, "a channel on the shared image must be reported"
        assert entry["issue"] == "shared_image"
    finally:
        auth_client.delete(f"/api/channels/{n}")


def test_audit_distinguishes_the_two_faults(auth_client):
    missing = _make_channel(auth_client, 747)
    shared = _make_channel(auth_client, 748)
    try:
        with main.get_db() as conn:
            conn.execute(
                "UPDATE channels SET watermark=?, watermark_image_url=NULL WHERE number=?",
                (json.dumps({"enabled": True}), missing))
            conn.execute(
                "UPDATE channels SET watermark=?, watermark_image_url=? WHERE number=?",
                (json.dumps({"enabled": True}),
                 "http://tunarr:8000/images/uploads/linearr-watermark.png", shared))
        broken = {b["number"]: b["issue"]
                  for b in auth_client.get("/api/channels/watermark-audit").json()["broken"]}
        assert broken[missing] == "no_image"
        assert broken[shared] == "shared_image"
    finally:
        for n in (missing, shared):
            auth_client.delete(f"/api/channels/{n}")


def test_audit_ignores_a_channel_with_its_own_image(auth_client):
    n = _make_channel(auth_client, 749)
    try:
        with main.get_db() as conn:
            conn.execute(
                "UPDATE channels SET watermark=?, watermark_image_url=? WHERE number=?",
                (json.dumps({"enabled": True}),
                 "http://tunarr:8000/images/uploads/linearr-ch749-abc1234567.png", n),
            )
        audit = auth_client.get("/api/channels/watermark-audit").json()
        assert not any(b["number"] == n for b in audit["broken"])
    finally:
        auth_client.delete(f"/api/channels/{n}")


def test_repair_reresolves_a_shared_image(auth_client, monkeypatch):
    """Repair must drop the shared URL and upload the channel's own icon — the
    resolver is a no-op while a URL is still present, so clearing comes first."""
    n = _make_channel(auth_client, 750)
    resolved = f"http://tunarr:8000/images/uploads/linearr-ch{n}-deadbeef00.png"
    cleared: list[bool] = []

    async def fake_refollow(channel_number: int):
        with main.get_db() as conn:
            row = conn.execute(
                "SELECT watermark_image_url FROM channels WHERE number=?",
                (channel_number,)).fetchone()
        cleared.append(not (row["watermark_image_url"] or "").strip())
        _set_image_url(channel_number, resolved)
        return resolved

    monkeypatch.setattr(main, "_refollow_channel_icon_watermark", fake_refollow)
    try:
        with main.get_db() as conn:
            conn.execute(
                "UPDATE channels SET watermark=?, watermark_image_url=? WHERE number=?",
                (json.dumps({"enabled": True, "width": 7}),
                 "http://tunarr:8000/images/uploads/linearr-watermark.png", n),
            )
        r = auth_client.post(f"/api/channels/watermark-repair?channel_number={n}")
        assert r.status_code == 200, r.text
        entry = r.json()["repaired"][0]
        assert entry["issue"] == "shared_image"
        assert entry["action"] == "image_resolved_from_icon"
        assert entry["image_url"] == resolved
        assert cleared == [True], "the shared URL must be cleared before re-resolving"

        audit = auth_client.get("/api/channels/watermark-audit").json()
        assert not any(b["number"] == n for b in audit["broken"])
    finally:
        auth_client.delete(f"/api/channels/{n}")
