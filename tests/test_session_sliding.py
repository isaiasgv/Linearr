"""Sessions slide, and "keep me signed in" picks a longer window.

The lifetime runs from LAST USE, not from login. A fixed window from login
expires mid-session on a schedule that looks arbitrary from the outside: you are
working normally and are suddenly at the login screen. Re-issuing the cookie as
the app is used is what turns "7 days since you logged in" into "7 days since
you last touched it", which for anyone using the app regularly means never.
"""
import time

import conftest
import main


def _login(client, remember=None):
    body = {"username": conftest.TEST_USERNAME, "password": conftest.TEST_PASSWORD}
    if remember is not None:
        body["remember"] = remember
    return client.post("/api/auth/login", json=body)


def _session_cookie(response) -> str | None:
    """The `session` value from a response's Set-Cookie, if it set one."""
    for name, value in response.headers.raw:
        if name.lower() == b"set-cookie" and value.startswith(b"session="):
            return value.decode().split("session=", 1)[1].split(";", 1)[0]
    return None


def test_remember_me_gets_the_long_window(client):
    r = _login(client, remember=True)
    assert r.status_code == 200
    assert r.json()["expires_in"] == main.SESSION_REMEMBER_MAX_AGE
    claims = main._verify_session_token(_session_cookie(r))
    assert claims is not None and claims[1] == main.SESSION_REMEMBER_MAX_AGE


def test_without_remember_me_it_is_the_short_window(client):
    r = _login(client, remember=False)
    assert r.json()["expires_in"] == main.SESSION_MAX_AGE
    claims = main._verify_session_token(_session_cookie(r))
    assert claims is not None and claims[1] == main.SESSION_MAX_AGE


def test_remember_defaults_on_when_the_field_is_absent(client):
    """An older client that does not send the field must not be silently
    downgraded to the short window."""
    assert _login(client).json()["expires_in"] == main.SESSION_REMEMBER_MAX_AGE


def test_a_fresh_cookie_is_not_reissued_on_every_request(client):
    """Refreshing on every call would put a Set-Cookie on every API response for
    no benefit."""
    _login(client)
    r = client.get("/api/channels")
    assert r.status_code == 200
    assert _session_cookie(r) is None


def test_an_ageing_session_is_reissued_on_use(client):
    """The actual sliding behaviour."""
    _login(client, remember=False)
    old_issued = int(time.time()) - main.SESSION_REFRESH_AFTER - 5
    stale = (f"{old_issued}.{main.SESSION_MAX_AGE}.abc."
             f"{main._sign_session(old_issued, 'abc', main.SESSION_MAX_AGE)}")
    client.cookies.set("session", stale)

    r = client.get("/api/channels")
    assert r.status_code == 200
    refreshed = _session_cookie(r)
    assert refreshed is not None, "an ageing session should have been re-issued"

    claims = main._verify_session_token(refreshed)
    assert claims is not None
    assert claims[0] > old_issued, "the new token should be issued now"
    assert claims[1] == main.SESSION_MAX_AGE, "the lifetime must be preserved on refresh"


def test_refresh_preserves_the_remember_window(client):
    """A sliding refresh must not quietly demote a 90-day session to 7 days."""
    old_issued = int(time.time()) - main.SESSION_REFRESH_AFTER - 5
    ma = main.SESSION_REMEMBER_MAX_AGE
    client.cookies.set(
        "session",
        f"{old_issued}.{ma}.abc.{main._sign_session(old_issued, 'abc', ma)}",
    )
    r = client.get("/api/channels")
    claims = main._verify_session_token(_session_cookie(r))
    assert claims is not None and claims[1] == ma


def test_logout_is_never_undone_by_the_refresh(client):
    """Logout runs through the same middleware. Re-issuing the cookie on that
    response would hand it straight back and make logging out do nothing."""
    _login(client)
    old_issued = int(time.time()) - main.SESSION_REFRESH_AFTER - 5
    ma = main.SESSION_REMEMBER_MAX_AGE
    client.cookies.set(
        "session",
        f"{old_issued}.{ma}.abc.{main._sign_session(old_issued, 'abc', ma)}",
    )

    r = client.post("/api/auth/logout")
    assert r.status_code == 200
    # `delete_cookie` writes `session=""`, so a Set-Cookie IS present — what
    # matters is that it clears rather than renews. Asserted on the header the
    # server sent, not on the test client's jar: the jar still holds the cookie
    # this test poked into it directly, which says nothing about the app.
    header = next(
        v.decode() for n, v in r.headers.raw
        if n.lower() == b"set-cookie" and v.startswith(b"session=")
    )
    assert main._verify_session_token(_session_cookie(r).strip('"')) is None, \
        "logout handed back a live session cookie"
    assert "Max-Age=0" in header or "expires=Thu, 01 Jan 1970" in header.lower(), \
        f"logout should expire the cookie, got: {header}"


def test_the_refreshed_cookie_keeps_its_protections(client):
    """Login and the refresh both write the cookie; a refresh that dropped
    HttpOnly or SameSite would weaken every session an hour after creation."""
    old_issued = int(time.time()) - main.SESSION_REFRESH_AFTER - 5
    ma = main.SESSION_MAX_AGE
    client.cookies.set(
        "session",
        f"{old_issued}.{ma}.abc.{main._sign_session(old_issued, 'abc', ma)}",
    )
    r = client.get("/api/channels")
    header = next(
        v.decode() for n, v in r.headers.raw
        if n.lower() == b"set-cookie" and v.startswith(b"session=")
    )
    assert "HttpOnly" in header
    assert "SameSite=lax" in header
    assert f"Max-Age={ma}" in header


def test_an_expired_session_is_still_rejected(client):
    """Sliding must not become immortal — past the window it is over."""
    dead = int(time.time()) - main.SESSION_MAX_AGE - 10
    ma = main.SESSION_MAX_AGE
    client.cookies.set(
        "session", f"{dead}.{ma}.abc.{main._sign_session(dead, 'abc', ma)}"
    )
    assert client.get("/api/channels").status_code == 401
