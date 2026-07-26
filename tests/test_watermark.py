"""Watermark config: storage, validation, and the Tunarr payload mapping.

Validation mirrors Tunarr's real zod constraints so users get a clear message
instead of an opaque 400 from Tunarr:
  width strictly > 0, opacity an integer 0-100, margins 0-100,
  duration >= 0, fade period >= 1 minute.
"""
import pytest


def _make_channel(auth_client, number=701):
    r = auth_client.post("/api/channels", json={
        "number": number, "name": f"WM {number}", "tier": "Galaxy Main",
        "vibe": "", "mode": "Shuffle", "style": "", "color": "blue", "icon": None,
    })
    assert r.status_code in (201, 409), r.text
    return number


def test_watermark_defaults_to_absent(auth_client):
    n = _make_channel(auth_client, 701)
    r = auth_client.get(f"/api/channels/{n}/watermark")
    assert r.status_code == 200
    assert r.json() == {"watermark": None}


def test_put_and_get_watermark_roundtrip(auth_client):
    n = _make_channel(auth_client, 702)
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
    n = _make_channel(auth_client, 703)
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
