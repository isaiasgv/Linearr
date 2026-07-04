"""Thumb proxy performance pipeline: Plex transcoder usage, raw fallback,
in-memory LRU, and dimension clamping."""
import httpx
import pytest

import main


@pytest.fixture(autouse=True)
def _plex_configured_and_clean_cache():
    main._THUMB_CACHE.clear()
    with main.get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_url', 'http://plex.test')")
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_token', 'tok')")
    yield
    main._THUMB_CACHE.clear()
    with main.get_db() as conn:
        conn.execute("DELETE FROM settings WHERE key IN ('plex_url', 'plex_token')")


@pytest.fixture
def plex_transport(monkeypatch):
    """Mock Plex: transcoder works for /library paths, art path must fall back."""
    state = {"requests": []}

    def handler(request: httpx.Request) -> httpx.Response:
        state["requests"].append(request)
        if request.url.path == "/photo/:/transcode":
            inner = request.url.params.get("url", "")
            if "no-transcode" in inner:
                return httpx.Response(404)
            return httpx.Response(200, content=b"small-jpeg",
                                  headers={"content-type": "image/jpeg"})
        return httpx.Response(200, content=b"full-size-original",
                              headers={"content-type": "image/png"})

    transport = httpx.MockTransport(handler)
    real_client = httpx.AsyncClient

    def fake_client(**kwargs):
        kwargs.pop("transport", None)
        return real_client(transport=transport, **kwargs)

    monkeypatch.setattr(main.httpx, "AsyncClient", fake_client)
    return state


def test_thumb_uses_plex_transcoder(auth_client, plex_transport):
    r = auth_client.get("/api/plex/thumb", params={"path": "/library/metadata/1/thumb/2"})
    assert r.status_code == 200
    assert r.content == b"small-jpeg"
    assert r.headers["content-type"] == "image/jpeg"
    assert "immutable" in r.headers["cache-control"]
    req = plex_transport["requests"][0]
    assert req.url.path == "/photo/:/transcode"
    assert req.url.params["url"] == "/library/metadata/1/thumb/2"
    assert req.url.params["width"] == "240" and req.url.params["height"] == "360"
    # Token rides in the header, never the query string.
    assert "X-Plex-Token" in req.headers and "tok" not in str(req.url)


def test_thumb_falls_back_to_raw_when_transcode_fails(auth_client, plex_transport):
    r = auth_client.get("/api/plex/thumb", params={"path": "/library/no-transcode/art"})
    assert r.status_code == 200
    assert r.content == b"full-size-original"
    paths = [q.url.path for q in plex_transport["requests"]]
    assert paths == ["/photo/:/transcode", "/library/no-transcode/art"]


def test_thumb_lru_serves_repeats_without_plex(auth_client, plex_transport):
    for _ in range(3):
        r = auth_client.get("/api/plex/thumb", params={"path": "/library/metadata/9/thumb/1"})
        assert r.status_code == 200
    assert len(plex_transport["requests"]) == 1, "repeat requests must hit the LRU, not Plex"


def test_thumb_clamps_dimensions(auth_client, plex_transport):
    r = auth_client.get("/api/plex/thumb",
                        params={"path": "/library/metadata/2/thumb/1", "w": 99999, "h": 1})
    assert r.status_code == 200
    req = plex_transport["requests"][0]
    assert req.url.params["width"] == "1200"
    assert req.url.params["height"] == "40"


def test_thumb_ssrf_still_rejected(auth_client, plex_transport):
    for bad in ("//evil", "http://evil", "/etc/passwd", "/library/..\\x"):
        r = auth_client.get("/api/plex/thumb", params={"path": bad})
        assert r.status_code == 400, bad
    assert plex_transport["requests"] == []
