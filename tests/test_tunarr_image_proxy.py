"""`GET /api/tunarr/image` — the browser-facing proxy for Tunarr-hosted images.

`watermark_image_url` is stored as an absolute URL on the Tunarr base
(`http://tunarr:8000/...` by default) because ffmpeg *inside the Tunarr
container* is what fetches it. The user's browser is on the LAN and cannot
resolve that hostname, so the watermark editor's live preview rendered a broken
image on every default Docker deployment. This route fetches server-side instead.

Hardening mirrors `/api/plex/thumb`: only a plain path under Tunarr's `/images/`
directory, the base URL prefixed server-side, no redirects followed.
"""
import httpx
import pytest

import main

_PNG = b"\x89PNG\r\n\x1a\n-fake"


@pytest.fixture
def tunarr_transport(monkeypatch):
    state: dict = {"requests": []}

    def handler(request: httpx.Request) -> httpx.Response:
        state["requests"].append(request)
        if request.url.path == "/images/uploads/logo.png":
            return httpx.Response(200, content=_PNG, headers={"content-type": "image/png"})
        if request.url.path == "/images/uploads/gone.png":
            return httpx.Response(404)
        if request.url.path == "/images/uploads/moved.png":
            return httpx.Response(302, headers={"location": "http://evil.test/x.png"})
        return httpx.Response(418, content=b"should not be reached")

    transport = httpx.MockTransport(handler)
    real_client = httpx.AsyncClient

    def fake_client(**kwargs):
        kwargs.pop("transport", None)
        return real_client(transport=transport, **kwargs)

    monkeypatch.setattr(main.httpx, "AsyncClient", fake_client)
    monkeypatch.setattr(main, "get_tunarr_url", lambda: "http://tunarr:8000")
    return state


def test_requires_auth(client):
    r = client.get("/api/tunarr/image", params={"path": "/images/uploads/logo.png"})
    assert r.status_code == 401


def test_streams_the_bytes_with_long_lived_cache_headers(auth_client, tunarr_transport):
    r = auth_client.get("/api/tunarr/image", params={"path": "/images/uploads/logo.png"})
    assert r.status_code == 200, r.text
    assert r.content == _PNG
    assert r.headers["content-type"] == "image/png"
    assert "immutable" in r.headers["cache-control"]
    assert "max-age=604800" in r.headers["cache-control"]
    # The Tunarr base URL is prefixed server-side, not taken from the caller.
    req = tunarr_transport["requests"][0]
    assert req.url.host == "tunarr" and req.url.port == 8000
    assert req.url.path == "/images/uploads/logo.png"


@pytest.mark.parametrize("bad", [
    "http://evil.test/images/x.png",          # absolute URL
    "https://evil.test/images/x.png",
    "//evil.test/images/x.png",               # protocol-relative
    "/images/../../etc/passwd",               # traversal
    "/images/uploads/../../../secret",
    "images/uploads/logo.png",                # not rooted
    "/api/channels",                          # outside /images/
    "/etc/passwd",
    "/images/x@evil.test/y.png",              # userinfo trick
    "\\images\\uploads\\logo.png",
])
def test_rejects_anything_that_is_not_a_tunarr_image_path(auth_client, tunarr_transport, bad):
    r = auth_client.get("/api/tunarr/image", params={"path": bad})
    assert r.status_code == 400, f"{bad!r} must be rejected, got {r.status_code}"
    assert tunarr_transport["requests"] == [], f"{bad!r} reached the network"


def test_does_not_follow_a_redirect(auth_client, tunarr_transport):
    r = auth_client.get("/api/tunarr/image", params={"path": "/images/uploads/moved.png"})
    assert r.status_code != 200
    # Only the one hop was made — the 302 target was never fetched.
    assert [str(q.url) for q in tunarr_transport["requests"]] == [
        "http://tunarr:8000/images/uploads/moved.png"]


def test_surfaces_an_upstream_404(auth_client, tunarr_transport):
    r = auth_client.get("/api/tunarr/image", params={"path": "/images/uploads/gone.png"})
    assert r.status_code == 404


def test_502_when_tunarr_is_unreachable(auth_client, monkeypatch):
    monkeypatch.setattr(main, "get_tunarr_url", lambda: "http://tunarr:8000")

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route to host")

    transport = httpx.MockTransport(handler)
    real_client = httpx.AsyncClient
    monkeypatch.setattr(main.httpx, "AsyncClient",
                        lambda **kw: real_client(transport=transport,
                                                 **{k: v for k, v in kw.items()
                                                    if k != "transport"}))
    r = auth_client.get("/api/tunarr/image", params={"path": "/images/uploads/logo.png"})
    assert r.status_code == 502


def test_400_when_tunarr_is_not_configured(auth_client, monkeypatch):
    monkeypatch.setattr(main, "get_tunarr_url", lambda: "")
    r = auth_client.get("/api/tunarr/image", params={"path": "/images/uploads/logo.png"})
    assert r.status_code == 400
