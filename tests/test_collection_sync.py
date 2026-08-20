"""Collection generation: emptying, per-type independence, and rebuild-on-push.

Three reported faults, all in `generate_collections`:

1. Removing items did not reach Plex. A type with no assignments was skipped
   outright, so emptying a channel left every item sitting in the collection —
   and therefore on the Tunarr channel, since Tunarr's smart collections resolve
   by tag to whatever Plex currently holds.
2. A channel could not reference an existing collection for one type while
   Linearr generated the other: a build forced BOTH slots back to 'owned' and
   silently discarded the assignment.
3. Pushing to Tunarr published whatever the Plex collection last contained,
   because nothing rebuilt it first.
"""
import httpx
import pytest

import main

CH = 8801
MACHINE = "machine-abc"


@pytest.fixture
def channel():
    with main.get_db() as conn:
        conn.execute("DELETE FROM channels WHERE number=?", (CH,))
        conn.execute("INSERT INTO channels (number, name, tier) VALUES (?,?,?)",
                     (CH, "Collection Test", "Galaxy Main"))
        conn.execute("DELETE FROM assignments WHERE channel_number=?", (CH,))
        conn.execute("DELETE FROM channel_collections WHERE channel_number=?", (CH,))
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_url', 'http://plex:32400')")
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_token', 'tok')")
    yield
    with main.get_db() as conn:
        conn.execute("DELETE FROM assignments WHERE channel_number=?", (CH,))
        conn.execute("DELETE FROM channel_collections WHERE channel_number=?", (CH,))
        conn.execute("DELETE FROM channels WHERE number=?", (CH,))


def _assign(rating_key: str, plex_type: str):
    with main.get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO assignments "
            "(channel_number, plex_rating_key, plex_type, plex_title) VALUES (?,?,?,?)",
            (CH, rating_key, plex_type, f"Item {rating_key}"),
        )


def _slot(plex_type: str, **fields):
    cols = {"channel_number": CH, "plex_type": plex_type, "collection_rating_key": "900",
            "collection_title": "Collection Test Movies", "managed": 1,
            "source": "owned", "is_smart": 0, "linearr_created": 1}
    cols.update(fields)
    with main.get_db() as conn:
        conn.execute(
            f"INSERT OR REPLACE INTO channel_collections ({','.join(cols)}) "
            f"VALUES ({','.join('?' * len(cols))})", tuple(cols.values()))


def _mock_plex(monkeypatch, *, collection_items, collections=None, removed=None, added=None):
    """A Plex that owns one movie collection (ratingKey 900) with `collection_items`."""
    cols = collections if collections is not None else [
        {"ratingKey": 900, "title": "Collection Test Movies"}
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/identity":
            return httpx.Response(200, json={"MediaContainer": {"machineIdentifier": MACHINE}})
        if path == "/library/sections":
            return httpx.Response(200, json={"MediaContainer": {"Directory": [
                {"key": "1", "type": "movie", "title": "Movies"},
                {"key": "2", "type": "show", "title": "TV"},
            ]}})
        if path.endswith("/collections") and "/sections/" in path:
            return httpx.Response(200, json={"MediaContainer": {"Metadata": cols}})
        if path.endswith("/children"):
            return httpx.Response(200, json={"MediaContainer": {"Metadata": [
                {"ratingKey": k} for k in collection_items
            ]}})
        if path.endswith("/items"):
            if request.method == "DELETE":
                if removed is not None:
                    removed.append(request.url.params.get("items"))
                return httpx.Response(200, json={})
            if added is not None:
                added.append(request.url.params.get("uri"))
            return httpx.Response(200, json={})
        if path == "/library/collections" and request.method == "POST":
            # Creating a collection — Plex echoes the new one back.
            return httpx.Response(200, json={"MediaContainer": {"Metadata": [
                {"ratingKey": 901, "title": request.url.params.get("title", "")}
            ]}})
        return httpx.Response(200, json={"MediaContainer": {}})

    transport = httpx.MockTransport(handler)
    real = httpx.AsyncClient
    monkeypatch.setattr(main.httpx, "AsyncClient",
                        lambda *a, **kw: real(transport=transport))


# ── 1. Removals reach Plex ───────────────────────────────────────────────────

def test_removing_the_last_item_empties_the_collection(auth_client, channel, monkeypatch):
    """The regression. Zero assignments used to skip the type entirely, so the
    collection kept every item forever."""
    _slot("movie")                       # Linearr already owns/manages it
    removed: list = []
    _mock_plex(monkeypatch, collection_items=["11", "12"], removed=removed)

    r = auth_client.post(f"/api/collections/generate/{CH}")
    assert r.status_code == 200, r.text
    assert sorted(removed) == ["11", "12"], \
        "emptying the channel must empty the collection, not leave it stale"


def test_removing_some_items_prunes_only_those(auth_client, channel, monkeypatch):
    _slot("movie")
    _assign("11", "movie")
    removed: list = []
    _mock_plex(monkeypatch, collection_items=["11", "12"], removed=removed)

    auth_client.post(f"/api/collections/generate/{CH}")
    assert removed == ["12"]


def test_an_unmanaged_empty_type_creates_nothing(auth_client, channel, monkeypatch):
    """No assignments and nothing owned — do not invent an empty collection."""
    _assign("21", "show")            # so the request isn't a bare 404
    added: list = []
    _mock_plex(monkeypatch, collection_items=[], collections=[], added=added)

    r = auth_client.post(f"/api/collections/generate/{CH}")
    assert r.status_code == 200
    assert "movie" not in r.json().get("collections", r.json())


# ── 2. The two types are independent ─────────────────────────────────────────

def test_an_assigned_slot_survives_building_the_other_type(auth_client, channel, monkeypatch):
    """Referencing an existing collection for movies while Linearr generates the
    shows is a legitimate setup, and a build used to silently convert it."""
    _slot("movie", source="assigned", managed=0, linearr_created=0,
          collection_title="My Own Movie Collection", collection_rating_key="555")
    _assign("11", "movie")
    _assign("21", "show")
    _mock_plex(monkeypatch, collection_items=[])

    r = auth_client.post(f"/api/collections/generate/{CH}")
    assert r.status_code == 200, r.text

    with main.get_db() as conn:
        row = conn.execute(
            "SELECT source, collection_title FROM channel_collections "
            "WHERE channel_number=? AND plex_type='movie'", (CH,)).fetchone()
    assert row["source"] == "assigned", "building the shows converted the movie slot"
    assert row["collection_title"] == "My Own Movie Collection"


def test_take_over_assigned_is_the_explicit_opt_in(auth_client, channel, monkeypatch):
    _slot("movie", source="assigned", managed=0, linearr_created=0,
          collection_title="My Own Movie Collection", collection_rating_key="555")
    _assign("11", "movie")
    _mock_plex(monkeypatch, collection_items=[])

    r = auth_client.post(f"/api/collections/generate/{CH}?take_over_assigned=true")
    assert r.status_code == 200, r.text
    with main.get_db() as conn:
        row = conn.execute(
            "SELECT source FROM channel_collections "
            "WHERE channel_number=? AND plex_type='movie'", (CH,)).fetchone()
    assert row["source"] == "owned"


def test_an_assigned_slot_is_reported_as_skipped(auth_client, channel, monkeypatch):
    """Silently doing nothing would be its own bug — say so."""
    _slot("movie", source="assigned", managed=0, linearr_created=0)
    _assign("11", "movie")
    _mock_plex(monkeypatch, collection_items=[])

    body = auth_client.post(f"/api/collections/generate/{CH}").json()
    entry = body.get("collections", body).get("movie", {})
    assert "skipped" in entry and "existing collection" in entry["skipped"]
