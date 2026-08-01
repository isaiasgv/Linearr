"""Structural tests for the MCP tool registry.

These are the tests that keep the surface honest as the app grows: every tool
annotated, every tool instrumented, every tool in a declared toolset, and the
docs matching the code.
"""
import asyncio
import json

import main
from linearr_mcp import build_mcp_server
from linearr_mcp._request import json_request
from linearr_mcp.registry import TOOLSETS, resolve_toolsets


# ── request shim ─────────────────────────────────────────────────────────────

def test_json_request_round_trips_body():
    req = json_request({"icon": "data:image/png;base64,AAA"})
    assert asyncio.run(req.json()) == {"icon": "data:image/png;base64,AAA"}


def test_json_request_reports_content_length():
    req = json_request({"a": 1})
    assert req.headers["content-length"] == str(len(b'{"a": 1}'))


# ── annotations ──────────────────────────────────────────────────────────────

def _tools():
    return {t.name: t for t in main.mcp_server._tool_manager.list_tools()}


def test_every_tool_has_annotations():
    missing = [n for n, t in _tools().items() if t.annotations is None]
    assert not missing, f"tools without annotations: {missing}"


def test_read_tools_are_marked_read_only():
    tools = _tools()
    for name in ("list_channels", "get_channel", "search_library",
                 "list_assignments", "list_plex_collections"):
        assert tools[name].annotations.readOnlyHint is True, name


def test_destructive_tools_are_marked_destructive():
    tools = _tools()
    for name in ("delete_channel", "purge_channel_content",
                 "delete_collection", "unassign_item"):
        ann = tools[name].annotations
        assert ann.readOnlyHint is not True, name
        assert ann.destructiveHint is True, name


def test_write_tools_are_not_marked_read_only():
    tools = _tools()
    for name in ("create_channel", "assign_items", "build_collections"):
        assert tools[name].annotations.readOnlyHint is not True, name


def test_plex_tools_are_marked_open_world():
    tools = _tools()
    for name in ("search_library", "get_item", "list_libraries"):
        assert tools[name].annotations.openWorldHint is True, name


# ── toolsets ─────────────────────────────────────────────────────────────────

def test_every_tool_belongs_to_a_declared_toolset():
    from linearr_mcp import TOOLSET_OF
    unknown = [n for n in _tools() if TOOLSET_OF.get(n) not in TOOLSETS]
    assert not unknown, f"tools with no toolset: {unknown}"


def test_toolset_counts_sum_to_registered_total():
    total = sum(t["tool_count"] for t in main.MCP_TOOLSET_INFO)
    assert total == len(_tools())


def test_env_var_selects_toolsets(monkeypatch):
    monkeypatch.setenv("MCP_TOOLSETS", "channels, plex")
    assert resolve_toolsets(main) == {"channels", "plex"}


def test_env_var_all_means_all(monkeypatch):
    monkeypatch.setenv("MCP_TOOLSETS", "all")
    assert resolve_toolsets(main) == set(TOOLSETS)


def test_unknown_toolset_names_are_ignored(monkeypatch):
    monkeypatch.setenv("MCP_TOOLSETS", "channels,bogus")
    assert resolve_toolsets(main) == {"channels"}


def test_empty_selection_falls_back_to_all(monkeypatch):
    """A typo must not silently produce a server with no tools."""
    monkeypatch.setenv("MCP_TOOLSETS", "bogus")
    assert resolve_toolsets(main) == set(TOOLSETS)


def test_mcp_info_reports_toolsets(auth_client):
    info = auth_client.get("/api/mcp/info").json()
    names = [t["name"] for t in info["toolsets"]]
    assert names == list(TOOLSETS)
    assert info["tool_count"] == sum(t["tool_count"] for t in info["toolsets"])


def test_put_toolsets_persists_selection(auth_client):
    r = auth_client.put("/api/mcp/toolsets", json={"toolsets": ["channels", "plex"]})
    assert r.status_code == 200, r.text
    assert r.json()["restart_required"] is True
    with main.get_db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key='mcp_toolsets'").fetchone()
    assert row["value"] == "channels,plex"
    # A stored selection must not leak into the rest of the suite.
    with main.get_db() as conn:
        conn.execute("DELETE FROM settings WHERE key='mcp_toolsets'")


def test_put_toolsets_rejects_unknown_names(auth_client):
    r = auth_client.put("/api/mcp/toolsets", json={"toolsets": ["nope"]})
    assert r.status_code == 400


def test_put_toolsets_rejects_an_empty_selection(auth_client):
    assert auth_client.put("/api/mcp/toolsets", json={"toolsets": []}).status_code == 400


def test_put_toolsets_requires_session(client):
    assert client.put("/api/mcp/toolsets",
                      json={"toolsets": ["channels"]}).status_code == 401


# ── resources ────────────────────────────────────────────────────────────────

def _rpc(auth_client, method: str, params: dict | None = None):
    token = auth_client.get("/api/mcp/info").json()["token"]
    msg = {"jsonrpc": "2.0", "method": method, "id": 1}
    if params is not None:
        msg["params"] = params
    r = auth_client.post("/mcp", json=msg, headers={
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    return r.json()["result"]


def test_resources_are_listed(auth_client):
    result = _rpc(auth_client, "resources/list")
    uris = [x["uri"] for x in result["resources"]]
    assert "linearr://lineup" in uris
    assert "linearr://libraries" in uris
    assert "linearr://status" in uris


def test_channel_resource_is_a_template(auth_client):
    result = _rpc(auth_client, "resources/templates/list")
    templates = [x["uriTemplate"] for x in result["resourceTemplates"]]
    assert "linearr://channel/{number}" in templates


def test_lineup_resource_reads(auth_client):
    result = _rpc(auth_client, "resources/read", {"uri": "linearr://lineup"})
    body = json.loads(result["contents"][0]["text"])
    assert "channels" in body and "total" in body


def test_status_resource_leaks_no_secrets(auth_client):
    with main.get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_token', ?)",
                     ("super-secret-token",))
    result = _rpc(auth_client, "resources/read", {"uri": "linearr://status"})
    assert "super-secret-token" not in result["contents"][0]["text"]


def test_channel_resource_reports_a_missing_channel(auth_client):
    result = _rpc(auth_client, "resources/read",
                  {"uri": "linearr://channel/99999"})
    assert "not found" in result["contents"][0]["text"]


# ── instructions ─────────────────────────────────────────────────────────────

def test_instructions_warn_about_the_two_sharp_edges(auth_client):
    result = _rpc(auth_client, "initialize", {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "pytest", "version": "1"}})
    instructions = result["instructions"]
    assert "RENUMBERS" in instructions
    assert "previews by default" in instructions


def test_gating_removes_exactly_one_toolset(monkeypatch):
    """Build a second server with `channels` disabled and diff the tool names."""
    monkeypatch.setenv("MCP_TOOLSETS", ",".join(t for t in TOOLSETS if t != "channels"))
    server, info = build_mcp_server(main)
    names = {t.name for t in server._tool_manager.list_tools()}
    assert "list_channels" not in names
    assert "list_assignments" in names
    assert next(i for i in info if i["name"] == "channels")["enabled"] is False
    assert next(i for i in info if i["name"] == "channels")["tool_count"] == 0
