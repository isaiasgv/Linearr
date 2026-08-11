"""Deleting a Linearr channel deletes the Tunarr channel linked to it.

It used to not. `delete_channel` cleared `tunarr_channel_links` along with every
other referencing table, which severed the link but stranded the actual Tunarr
channel — still in the lineup, still in the guide, and no longer reachable from
Linearr to clean up.

The ordering matters as much as the call: Linearr is authoritative, so its own
delete commits first and the Tunarr request is best-effort afterwards. A Tunarr
failure must be *reported*, never allowed to undo the delete the user asked for.
"""
import httpx
import pytest

import main

CH = 8801
TUNARR_ID = "dddd4444-eeee-5555-ffff-666666666666"


@pytest.fixture
def linked_channel():
    with main.get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO channels (number, name, tier) VALUES (?,?,?)",
            (CH, "Delete Me", "Galaxy Main"),
        )
        conn.execute("DELETE FROM tunarr_channel_links WHERE channel_number=?", (CH,))
        conn.execute("INSERT INTO tunarr_channel_links VALUES (?,?,?,?)",
                     (CH, TUNARR_ID, "Delete Me", CH))
    yield
    with main.get_db() as conn:
        conn.execute("DELETE FROM tunarr_channel_links WHERE channel_number=?", (CH,))
        conn.execute("DELETE FROM channels WHERE number=?", (CH,))


def _mock_tunarr(monkeypatch, handler):
    transport = httpx.MockTransport(handler)
    real = httpx.AsyncClient
    monkeypatch.setattr(main.httpx, "AsyncClient",
                        lambda *a, **kw: real(transport=transport))


def test_delete_removes_the_tunarr_channel(auth_client, linked_channel, monkeypatch):
    seen: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path))
        return httpx.Response(204)

    _mock_tunarr(monkeypatch, handler)

    r = auth_client.delete(f"/api/channels/{CH}")
    assert r.status_code == 200, r.text
    assert r.json()["tunarr"]["deleted"] is True
    assert ("DELETE", f"/api/channels/{TUNARR_ID}") in seen


def test_delete_tunarr_false_keeps_the_tunarr_channel(auth_client, linked_channel,
                                                      monkeypatch):
    seen: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path))
        return httpx.Response(204)

    _mock_tunarr(monkeypatch, handler)

    r = auth_client.delete(f"/api/channels/{CH}?delete_tunarr=false")
    assert r.status_code == 200, r.text
    assert r.json()["tunarr"]["deleted"] is False
    assert not any(m == "DELETE" for m, _ in seen), \
        f"Tunarr must not be called when delete_tunarr=false: {seen}"
    # ...and the local channel is still gone.
    with main.get_db() as conn:
        assert conn.execute("SELECT 1 FROM channels WHERE number=?", (CH,)).fetchone() is None


def test_a_tunarr_failure_does_not_undo_the_local_delete(auth_client, linked_channel,
                                                          monkeypatch):
    """The whole point of committing locally first. A 500 from Tunarr leaves a
    stranded channel there — it must not resurrect the Linearr row."""
    _mock_tunarr(monkeypatch, lambda req: httpx.Response(500, text="boom"))

    r = auth_client.delete(f"/api/channels/{CH}")
    assert r.status_code == 200, r.text
    assert r.json()["tunarr"]["deleted"] is False
    assert "500" in r.json()["tunarr"]["message"]
    with main.get_db() as conn:
        assert conn.execute("SELECT 1 FROM channels WHERE number=?", (CH,)).fetchone() is None


def test_a_tunarr_404_counts_as_deleted(auth_client, linked_channel, monkeypatch):
    """Already gone is the desired end state, not an error to report to someone
    who just asked for it to be deleted."""
    _mock_tunarr(monkeypatch, lambda req: httpx.Response(404, json={}))

    r = auth_client.delete(f"/api/channels/{CH}")
    assert r.json()["tunarr"]["deleted"] is True


def test_unlinked_channel_reports_no_tunarr_result(auth_client, monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"no Tunarr call expected, got {request.url}")

    _mock_tunarr(monkeypatch, handler)
    with main.get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO channels (number, name, tier) VALUES (?,?,?)",
                     (8802, "Unlinked", "Galaxy Main"))
    try:
        r = auth_client.delete("/api/channels/8802")
        assert r.status_code == 200, r.text
        assert r.json()["tunarr"] is None
    finally:
        with main.get_db() as conn:
            conn.execute("DELETE FROM channels WHERE number=?", (8802,))
