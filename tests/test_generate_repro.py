"""Reproduction: do movie items actually get PUT into the Plex collection on generate?"""
from urllib.parse import parse_qs, urlparse

import httpx
import respx

import main

PLEX = "http://plex:32400"


def _seed(channel=950, name="Repro"):
    with main.get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO channels (number, name) VALUES (?, ?)", (channel, name))
        conn.execute("DELETE FROM assignments WHERE channel_number=?", (channel,))
        conn.execute("DELETE FROM channel_collections WHERE channel_number=?", (channel,))
        data = [("m1", "movie"), ("m2", "movie"), ("s1", "show"), ("s2", "show")]
        for rk, t in data:
            conn.execute(
                "INSERT INTO assignments (channel_number, plex_rating_key, plex_title, plex_type, plex_thumb, plex_year) "
                "VALUES (?,?,?,?,?,?)",
                (channel, rk, f"{t} {rk}", t, None, 2020),
            )
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_url', ?)", (PLEX,))
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_token', 'tok')")


@respx.mock
def test_repro_movies_added(auth_client):
    _seed()
    r = respx.mock
    r.get(f"{PLEX}/identity").mock(return_value=httpx.Response(200, json={"MediaContainer": {"machineIdentifier": "MID"}}))
    r.get(f"{PLEX}/library/sections").mock(return_value=httpx.Response(200, json={"MediaContainer": {"Directory": [
        {"type": "movie", "key": "10"}, {"type": "show", "key": "20"}]}}))
    r.get(url__regex=rf"{PLEX}/library/sections/\d+/collections").mock(
        return_value=httpx.Response(200, json={"MediaContainer": {"Metadata": []}}))

    ids = iter(["100", "200"])
    def _create(request):
        return httpx.Response(201, json={"MediaContainer": {"Metadata": [{"ratingKey": next(ids)}]}})
    r.post(f"{PLEX}/library/collections").mock(side_effect=_create)
    r.get(url__regex=rf"{PLEX}/library/collections/\d+/children").mock(
        return_value=httpx.Response(200, json={"MediaContainer": {"Metadata": []}}))
    put_route = r.put(url__regex=rf"{PLEX}/library/collections/\d+/items").mock(
        return_value=httpx.Response(200, json={}))

    resp = auth_client.post("/api/collections/generate/950")
    print("STATUS:", resp.status_code, resp.text)

    added_keys = []
    for call in put_route.calls:
        q = parse_qs(urlparse(str(call.request.url)).query)
        uri = q.get("uri", [""])[0]
        added_keys.append(uri.rsplit("/", 1)[-1])
    print("PUT add keys:", sorted(added_keys))

    assert "m1" in added_keys and "m2" in added_keys, f"movies not added! got {sorted(added_keys)}"
    assert "s1" in added_keys and "s2" in added_keys, f"shows not added! got {sorted(added_keys)}"
