"""An upstream 401 must never reach the browser as a 401.

The frontend treats **any** 401 as "your Linearr session is gone" and drops you
at the login screen. So a route that forwarded Plex's 401 verbatim logged you
out of Linearr because *Plex's* token had expired — a different problem with a
different fix.

Plex JWT tokens last about 7 days, which is exactly the cadence the logouts
appeared on, and it is why the complaint survived both a persisted session
secret and sliding sessions: neither had anything to do with it.
"""
import httpx
import pytest

import main


def _plex_returning(monkeypatch, status: int):
    """Point Plex at a server that answers every request with `status`."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"error": "nope"})

    transport = httpx.MockTransport(handler)
    real = httpx.AsyncClient
    monkeypatch.setattr(main.httpx, "AsyncClient",
                        lambda *a, **kw: real(transport=transport))
    with main.get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_url', 'http://plex:32400')")
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_token', 'expired-token')")


@pytest.mark.parametrize("upstream", [401, 403])
def test_an_upstream_auth_failure_is_not_a_401(auth_client, monkeypatch, upstream):
    """The regression. A 401 from Linearr must mean one thing only."""
    _plex_returning(monkeypatch, upstream)
    r = auth_client.get("/api/plex/libraries")
    assert r.status_code != 401, (
        "an expired Plex token surfaced as a Linearr 401, which logs the user "
        "out of Linearr entirely"
    )
    assert r.status_code == 502


def test_the_session_survives_an_upstream_auth_failure(auth_client, monkeypatch):
    """End to end: the thing the user actually experiences."""
    _plex_returning(monkeypatch, 401)
    auth_client.get("/api/plex/libraries")
    # Still signed in — the session was never the problem.
    assert auth_client.get("/api/auth/session").json()["authenticated"] is True


def test_meaningful_upstream_statuses_still_pass_through(auth_client, monkeypatch):
    """Only 401/403 are remapped. A 404 from Plex really does mean 'not found',
    and flattening everything to 502 would throw that away."""
    _plex_returning(monkeypatch, 404)
    assert auth_client.get("/api/plex/libraries").status_code == 404


def test_upstream_status_mapping():
    assert main._upstream_status(401) == 502
    assert main._upstream_status(403) == 502
    assert main._upstream_status(404) == 404
    assert main._upstream_status(500) == 500


# ── The session endpoint the client asks for a second opinion ────────────────

def test_session_endpoint_reports_a_live_session(auth_client):
    body = auth_client.get("/api/auth/session").json()
    assert body["authenticated"] is True
    assert body["seconds_remaining"] > 0
    assert body["expires_at"] == body["issued_at"] + body["max_age"]


def test_session_endpoint_never_401s_without_a_cookie(client):
    """It is what the client consults BEFORE deciding it has been logged out, so
    it must not be able to 401 and become part of the problem it diagnoses."""
    client.cookies.clear()
    r = client.get("/api/auth/session")
    assert r.status_code == 200
    assert r.json() == {"authenticated": False}


def test_session_endpoint_reports_the_remember_window(client):
    client.post("/api/auth/login", json={
        "username": "admin", "password": "test-pass-123", "remember": True,
    })
    assert client.get("/api/auth/session").json()["remember"] is True
