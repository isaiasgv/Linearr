"""Safety logic for channel collection generation: Linearr only manages its own
'{Channel} Movies/TV' collections, additive-only on first touch, never prunes a
user's own collection."""
import httpx
import pytest
import respx

import main

PLEX = "http://plex:32400"


# ── Pure helpers ──────────────────────────────────────────────────────────────

def test_owned_collection_name():
    assert main._owned_collection_name("Galaxy ONE", "movie") == "Galaxy ONE Movies"
    assert main._owned_collection_name("Galaxy ONE", "show") == "Galaxy ONE TV"


def test_owned_collection_name_rejects_unknown_type():
    with pytest.raises(ValueError):
        main._owned_collection_name("Galaxy ONE", "artist")


def test_is_owned_title():
    assert main._is_owned_title("Galaxy ONE Movies", "Galaxy ONE") is True
    assert main._is_owned_title("Galaxy ONE TV", "Galaxy ONE") is True
    assert main._is_owned_title("Movies", "Galaxy ONE") is False
    assert main._is_owned_title("Galaxy ONE Sci-Fi", "Galaxy ONE") is False


def test_collection_delta_additive_only_first_touch():
    to_add, to_remove = main._collection_delta({"1", "2", "3"}, {"3", "99"}, already_managed=False)
    assert to_add == {"1", "2"}
    assert to_remove == set()  # 99 (foreign) is NOT removed on first touch


def test_collection_delta_full_reconcile_when_managed():
    to_add, to_remove = main._collection_delta({"1", "2", "3"}, {"3", "99"}, already_managed=True)
    assert to_add == {"1", "2"}
    assert to_remove == {"99"}


def test_managed_column_exists(client):
    # Depends on `client`: the schema (and therefore this column) is created by
    # `init_db()` in the app lifespan, which only runs inside the TestClient
    # context manager. Without the fixture this passed only when some earlier
    # test in the session happened to build the schema first, and failed when
    # the file was run on its own.
    with main.get_db() as conn:
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(channel_collections)")}
    assert "managed" in cols


# ── Integration (respx-mocked Plex) ──────────────────────────────────────────

def _seed(channel, name):
    with main.get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO channels (number, name) VALUES (?, ?)", (channel, name))
        conn.execute("DELETE FROM assignments WHERE channel_number=?", (channel,))
        conn.execute("DELETE FROM channel_collections WHERE channel_number=?", (channel,))
        for rk in ("1", "2", "3"):
            conn.execute(
                "INSERT INTO assignments (channel_number, plex_rating_key, plex_title, plex_type, plex_thumb, plex_year) "
                "VALUES (?,?,?,?,?,?)",
                (channel, rk, f"Movie {rk}", "movie", None, 2020),
            )
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_url', ?)", (PLEX,))
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_token', 'tok')")


def _base_routes(r, *, section_collections, children):
    r.get(f"{PLEX}/identity").mock(return_value=httpx.Response(200, json={"MediaContainer": {"machineIdentifier": "MID"}}))
    r.get(f"{PLEX}/library/sections").mock(return_value=httpx.Response(200, json={"MediaContainer": {"Directory": [
        {"type": "movie", "key": "10"}, {"type": "show", "key": "20"}]}}))
    r.get(url__regex=rf"{PLEX}/library/sections/\d+/collections").mock(
        return_value=httpx.Response(200, json={"MediaContainer": {"Metadata": section_collections}}))
    r.get(url__regex=rf"{PLEX}/library/collections/\d+/children").mock(
        return_value=httpx.Response(200, json={"MediaContainer": {"Metadata": [{"ratingKey": k} for k in children]}}))


@respx.mock
def test_first_touch_is_additive_only_on_adopted_collection(auth_client):
    _seed(900, "TestChan")
    r = respx.mock
    _base_routes(r, section_collections=[{"title": "TestChan Movies", "ratingKey": "500"}], children=["3", "99"])
    add = r.put(url__regex=rf"{PLEX}/library/collections/500/items").mock(return_value=httpx.Response(200, json={}))
    delete = r.delete(url__regex=rf"{PLEX}/library/collections/500/items").mock(return_value=httpx.Response(200, json={}))

    resp = auth_client.post("/api/collections/generate/900")
    assert resp.status_code == 200, resp.text
    assert add.called
    assert not delete.called  # foreign item 99 NOT removed on first touch
    with main.get_db() as conn:
        row = conn.execute("SELECT collection_title, managed FROM channel_collections "
                           "WHERE channel_number=900 AND plex_type='movie'").fetchone()
    assert row["collection_title"] == "TestChan Movies"
    assert row["managed"] == 1


@respx.mock
def test_legacy_link_to_user_collection_is_ignored(auth_client):
    _seed(901, "Legacy")
    with main.get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO channel_collections "
                     "(channel_number, plex_type, collection_rating_key, collection_title, managed) "
                     "VALUES (901, 'movie', '777', 'Movies', 0)")
    r = respx.mock
    _base_routes(r, section_collections=[], children=[])
    create = r.post(f"{PLEX}/library/collections").mock(
        return_value=httpx.Response(201, json={"MediaContainer": {"Metadata": [{"ratingKey": "888"}]}}))
    r.put(url__regex=rf"{PLEX}/library/collections/888/items").mock(return_value=httpx.Response(200, json={}))
    user_delete = r.delete(url__regex=rf"{PLEX}/library/collections/777/items").mock(return_value=httpx.Response(200, json={}))

    resp = auth_client.post("/api/collections/generate/901")
    assert resp.status_code == 200, resp.text
    assert create.called
    assert not user_delete.called  # the user's collection 777 is never touched
    with main.get_db() as conn:
        row = conn.execute("SELECT collection_rating_key FROM channel_collections "
                           "WHERE channel_number=901 AND plex_type='movie'").fetchone()
    assert row["collection_rating_key"] == "888"


@respx.mock
def test_add_from_collection_does_not_set_managed_target(auth_client):
    with main.get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO channels (number, name) VALUES (902, 'AddFrom')")
        conn.execute("DELETE FROM channel_collections WHERE channel_number=902")
        conn.execute("DELETE FROM assignments WHERE channel_number=902")
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_url', ?)", (PLEX,))
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_token', 'tok')")
    respx.mock.get(f"{PLEX}/library/collections/555/children").mock(
        return_value=httpx.Response(200, json={"MediaContainer": {"Metadata": [
            {"ratingKey": "10", "title": "A", "type": "movie", "year": 2020},
            {"ratingKey": "11", "title": "B", "type": "movie", "year": 2021}]}}))
    resp = auth_client.post("/api/channel-collections/902",
                            json={"plex_type": "movie", "collection_rating_key": "555", "collection_title": "User Sci-Fi"})
    assert resp.status_code in (200, 201), resp.text
    assert resp.json()["added"] == 2
    with main.get_db() as conn:
        rows = conn.execute("SELECT * FROM channel_collections WHERE channel_number=902").fetchall()
        cnt = conn.execute("SELECT COUNT(*) c FROM assignments WHERE channel_number=902").fetchone()
    assert len(rows) == 0
    assert cnt["c"] == 2
