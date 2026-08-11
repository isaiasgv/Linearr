"""The URL Tunarr is given for a channel icon is settable, and the watermark reuses it.

Tunarr publishes the channel icon in its guide, so the URL has to be one that a
Plex client outside the LAN can actually fetch. `tunarr_public_url` covers that
globally, but not every case: an icon may be hosted somewhere else entirely, or
one channel may need a different host. `POST .../icon/image` is the per-channel
override, mirroring `POST .../watermark/image`.

Two behaviours here are load-bearing:

- A hand-set URL is NEVER re-derived. Without the manual flag the next icon
  change or sync would re-upload the stored icon straight over it.
- "Watermark follows the channel icon" reuses the icon's own uploaded URL rather
  than uploading a second copy. That removes the workflow this was reported
  from: upload icon → apply as watermark → copy the URL that came back → paste
  it into the URL field, because the icon URL itself could not be set.
"""
import json as _json

import httpx
import pytest

import main

CH = 8701
TUNARR_ID = "cccc3333-dddd-4444-eeee-555555555555"
PNG = ("data:image/png;base64,"
       "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
OTHER_PNG = ("data:image/png;base64,"
             "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")

FOLLOW_WM = _json.dumps({
    "enabled": True, "position": "bottom-right", "width": 7.0,
    "vertical_margin": 5.0, "horizontal_margin": 5.0, "duration": 0.0,
    "opacity": 30, "fixed_size": False, "use_channel_icon": True, "fade": None,
})


@pytest.fixture
def channel():
    with main.get_db() as conn:
        conn.execute("DELETE FROM channels WHERE number=?", (CH,))
        conn.execute(
            "INSERT INTO channels (number, name, tier, icon) VALUES (?,?,?,?)",
            (CH, "Icon URL Test", "Galaxy Main", PNG),
        )
        conn.execute("DELETE FROM tunarr_channel_links WHERE channel_number=?", (CH,))
        conn.execute("INSERT INTO tunarr_channel_links VALUES (?,?,?,?)",
                     (CH, TUNARR_ID, "Icon URL Test", CH))
    yield
    with main.get_db() as conn:
        conn.execute("DELETE FROM tunarr_channel_links WHERE channel_number=?", (CH,))
        conn.execute("DELETE FROM channels WHERE number=?", (CH,))


def _mock_tunarr(monkeypatch, uploads: list | None = None):
    """Tunarr that accepts uploads and channel writes."""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path == "/api/upload/image":
            if uploads is not None:
                uploads.append(request)
            return httpx.Response(200, json={"fileUrl": "http://localhost:8000/images/uploads/x.png"})
        if request.url.path == f"/api/channels/{TUNARR_ID}":
            if request.method == "GET":
                return httpx.Response(200, json={"id": TUNARR_ID, "name": "n", "number": CH})
            return httpx.Response(200, json={})
        return httpx.Response(200, json={})

    transport = httpx.MockTransport(handler)
    real = httpx.AsyncClient
    monkeypatch.setattr(main.httpx, "AsyncClient",
                        lambda *a, **kw: real(transport=transport))


def _row(field: str):
    with main.get_db() as conn:
        return conn.execute(f"SELECT {field} FROM channels WHERE number=?", (CH,)).fetchone()[field]


def test_get_reports_icon_and_url(auth_client, channel, monkeypatch):
    _mock_tunarr(monkeypatch)
    r = auth_client.get(f"/api/channels/{CH}/icon")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["icon"] == PNG
    assert body["manual"] is False


def test_setting_an_absolute_url_stores_it_verbatim(auth_client, channel, monkeypatch):
    _mock_tunarr(monkeypatch)
    url = "https://tunarr.example.com/images/uploads/my-logo.png"
    r = auth_client.post(f"/api/channels/{CH}/icon/image", json={"url": url})
    assert r.status_code == 200, r.text
    assert r.json()["icon_url"] == url
    assert r.json()["manual"] is True
    assert _row("icon_url") == url


def test_a_relative_url_is_rejected(auth_client, channel, monkeypatch):
    _mock_tunarr(monkeypatch)
    r = auth_client.post(f"/api/channels/{CH}/icon/image", json={"url": "/images/x.png"})
    assert r.status_code == 400
    assert "absolute" in r.json()["detail"].lower()


def test_a_manual_url_survives_an_icon_change(auth_client, channel, monkeypatch):
    """The whole point of the manual flag. Changing the icon must not silently
    re-upload over a URL the user pointed somewhere on purpose."""
    _mock_tunarr(monkeypatch)
    url = "https://cdn.example.org/logos/galaxy.png"
    auth_client.post(f"/api/channels/{CH}/icon/image", json={"url": url})

    r = auth_client.put(f"/api/channels/{CH}/icon", json={"icon": OTHER_PNG})
    assert r.status_code == 200, r.text
    assert _row("icon_url") == url, "a hand-set icon URL was overwritten by an icon change"
    assert _row("icon") == OTHER_PNG, "the icon itself should still have changed"


def test_a_manual_url_is_what_tunarr_receives(auth_client, channel, monkeypatch):
    url = "https://cdn.example.org/logos/galaxy.png"
    _mock_tunarr(monkeypatch)
    auth_client.post(f"/api/channels/{CH}/icon/image", json={"url": url})

    with main.get_db() as conn:
        ch = dict(conn.execute("SELECT * FROM channels WHERE number=?", (CH,)).fetchone())
    assert main._tunarr_channel_changes(ch)["icon"]["path"] == url


def test_empty_body_re_derives_from_the_icon_and_clears_manual(auth_client, channel,
                                                                monkeypatch):
    _mock_tunarr(monkeypatch)
    auth_client.post(f"/api/channels/{CH}/icon/image",
                     json={"url": "https://cdn.example.org/x.png"})
    assert _row("icon_url_manual") == 1

    r = auth_client.post(f"/api/channels/{CH}/icon/image", json={})
    assert r.status_code == 200, r.text
    assert r.json()["manual"] is False
    assert _row("icon_url_manual") == 0
    assert "/images/uploads/" in _row("icon_url")


def test_uploading_an_image_marks_it_manual(auth_client, channel, monkeypatch):
    """An explicitly supplied image is a deliberate choice too — a later icon
    change should not quietly replace it."""
    _mock_tunarr(monkeypatch)
    r = auth_client.post(f"/api/channels/{CH}/icon/image", json={"image": OTHER_PNG})
    assert r.status_code == 200, r.text
    assert r.json()["manual"] is True


# ── The watermark reuses the icon URL ────────────────────────────────────────

def test_watermark_following_the_icon_reuses_its_url(auth_client, channel, monkeypatch):
    """No second upload, and no copy-paste dance to get a chosen domain onto the
    watermark — setting the icon URL is enough."""
    _mock_tunarr(monkeypatch)
    url = "https://tunarr.example.com/images/uploads/logo.png"
    with main.get_db() as conn:
        conn.execute("UPDATE channels SET watermark=? WHERE number=?", (FOLLOW_WM, CH))
    auth_client.post(f"/api/channels/{CH}/icon/image", json={"url": url})

    assert _row("watermark_image_url") == url


def test_reuse_means_no_duplicate_upload(auth_client, channel, monkeypatch):
    uploads: list = []
    _mock_tunarr(monkeypatch, uploads)
    with main.get_db() as conn:
        conn.execute("UPDATE channels SET watermark=? WHERE number=?", (FOLLOW_WM, CH))

    auth_client.put(f"/api/channels/{CH}/icon", json={"icon": OTHER_PNG})

    icon_uploads = [u for u in uploads if b"linearr-icon-ch" in (u.content or b"")]
    wm_uploads = [u for u in uploads if b"linearr-ch" in (u.content or b"")
                  and b"linearr-icon-ch" not in (u.content or b"")]
    assert len(icon_uploads) >= 1, "the icon itself must still be uploaded"
    assert wm_uploads == [], \
        "the watermark should reuse the icon's uploaded URL, not upload a second copy"


def test_a_watermark_not_following_the_icon_is_untouched(auth_client, channel, monkeypatch):
    """`use_channel_icon` false means a hand-chosen watermark image; setting the
    icon URL must not reach across and clobber it."""
    _mock_tunarr(monkeypatch)
    pasted = "https://cdn.example.com/watermark.png"
    wm = _json.loads(FOLLOW_WM)
    wm["use_channel_icon"] = False
    with main.get_db() as conn:
        conn.execute("UPDATE channels SET watermark=?, watermark_image_url=? WHERE number=?",
                     (_json.dumps(wm), pasted, CH))

    auth_client.post(f"/api/channels/{CH}/icon/image",
                     json={"url": "https://tunarr.example.com/images/uploads/logo.png"})

    assert _row("watermark_image_url") == pasted
