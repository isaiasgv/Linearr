"""Server-side icon generation, and the icon bugs found while building it.

The renderer (`icon_render`) reproduces the logos on air — measured, not guessed:
at scale 1 "Galaxy Puerto Rico" is 233 x 83 px with "Galaxy" 147 px wide. The
browser generator it replaces stretched every line to the canvas width, which
made the brand about twice the size of the name under it.

Bugs pinned here:

- Creating a channel pushed the raw `data:` icon to Tunarr even after uploading
  it, so XMLTV carried a 200 KB data URI (how CH 132/133 got theirs).
- Editing a channel's icon through `PUT /api/channels/{n}` re-pointed the
  watermark before the new icon was uploaded, leaving it on the old one.
- "Galaxy+ Premieres" split as "Galaxy" over "+ Premieres".
- The pack import cleared `icon_url` but kept `icon_url_manual`, so the
  channel never uploaded again.
- A routine sync replaced logos hand-made in Tunarr's own UI with Linearr's
  `linearr-icon-*` copy.
"""
import base64
import io
import json as _json

import httpx
import pytest
from PIL import Image

import icon_render
import main

CH = 8801
TUNARR_ID = "dddd4444-eeee-5555-ffff-666666666666"
PNG = ("data:image/png;base64,"
       "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
FOLLOW_WM = _json.dumps({
    "enabled": True, "position": "bottom-right", "width": 7.0,
    "vertical_margin": 5.0, "horizontal_margin": 5.0, "duration": 0.0,
    "opacity": 30, "fixed_size": False, "use_channel_icon": True, "fade": None,
})


def _size(png: bytes) -> tuple[int, int]:
    return Image.open(io.BytesIO(png)).size


def _png_bytes(w: int, h: int) -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", (w, h), (255, 0, 0, 255)).save(buf, format="PNG")
    return buf.getvalue()


# ── naming ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("name, expected", [
    ("Galaxy+ Premieres", ("Galaxy+", "Premieres")),
    ("Galaxy Cartoon Network", ("Galaxy", "Cartoon Network")),
    ("galaxy   Comedy", ("galaxy", "Comedy")),
    ("Galaxyland", None),
    ("Galaxy", None),
    ("Cartoon Network", None),
])
def test_split_channel_name(name, expected):
    assert icon_render.split_channel_name(name) == expected


def test_brand_comes_from_tier_when_the_name_has_none():
    assert icon_render.brand_for("Cinema", "Galaxy Premium") == icon_render.IconSpec("Galaxy+", "Cinema")
    assert icon_render.brand_for("Cartoon Network", "Classics") == icon_render.IconSpec("Galaxy", "Cartoon Network")


# ── rendering ─────────────────────────────────────────────────────────────────

def test_scale_one_matches_the_reference_logos():
    # Reference: 233 x 83 (Puerto Rico) and 203 x 83 (Galaxy+ Premieres).
    w, h = _size(icon_render.render_icon(icon_render.brand_for("Galaxy Puerto Rico"), scale=1))
    assert abs(w - 233) <= 4 and abs(h - 83) <= 4
    w, h = _size(icon_render.render_icon(icon_render.brand_for("Galaxy+ Premieres"), scale=1))
    assert abs(w - 203) <= 4 and abs(h - 83) <= 4


def test_brand_keeps_its_natural_width():
    """The old generator stretched "Galaxy" to the name's width. A short name
    must not make the brand bigger, nor a long one."""
    short = _size(icon_render.render_icon(icon_render.IconSpec("Galaxy", ""), scale=1))
    assert abs(short[0] - 147) <= 3


def test_output_scales():
    w1, h1 = _size(icon_render.render_icon(icon_render.brand_for("Galaxy FOX"), scale=1))
    w4, h4 = _size(icon_render.render_icon(icon_render.brand_for("Galaxy FOX"), scale=4))
    assert abs(w4 - 4 * w1) <= 8 and abs(h4 - 4 * h1) <= 8


def test_a_long_name_wraps_to_two_lines():
    one = _size(icon_render.render_icon(icon_render.brand_for("Galaxy Pirates"), scale=1))
    two = _size(icon_render.render_icon(icon_render.brand_for("Galaxy Pirates of the Caribbean"), scale=1))
    assert two[1] > one[1] + 25
    assert two[0] < 147 * icon_render.MAX_NAME_RATIO + 4


def test_logo_art_sits_under_the_brand_at_brand_width():
    spec = icon_render.IconSpec("Galaxy", "ignored")
    # 4:1 art is width-limited: it lands at LOGO_WIDTH_RATIO x the brand.
    w, h = _size(icon_render.render_icon(spec, logo=_png_bytes(400, 100), scale=1))
    assert abs(w - round(146 * icon_render.LOGO_WIDTH_RATIO)) <= 4
    # 1:1 art is height-limited instead, so it never towers over the brand.
    _, h = _size(icon_render.render_icon(spec, logo=_png_bytes(300, 300), scale=1))
    assert h <= 41 + 9 + round(41 * icon_render.LOGO_MAX_HEIGHT_RATIO) + 2


def test_a_flat_logo_is_grown_to_a_readable_height():
    spec = icon_render.IconSpec("Galaxy", "")
    # 10:1, like the Game of Thrones wordmark. At brand width it would be
    # ~17 px tall; it grows (up to LOGO_MAX_WIDTH_RATIO wide) instead.
    w, h = _size(icon_render.render_icon(spec, logo=_png_bytes(1000, 100), scale=1))
    assert h - 41 - 9 >= 25
    assert w <= round(146 * icon_render.LOGO_MAX_WIDTH_RATIO) + 2


def test_an_empty_icon_is_refused():
    with pytest.raises(ValueError):
        icon_render.render_icon(icon_render.IconSpec("", ""))


# ── routes ────────────────────────────────────────────────────────────────────

@pytest.fixture
def channel():
    with main.get_db() as conn:
        conn.execute("DELETE FROM channels WHERE number=?", (CH,))
        conn.execute(
            "INSERT INTO channels (number, name, tier, icon, watermark) VALUES (?,?,?,?,?)",
            (CH, "Galaxy+ Render Test", "Galaxy Premium", PNG, FOLLOW_WM),
        )
        conn.execute("DELETE FROM tunarr_channel_links WHERE channel_number=?", (CH,))
        conn.execute("INSERT INTO tunarr_channel_links VALUES (?,?,?,?)",
                     (CH, TUNARR_ID, "Galaxy+ Render Test", CH))
    yield
    with main.get_db() as conn:
        conn.execute("DELETE FROM tunarr_channel_links WHERE channel_number=?", (CH,))
        conn.execute("DELETE FROM channels WHERE number=?", (CH,))


def _mock_tunarr(monkeypatch, *, current_icon: str = "", writes: list | None = None,
                 creates: list | None = None):
    """A Tunarr that accepts uploads, echoes the uploaded filename back, and
    holds one linked channel whose icon is `current_icon`."""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path == "/api/upload/image":
            body = request.content.decode("latin-1")
            name = body.split('filename="', 1)[1].split('"', 1)[0] if 'filename="' in body else "x.png"
            return httpx.Response(200, json={"fileUrl": f"http://localhost:8000/images/uploads/{name}"})
        if request.url.path == f"/api/channels/{TUNARR_ID}":
            if request.method == "GET":
                return httpx.Response(200, json={"id": TUNARR_ID, "name": "n", "number": CH,
                                                 "icon": {"path": current_icon}})
            if writes is not None:
                writes.append(_json.loads(request.content))
            return httpx.Response(200, json={})
        if request.method == "POST" and request.url.path == "/api/channels":
            body = _json.loads(request.content)
            if creates is not None:
                creates.append(body)
            return httpx.Response(201, json={"id": "new-tunarr-id", "name": body["channel"]["name"],
                                             "number": body["channel"]["number"]})
        return httpx.Response(200, json={})

    transport = httpx.MockTransport(handler)
    real = httpx.AsyncClient
    monkeypatch.setattr(main.httpx, "AsyncClient", lambda *a, **kw: real(transport=transport))

    async def _tc(client, url):
        return "transcode-1"
    monkeypatch.setattr(main, "_tunarr_resolve_transcode_config", _tc)


def _row(number: int, field: str):
    with main.get_db() as conn:
        return conn.execute(f"SELECT {field} FROM channels WHERE number=?", (number,)).fetchone()[field]


def test_render_preview_returns_a_png(auth_client):
    r = auth_client.post("/api/icons/render", json={"name": "Galaxy+ Soles Haven", "scale": 1})
    assert r.status_code == 200
    data = r.json()["icon"]
    assert data.startswith("data:image/png;base64,")
    assert _size(base64.b64decode(data.split(",", 1)[1]))[1] > 60


def test_render_preview_needs_something_to_draw(auth_client):
    assert auth_client.post("/api/icons/render", json={}).status_code == 400


def test_generate_uses_the_channel_name_and_pushes_the_upload(auth_client, channel, monkeypatch):
    writes: list = []
    _mock_tunarr(monkeypatch, writes=writes)
    r = auth_client.post(f"/api/channels/{CH}/icon/generate", json={})
    assert r.status_code == 200, r.text
    url = _row(CH, "icon_url")
    assert f"linearr-icon-ch{CH}-" in url
    assert writes and writes[-1]["icon"]["path"] == url
    # the watermark followed the new icon
    assert _row(CH, "watermark_image_url") == url


def test_generate_reports_a_missing_plex_logo(auth_client, channel, monkeypatch):
    async def _none(key):
        return None
    monkeypatch.setattr(main, "_plex_clear_logo", _none)
    r = auth_client.post(f"/api/channels/{CH}/icon/generate", json={"plex_logo": "123"})
    assert r.status_code == 400
    assert "clear logo" in r.json()["detail"]


def test_create_pushes_the_uploaded_url_not_the_data_uri(auth_client, monkeypatch):
    n = CH + 1
    creates: list = []
    _mock_tunarr(monkeypatch, creates=creates)
    try:
        r = auth_client.post("/api/channels", json={
            "number": n, "name": "Galaxy Futurama", "tier": "Galaxy Main", "auto_icon": True})
        assert r.status_code == 201, r.text
        assert _row(n, "icon").startswith("data:image/png")
        path = creates[-1]["channel"]["icon"]["path"]
        assert path.startswith("http") and f"linearr-icon-ch{n}-" in path
    finally:
        with main.get_db() as conn:
            conn.execute("DELETE FROM tunarr_channel_links WHERE channel_number=?", (n,))
            conn.execute("DELETE FROM channels WHERE number=?", (n,))


def test_editing_the_icon_in_the_form_moves_the_watermark_to_it(auth_client, channel, monkeypatch):
    _mock_tunarr(monkeypatch)
    auth_client.post(f"/api/channels/{CH}/icon/generate", json={"text": "First"})
    first = _row(CH, "icon_url")
    second_icon = auth_client.post("/api/icons/render", json={"name": "Galaxy+ Second"}).json()["icon"]
    r = auth_client.put(f"/api/channels/{CH}", json={
        "number": CH, "name": "Galaxy+ Render Test", "tier": "Galaxy Premium", "icon": second_icon})
    assert r.status_code == 200, r.text
    second = _row(CH, "icon_url")
    assert second != first
    assert _row(CH, "watermark_image_url") == second


def test_a_routine_sync_keeps_a_hand_made_tunarr_icon(auth_client, channel, monkeypatch):
    writes: list = []
    hand_made = "https://tunarr.example.com/images/uploads/1a186c84_icon.png"
    _mock_tunarr(monkeypatch, current_icon=hand_made, writes=writes)
    r = auth_client.post(f"/api/channels/{CH}/sync-tunarr")
    assert r.status_code == 200, r.text
    assert writes[-1]["icon"]["path"] == hand_made


def test_an_explicit_icon_change_replaces_a_hand_made_one(auth_client, channel, monkeypatch):
    writes: list = []
    _mock_tunarr(monkeypatch, current_icon="https://tunarr.example.com/images/uploads/x_icon.png",
                 writes=writes)
    auth_client.post(f"/api/channels/{CH}/icon/generate", json={})
    assert "linearr-icon-ch" in writes[-1]["icon"]["path"]


def test_a_routine_sync_still_updates_linearrs_own_icons(auth_client, channel, monkeypatch):
    writes: list = []
    _mock_tunarr(monkeypatch, current_icon="http://localhost:8000/images/uploads/linearr-icon-ch1-old.png",
                 writes=writes)
    auth_client.post(f"/api/channels/{CH}/sync-tunarr")
    assert writes[-1]["icon"]["path"] != "http://localhost:8000/images/uploads/linearr-icon-ch1-old.png"


def test_pack_import_keeps_a_manual_url_and_clears_a_cached_one(auth_client, channel):
    with main.get_db() as conn:
        conn.execute("UPDATE channels SET icon_url='https://cdn.example.com/a.png', icon_url_manual=1 "
                     "WHERE number=?", (CH,))
    auth_client.post("/api/icons/import", json={"icons": {str(CH): PNG}})
    assert _row(CH, "icon_url") == "https://cdn.example.com/a.png"
    with main.get_db() as conn:
        conn.execute("UPDATE channels SET icon_url='http://localhost:8000/images/uploads/old.png', "
                     "icon_url_manual=0 WHERE number=?", (CH,))
    auth_client.post("/api/icons/import", json={"icons": {str(CH): PNG}})
    assert _row(CH, "icon_url") is None


def test_foreign_icon_detection():
    f = main._tunarr_icon_is_foreign
    assert f({"path": "https://tunarr.oribion.com/images/uploads/1a18_icon.png"})
    assert f({"path": "http://10.0.0.60:8181/images/uploads/GalaxyHarryPotter.png"})
    assert not f({"path": "http://tunarr:8000/images/uploads/linearr-icon-ch104-c7929cdfb5.png"})
    assert not f({"path": "data:image/png;base64,AAAA"})
    assert not f({"path": ""})
    assert not f(None)


def test_container_hostname_asset_base_is_flagged(monkeypatch):
    monkeypatch.setattr(main, "_tunarr_asset_base", lambda: "http://tunarr:8000")
    assert "Docker" in main._asset_base_warning()
    monkeypatch.setattr(main, "_tunarr_asset_base", lambda: "https://tunarr.oribion.com")
    assert main._asset_base_warning() is None
