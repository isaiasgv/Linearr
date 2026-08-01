"""Behavioural tests for the expanded MCP tool surface.

Anything that would need a live Plex or Tunarr is either mocked (see
tests/test_tunarr_sync.py for the respx pattern) or tested through the parts
that stay local — link rows, validation, and argument handling.

Channel numbers here live in the 88xx band so nothing collides with the other
test files sharing the session-scoped SQLite file (they use 7xxx and 9xx).
"""
import json

import main
from tests.test_mcp import MCP_HEADERS, _call, _token  # noqa: F401  (MCP_HEADERS re-exported)


def _text(result):
    assert not result.get("isError"), result
    return result["content"][0]["text"]


def _json(result):
    """The tool's return value.

    FastMCP puts a non-dict return (a list) under `structuredContent.result`
    and splits it across one content block per item, so reading `content[0]`
    would silently give you the first element instead of the list.
    """
    assert not result.get("isError"), result
    structured = result.get("structuredContent")
    if structured is not None:
        return structured["result"] if set(structured) == {"result"} else structured
    return json.loads(_text(result))


def _error_text(result):
    assert result.get("isError"), f"expected an error, got: {result}"
    return result["content"][0]["text"]


# ── channels ─────────────────────────────────────────────────────────────────

def test_reorder_channel_renumbers(auth_client):
    """A reorder is a renumber, so the channels this test created may not be
    under the numbers it created them at by the time it cleans up. Track them by
    uid — the stable identity — and delete whatever number they ended up on."""
    token = _token(auth_client)
    uids = set()
    for n, name in ((8801, "Alpha"), (8802, "Bravo"), (8803, "Charlie")):
        r = auth_client.post("/api/channels", json={"number": n, "name": name,
                                                    "tier": "Galaxy Main"})
        assert r.status_code == 201, r.text
        uids.add(r.json()["uid"])
    try:
        before = [c["number"] for c in auth_client.get("/api/channels").json()]
        result = _json(_call(auth_client, token, "reorder_channel",
                             {"moved_number": 8803,
                              "target_index": before.index(8801)}))
        assert "changed" in result and "channels" in result
        after = [c["number"] for c in auth_client.get("/api/channels").json()]
        assert len(after) == len(before), "a reorder must not add or drop channels"
        assert after == sorted(after), "the lineup must stay ordered by number"
        assert len(set(after)) == len(after), "a renumber must never collide"
    finally:
        for ch in auth_client.get("/api/channels").json():
            if ch["uid"] in uids:
                auth_client.delete(f"/api/channels/{ch['number']}")


def test_create_channel_package_creates_many(auth_client):
    token = _token(auth_client)
    try:
        result = _json(_call(auth_client, token, "create_channel_package", {
            "channels": [{"number": 8811, "name": "Pack One"},
                         {"number": 8812, "name": "Pack Two"}]}))
        assert sorted(result["created"]) == [8811, 8812]
    finally:
        for n in (8811, 8812):
            auth_client.delete(f"/api/channels/{n}")


def test_set_and_clear_channel_icon(auth_client):
    token = _token(auth_client)
    auth_client.post("/api/channels", json={"number": 8813, "name": "Icon Ch"})
    try:
        _call(auth_client, token, "set_channel_icon",
              {"channel_number": 8813, "icon": "data:image/png;base64,AAAA"})
        with main.get_db() as conn:
            row = conn.execute("SELECT icon FROM channels WHERE number=8813").fetchone()
        assert row["icon"] == "data:image/png;base64,AAAA"

        _call(auth_client, token, "clear_channel_icon", {"channel_number": 8813})
        with main.get_db() as conn:
            row = conn.execute("SELECT icon FROM channels WHERE number=8813").fetchone()
        assert row["icon"] is None
    finally:
        auth_client.delete("/api/channels/8813")


def test_set_channel_icon_needs_an_icon_or_an_id(auth_client):
    token = _token(auth_client)
    auth_client.post("/api/channels", json={"number": 8815, "name": "No Icon"})
    try:
        assert "icon_id" in _error_text(
            _call(auth_client, token, "set_channel_icon", {"channel_number": 8815}))
    finally:
        auth_client.delete("/api/channels/8815")


def test_set_channel_icon_redacts_the_blob_from_logs(auth_client):
    """A base64 PNG in the Activity Log is pure noise and hides real entries."""
    token = _token(auth_client)
    auth_client.post("/api/channels", json={"number": 8814, "name": "Redact Ch"})
    try:
        _call(auth_client, token, "set_channel_icon",
              {"channel_number": 8814, "icon": "data:image/png;base64," + "Z" * 400})
        logs = auth_client.get("/api/app-logs?limit=1000").json()
        entries = logs.get("logs", logs) if isinstance(logs, dict) else logs
        assert "ZZZZZ" not in json.dumps(entries)
    finally:
        auth_client.delete("/api/channels/8814")


# ── icons ────────────────────────────────────────────────────────────────────

def test_icon_library_round_trip(auth_client):
    token = _token(auth_client)
    saved = _json(_call(auth_client, token, "save_icon",
                        {"name": "Test Icon", "data": "data:image/png;base64,BBBB"}))
    icon_id = saved["id"]
    try:
        listed = _json(_call(auth_client, token, "list_icon_library"))
        entry = next(i for i in listed if i["id"] == icon_id)
        assert entry["name"] == "Test Icon"
        assert "data" not in entry, "icon data must be stripped unless asked for"

        with_data = _json(_call(auth_client, token, "list_icon_library",
                                {"include_data": True}))
        assert any(i["id"] == icon_id and i["data"] for i in with_data)

        _call(auth_client, token, "update_saved_icon",
              {"icon_id": icon_id, "name": "Renamed"})
        listed = _json(_call(auth_client, token, "list_icon_library"))
        assert next(i for i in listed if i["id"] == icon_id)["name"] == "Renamed"
    finally:
        _call(auth_client, token, "delete_saved_icon", {"icon_id": icon_id})
    listed = _json(_call(auth_client, token, "list_icon_library"))
    assert not any(i["id"] == icon_id for i in listed)


def test_set_channel_icon_from_the_library(auth_client):
    token = _token(auth_client)
    saved = _json(_call(auth_client, token, "save_icon",
                        {"name": "Lib Icon", "data": "data:image/png;base64,CCCC"}))
    auth_client.post("/api/channels", json={"number": 8816, "name": "From Library"})
    try:
        _call(auth_client, token, "set_channel_icon",
              {"channel_number": 8816, "icon_id": saved["id"]})
        with main.get_db() as conn:
            row = conn.execute("SELECT icon FROM channels WHERE number=8816").fetchone()
        assert row["icon"] == "data:image/png;base64,CCCC"
    finally:
        auth_client.delete("/api/channels/8816")
        _call(auth_client, token, "delete_saved_icon", {"icon_id": saved["id"]})


def test_update_saved_icon_requires_a_field(auth_client):
    token = _token(auth_client)
    saved = _json(_call(auth_client, token, "save_icon",
                        {"name": "Bare", "data": "data:image/png;base64,DDDD"}))
    try:
        assert "at least one" in _error_text(
            _call(auth_client, token, "update_saved_icon", {"icon_id": saved["id"]}))
    finally:
        _call(auth_client, token, "delete_saved_icon", {"icon_id": saved["id"]})
