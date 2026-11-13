"""Static files under the built frontend are served as files, not as the SPA shell.

The editor fonts are self-hosted (`public/fonts/` → `dist/fonts/`) because the
CSP blocks Google Fonts outright — `style-src 'self'` stops the stylesheet,
`default-src 'self'` stops the woff2 files, and `connect-src 'self'` stops the
fetch used to inline a face for PNG export.

The SPA fallback used to serve only `assets/*` and slash-free root files, so a
request for `/fonts/inter-latin.woff2` fell through and was answered with
`index.html`. That returns 200 with `text/html`, the font fails to parse, and
text silently renders in a fallback face — indistinguishable from the CSP bug
this replaced. Hence a test.
"""
import main


def _dist(tmp_path, monkeypatch):
    """Point the SPA fallback at a throwaway dist tree."""
    dist = tmp_path / "dist"
    (dist / "fonts").mkdir(parents=True)
    (dist / "assets").mkdir()
    (dist / "fonts" / "inter-latin.woff2").write_bytes(b"wOF2fake")
    (dist / "assets" / "index-abc123.js").write_text("console.log(1)")
    (dist / "favicon.svg").write_text("<svg/>")
    (dist / "index.html").write_text("<!doctype html><title>Linearr</title>")
    monkeypatch.setattr(main, "DIST_DIR", dist)
    monkeypatch.setattr(main, "INDEX_HTML", dist / "index.html")
    return dist


def test_fonts_are_served_as_files(auth_client, tmp_path, monkeypatch):
    _dist(tmp_path, monkeypatch)
    r = auth_client.get("/fonts/inter-latin.woff2")
    assert r.status_code == 200
    assert r.content == b"wOF2fake"
    assert "html" not in r.headers.get("content-type", ""), \
        "a font answered with the SPA shell parses as nothing and falls back silently"


def test_hashed_assets_still_served(auth_client, tmp_path, monkeypatch):
    _dist(tmp_path, monkeypatch)
    r = auth_client.get("/assets/index-abc123.js")
    assert r.status_code == 200
    assert r.text == "console.log(1)"


def test_root_level_files_still_served(auth_client, tmp_path, monkeypatch):
    _dist(tmp_path, monkeypatch)
    assert auth_client.get("/favicon.svg").text == "<svg/>"


def test_unknown_route_still_falls_back_to_the_spa(auth_client, tmp_path, monkeypatch):
    _dist(tmp_path, monkeypatch)
    r = auth_client.get("/channels/42")
    assert r.status_code == 200
    assert "<!doctype html>" in r.text.lower()


def test_a_missing_font_does_not_serve_the_shell_as_a_font(auth_client, tmp_path,
                                                            monkeypatch):
    """It falls through to the SPA — acceptable for a typo'd URL, but it must be
    an HTML document, never a 200 pretending to be a font."""
    _dist(tmp_path, monkeypatch)
    r = auth_client.get("/fonts/does-not-exist.woff2")
    assert "<!doctype html>" in r.text.lower()


def test_traversal_out_of_dist_is_refused(auth_client, tmp_path, monkeypatch):
    """`full_path` comes from the URL, so the resolved path is what matters."""
    dist = _dist(tmp_path, monkeypatch)
    secret = tmp_path / "secret.txt"
    secret.write_text("PLEX_TOKEN=hunter2")
    r = auth_client.get("/assets/../../secret.txt")
    assert "hunter2" not in r.text
    assert (dist / "index.html").read_text() in r.text or r.status_code == 404
