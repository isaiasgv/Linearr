"""Asset links written INTO Tunarr use the public base; API calls do not.

Two different addresses for two different readers. Linearr talks to Tunarr
container-to-container (`http://tunarr:8000`), but the URLs Tunarr stores are
copied into XMLTV and into ffmpeg command lines, where they are fetched by Plex
clients that may be nowhere near this network. A LAN-only address there is why
channel icons render locally and nowhere else.

The sharp edge guarded here is the re-basing rule: a *user's own* watermark URL
pointing at some third-party host must never be rewritten onto the Tunarr
domain, because that would silently produce a 404 and — for an enabled
watermark — take the channel off the air.
"""
import pytest

import main

PUBLIC = "https://tunarr.example.com"
INTERNAL = "http://tunarr:8000"


@pytest.fixture(autouse=True)
def _db():
    """Most of these are pure-function tests that never build a TestClient, so
    the app lifespan (which normally creates the schema) never runs.

    `tunarr_url` is pinned here rather than assumed: whether a URL gets re-based
    depends on its host matching the configured Tunarr, and other test modules
    in the suite write that setting. Restored afterwards so this module does not
    become the thing that pollutes them back.
    """
    main.init_db()
    with main.get_db() as conn:
        prev = conn.execute(
            "SELECT key, value FROM settings WHERE key IN "
            "('tunarr_url', 'tunarr_public_url')").fetchall()
        saved = {r["key"]: r["value"] for r in prev}
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('tunarr_url', ?)", (INTERNAL,))
        conn.execute("DELETE FROM settings WHERE key='tunarr_public_url'")
    yield
    with main.get_db() as conn:
        conn.execute("DELETE FROM settings WHERE key IN "
                     "('tunarr_url', 'tunarr_public_url')")
        for k, v in saved.items():
            conn.execute("INSERT OR REPLACE INTO settings VALUES (?, ?)", (k, v))


@pytest.fixture
def public_base():
    with main.get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('tunarr_public_url', ?)",
                     (PUBLIC,))
    return PUBLIC


def test_no_public_url_falls_back_to_the_internal_one():
    """An install that never sets this must behave exactly as before."""
    assert main._tunarr_asset_base() == INTERNAL
    assert main._tunarr_asset_url(f"{INTERNAL}/images/uploads/x.png") == \
        f"{INTERNAL}/images/uploads/x.png"


def test_a_tunarr_upload_is_rebased_onto_the_public_host(public_base):
    assert main._tunarr_asset_url(f"{INTERNAL}/images/uploads/linearr-ch131-abc.png") == \
        f"{PUBLIC}/images/uploads/linearr-ch131-abc.png"


def test_an_already_public_url_stays_put(public_base):
    """Re-basing must be idempotent — it runs on every read."""
    url = f"{PUBLIC}/images/uploads/linearr-ch131-abc.png"
    assert main._tunarr_asset_url(url) == url
    assert main._tunarr_asset_url(main._tunarr_asset_url(url)) == url


def test_a_third_party_url_is_never_rewritten(public_base):
    """The important one. A user may paste their own watermark URL; rewriting
    the host onto Tunarr would point at a 404, and for an enabled watermark a
    missing image is what kills the channel."""
    external = "https://cdn.example.org/logos/galaxy.png"
    assert main._tunarr_asset_url(external) == external


def test_a_non_images_path_on_tunarr_is_left_alone(public_base):
    """Only Tunarr's upload directory is an asset path. Anything else is not
    ours to rewrite."""
    other = f"{INTERNAL}/api/channels/abc/icon"
    assert main._tunarr_asset_url(other) == other


def test_blank_and_none_resolve_to_none(public_base):
    assert main._tunarr_asset_url(None) is None
    assert main._tunarr_asset_url("") is None
    assert main._tunarr_asset_url("   ") is None


def test_changing_the_public_url_takes_effect_without_a_migration(public_base):
    """Stored rows are absolute and are NOT rewritten on a settings change —
    every read re-bases instead, so the switch is immediate either way."""
    stored = f"{INTERNAL}/images/uploads/linearr-ch101-deadbeef.png"
    assert main._tunarr_asset_url(stored).startswith(PUBLIC)
    with main.get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO settings VALUES "
                     "('tunarr_public_url', 'https://other.example.net')")
    assert main._tunarr_asset_url(stored) == \
        "https://other.example.net/images/uploads/linearr-ch101-deadbeef.png"


# ── The icon payload Tunarr actually receives ────────────────────────────────

def test_channel_changes_prefer_the_uploaded_icon_url(public_base):
    """The whole point: Tunarr copies this into XMLTV, and a data: URI there is
    unreadable to any Plex client that is not on this machine."""
    ch = {
        "name": "Galaxy Test", "number": 101, "tier": "Galaxy Main",
        "icon": "data:image/png;base64,iVBORw0KGgo=",
        "icon_url": f"{INTERNAL}/images/uploads/linearr-icon-ch101-abc.png",
    }
    changes = main._tunarr_channel_changes(ch)
    assert changes["icon"]["path"] == f"{PUBLIC}/images/uploads/linearr-icon-ch101-abc.png"
    assert not changes["icon"]["path"].startswith("data:")


def test_channel_changes_fall_back_to_the_data_uri(public_base):
    """A failed upload must not cost the channel its logo — it still renders
    locally, which beats nothing."""
    data_uri = "data:image/png;base64,iVBORw0KGgo="
    changes = main._tunarr_channel_changes(
        {"name": "N", "number": 102, "tier": "Galaxy Main", "icon": data_uri})
    assert changes["icon"]["path"] == data_uri


def test_channel_with_no_icon_sends_no_icon_key(public_base):
    """Omitted rather than nulled, so an icon set in Tunarr's own UI survives."""
    changes = main._tunarr_channel_changes(
        {"name": "N", "number": 103, "tier": "Galaxy Main"})
    assert "icon" not in changes


def test_watermark_image_is_rebased_too(public_base):
    ch = {
        "name": "N", "number": 104, "tier": "Galaxy Main",
        "watermark": '{"enabled": true, "position": "bottom-right"}',
        "watermark_image_url": f"{INTERNAL}/images/uploads/linearr-ch104-abc.png",
    }
    wm = main._tunarr_channel_changes(ch)["watermark"]
    assert wm["enabled"] is True
    assert wm["url"] == f"{PUBLIC}/images/uploads/linearr-ch104-abc.png"


def test_settings_roundtrip_the_public_url(auth_client):
    r = auth_client.post("/api/settings", json={
        "plex_url": "http://plex:32400", "plex_token": "",
        "tunarr_url": INTERNAL, "tunarr_public_url": f"{PUBLIC}/",
    })
    assert r.status_code == 200, r.text
    # Stored without the trailing slash, so joining a path never doubles it.
    assert auth_client.get("/api/settings").json()["tunarr_public_url"] == PUBLIC

    # Blank clears it, reverting asset links to the internal URL.
    auth_client.post("/api/settings", json={
        "plex_url": "http://plex:32400", "plex_token": "",
        "tunarr_url": INTERNAL, "tunarr_public_url": "",
    })
    assert auth_client.get("/api/settings").json()["tunarr_public_url"] == ""
