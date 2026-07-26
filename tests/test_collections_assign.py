"""Assign-by-reference collections (Workstream 3).

A fourth collection concept, distinct from the three that already exist:

  1. `generate_collections` manages Linearr's OWN '{Channel} Movies/TV'
     collections, resolved BY NAME (see test_collections_safety.py).
  2. `channel_collections` holds one slot per (channel_number, plex_type).
  3. `POST /api/channel-collections/{n}` COPIES a collection's items into
     assignments (an import, not a link).
  4. NEW: `POST /api/channel-collections/{n}/assign` records that a channel
     USES an existing collection — by reference. Linearr never edits its
     contents, and generation can never prune it.

The most important test in this file is
`test_generate_never_touches_assigned_collection`: the name-based ownership
safety must be exactly as strong with an assigned slot as it is without one.
"""
import httpx
import pytest
import respx

import main

PLEX = "http://plex:32400"
TUNARR = "http://tunarr.test"


# ── Fixtures / helpers ────────────────────────────────────────────────────────

def _seed_channel(number: int, name: str, *, movies=("1", "2", "3")):
    with main.get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO channels (number, name) VALUES (?, ?)", (number, name))
        conn.execute("DELETE FROM assignments WHERE channel_number=?", (number,))
        conn.execute("DELETE FROM channel_collections WHERE channel_number=?", (number,))
        for rk in movies:
            conn.execute(
                "INSERT INTO assignments (channel_number, plex_rating_key, plex_title, plex_type, plex_thumb, plex_year) "
                "VALUES (?,?,?,?,?,?)",
                (number, rk, f"Movie {rk}", "movie", None, 2020),
            )
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_url', ?)", (PLEX,))
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_token', 'tok')")


def _slot(channel_number: int, plex_type: str):
    with main.get_db() as conn:
        row = conn.execute(
            "SELECT * FROM channel_collections WHERE channel_number=? AND plex_type=?",
            (channel_number, plex_type),
        ).fetchone()
    return dict(row) if row else None


def _assignment_rows(channel_number: int):
    with main.get_db() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT plex_rating_key FROM assignments WHERE channel_number=? ORDER BY plex_rating_key",
            (channel_number,),
        ).fetchall()]


def _base_plex_routes(r, *, section_collections, children):
    r.get(f"{PLEX}/identity").mock(return_value=httpx.Response(
        200, json={"MediaContainer": {"machineIdentifier": "MID"}}))
    r.get(f"{PLEX}/library/sections").mock(return_value=httpx.Response(
        200, json={"MediaContainer": {"Directory": [
            {"type": "movie", "key": "10"}, {"type": "show", "key": "20"}]}}))
    r.get(url__regex=rf"{PLEX}/library/sections/\d+/collections").mock(
        return_value=httpx.Response(200, json={"MediaContainer": {"Metadata": section_collections}}))
    r.get(url__regex=rf"{PLEX}/library/collections/\d+/children").mock(
        return_value=httpx.Response(200, json={"MediaContainer": {"Metadata": [{"ratingKey": k} for k in children]}}))


# ── Schema ────────────────────────────────────────────────────────────────────

def test_source_and_is_smart_columns_exist(client):
    with main.get_db() as conn:
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(channel_collections)")}
    assert "source" in cols
    assert "is_smart" in cols


def test_existing_rows_default_to_owned(client):
    """Rows written by the pre-existing generate path must read back as 'owned'."""
    with main.get_db() as conn:
        conn.execute("DELETE FROM channel_collections WHERE channel_number=940")
        conn.execute(
            "INSERT INTO channel_collections "
            "(channel_number, plex_type, collection_rating_key, collection_title, managed) "
            "VALUES (940, 'movie', '500', 'Legacy Movies', 1)")
    row = _slot(940, "movie")
    assert row["source"] == "owned"
    assert row["is_smart"] == 0


# ── Assign by reference ───────────────────────────────────────────────────────

def test_assign_writes_assigned_source_and_leaves_assignments_untouched(auth_client):
    _seed_channel(910, "Assigned")
    before = _assignment_rows(910)

    resp = auth_client.post("/api/channel-collections/910/assign", json={
        "plex_type": "movie",
        "collection_rating_key": "777",
        "collection_title": "User Sci-Fi",
        "is_smart": True,
    })
    assert resp.status_code == 200, resp.text

    row = _slot(910, "movie")
    assert row["source"] == "assigned"
    assert row["is_smart"] == 1
    assert row["collection_rating_key"] == "777"
    assert row["collection_title"] == "User Sci-Fi"
    assert row["managed"] == 0
    # Reference only: assignments are completely untouched.
    assert _assignment_rows(910) == before


@respx.mock
def test_assign_never_reads_the_plex_collection(auth_client):
    """An assign must not fetch (let alone modify) the collection's members."""
    _seed_channel(911, "NoRead")
    children = respx.mock.get(url__regex=rf"{PLEX}/library/collections/\d+/children").mock(
        return_value=httpx.Response(200, json={"MediaContainer": {"Metadata": []}}))

    resp = auth_client.post("/api/channel-collections/911/assign", json={
        "plex_type": "movie", "collection_rating_key": "777", "collection_title": "User Sci-Fi"})
    assert resp.status_code == 200, resp.text
    assert not children.called


def test_assign_replaces_existing_slot(auth_client):
    _seed_channel(912, "Replace")
    auth_client.post("/api/channel-collections/912/assign", json={
        "plex_type": "movie", "collection_rating_key": "111", "collection_title": "First", "is_smart": True})
    auth_client.post("/api/channel-collections/912/assign", json={
        "plex_type": "movie", "collection_rating_key": "222", "collection_title": "Second"})

    with main.get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM channel_collections WHERE channel_number=912 AND plex_type='movie'").fetchall()
    assert len(rows) == 1  # one active source per type
    assert rows[0]["collection_rating_key"] == "222"
    assert rows[0]["collection_title"] == "Second"
    assert rows[0]["is_smart"] == 0


def test_assign_rejects_unknown_type(auth_client):
    _seed_channel(913, "BadType")
    resp = auth_client.post("/api/channel-collections/913/assign", json={
        "plex_type": "artist", "collection_rating_key": "1", "collection_title": "X"})
    assert resp.status_code == 400


def test_assign_unknown_channel_is_404(auth_client):
    resp = auth_client.post("/api/channel-collections/99999/assign", json={
        "plex_type": "movie", "collection_rating_key": "1", "collection_title": "X"})
    assert resp.status_code == 404


def test_get_channel_collections_exposes_source_and_is_smart(auth_client):
    _seed_channel(914, "Expose")
    auth_client.post("/api/channel-collections/914/assign", json={
        "plex_type": "movie", "collection_rating_key": "777",
        "collection_title": "User Sci-Fi", "is_smart": True})

    body = auth_client.get("/api/channel-collections/914").json()
    assert body["movie"]["source"] == "assigned"
    assert body["movie"]["is_smart"] == 1


# ── generate_collections interaction ──────────────────────────────────────────

@respx.mock
def test_generate_flips_assigned_slot_back_to_owned(auth_client):
    _seed_channel(920, "FlipBack")
    auth_client.post("/api/channel-collections/920/assign", json={
        "plex_type": "movie", "collection_rating_key": "777",
        "collection_title": "User Sci-Fi", "is_smart": True})
    assert _slot(920, "movie")["source"] == "assigned"

    r = respx.mock
    _base_plex_routes(r, section_collections=[{"title": "FlipBack Movies", "ratingKey": "500"}], children=[])
    r.put(url__regex=rf"{PLEX}/library/collections/500/items").mock(return_value=httpx.Response(200, json={}))

    resp = auth_client.post("/api/collections/generate/920")
    assert resp.status_code == 200, resp.text

    row = _slot(920, "movie")
    assert row["source"] == "owned"
    assert row["is_smart"] == 0
    assert row["collection_rating_key"] == "500"
    assert row["collection_title"] == "FlipBack Movies"
    assert row["managed"] == 1


@respx.mock
def test_generate_never_touches_assigned_collection(auth_client):
    """THE ownership invariant, with an assigned slot in play.

    Generation resolves its target BY NAME ('{Channel} Movies'). The assigned
    collection (rating key 777, title 'User Sci-Fi') must never be read for
    reconciliation, added to, or pruned — even though the slot points at it
    when generation starts.
    """
    _seed_channel(921, "Invariant")
    auth_client.post("/api/channel-collections/921/assign", json={
        "plex_type": "movie", "collection_rating_key": "777",
        "collection_title": "User Sci-Fi", "is_smart": True})

    r = respx.mock
    # The user's assigned collection is visible in the section listing, and no
    # '{Channel} Movies' exists yet — so generation must CREATE its own.
    r.get(f"{PLEX}/identity").mock(return_value=httpx.Response(
        200, json={"MediaContainer": {"machineIdentifier": "MID"}}))
    r.get(f"{PLEX}/library/sections").mock(return_value=httpx.Response(
        200, json={"MediaContainer": {"Directory": [
            {"type": "movie", "key": "10"}, {"type": "show", "key": "20"}]}}))
    r.get(url__regex=rf"{PLEX}/library/sections/\d+/collections").mock(
        return_value=httpx.Response(200, json={"MediaContainer": {"Metadata": [
            {"title": "User Sci-Fi", "ratingKey": "777"}]}}))
    r.get(url__regex=rf"{PLEX}/library/collections/\d+/children").mock(
        return_value=httpx.Response(200, json={"MediaContainer": {"Metadata": []}}))
    create = r.post(f"{PLEX}/library/collections").mock(
        return_value=httpx.Response(201, json={"MediaContainer": {"Metadata": [{"ratingKey": "888"}]}}))
    owned_add = r.put(url__regex=rf"{PLEX}/library/collections/888/items").mock(
        return_value=httpx.Response(200, json={}))
    assigned_add = r.put(url__regex=rf"{PLEX}/library/collections/777/items").mock(
        return_value=httpx.Response(200, json={}))
    assigned_del = r.delete(url__regex=rf"{PLEX}/library/collections/777/items").mock(
        return_value=httpx.Response(200, json={}))
    assigned_wipe = r.delete(f"{PLEX}/library/collections/777").mock(
        return_value=httpx.Response(200, json={}))

    resp = auth_client.post("/api/collections/generate/921")
    assert resp.status_code == 200, resp.text

    # Only the owned, name-resolved collection was written to.
    assert create.called
    assert create.calls[0].request.url.params["title"] == "Invariant Movies"
    assert owned_add.called
    assert not assigned_add.called
    assert not assigned_del.called
    assert not assigned_wipe.called

    # The slot now points at the owned collection.
    row = _slot(921, "movie")
    assert row["source"] == "owned"
    assert row["collection_rating_key"] == "888"


@respx.mock
def test_generate_refuses_non_owned_title(auth_client):
    """Belt-and-braces: even if a non-owned title were resolved, generation aborts."""
    _seed_channel(922, "Refuse")
    r = respx.mock
    _base_plex_routes(r, section_collections=[{"title": "Refuse Movies", "ratingKey": "500"}], children=[])
    r.put(url__regex=rf"{PLEX}/library/collections/500/items").mock(return_value=httpx.Response(200, json={}))
    # Force the ownership check to fail for a title the resolver did return.
    orig = main._is_owned_title
    main._is_owned_title = lambda title, ch: False
    try:
        resp = auth_client.post("/api/collections/generate/922")
    finally:
        main._is_owned_title = orig
    assert resp.status_code == 500


# ── Smart collection create + assign (atomic) ─────────────────────────────────

def _smart_body(title="Neon 80s"):
    return {"section_id": "10", "type": "movie", "title": title,
            "filters": {"decade": 1980}, "sort": "year_asc", "limit": 50}


@respx.mock
def test_smart_collection_create_and_assign(auth_client):
    _seed_channel(930, "Smart")
    r = respx.mock
    r.get(f"{PLEX}/identity").mock(return_value=httpx.Response(
        200, json={"MediaContainer": {"machineIdentifier": "MID"}}))
    create = r.post(f"{PLEX}/library/collections").mock(return_value=httpx.Response(
        201, json={"MediaContainer": {"Metadata": [{"ratingKey": "4242", "title": "Neon 80s"}]}}))

    resp = auth_client.post("/api/channels/930/smart-collection", json=_smart_body())
    assert resp.status_code in (200, 201), resp.text
    assert create.called
    body = resp.json()
    assert body["rating_key"] == "4242"
    assert body["assigned"] is True

    row = _slot(930, "movie")
    assert row["source"] == "assigned"
    assert row["is_smart"] == 1
    assert row["collection_rating_key"] == "4242"
    assert row["collection_title"] == "Neon 80s"


@respx.mock
def test_smart_create_failure_leaves_no_slot(auth_client):
    """Plex refuses the create → no assignment may be written (no dangling ref)."""
    _seed_channel(931, "SmartFail")
    r = respx.mock
    r.get(f"{PLEX}/identity").mock(return_value=httpx.Response(
        200, json={"MediaContainer": {"machineIdentifier": "MID"}}))
    r.post(f"{PLEX}/library/collections").mock(return_value=httpx.Response(500, text="boom"))

    resp = auth_client.post("/api/channels/931/smart-collection", json=_smart_body())
    assert resp.status_code >= 400
    assert _slot(931, "movie") is None


@respx.mock
def test_smart_create_assign_is_atomic_on_assign_failure(auth_client, monkeypatch):
    """Assign step blows up → the just-created Plex collection is rolled back,
    and no orphan slot is left behind."""
    _seed_channel(932, "SmartAtomic")
    r = respx.mock
    r.get(f"{PLEX}/identity").mock(return_value=httpx.Response(
        200, json={"MediaContainer": {"machineIdentifier": "MID"}}))
    r.post(f"{PLEX}/library/collections").mock(return_value=httpx.Response(
        201, json={"MediaContainer": {"Metadata": [{"ratingKey": "4343", "title": "Neon 80s"}]}}))
    rollback = r.delete(f"{PLEX}/library/collections/4343").mock(
        return_value=httpx.Response(200, json={}))

    def _boom(*a, **kw):
        raise RuntimeError("db exploded")

    monkeypatch.setattr(main, "_write_assigned_slot", _boom)

    resp = auth_client.post("/api/channels/932/smart-collection", json=_smart_body())
    assert resp.status_code >= 400
    assert rollback.called            # no orphaned Plex collection
    assert _slot(932, "movie") is None  # no dangling assignment


# ── Tunarr smart-collection purge ─────────────────────────────────────────────

def _set_tunarr_url():
    with main.get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('tunarr_url', ?)", (TUNARR,))


def _seed_links():
    with main.get_db() as conn:
        conn.execute("DELETE FROM tunarr_collection_links")
        conn.execute("INSERT OR REPLACE INTO tunarr_collection_links VALUES (?,?,?,?)",
                     (950, "movie", "u-1", "A Movies"))
        conn.execute("INSERT OR REPLACE INTO tunarr_collection_links VALUES (?,?,?,?)",
                     (951, "movie", "u-2", "B Movies"))


def _links():
    with main.get_db() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM tunarr_collection_links").fetchall()]


@respx.mock
def test_purge_deletes_all_and_clears_links(auth_client):
    _set_tunarr_url()
    _seed_links()
    r = respx.mock
    r.get(f"{TUNARR}/api/smart_collections").mock(return_value=httpx.Response(200, json=[
        {"uuid": "u-1", "name": "A Movies"}, {"uuid": "u-2", "name": "B Movies"}]))
    d1 = r.delete(f"{TUNARR}/api/smart_collections/u-1").mock(return_value=httpx.Response(204))
    d2 = r.delete(f"{TUNARR}/api/smart_collections/u-2").mock(return_value=httpx.Response(200, json={}))

    resp = auth_client.post("/api/tunarr/smart-collections/purge")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"deleted": 2, "failed": []}
    assert d1.called and d2.called
    assert _links() == []


@respx.mock
def test_purge_reports_per_item_failures(auth_client):
    _set_tunarr_url()
    _seed_links()
    r = respx.mock
    r.get(f"{TUNARR}/api/smart_collections").mock(return_value=httpx.Response(200, json=[
        {"uuid": "u-1", "name": "A Movies"}, {"uuid": "u-2", "name": "B Movies"}]))
    r.delete(f"{TUNARR}/api/smart_collections/u-1").mock(return_value=httpx.Response(500, text="nope"))
    d2 = r.delete(f"{TUNARR}/api/smart_collections/u-2").mock(return_value=httpx.Response(204))

    resp = auth_client.post("/api/tunarr/smart-collections/purge")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["deleted"] == 1          # the second delete still ran
    assert d2.called
    assert len(body["failed"]) == 1
    assert body["failed"][0]["id"] == "u-1"
    # The link for the collection that survived in Tunarr is kept.
    assert [l["tunarr_collection_id"] for l in _links()] == ["u-1"]


@respx.mock
def test_purge_on_empty_tunarr(auth_client):
    _set_tunarr_url()
    _seed_links()
    respx.mock.get(f"{TUNARR}/api/smart_collections").mock(return_value=httpx.Response(200, json=[]))

    resp = auth_client.post("/api/tunarr/smart-collections/purge")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"deleted": 0, "failed": []}
    assert _links() == []


# ── Tunarr sync works unchanged for an assigned collection ────────────────────

@respx.mock
def test_sync_collections_pushes_an_assigned_collection(auth_client):
    """`sync-collections` reads channel_collections titles, so an assigned row
    pushes to Tunarr with no change to that route."""
    _seed_channel(960, "SyncAssigned")
    _set_tunarr_url()
    with main.get_db() as conn:
        conn.execute("DELETE FROM tunarr_collection_links WHERE channel_number=960")
    auth_client.post("/api/channel-collections/960/assign", json={
        "plex_type": "movie", "collection_rating_key": "777",
        "collection_title": "User Sci-Fi", "is_smart": True})

    r = respx.mock
    r.get(f"{TUNARR}/api/smart_collections").mock(return_value=httpx.Response(200, json=[]))
    r.get(f"{TUNARR}/api/version").mock(return_value=httpx.Response(200, json={"tunarr": "1.3.6"}))
    r.post(f"{TUNARR}/api/tasks/ScanLibrariesTask").mock(return_value=httpx.Response(202, json={}))
    r.get(f"{TUNARR}/api/jobs").mock(return_value=httpx.Response(200, json=[]))
    created = r.post(f"{TUNARR}/api/smart_collections").mock(return_value=httpx.Response(
        201, json={"uuid": "sc-9", "name": "User Sci-Fi",
                   "filter": {"type": "value"}, "filterString": 'tags = "User Sci-Fi"'}))

    resp = auth_client.post("/api/tunarr/channel-links/960/sync-collections")
    assert resp.status_code == 200, resp.text
    assert created.called
    body = resp.json()
    assert [c["name"] for c in body["created"]] == ["User Sci-Fi"]
    with main.get_db() as conn:
        row = conn.execute(
            "SELECT * FROM tunarr_collection_links WHERE channel_number=960").fetchone()
    assert row["tunarr_collection_id"] == "sc-9"
