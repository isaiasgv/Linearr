"""Tests for the canonical Tunarr channel writer.

Tunarr's PUT /api/channels/:id takes the FULL SaveableChannel — a partial body
is a 400. These tests pin the read-modify-write behavior and the transcode
config resolution that a create needs to be valid on 1.3.x (where
transcodeConfigId is z.uuid() and must exist).
"""
import json

import httpx
import pytest

import main


@pytest.fixture
def anyio_backend():
    return "asyncio"


TC_UUID = "11111111-2222-3333-4444-555555555555"


@pytest.mark.anyio
async def test_resolve_transcode_config_prefers_transcode_configs_route():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/transcode_configs":
            return httpx.Response(200, json=[
                {"id": TC_UUID, "name": "Default", "isDefault": True},
            ])
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
        got = await main._tunarr_resolve_transcode_config(client, "http://t.test")
    assert got == TC_UUID


@pytest.mark.anyio
async def test_resolve_transcode_config_picks_default_over_first():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/transcode_configs":
            return httpx.Response(200, json=[
                {"id": "aaaaaaaa-0000-0000-0000-000000000000", "name": "Other"},
                {"id": TC_UUID, "name": "Default", "isDefault": True},
            ])
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
        got = await main._tunarr_resolve_transcode_config(client, "http://t.test")
    assert got == TC_UUID


@pytest.mark.anyio
async def test_resolve_transcode_config_falls_back_to_ffmpeg_settings():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/transcode_configs":
            return httpx.Response(404)
        if request.url.path == "/api/ffmpeg-settings":
            return httpx.Response(200, json={"defaultTranscodeConfigId": TC_UUID})
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
        got = await main._tunarr_resolve_transcode_config(client, "http://t.test")
    assert got == TC_UUID


@pytest.mark.anyio
async def test_resolve_transcode_config_never_returns_a_non_uuid():
    """The old code could yield the literal 'default', which Tunarr 1.3 rejects."""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/transcode_configs":
            return httpx.Response(200, json=[{"id": "default", "name": "Bogus"}])
        if request.url.path == "/api/ffmpeg-settings":
            return httpx.Response(200, json={})
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
        got = await main._tunarr_resolve_transcode_config(client, "http://t.test")
    assert got is None


CH_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

# A realistic full channel as Tunarr's GET returns it, including the read-only
# keys that must be stripped before a PUT.
def _existing_channel() -> dict:
    return {
        "id": CH_UUID,
        "name": "Old Name",
        "number": 101,
        "groupTitle": "Galaxy Main",
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
        # read-only — Tunarr strips these, we must not send them
        "programCount": 42,
        "transcoding": {"targetResolution": "1920x1080"},
        "sessions": [{"id": "s1"}],
        "fallback": [{"id": "p1"}],
    }


def _mock_channel_server(existing: dict | None = None, put_status: int = 200):
    """MockTransport serving GET/PUT for one channel. Records the PUT body."""
    state: dict = {"put_body": None, "gets": 0, "puts": 0}
    current = existing if existing is not None else _existing_channel()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path == f"/api/channels/{CH_UUID}":
            state["gets"] += 1
            return httpx.Response(200, json=current)
        if request.method == "PUT" and request.url.path == f"/api/channels/{CH_UUID}":
            state["puts"] += 1
            state["put_body"] = json.loads(request.content or b"{}")
            if put_status != 200:
                return httpx.Response(put_status, json={})
            merged = {**current, **state["put_body"]}
            return httpx.Response(200, json=merged)
        return httpx.Response(404, json={})

    return httpx.MockTransport(handler), state


REQUIRED_SAVEABLE_KEYS = [
    "id", "name", "number", "groupTitle", "duration", "startTime", "stealth",
    "disableFillerOverlay", "guideMinimumDuration", "streamMode",
    "subtitlesEnabled", "transcodeConfigId", "icon", "offline",
]


@pytest.mark.anyio
async def test_save_channel_sends_every_required_key():
    """Regression: the old code PUT only 4 keys and Tunarr 400'd."""
    transport, state = _mock_channel_server()
    async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
        r = await main._tunarr_save_channel(
            client, "http://t.test", CH_UUID, {"name": "New Name"})
    assert r.status_code == 200
    body = state["put_body"]
    for key in REQUIRED_SAVEABLE_KEYS:
        assert key in body, f"required key {key!r} missing from PUT body"


@pytest.mark.anyio
async def test_save_channel_applies_changes_and_preserves_the_rest():
    transport, state = _mock_channel_server()
    async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
        await main._tunarr_save_channel(
            client, "http://t.test", CH_UUID,
            {"name": "New Name", "number": 205, "groupTitle": "Classics"})
    body = state["put_body"]
    assert body["name"] == "New Name"
    assert body["number"] == 205
    assert body["groupTitle"] == "Classics"
    # untouched values echoed back verbatim — never recomputed
    assert body["duration"] == 86400000
    assert body["startTime"] == 1700000000000
    assert body["guideMinimumDuration"] == 30000
    assert body["transcodeConfigId"] == TC_UUID


@pytest.mark.anyio
async def test_save_channel_strips_readonly_keys():
    transport, state = _mock_channel_server()
    async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
        await main._tunarr_save_channel(
            client, "http://t.test", CH_UUID, {"name": "X"})
    body = state["put_body"]
    for key in ("programCount", "transcoding", "sessions", "fallback"):
        assert key not in body, f"read-only key {key!r} must not be sent"


@pytest.mark.anyio
async def test_save_channel_strips_readonly_keys_even_when_in_changes():
    """The read-only filter must apply to the final merged payload, not just
    the copy of `current` — otherwise a caller passing a read-only key inside
    `changes` reintroduces it into the PUT body."""
    transport, state = _mock_channel_server()
    async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
        await main._tunarr_save_channel(
            client, "http://t.test", CH_UUID,
            {"name": "X", "programCount": 999, "sessions": [{"id": "sneaky"}]})
    body = state["put_body"]
    assert "programCount" not in body, "read-only key smuggled in via changes must still be stripped"
    assert "sessions" not in body, "read-only key smuggled in via changes must still be stripped"


@pytest.mark.anyio
async def test_save_channel_returns_get_failure_without_putting():
    calls = {"puts": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "PUT":
            calls["puts"] += 1
        return httpx.Response(404, json={})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
        r = await main._tunarr_save_channel(
            client, "http://t.test", CH_UUID, {"name": "X"})
    assert r.status_code == 404
    assert calls["puts"] == 0, "a failed GET must never be followed by a PUT"


@pytest.mark.anyio
async def test_save_channel_returns_error_when_body_is_not_a_dict():
    """A 200 GET whose body is valid JSON but not a dict (e.g. a list) must not
    be mistaken for a successful save — no PUT was ever attempted."""
    calls = {"puts": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "PUT":
            calls["puts"] += 1
            return httpx.Response(200, json={})
        return httpx.Response(200, json=[{"id": CH_UUID}])

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
        r = await main._tunarr_save_channel(
            client, "http://t.test", CH_UUID, {"name": "X"})
    assert r.status_code not in range(200, 300)
    assert calls["puts"] == 0, "an unusable GET body must never be followed by a PUT"


@pytest.mark.anyio
async def test_save_channel_returns_error_when_body_is_not_json():
    """A 200 GET with a non-JSON body must not be mistaken for a successful
    save — no PUT was ever attempted."""
    calls = {"puts": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "PUT":
            calls["puts"] += 1
            return httpx.Response(200, json={})
        return httpx.Response(200, content=b"not json at all")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
        r = await main._tunarr_save_channel(
            client, "http://t.test", CH_UUID, {"name": "X"})
    assert r.status_code not in range(200, 300)
    assert calls["puts"] == 0, "an unusable GET body must never be followed by a PUT"


@pytest.mark.anyio
async def test_save_channel_surfaces_a_500_as_is():
    """Tunarr returns 500 (not 409) for a duplicate number, with an empty body."""
    transport, state = _mock_channel_server(put_status=500)
    async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
        r = await main._tunarr_save_channel(
            client, "http://t.test", CH_UUID, {"number": 999})
    assert r.status_code == 500
    assert state["puts"] == 1


@pytest.mark.anyio
async def test_channel_obj_never_sends_readonly_transcoding():
    """`transcoding` is read-only in SaveableChannel; sending it instead of
    transcodeConfigId produced an invalid create body."""
    obj = main._tunarr_channel_obj(
        name="X", number=1, group_title="G", transcode_id=None)
    assert "transcoding" not in obj


@pytest.mark.anyio
async def test_create_sends_the_union_and_does_not_retry_flat():
    """No flat-object create form exists in any supported Tunarr version, so a
    rejected create must not be retried with a flat body."""
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content or b"{}"))
        return httpx.Response(400, json={"error": "nope"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
        r = await main._tunarr_create_channel(
            client, "http://t.test",
            main._tunarr_channel_obj(
                name="X", number=1, group_title="G", transcode_id=TC_UUID),
        )

    assert r.status_code == 400
    assert len(bodies) == 1, "a 400 must not trigger a flat-body retry"
    assert bodies[0]["type"] == "new"
    assert bodies[0]["channel"]["name"] == "X"
    assert "id" in bodies[0]["channel"], "Tunarr's schema requires channel.id"
