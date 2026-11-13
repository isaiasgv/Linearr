"""Tier -> Tunarr guide group mapping.

Linearr's tier is a fixed classification its UI filters and numbers by, but
the guide group is what viewers see, and an install may group differently —
the Galaxy lineup shows "Galaxy" and "Galaxy+", not the three tier names. A
sync pushed the tier verbatim, so every sync re-created that drift.
"""
import main


def _set_map(value: str | None):
    with main.get_db() as conn:
        if value is None:
            conn.execute("DELETE FROM settings WHERE key='tunarr_group_map'")
        else:
            conn.execute("INSERT OR REPLACE INTO settings VALUES ('tunarr_group_map', ?)", (value,))


def test_without_a_map_the_tier_is_the_group(client):
    _set_map(None)
    assert main._tunarr_group_for("Classics") == "Classics"


def test_a_mapped_tier_uses_its_group_and_others_fall_through(client):
    _set_map('{"Classics": "Galaxy", "Galaxy Premium": "Galaxy+"}')
    try:
        assert main._tunarr_group_for("Classics") == "Galaxy"
        assert main._tunarr_group_for("Galaxy Premium") == "Galaxy+"
        assert main._tunarr_group_for("Sci-Fi") == "Sci-Fi"
        changes = main._tunarr_channel_changes({"name": "n", "number": 1, "tier": "Galaxy Premium"})
        assert changes["groupTitle"] == "Galaxy+"
    finally:
        _set_map(None)


def test_a_broken_map_is_ignored(client):
    _set_map("not json")
    try:
        assert main._tunarr_group_for("Classics") == "Classics"
    finally:
        _set_map(None)


def test_settings_round_trip(auth_client):
    try:
        cur = auth_client.get("/api/settings").json()
        r = auth_client.post("/api/settings", json={
            "plex_url": cur["plex_url"], "plex_token": cur.get("plex_token") or "t",
            "tunarr_group_map": {"Classics": " Galaxy ", "": "x"}})
        assert r.status_code == 200
        assert auth_client.get("/api/settings").json()["tunarr_group_map"] == {"Classics": "Galaxy"}
    finally:
        _set_map(None)
