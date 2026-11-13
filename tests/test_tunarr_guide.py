"""The program guide reads Tunarr's EPG, not its lineup.

`GET /api/guide/channels/{id}` returns the channel's LINEUP —
`[{index, startTimeMs, lineupItem: {durationMs, type}}]` — which carries no
title at all. The guide used to try that endpoint first, so every programme fell
through the title-extraction chain to the literal string "Program" and the whole
guide rendered as a wall of identical blocks.

`GET /api/guide/channels` (no id) is the materialized EPG and does carry titles.
Shapes here are copied from a live Tunarr 1.3.10.
"""
import json

import httpx
import pytest

import main

CH = 8901
TUNARR_ID = "aaaa1111-bbbb-2222-cccc-333333333333"

NOW_MS = 1785816000000

# Real bulk-guide shape: dict keyed by channel id, programs carry title/start/
# stop/duration/type.
BULK_GUIDE = {
    TUNARR_ID: {
        "id": TUNARR_ID,
        "name": "Galaxy SpongeBob",
        "number": CH,
        "icon": {"path": "", "width": 0, "duration": 0, "position": "bottom-right"},
        "programs": [
            {"type": "content", "title": "SpongeBob SquarePants",
             "episodeTitle": "Help Wanted", "seasonNumber": 1, "episodeNumber": 1,
             "start": NOW_MS, "stop": NOW_MS + 1_800_000, "duration": 1_800_000},
            {"type": "content", "title": "Rocko's Modern Life",
             "start": NOW_MS + 1_800_000, "stop": NOW_MS + 3_600_000,
             "duration": 1_800_000},
        ],
    }
}

# What the per-channel endpoint returns — no titles anywhere.
LINEUP_ONLY = [
    {"index": 0, "startTimeMs": NOW_MS, "lineupItem": {"durationMs": 1_800_000,
                                                       "type": "offline"}},
]


def _mock_tunarr(monkeypatch, *, bulk=None, lineup=None):
    """Point every internal httpx.AsyncClient at a MockTransport."""
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/api/guide/channels":
            return httpx.Response(200, json=bulk if bulk is not None else {})
        if path.startswith("/api/guide/channels/"):
            return httpx.Response(200, json=LINEUP_ONLY)
        if path.endswith("/lineup"):
            return httpx.Response(200, json=lineup if lineup is not None else [])
        return httpx.Response(404, json={})

    transport = httpx.MockTransport(handler)
    real = httpx.AsyncClient
    monkeypatch.setattr(main.httpx, "AsyncClient",
                        lambda *a, **kw: real(transport=transport))


@pytest.fixture
def linked_channel():
    with main.get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO channels (number, name, tier) VALUES (?,?,?)",
                     (CH, "Galaxy SpongeBob", "Galaxy Main"))
        conn.execute("DELETE FROM tunarr_channel_links")
        conn.execute("INSERT OR REPLACE INTO tunarr_channel_links VALUES (?,?,?,?)",
                     (CH, TUNARR_ID, "Galaxy SpongeBob", CH))
    yield
    with main.get_db() as conn:
        conn.execute("DELETE FROM tunarr_channel_links WHERE channel_number=?", (CH,))
        conn.execute("DELETE FROM channels WHERE number=?", (CH,))


def _guide(auth_client) -> dict:
    r = auth_client.get("/api/tunarr/guide?hours=6")
    assert r.status_code == 200, r.text
    return r.json()


def test_guide_uses_real_titles(auth_client, linked_channel, monkeypatch):
    _mock_tunarr(monkeypatch, bulk=BULK_GUIDE)
    channels = _guide(auth_client)["channels"]
    entry = next(c for c in channels if c["channel_number"] == CH)
    titles = [p["title"] for p in entry["schedule"]]
    assert titles == ["SpongeBob SquarePants", "Rocko's Modern Life"]
    assert "Program" not in titles, "the placeholder must not appear when the EPG has titles"


def test_guide_carries_start_and_duration(auth_client, linked_channel, monkeypatch):
    """The bulk shape uses `start`/`duration`, not `startTimeMs`/`durationMs`."""
    _mock_tunarr(monkeypatch, bulk=BULK_GUIDE)
    entry = next(c for c in _guide(auth_client)["channels"] if c["channel_number"] == CH)
    first = entry["schedule"][0]
    assert first["startTime"] == NOW_MS
    assert first["duration"] == 1_800_000


def test_guide_keeps_episode_detail(auth_client, linked_channel, monkeypatch):
    _mock_tunarr(monkeypatch, bulk=BULK_GUIDE)
    entry = next(c for c in _guide(auth_client)["channels"] if c["channel_number"] == CH)
    ep = entry["schedule"][0]["episode"]
    assert ep and ep["season"] == 1 and ep["episode"] == 1
    assert ep["title"] == "Help Wanted"


def test_guide_does_not_fall_back_to_the_titleless_lineup(auth_client, linked_channel,
                                                          monkeypatch):
    """Regression: with a populated EPG, the lineup must never be consulted —
    it is what produced the wall of "Program" blocks."""
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        if request.url.path == "/api/guide/channels":
            return httpx.Response(200, json=BULK_GUIDE)
        return httpx.Response(404, json={})

    transport = httpx.MockTransport(handler)
    real = httpx.AsyncClient
    monkeypatch.setattr(main.httpx, "AsyncClient",
                        lambda *a, **kw: real(transport=transport))

    entry = next(c for c in _guide(auth_client)["channels"] if c["channel_number"] == CH)
    assert [p["title"] for p in entry["schedule"]][0] == "SpongeBob SquarePants"
    assert not any(p.endswith("/lineup") for p in seen), \
        f"lineup should not be requested when the EPG has data: {seen}"
    assert not any(p.startswith("/api/guide/channels/") for p in seen), \
        f"the per-channel (lineup) guide endpoint must not be used: {seen}"


def test_guide_fetches_the_bulk_epg_once_for_the_whole_lineup(auth_client, monkeypatch):
    """One request, not one per channel — this ran 40 round trips on a 40-channel
    lineup before."""
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path == "/api/guide/channels":
            return httpx.Response(200, json=BULK_GUIDE)
        return httpx.Response(404, json={})

    transport = httpx.MockTransport(handler)
    real = httpx.AsyncClient
    monkeypatch.setattr(main.httpx, "AsyncClient",
                        lambda *a, **kw: real(transport=transport))

    with main.get_db() as conn:
        conn.execute("DELETE FROM tunarr_channel_links")
        for i in range(5):
            n = 8910 + i
            conn.execute("INSERT OR REPLACE INTO channels (number, name, tier)"
                         " VALUES (?,?,?)", (n, f"CH {n}", "Galaxy Main"))
            conn.execute("INSERT OR REPLACE INTO tunarr_channel_links VALUES (?,?,?,?)",
                         (n, f"id-{n}", f"CH {n}", n))
    try:
        _guide(auth_client)
        bulk_calls = [c for c in calls if c == "/api/guide/channels"]
        assert len(bulk_calls) == 1, f"expected one bulk EPG fetch, got {bulk_calls}"
    finally:
        with main.get_db() as conn:
            for i in range(5):
                n = 8910 + i
                conn.execute("DELETE FROM tunarr_channel_links WHERE channel_number=?", (n,))
                conn.execute("DELETE FROM channels WHERE number=?", (n,))


def test_guide_still_shows_the_lineup_when_the_epg_is_empty(auth_client, linked_channel,
                                                            monkeypatch):
    """An un-materialized EPG should not render an empty row."""
    _mock_tunarr(monkeypatch, bulk={}, lineup=LINEUP_ONLY)
    entry = next(c for c in _guide(auth_client)["channels"] if c["channel_number"] == CH)
    assert len(entry["schedule"]) == 1
    assert entry["schedule"][0]["startTime"] == NOW_MS
