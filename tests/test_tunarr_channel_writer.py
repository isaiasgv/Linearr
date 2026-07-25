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
