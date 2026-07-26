"""Channel icon: removing one has to reach Tunarr.

Same failure mode as the watermark. Tunarr channel writes are read-modify-write
and `_tunarr_channel_changes` only emits `icon` when the channel row holds a
`data:` icon — so clearing the icon locally sends no `icon` key at all and the
PUT echoes Tunarr's existing icon straight back. The route still answers
`{"ok": true}` while Tunarr keeps the old logo forever.

The fix mirrors the watermark one: an explicit `icon_override` carrying an
empty-path icon object (Tunarr's "none" state), used ONLY when Linearr is
deliberately clearing the icon — a routine sync for a channel with no icon must
still omit the key so an icon set in Tunarr's own UI survives.
"""
import json as _json

import httpx

import main

_ICON_CH_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

# 1x1 transparent PNG
_PNG_DATA_URI = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGMAAQAABQABoIJXOQAAAABJRU5ErkJggg=="
)


def _install_mock_client(monkeypatch, handler):
    calls: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return handler(request)

    transport = httpx.MockTransport(_handler)
    real_async_client = httpx.AsyncClient

    def _factory(*args, **kwargs):
        return real_async_client(transport=transport)

    monkeypatch.setattr(main.httpx, "AsyncClient", _factory)
    return calls


def _seed_icon_channel(number: int, icon: str | None, tunarr_id: str | None = _ICON_CH_UUID):
    with main.get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO channels (number, name, tier, icon) VALUES (?,?,?,?)",
            (number, f"ICON {number}", "Galaxy Main", icon),
        )
        conn.execute("DELETE FROM tunarr_channel_links WHERE channel_number=?", (number,))
        if tunarr_id:
            conn.execute("INSERT OR REPLACE INTO tunarr_channel_links VALUES (?,?,?,?)",
                         (number, tunarr_id, f"ICON {number}", number))


def _existing_tunarr_channel(number: int, icon_path: str) -> dict:
    return {
        "id": _ICON_CH_UUID,
        "name": "Icon Channel",
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
        "icon": {"path": icon_path, "width": 0, "duration": 0, "position": "bottom-right"},
        "offline": {"mode": "pic"},
        "onDemand": {"enabled": False},
    }


def _handler_for(number: int, icon_path: str):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path == f"/api/channels/{_ICON_CH_UUID}":
            return httpx.Response(200, json=_existing_tunarr_channel(number, icon_path))
        if request.method == "PUT" and request.url.path == f"/api/channels/{_ICON_CH_UUID}":
            return httpx.Response(200, json=_json.loads(request.content or b"{}"))
        return httpx.Response(404, json={})
    return handler


def test_delete_icon_clears_it_in_tunarr(monkeypatch, auth_client):
    """Regression: DELETE /api/channels/{n}/icon must push an empty-path icon.

    Before the fix `changes` carried no `icon` key at all, so the
    read-modify-write PUT echoed Tunarr's old logo back and the icon survived.
    """
    n = 7111
    _seed_icon_channel(n, _PNG_DATA_URI)
    calls = _install_mock_client(monkeypatch, _handler_for(n, "http://tunarr:8000/old-logo.png"))

    r = auth_client.delete(f"/api/channels/{n}/icon")
    assert r.status_code == 200, r.text

    put_req = next(c for c in calls
                   if c.method == "PUT" and c.url.path == f"/api/channels/{_ICON_CH_UUID}")
    put_body = _json.loads(put_req.content or b"{}")
    assert "icon" in put_body, "clearing must send an icon object, not omit the key"
    assert put_body["icon"]["path"] == "", put_body["icon"]

    # The route must surface the sync result rather than discarding it.
    assert r.json()["tunarr_sync"] == {
        "synced": True, "action": "updated", "tunarr_id": _ICON_CH_UUID}


def test_set_icon_pushes_the_data_uri_to_tunarr(monkeypatch, auth_client):
    n = 7112
    _seed_icon_channel(n, None)
    calls = _install_mock_client(monkeypatch, _handler_for(n, ""))

    r = auth_client.put(f"/api/channels/{n}/icon", json={"icon": _PNG_DATA_URI})
    assert r.status_code == 200, r.text
    put_req = next(c for c in calls
                   if c.method == "PUT" and c.url.path == f"/api/channels/{_ICON_CH_UUID}")
    put_body = _json.loads(put_req.content or b"{}")
    assert put_body["icon"]["path"] == _PNG_DATA_URI


def test_routine_sync_without_an_icon_leaves_tunarrs_icon_alone(monkeypatch, auth_client):
    """The reason clearing needs an override: a plain sync must NOT send `icon`,
    or an icon set directly in Tunarr's own UI would be clobbered."""
    n = 7113
    _seed_icon_channel(n, None)
    live_icon = "http://tunarr:8000/user-set.png"
    calls = _install_mock_client(monkeypatch, _handler_for(n, live_icon))

    r = auth_client.post(f"/api/channels/{n}/sync-tunarr")
    assert r.status_code == 200, r.text

    put_req = next(c for c in calls
                   if c.method == "PUT" and c.url.path == f"/api/channels/{_ICON_CH_UUID}")
    put_body = _json.loads(put_req.content or b"{}")
    assert put_body["icon"]["path"] == live_icon


def test_icon_obj_empty_path_is_the_none_state():
    assert main._tunarr_icon_obj(None)["path"] == ""
    assert main._tunarr_icon_obj("")["path"] == ""
