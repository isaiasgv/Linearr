"""SSRF, secret masking, webhook auth, security headers."""
import main


def test_health_has_security_headers(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.headers.get("X-Content-Type-Options") == "nosniff"
    assert "Content-Security-Policy" in r.headers


def test_thumb_rejects_ssrf_paths(auth_client):
    for bad in ["@evil.com/x", "//evil.com/x", "http://evil.com", "/etc/passwd",
                "/library/..\\..\\x", "/library/x@evil"]:
        r = auth_client.get("/api/plex/thumb", params={"path": bad})
        assert r.status_code == 400, f"expected 400 for {bad!r}, got {r.status_code}"


def test_settings_masks_secrets(auth_client):
    auth_client.post("/api/settings", json={
        "plex_url": "http://plex:32400",
        "plex_token": "super-secret-token",
        "openai_api_key": "sk-secret",
    })
    r = auth_client.get("/api/settings")
    body = r.json()
    assert body["plex_token"] == ""
    assert body["plex_token_set"] is True
    assert body["openai_api_key"] == ""
    assert body["openai_api_key_set"] is True


def test_settings_keep_existing_on_empty_post(auth_client):
    auth_client.post("/api/settings", json={"plex_url": "http://plex:32400", "plex_token": "keep-me"})
    # Posting an empty token must NOT wipe the stored value.
    auth_client.post("/api/settings", json={"plex_url": "http://plex:32400", "plex_token": ""})
    with main.get_db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key='plex_token'").fetchone()
    assert row["value"] == "keep-me"


def test_webhook_requires_token(client):
    r = client.post("/api/plex/webhook", data={"payload": ""})
    assert r.status_code == 401


def test_webhook_accepts_valid_token(client):
    secret = main._ensure_webhook_secret()
    r = client.post("/api/plex/webhook", params={"token": secret}, data={"payload": ""})
    assert r.status_code == 200
    assert r.json() == {"ok": True}
