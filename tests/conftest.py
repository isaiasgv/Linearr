"""Test config. Sets a throwaway DB + known credentials BEFORE importing main,
since main reads these from the environment at module import time.
"""
import os
import sys
import tempfile
from pathlib import Path

# Known test credentials/secret (must be set before `import main`).
TEST_USERNAME = "admin"
TEST_PASSWORD = "test-pass-123"
os.environ.setdefault("APP_USERNAME", TEST_USERNAME)
os.environ.setdefault("APP_PASSWORD", TEST_PASSWORD)
os.environ.setdefault("APP_SECRET", "test-secret-deterministic")

# Throwaway DB under the temp dir, fresh per test session.
_DB = Path(tempfile.gettempdir()) / "linearr_pytest.db"
if _DB.exists():
    _DB.unlink()
os.environ["DB_PATH"] = str(_DB)

# Make the repo root importable (main.py lives there).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402


@pytest.fixture()
def client():
    # Context-manager form runs the lifespan (init_db, webhook secret, etc.).
    with TestClient(main.app) as c:
        yield c


@pytest.fixture(autouse=True)
def _reset_login_rate_limit():
    # The login rate limiter is process-global and keys on the TestClient IP; clear it
    # before each test so repeated logins across the suite don't trip the per-window cap.
    main._login_attempts.clear()
    yield


@pytest.fixture()
def auth_client(client):
    r = client.post("/api/auth/login", json={"username": TEST_USERNAME, "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    return client
