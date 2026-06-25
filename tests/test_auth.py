"""Auth + session-token hardening."""
import time

import main
from conftest import TEST_PASSWORD, TEST_USERNAME


def test_login_success_sets_cookie(client):
    r = client.post("/api/auth/login", json={"username": TEST_USERNAME, "password": TEST_PASSWORD})
    assert r.status_code == 200
    assert r.json() == {"ok": True}
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
    assert main._verify_session_token(tok) is True


def test_session_token_tampered_rejected():
    tok = main._make_session_token()
    issued, nonce, sig = tok.split(".")
    forged = f"{issued}.{nonce}.{'0' * len(sig)}"
    assert main._verify_session_token(forged) is False


def test_session_token_expired_rejected():
    old = int(time.time()) - main.SESSION_MAX_AGE - 10
    nonce = "deadbeef"
    tok = f"{old}.{nonce}.{main._sign_session(old, nonce)}"
    assert main._verify_session_token(tok) is False


def test_session_token_garbage_rejected():
    assert main._verify_session_token(None) is False
    assert main._verify_session_token("") is False
    assert main._verify_session_token("a.b") is False
    assert main._verify_session_token("notanumber.nonce.sig") is False
