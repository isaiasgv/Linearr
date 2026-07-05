"""Purge-channel-content endpoint + the bulk-assign regression (items must not
require a per-item channel_number — the collection 'Add all' 422 bug)."""
import main
from tests.test_mcp import _call, _token


def _seed(auth_client, channel, n_movies, n_shows):
    auth_client.post("/api/channels", json={"number": channel, "name": f"Purge {channel}"})
    items = (
        [{"plex_rating_key": f"m{channel}-{i}", "plex_title": f"Movie {i}",
          "plex_type": "movie", "plex_thumb": None, "plex_year": 2000 + i}
         for i in range(n_movies)]
        + [{"plex_rating_key": f"s{channel}-{i}", "plex_title": f"Show {i}",
            "plex_type": "show", "plex_thumb": None, "plex_year": 2010 + i}
           for i in range(n_shows)]
    )
    # NOTE: items intentionally carry NO channel_number — exactly what the
    # frontend sends. This is the shape that used to 422.
    r = auth_client.post("/api/assignments/bulk",
                         json={"channel_number": channel, "items": items})
    assert r.status_code == 201, r.text
    return r.json()


# ── the collection 'Add all' 422 regression ─────────────────────────────────

def test_bulk_assign_without_per_item_channel_number(auth_client):
    result = _seed(auth_client, 8801, 3, 2)
    assert result["added"] == 5 and result["skipped"] == 0


# ── purge endpoint ───────────────────────────────────────────────────────────

def _counts(auth_client, channel):
    data = auth_client.get("/api/assignments").json()
    rows = data.get(str(channel), []) if isinstance(data, dict) else []
    return (sum(1 for r in rows if r["plex_type"] == "movie"),
            sum(1 for r in rows if r["plex_type"] == "show"))


def test_purge_movies_only(auth_client):
    _seed(auth_client, 8802, 4, 3)
    r = auth_client.delete("/api/assignments/channel/8802?content_type=movies")
    assert r.status_code == 200 and r.json()["removed"] == 4
    assert _counts(auth_client, 8802) == (0, 3)


def test_purge_shows_only(auth_client):
    _seed(auth_client, 8803, 4, 3)
    r = auth_client.delete("/api/assignments/channel/8803?content_type=shows")
    assert r.status_code == 200 and r.json()["removed"] == 3
    assert _counts(auth_client, 8803) == (4, 0)


def test_purge_both(auth_client):
    _seed(auth_client, 8804, 2, 2)
    r = auth_client.delete("/api/assignments/channel/8804?content_type=both")
    assert r.status_code == 200 and r.json()["removed"] == 4
    assert _counts(auth_client, 8804) == (0, 0)


def test_purge_default_is_both(auth_client):
    _seed(auth_client, 8805, 2, 1)
    r = auth_client.delete("/api/assignments/channel/8805")
    assert r.status_code == 200 and r.json()["removed"] == 3


def test_purge_rejects_bad_content_type(auth_client):
    _seed(auth_client, 8806, 1, 1)
    r = auth_client.delete("/api/assignments/channel/8806?content_type=bogus")
    assert r.status_code == 400


def test_purge_missing_channel_404(auth_client):
    r = auth_client.delete("/api/assignments/channel/99999?content_type=both")
    assert r.status_code == 404


# ── MCP purge tool ───────────────────────────────────────────────────────────

def test_mcp_purge_channel_content(auth_client):
    _seed(auth_client, 8807, 3, 2)
    token = _token(auth_client)
    result = _call(auth_client, token, "purge_channel_content",
                   {"channel_number": 8807, "content_type": "movies"})
    assert not result.get("isError"), result
    assert _counts(auth_client, 8807) == (0, 2)
