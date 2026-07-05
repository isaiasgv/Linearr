"""Regression tests for the MCP/Plex hardening pass: icon stripping, MCP
call logging, safe smart-collection updates, windowed list tools, and the
Tunarr filterString translation."""
import json

import pytest

import main
from tests.test_mcp import MCP_HEADERS, _call, _token


# ── list_channels must not leak icon blobs ───────────────────────────────────

def test_list_channels_strips_icons(auth_client):
    token = _token(auth_client)
    r = auth_client.post("/api/channels", json={
        "number": 961, "name": "Icon Test",
        "icon": "data:image/png;base64," + "A" * 5000,
    })
    assert r.status_code == 201, r.text
    try:
        result = _call(auth_client, token, "list_channels")
        assert not result.get("isError"), result
        text = result["content"][0]["text"]
        assert "base64" not in text and "AAAAA" not in text
    finally:
        auth_client.delete("/api/channels/961")


# ── every MCP tool call lands in the Activity Log ────────────────────────────

def test_mcp_tool_calls_are_logged(auth_client):
    token = _token(auth_client)
    _call(auth_client, token, "list_channels")
    # High limit: the shared test DB accumulates many logs across the suite, and
    # created_at is 1s-granular, so a small window could miss this entry.
    logs = auth_client.get("/api/app-logs?limit=1000").json()
    entries = logs.get("logs", logs) if isinstance(logs, dict) else logs
    mcp_entries = [e for e in entries if e.get("category") == "mcp"]
    assert mcp_entries, "MCP tool calls must appear in the Activity Log"
    assert any("list_channels" in (e.get("message") or "") for e in mcp_entries)


def test_mcp_tool_errors_are_logged(auth_client):
    token = _token(auth_client)
    result = _call(auth_client, token, "get_channel", {"number": 99999})
    assert result.get("isError")
    logs = auth_client.get("/api/app-logs?limit=1000").json()
    entries = logs.get("logs", logs) if isinstance(logs, dict) else logs
    errs = [e for e in entries
            if e.get("category") == "mcp" and e.get("level") == "error"
            and "get_channel" in (e.get("message") or "")]
    assert errs, "failed MCP tool calls must be logged at error level"


# ── update_smart_collection: rename-only must NOT touch filter rules ─────────

@pytest.fixture
def capture_smart_update(monkeypatch):
    captured = {}

    async def fake_update(rating_key, body):
        captured["rating_key"] = rating_key
        captured["body"] = body
        return {"ok": True, "updated": ["title"], "unresolved_genres": []}

    monkeypatch.setattr(main, "plex_update_smart_collection", fake_update)
    return captured


def test_smart_update_rename_only_keeps_rules(auth_client, capture_smart_update):
    token = _token(auth_client)
    result = _call(auth_client, token, "update_smart_collection",
                   {"rating_key": "123", "section_id": "1", "title": "New Name"})
    assert not result.get("isError"), result
    assert capture_smart_update["body"].filters is None, \
        "rename-only call must not replace the filter rules"


def test_smart_update_with_filters_replaces_rules(auth_client, capture_smart_update):
    token = _token(auth_client)
    result = _call(auth_client, token, "update_smart_collection",
                   {"rating_key": "123", "section_id": "1", "genres": ["Horror"]})
    assert not result.get("isError"), result
    filters = capture_smart_update["body"].filters
    assert filters is not None and filters.genres == ["Horror"]


# ── windowed list tools ──────────────────────────────────────────────────────

def test_list_plex_collections_windows(auth_client, monkeypatch):
    async def fake_collections():
        return [{"rating_key": str(i), "title": f"C{i}"} for i in range(300)]

    monkeypatch.setattr(main, "plex_collections", fake_collections)
    token = _token(auth_client)
    result = _call(auth_client, token, "list_plex_collections",
                   {"offset": 10, "limit": 25})
    assert not result.get("isError"), result
    data = json.loads(result["content"][0]["text"])
    assert data["total"] == 300 and data["offset"] == 10
    assert len(data["collections"]) == 25
    assert data["collections"][0]["rating_key"] == "10"


# ── Tunarr filterString translation ──────────────────────────────────────────

def test_parse_filter_string_simple_tags():
    s = main._parse_filter_string('tags = "Galaxy ONE Movies"')
    assert s is not None
    assert s["fieldSpec"]["key"] == "tags"
    assert s["fieldSpec"]["name"] == "tags"
    assert s["fieldSpec"]["value"] == ["Galaxy ONE Movies"]


def test_parse_filter_string_rejects_complex():
    assert main._parse_filter_string('tags = "A" AND year >> 1980') is None
    assert main._parse_filter_string("") is None
    assert main._parse_filter_string(None) is None
