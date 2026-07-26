"""`channels.uid` — the stable, additive channel identity.

`number` is the PRIMARY KEY but a reorder MUTATES it, and `name` has no unique
constraint, so neither can identify a channel row across the operations clients
care about. `uid` exists so a client can key a row on something that survives a
renumber. It is additive only: no route takes it, and it never replaces the
primary key.

Covered here: the migration/backfill, every channel-creating path, uniqueness
for same-name/same-tier channels, and survival through both renumber paths.
"""
import httpx
import pytest

import main

_UUID_RE = main._UUID_RE


def _uids(auth_client) -> dict[int, str]:
    r = auth_client.get("/api/channels")
    assert r.status_code == 200, r.text
    return {c["number"]: c["uid"] for c in r.json()}


def _clear(*numbers: int) -> None:
    with main.get_db() as conn:
        for n in numbers:
            conn.execute("DELETE FROM channels WHERE number=?", (n,))


@pytest.fixture()
def no_tunarr(monkeypatch):
    monkeypatch.setattr(main, "get_tunarr_url", lambda: "")


# ── Migration + backfill ──────────────────────────────────────────────────────

def test_uid_column_exists_and_every_row_has_one(client):
    with main.get_db() as conn:
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(channels)")}
        assert "uid" in cols
        missing = conn.execute(
            "SELECT COUNT(*) FROM channels WHERE uid IS NULL OR uid=''").fetchone()[0]
    assert missing == 0, "init_db must backfill every existing row"


def test_backfill_fills_a_row_left_without_a_uid(client):
    """Simulates a pre-migration row: clear the uid, re-run init_db, get one."""
    _clear(8801)
    with main.get_db() as conn:
        conn.execute("INSERT INTO channels (number, name, tier) VALUES (8801, 'Legacy', 'Galaxy Main')")
        conn.execute("UPDATE channels SET uid=NULL WHERE number=8801")
    main.init_db()
    with main.get_db() as conn:
        uid = conn.execute("SELECT uid FROM channels WHERE number=8801").fetchone()["uid"]
    assert uid and _UUID_RE.match(uid), f"backfilled uid is not uuid-shaped: {uid!r}"
    _clear(8801)


def test_trigger_fills_uid_on_an_insert_that_omits_it(client):
    """Safety net for any path (or direct SQL) that forgets to pass one.
    SQLite cannot take a non-constant column DEFAULT, hence a trigger."""
    _clear(8802)
    with main.get_db() as conn:
        conn.execute("INSERT INTO channels (number, name, tier) VALUES (8802, 'Raw', 'Galaxy Main')")
        uid = conn.execute("SELECT uid FROM channels WHERE number=8802").fetchone()["uid"]
    assert uid and _UUID_RE.match(uid), f"trigger uid is not uuid-shaped: {uid!r}"
    _clear(8802)


# ── Creation paths ────────────────────────────────────────────────────────────

def _create(auth_client, number, name="UID Ch", tier="Galaxy Main"):
    _clear(number)
    r = auth_client.post("/api/channels", json={
        "number": number, "name": name, "tier": tier,
        "vibe": "", "mode": "Shuffle", "style": "", "color": "blue", "icon": None,
    })
    assert r.status_code == 201, r.text
    return r.json()


def test_create_channel_assigns_and_exposes_a_uid(auth_client, no_tunarr):
    created = _create(auth_client, 8810)
    assert _UUID_RE.match(created["uid"] or "")
    assert _uids(auth_client)[8810] == created["uid"], "GET /api/channels must expose uid"
    _clear(8810)


def test_same_name_and_tier_get_different_uids(auth_client, no_tunarr):
    """The exact React-key collision this column exists to fix: `name` has no
    unique constraint, so `tier|name` is not an identity."""
    a = _create(auth_client, 8811, name="Twin", tier="Galaxy Main")
    b = _create(auth_client, 8812, name="Twin", tier="Galaxy Main")
    assert a["uid"] != b["uid"]
    _clear(8811, 8812)


def test_create_package_assigns_uids(auth_client):
    _clear(8820, 8821)
    r = auth_client.post("/api/channels/create-package", json={"channels": [
        {"number": 8820, "name": "Pack A"},
        {"number": 8821, "name": "Pack B"},
    ]})
    assert r.status_code == 200, r.text
    got = _uids(auth_client)
    assert _UUID_RE.match(got[8820] or "") and _UUID_RE.match(got[8821] or "")
    assert got[8820] != got[8821]
    _clear(8820, 8821)


def test_lineup_import_assigns_uids(auth_client):
    _clear(8830)
    r = auth_client.post("/api/import/lineup", json={
        "mode": "merge",
        "data": {"channels": [{"number": 8830, "name": "Imported"}]},
    })
    assert r.status_code == 200, r.text
    assert _UUID_RE.match(_uids(auth_client)[8830] or "")
    _clear(8830)


def test_preset_style_lineup_import_assigns_uids(client):
    """`_import_lineup_data` is a second, separate import path."""
    _clear(8831)
    main._import_lineup_data({"channels": [{"number": 8831, "name": "Preset"}]}, "merge")
    with main.get_db() as conn:
        uid = conn.execute("SELECT uid FROM channels WHERE number=8831").fetchone()["uid"]
    assert _UUID_RE.match(uid or "")
    _clear(8831)


def test_import_channel_keeps_the_existing_uid(auth_client, no_tunarr):
    """`INSERT OR REPLACE` deletes the old row — re-importing over a channel
    must not silently change its identity."""
    created = _create(auth_client, 8840, name="Reimport")
    r = auth_client.post("/api/import/channel", json={
        "channel": {"number": 8840, "name": "Reimport v2"},
    })
    assert r.status_code == 200, r.text
    got = _uids(auth_client)
    assert got[8840] == created["uid"]
    _clear(8840)


def test_import_channel_mints_a_uid_for_a_new_number(auth_client):
    _clear(8841)
    r = auth_client.post("/api/import/channel", json={
        "channel": {"number": 8841, "name": "Brand new"},
    })
    assert r.status_code == 200, r.text
    assert _UUID_RE.match(_uids(auth_client)[8841] or "")
    _clear(8841)


def test_tunarr_import_created_channel_gets_a_uid(auth_client, monkeypatch):
    """The Tunarr import path creates channels too."""
    _clear(8850)
    monkeypatch.setattr(main, "get_tunarr_url", lambda: "http://t.test")
    tid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[{"id": tid, "name": "From Tunarr", "number": 8850}])

    real = httpx.AsyncClient
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(main.httpx, "AsyncClient",
                        lambda *a, **k: real(transport=transport))

    r = auth_client.post("/api/tunarr/import-channels", json={
        "actions": [{"tunarr_id": tid, "action": "create"}]})
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 1
    assert _UUID_RE.match(_uids(auth_client)[8850] or "")
    with main.get_db() as conn:
        conn.execute("DELETE FROM tunarr_channel_links WHERE channel_number=8850")
    _clear(8850)


# ── The invariant that matters: a renumber must not change the uid ────────────

def test_uid_survives_a_reorder(auth_client, no_tunarr):
    a = _create(auth_client, 8861, name="Move A")
    b = _create(auth_client, 8862, name="Move B")
    lineup = auth_client.get("/api/channels").json()
    target = next(i for i, c in enumerate(lineup) if c["number"] == 8862)

    r = auth_client.post("/api/channels/reorder",
                         json={"moved_number": 8861, "target_index": target})
    assert r.status_code == 200, r.text

    after = {c["uid"]: c["number"] for c in auth_client.get("/api/channels").json()}
    assert a["uid"] in after and b["uid"] in after, "a reorder must preserve uids verbatim"
    # The numbers moved; the identities did not.
    assert after[a["uid"]] != 8861 or after[b["uid"]] != 8862
    _clear(after[a["uid"]], after[b["uid"]])


def test_uid_survives_an_explicit_renumber(auth_client, no_tunarr):
    created = _create(auth_client, 8871, name="Renumber me")
    _clear(8872)
    r = auth_client.put("/api/channels/8871", json={
        "number": 8872, "name": "Renumber me", "tier": "Galaxy Main",
        "vibe": "", "mode": "Shuffle", "style": "", "color": "blue", "icon": None,
    })
    assert r.status_code == 200, r.text
    assert r.json()["uid"] == created["uid"]
    assert _uids(auth_client)[8872] == created["uid"]
    _clear(8872)
