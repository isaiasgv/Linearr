"""Auth + session-token hardening."""
import time

import main
from conftest import TEST_PASSWORD, TEST_USERNAME


def test_login_success_sets_cookie(client):
    r = client.post("/api/auth/login", json={"username": TEST_USERNAME, "password": TEST_PASSWORD})
    assert r.status_code == 200
    assert r.json()["ok"] is True
    # The lifetime is reported so the UI can say how long the session lasts.
    assert r.json()["expires_in"] == main.SESSION_REMEMBER_MAX_AGE
    assert "session" in r.cookies


def test_login_wrong_password_401(client):
    r = client.post("/api/auth/login", json={"username": TEST_USERNAME, "password": "nope"})
    assert r.status_code == 401


def test_protected_route_requires_auth(client):
    # Fresh client (no cookie) — /api/* must be denied.
    r = client.get("/api/assignments")
    assert r.status_code == 401


def test_protected_route_with_auth(auth_client):
    r = auth_client.get("/api/assignments")
    assert r.status_code == 200


def test_logout_clears_session(auth_client):
    auth_client.post("/api/auth/logout")
    auth_client.cookies.clear()
    r = auth_client.get("/api/assignments")
    assert r.status_code == 401


def test_session_token_roundtrip():
    tok = main._make_session_token()
    # Returns the claims, not a bool — the middleware needs them to slide the window.
    assert main._verify_session_token(tok) is not None


def test_session_token_tampered_rejected():
    tok = main._make_session_token()
    issued, max_age, nonce, sig = tok.split(".")
    forged = f"{issued}.{max_age}.{nonce}.{'0' * len(sig)}"
    assert main._verify_session_token(forged) is None


def test_session_token_expired_rejected():
    old = int(time.time()) - main.SESSION_MAX_AGE - 10
    nonce = "deadbeef"
    ma = main.SESSION_MAX_AGE
    tok = f"{old}.{ma}.{nonce}.{main._sign_session(old, nonce, ma)}"
    assert main._verify_session_token(tok) is None


def test_session_token_garbage_rejected():
    assert main._verify_session_token(None) is None
    assert main._verify_session_token("") is None
    assert main._verify_session_token("a.b") is None
    assert main._verify_session_token("notanumber.nonce.sig") is None
    # The old three-part shape no longer carries a lifetime.
    assert main._verify_session_token("1700000000.nonce.sig") is None


def test_a_longer_lifetime_cannot_be_forged_by_editing_the_token():
    """`max_age` is carried IN the token so verification knows which window
    applies — so it has to be inside the signature, or anyone could grant
    themselves an unbounded session by editing one character."""
    tok = main._make_session_token(main.SESSION_MAX_AGE)
    issued, _, nonce, sig = tok.split(".")
    upgraded = f"{issued}.{main.SESSION_REMEMBER_MAX_AGE}.{nonce}.{sig}"
    assert main._verify_session_token(upgraded) is None


def test_an_unrecognised_lifetime_is_rejected():
    """Even correctly signed. Only the windows this app issues are acceptable."""
    issued = int(time.time())
    weird = 86400 * 3650
    tok = f"{issued}.{weird}.abc.{main._sign_session(issued, 'abc', weird)}"
    assert main._verify_session_token(tok) is None
