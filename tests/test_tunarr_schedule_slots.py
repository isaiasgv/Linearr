"""Slot times in a pushed Tunarr schedule are offsets from midnight.

Linearr pushes a `period: "day"` time-slot schedule. Every slot's `startTime` is
an offset within that period — 0 .. 86_400_000 — which is exactly what
`_hhmm_to_ms` produces from a block slot's `HH:MM`.

The base "shuffle all day" slot used to be built from
`_previous_sunday_midnight_ms()` instead: an absolute epoch (~1.7e12), i.e. the
channel's programming-start anchor rather than an in-period offset. That put the
supposed midnight slot ~20,000 days into the period and sorted it last instead of
first. Programming start is always 12:00AM, so these tests pin the unit.
"""
import httpx
import pytest

import main

DAY_MS = 24 * 60 * 60 * 1000
TUNARR_ID = "dddddddd-cccc-bbbb-aaaa-999999999999"
SC_ID = "sc-11111111"
CH = 8701


def _install_mock_client(monkeypatch):
    """Point every internal `httpx.AsyncClient(...)` at a MockTransport.

    `tunarr_push_schedule` builds its own clients, so this is the only seam.
    Tunarr has no shows and no saved schedule here, which is the interesting
    case: every block slot falls back to the smart collection.
    """
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/shows"):
            return httpx.Response(200, json=[])
        if request.url.path.endswith("/schedule"):
            return httpx.Response(200, json={})
        return httpx.Response(404, json={})

    transport = httpx.MockTransport(handler)
    real = httpx.AsyncClient
    monkeypatch.setattr(main.httpx, "AsyncClient",
                        lambda *a, **kw: real(transport=transport))


@pytest.fixture
def scheduled_channel(monkeypatch):
    """A channel with a Tunarr link, a collection link, and two block slots."""
    _install_mock_client(monkeypatch)
    with main.get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO channels (number, name, tier) VALUES (?,?,?)",
                     (CH, "Slot Units", "Galaxy Main"))
        conn.execute("INSERT OR REPLACE INTO tunarr_channel_links VALUES (?,?,?,?)",
                     (CH, TUNARR_ID, "Slot Units", CH))
        conn.execute("INSERT OR REPLACE INTO tunarr_collection_links VALUES (?,?,?,?)",
                     (CH, "show", SC_ID, "Slot Units TV"))
        cur = conn.execute(
            "INSERT INTO blocks (name, channel_number, days, start_time, end_time)"
            " VALUES (?,?,?,?,?)",
            ("Prime", CH, '["mon"]', "20:00", "23:00"))
        block_id = cur.lastrowid
        for slot_time, title in (("20:00", "Show A"), ("21:30", "Show B")):
            conn.execute(
                "INSERT INTO block_slots (block_id, slot_time, plex_rating_key,"
                " plex_title, plex_type) VALUES (?,?,?,?,?)",
                (block_id, slot_time, f"rk-{slot_time}", title, "show"))
    yield
    with main.get_db() as conn:
        conn.execute("DELETE FROM block_slots WHERE block_id IN"
                     " (SELECT id FROM blocks WHERE channel_number=?)", (CH,))
        conn.execute("DELETE FROM blocks WHERE channel_number=?", (CH,))
        conn.execute("DELETE FROM tunarr_collection_links WHERE channel_number=?", (CH,))
        conn.execute("DELETE FROM tunarr_channel_links WHERE channel_number=?", (CH,))
        conn.execute("DELETE FROM channels WHERE number=?", (CH,))


def _preview(auth_client) -> dict:
    r = auth_client.post(f"/api/tunarr/channel-links/{CH}/push-schedule",
                         json={"preview": True})
    assert r.status_code == 200, r.text
    return r.json()["schedule"]


def test_every_slot_start_is_within_the_day(auth_client, scheduled_channel):
    slots = _preview(auth_client)["slots"]
    assert slots, "expected the base slot plus the block slots"
    for slot in slots:
        assert 0 <= slot["startTime"] < DAY_MS, (
            f"{slot['type']} slot startTime {slot['startTime']} is not an offset "
            f"within the day — an epoch timestamp leaked in")


def test_the_base_slot_starts_at_midnight(auth_client, scheduled_channel):
    slots = _preview(auth_client)["slots"]
    assert slots[0]["startTime"] == 0, "programming starts at 12:00AM"
    assert slots[0]["type"] == "smart-collection"
    assert slots[0]["order"] == "ordered_shuffle"


def test_block_slots_keep_their_wall_clock_times(auth_client, scheduled_channel):
    slots = _preview(auth_client)["slots"]
    starts = sorted(s["startTime"] for s in slots)
    assert starts == [0, main._hhmm_to_ms("20:00"), main._hhmm_to_ms("21:30")]


def test_slots_are_sorted_with_midnight_first(auth_client, scheduled_channel):
    """The old epoch value sorted the base slot last; midnight must lead."""
    slots = _preview(auth_client)["slots"]
    assert [s["startTime"] for s in slots] == sorted(s["startTime"] for s in slots)
    assert slots[0]["startTime"] == 0
