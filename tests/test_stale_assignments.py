"""Collections keep their items when Plex re-keys a file, and are built in the
library the items live in.

Two regressions behind Galaxy channels airing offline most of the day:

1. Plex issues a NEW rating key when a file is replaced (Radarr upgrade,
   re-import). Assignments kept the old key, so the item silently fell out of
   the channel collection (Galaxy Harry Potter: 8 of 10 movies gone).
2. generate_collections used the FIRST movie section. With a "3D Movies"
   library listed before "Movies", collections were created in the 3D library,
   where the movies cannot be added, and stayed empty.
"""
import httpx
import pytest

import main

CH = 8850
MACHINE = "mid-stale"


@pytest.fixture
def channel(client):
    with main.get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO channels (number, name) VALUES (?, ?)", (CH, "Stale Test"))
        conn.execute("DELETE FROM assignments WHERE channel_number=?", (CH,))
        conn.execute("DELETE FROM channel_collections WHERE channel_number=?", (CH,))
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_url', 'http://plex:32400')")
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_token', 'tok')")
    yield
    with main.get_db() as conn:
        conn.execute("DELETE FROM assignments WHERE channel_number=?", (CH,))
        conn.execute("DELETE FROM channel_collections WHERE channel_number=?", (CH,))
        conn.execute("DELETE FROM channels WHERE number=?", (CH,))


def _assign(rk, title, year=2002, plex_type="movie"):
    with main.get_db() as conn:
        conn.execute(
            "INSERT INTO assignments (channel_number, plex_rating_key, plex_title, plex_type, plex_year) "
            "VALUES (?,?,?,?,?)", (CH, rk, title, plex_type, year))


def _keys():
    with main.get_db() as conn:
        return sorted(r[0] for r in conn.execute(
            "SELECT plex_rating_key FROM assignments WHERE channel_number=?", (CH,)))


def _mock_plex(monkeypatch, *, live, search, calls):
    """Plex with a '3D Movies' section (key 9) listed BEFORE 'Movies' (key 8).

    live:   {ratingKey: sectionId} for items Plex currently has
    search: {(sectionId, title): [ {ratingKey, title, year}, ... ]}
    calls:  list that receives (method, path, params) for every request
    """
    def handler(request: httpx.Request) -> httpx.Response:
        path, params = request.url.path, dict(request.url.params)
        calls.append((request.method, path, params))
        if path == "/identity":
            return httpx.Response(200, json={"MediaContainer": {"machineIdentifier": MACHINE}})
        if path == "/library/sections":
            return httpx.Response(200, json={"MediaContainer": {"Directory": [
                {"key": "9", "type": "movie", "title": "3D Movies"},
                {"key": "8", "type": "movie", "title": "Movies"},
                {"key": "2", "type": "show", "title": "TV Shows"},
            ]}})
        if path.startswith("/library/metadata/"):
            ks = path.rsplit("/", 1)[1].split(",")
            found = [{"ratingKey": k, "librarySectionID": live[k], "title": "x"} for k in ks if k in live]
            if not found:
                return httpx.Response(404)
            return httpx.Response(200, json={"MediaContainer": {"Metadata": found}})
        if path.endswith("/all") and "/sections/" in path:
            sec = path.split("/")[3]
            hits = search.get((sec, params.get("title")), [])
            return httpx.Response(200, json={"MediaContainer": {"Metadata": hits}})
        if path.endswith("/collections") and "/sections/" in path:
            return httpx.Response(200, json={"MediaContainer": {"Metadata": []}})
        if path == "/library/collections" and request.method == "POST":
            sec = params.get("sectionId")
            return httpx.Response(200, json={"MediaContainer": {"Metadata": [
                {"ratingKey": 7000 + int(sec), "title": params.get("title", "")}]}})
        if path.endswith("/children"):
            return httpx.Response(200, json={"MediaContainer": {"Metadata": []}})
        if path.endswith("/items"):
            return httpx.Response(200, json={})
        return httpx.Response(200, json={"MediaContainer": {}})

    transport = httpx.MockTransport(handler)
    real = httpx.AsyncClient
    monkeypatch.setattr(main.httpx, "AsyncClient", lambda *a, **kw: real(transport=transport))


def _created_sections(calls):
    return [p.get("sectionId") for m, path, p in calls if m == "POST" and path == "/library/collections"]


def _added_to(calls, coll_id):
    return sorted(p["uri"].rsplit("/", 1)[1] for m, path, p in calls
                  if m == "PUT" and path == f"/library/collections/{coll_id}/items")


def test_stale_key_is_repointed_to_the_replacement(auth_client, channel, monkeypatch):
    _assign("100", "Fantastic Beasts", 2018)
    _assign("40381", "Harry Potter and the Chamber of Secrets", 2002)   # replaced in Plex
    calls: list = []
    _mock_plex(monkeypatch, calls=calls,
               live={"100": "8", "64976": "8", "66492": "8"},
               search={("8", "Harry Potter and the Chamber of Secrets"): [
                   {"ratingKey": "64976", "title": "Harry Potter and the Chamber of Secrets", "year": 2002},
                   {"ratingKey": "66492", "title": "Harry Potter and the Chamber of Secrets", "year": 2002},
               ]})

    r = auth_client.post(f"/api/collections/generate/{CH}")
    assert r.status_code == 200, r.text
    assert _keys() == ["100", "66492"], "stale key should point at the newest copy"
    assert _added_to(calls, 7008) == ["100", "66492"]


def test_collection_is_built_in_the_section_holding_the_items(auth_client, channel, monkeypatch):
    """3D Movies is listed first; the movies live in Movies (8)."""
    _assign("100", "A", 2001)
    _assign("101", "B", 2002)
    calls: list = []
    _mock_plex(monkeypatch, calls=calls, live={"100": "8", "101": "8"}, search={})

    r = auth_client.post(f"/api/collections/generate/{CH}")
    assert r.status_code == 200, r.text
    assert _created_sections(calls) == ["8"], "must not create the collection in 3D Movies"
    with main.get_db() as conn:
        row = conn.execute("SELECT collection_rating_key FROM channel_collections "
                           "WHERE channel_number=? AND plex_type='movie'", (CH,)).fetchone()
    assert row["collection_rating_key"] == "7008"


def test_items_split_across_libraries_get_a_collection_in_each(auth_client, channel, monkeypatch):
    _assign("100", "A", 2001)
    _assign("101", "B", 2002)
    _assign("300", "C 3D", 2010)
    calls: list = []
    _mock_plex(monkeypatch, calls=calls, live={"100": "8", "101": "8", "300": "9"}, search={})

    r = auth_client.post(f"/api/collections/generate/{CH}")
    assert r.status_code == 200, r.text
    assert sorted(_created_sections(calls)) == ["8", "9"]
    assert _added_to(calls, 7008) == ["100", "101"]
    assert _added_to(calls, 7009) == ["300"]
    with main.get_db() as conn:
        row = conn.execute("SELECT collection_rating_key FROM channel_collections "
                           "WHERE channel_number=? AND plex_type='movie'", (CH,)).fetchone()
    assert row["collection_rating_key"] == "7008", "slot points at the section with most items"


def test_unmatched_stale_key_is_left_alone(auth_client, channel, monkeypatch):
    _assign("100", "A", 2001)
    _assign("555", "Gone Forever", 1999)
    calls: list = []
    _mock_plex(monkeypatch, calls=calls, live={"100": "8"}, search={})

    r = auth_client.post(f"/api/collections/generate/{CH}")
    assert r.status_code == 200, r.text
    assert _keys() == ["100", "555"], "no confident match: keep the assignment as-is"


def test_year_mismatch_is_not_a_match(auth_client, channel, monkeypatch):
    _assign("555", "Dune", 1984)
    calls: list = []
    _mock_plex(monkeypatch, calls=calls, live={"2021": "8"},
               search={("8", "Dune"): [{"ratingKey": "2021", "title": "Dune", "year": 2021}]})

    auth_client.post(f"/api/collections/generate/{CH}")
    assert _keys() == ["555"], "the 2021 remake is not the 1984 film"


def test_push_schedule_never_leaves_dead_air():
    assert main.TUNARR_SLOT_OVERFLOW == {"type": "oneExtra"}
    assert main.TUNARR_SLOT_LATENESS_MS >= 4 * 60 * 60 * 1000, \
        "lateness must tolerate a movie overrunning its slot, or Tunarr blanks the next slot"
