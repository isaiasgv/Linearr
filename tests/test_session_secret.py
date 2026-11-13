"""The session secret survives a restart.

Sessions are stateless: the cookie is `<issued>.<nonce>.<HMAC(secret, ...)>` and
nothing about it is stored server-side. So the secret IS the session store — a
new secret invalidates every outstanding cookie at once.

It used to be minted fresh with `secrets.token_hex(32)` on every process start
whenever `APP_SECRET` was unset. `.env` is optional in `docker-compose.yml`
(`required: false`), so that was the ordinary configuration, and the only signal
was a startup log line. Every container restart logged everyone out; anyone
redeploying regularly was logged out on every pull.
"""

import main


def _fresh_secret_resolution(monkeypatch, env_value: str | None):
    """Simulate a process start: clear the cache, set the env, resolve."""
    monkeypatch.setattr(main, "_app_secret_cache", None)
    monkeypatch.setattr(main, "_APP_SECRET_ENV", env_value or "")
    return main._get_app_secret()


def test_secret_is_stable_across_restarts(client, monkeypatch):
    """The regression. Two 'process starts' with no APP_SECRET must agree."""
    with main.get_db() as conn:
        conn.execute("DELETE FROM settings WHERE key='app_secret'")

    first = _fresh_secret_resolution(monkeypatch, None)
    second = _fresh_secret_resolution(monkeypatch, None)

    assert first == second, (
        "the session secret changed between restarts — every existing cookie "
        "just became invalid and every user was logged out"
    )
    assert len(first) == 64


def test_a_cookie_still_verifies_after_a_restart(client, monkeypatch):
    """End to end: issue a token, restart, and it must still be accepted."""
    with main.get_db() as conn:
        conn.execute("DELETE FROM settings WHERE key='app_secret'")

    _fresh_secret_resolution(monkeypatch, None)
    token = main._make_session_token()
    assert main._verify_session_token(token)

    # Restart: cache cleared, secret re-resolved from the database.
    monkeypatch.setattr(main, "_app_secret_cache", None)
    assert main._verify_session_token(token), \
        "a session issued before a restart must survive it"


def test_an_explicit_env_secret_wins(client, monkeypatch):
    """Operators managing the key themselves must not be silently overridden by
    a persisted one — that also keeps multi-instance deployments working."""
    with main.get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('app_secret', 'from-db')")
    assert _fresh_secret_resolution(monkeypatch, "from-the-env") == "from-the-env"


def test_the_shipped_default_is_never_used(client, monkeypatch):
    """`default-secret-change-me` counts as unset. Honouring it would let anyone
    forge HMAC(known_secret, "admin:changeme") against a default install.

    Asserted against the resolver rather than by reloading the module — a reload
    re-runs route registration and the MCP build, which is far more disruption
    than this check is worth.
    """
    with main.get_db() as conn:
        conn.execute("DELETE FROM settings WHERE key='app_secret'")
    # `_APP_SECRET_ENV` is what module import leaves behind once the default has
    # been normalised away, so an empty value is the "default was supplied" case.
    resolved = _fresh_secret_resolution(monkeypatch, "")
    assert resolved != main._DEFAULT_SECRET
    assert len(resolved) == 64, "should fall through to a generated random key"


def test_the_secret_is_not_exposed_by_the_settings_api(auth_client):
    """It lives in the same table as plex_token and openai_api_key, all of which
    the settings endpoint deliberately withholds."""
    body = auth_client.get("/api/settings").json()
    assert "app_secret" not in body
    assert main._get_app_secret() not in str(body)
