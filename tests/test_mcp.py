"""MCP endpoint tests: bearer auth, JSON-RPC roundtrips, tool behavior, and
the smart-collection URI builder (via a mocked Plex transport)."""
import httpx
import pytest

import main

MCP_HEADERS = {
    "Accept": "application/json, text/event-stream",
    "Content-Type": "application/json",
}


def _rpc(method: str, params: dict | None = None, id: int = 1) -> dict:
    msg = {"jsonrpc": "2.0", "method": method, "id": id}
    if params is not None:
        msg["params"] = params
    return msg


def _call(client, token: str, tool: str, arguments: dict | None = None):
    r = client.post(
        "/mcp",
        json=_rpc("tools/call", {"name": tool, "arguments": arguments or {}}),
        headers={**MCP_HEADERS, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    return r.json()["result"]


def _token(auth_client) -> str:
    r = auth_client.get("/api/mcp/info")
    assert r.status_code == 200, r.text
    return r.json()["token"]


# ── Auth ─────────────────────────────────────────────────────────────────────

def test_mcp_requires_bearer(client):
    r = client.post("/mcp", json=_rpc("tools/list"), headers=MCP_HEADERS)
    assert r.status_code == 401


def test_mcp_rejects_wrong_token(client):
    r = client.post(
        "/mcp", json=_rpc("tools/list"),
        headers={**MCP_HEADERS, "Authorization": "Bearer definitely-wrong"},
    )
    assert r.status_code == 401


def test_mcp_info_requires_session(client):
    assert client.get("/api/mcp/info").status_code == 401


def test_regenerate_rotates_token(auth_client):
    old = _token(auth_client)
    new = auth_client.post("/api/mcp/regenerate-token").json()["token"]
    assert new != old
    # Old token no longer accepted
    r = auth_client.post(
        "/mcp", json=_rpc("tools/list"),
        headers={**MCP_HEADERS, "Authorization": f"Bearer {old}"},
    )
    assert r.status_code == 401
    # New one is
    r = auth_client.post(
        "/mcp", json=_rpc("tools/list"),
        headers={**MCP_HEADERS, "Authorization": f"Bearer {new}"},
    )
    assert r.status_code == 200


# ── Protocol ─────────────────────────────────────────────────────────────────

def test_initialize(auth_client):
    token = _token(auth_client)
    r = auth_client.post(
        "/mcp",
        json=_rpc("initialize", {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "pytest", "version": "0"},
        }),
        headers={**MCP_HEADERS, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    result = r.json()["result"]
    assert result["serverInfo"]["name"] == "linearr"


def test_tools_list_has_full_surface(auth_client):
    token = _token(auth_client)
    r = auth_client.post(
        "/mcp", json=_rpc("tools/list"),
        headers={**MCP_HEADERS, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    names = {t["name"] for t in r.json()["result"]["tools"]}
    expected = {
        "list_channels", "get_channel", "create_channel", "update_channel", "delete_channel",
        "list_libraries", "browse_library", "search_library", "get_item",
        "get_show_seasons", "get_season_episodes",
        "list_assignments", "assign_items", "unassign_item",
        "get_collection_status", "build_collections", "list_plex_collections",
        "get_collection_items", "create_smart_collection", "update_smart_collection",
        "delete_collection",
        "get_server_info", "get_now_playing", "get_recent_events",
    }
    assert expected <= names, f"missing: {expected - names}"


# ── Tool behavior (against the test DB) ──────────────────────────────────────

def _payload(result: dict):
    """Tool results carry JSON in structuredContent or as text content."""
    if "structuredContent" in result:
        return result["structuredContent"]
    import json
    return json.loads(result["content"][0]["text"])


def test_channel_roundtrip(auth_client):
    token = _token(auth_client)
    created = _call(auth_client, token, "create_channel",
                    {"number": 951, "name": "MCP Test", "tier": "Classics"})
    assert not created.get("isError"), created
    got = _call(auth_client, token, "get_channel", {"number": 951})
    assert not got.get("isError"), got
    sc = _payload(got)
    assert sc["name"] == "MCP Test" and sc["assignment_count"] == 0
    updated = _call(auth_client, token, "update_channel",
                    {"number": 951, "name": "MCP Renamed"})
    assert not updated.get("isError"), updated
    assert _payload(updated)["name"] == "MCP Renamed"
    deleted = _call(auth_client, token, "delete_channel", {"number": 951})
    assert not deleted.get("isError"), deleted
    gone = _call(auth_client, token, "get_channel", {"number": 951})
    assert gone.get("isError")


def test_duplicate_channel_is_friendly_error(auth_client):
    token = _token(auth_client)
    _call(auth_client, token, "create_channel", {"number": 952, "name": "Dup"})
    dup = _call(auth_client, token, "create_channel", {"number": 952, "name": "Dup2"})
    assert dup.get("isError")
    assert "already exists" in dup["content"][0]["text"]
    _call(auth_client, token, "delete_channel", {"number": 952})


def test_list_channels_tool(auth_client):
    token = _token(auth_client)
    result = _call(auth_client, token, "list_channels")
    assert not result.get("isError"), result


def test_unassign_missing_is_error(auth_client):
    token = _token(auth_client)
    result = _call(auth_client, token, "unassign_item",
                   {"channel_number": 1, "rating_key": "nope"})
    assert result.get("isError")


def test_plex_tools_fail_gracefully_without_plex(auth_client):
    """Without a configured Plex token the library tools must return a clear
    error message, not a crash."""
    # Other tests in the suite may have stored Plex settings in the shared DB.
    with main.get_db() as conn:
        conn.execute("DELETE FROM settings WHERE key IN ('plex_url', 'plex_token')")
    token = _token(auth_client)
    result = _call(auth_client, token, "list_libraries")
    assert result.get("isError")
    assert "Plex token not configured" in result["content"][0]["text"]


# ── Smart-collection URI builder (mocked Plex) ───────────────────────────────

@pytest.mark.anyio
async def test_build_smart_uri():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/identity":
            return httpx.Response(200, json={"MediaContainer": {"machineIdentifier": "abc123"}})
        if request.url.path.endswith("/genre"):
            return httpx.Response(200, json={"MediaContainer": {"Directory": [
                {"title": "Horror", "key": "77"},
                {"title": "Comedy", "key": "88"},
            ]}})
        return httpx.Response(404)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler),
                                 base_url="http://plex.test") as client:
        filters = main.SmartCollectionFilters(
            genres=["horror", "Nope"], year_min=1980, year_max=1989, unwatched=True)
        uri, missing = await main._build_smart_uri(
            client, "http://plex.test", {}, "2", "movie", filters, "year_desc", 40)

    assert uri.startswith("server://abc123/com.plexapp.plugins.library/library/sections/2/all?")
    assert "type=1" in uri
    assert "genre=77" in uri
    assert missing == ["Nope"]
    # inclusive bounds → strict operators offset by one
    assert "year%3E%3E=1979" in uri
    assert "year%3C%3C=1990" in uri
    assert "unwatched=1" in uri
    assert "sort=year%3Adesc" in uri
    assert "limit=40" in uri


@pytest.fixture
def anyio_backend():
    return "asyncio"
