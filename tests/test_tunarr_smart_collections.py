"""Regression tests for the Tunarr smart-collection writer.

The real-world failure: Tunarr's API schema names the search field `filter`
and marks it OPTIONAL, so a write body using the wrong key (`query`) passes
validation, returns 2xx, and the smart collection is saved with NO rules.
The writer must therefore verify the response echoes the search object back,
and never trust a bare 2xx.
"""
import httpx
import pytest

import main


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _mock_tunarr(behavior: str):
    """Build a MockTransport imitating Tunarr's smart-collection endpoint.

    behavior:
      'strict-filter'  — accepts `filter`, 500s on `query` (observed live)
      'lenient-drop'   — accepts ANY body with 2xx but only persists `filter`
                         (zod strips unknown keys; filter is optional)
    """
    state = {"posts": [], "puts": []}

    def handler(request: httpx.Request) -> httpx.Response:
        import json
        body = json.loads(request.content or b"{}")
        if request.method == "POST":
            state["posts"].append(body)
        else:
            state["puts"].append(body)
        has_filter = "filter" in body
        has_query = "query" in body
        if behavior == "strict-filter" and has_query and not has_filter:
            return httpx.Response(500, json={"error": "internal"})
        # Persist only the `filter` key — mimic zod stripping unknown fields.
        saved = {
            "uuid": "u-1", "name": body.get("name", "X"), "keywords": "",
        }
        if has_filter:
            saved["filter"] = body["filter"]
            saved["filterString"] = 'tags = "X"'
        return httpx.Response(200 if request.method == "PUT" else 201, json=saved)

    return httpx.MockTransport(handler), state


@pytest.mark.anyio
async def test_writer_sends_filter_first():
    transport, state = _mock_tunarr("strict-filter")
    async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
        resp = await main._tunarr_write_smart_collection(
            client, "http://t.test", "/api/smart_collections",
            name="X", structured=main._tunarr_tags_filter("X"))
    assert resp.status_code == 201
    assert "filter" in state["posts"][0], "must send Tunarr's actual field name first"
    assert resp.json().get("filter"), "rules must be persisted"


@pytest.mark.anyio
async def test_writer_retries_when_2xx_drops_rules():
    """A 2xx that doesn't echo the search object back must trigger a retry,
    and the retry must UPDATE the just-created collection, not POST a duplicate."""
    import json as _j
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = _j.loads(request.content or b"{}")
        calls.append((request.method, request.url.path, body))
        saved = {"uuid": "u-9", "name": body.get("name", "X"), "keywords": ""}
        if "filter" in body:
            saved["filter"] = body["filter"]
        return httpx.Response(201 if request.method == "POST" else 200, json=saved)

    # Force the wrong field first to simulate a Tunarr that drops it silently.
    orig = main._SC_FIELDS
    main._SC_FIELDS = ("query", "filter")
    try:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler),
                                     base_url="http://t.test") as client:
            resp = await main._tunarr_write_smart_collection(
                client, "http://t.test", "/api/smart_collections",
                name="X", structured=main._tunarr_tags_filter("X"))
    finally:
        main._SC_FIELDS = orig

    assert resp.json().get("filter"), "retry must persist the rules"
    assert calls[0][0] == "POST" and "query" in calls[0][2]
    assert calls[1][0] == "PUT" and calls[1][1].endswith("/u-9"), \
        "retry after a rule-dropping POST must update the created uuid, not duplicate"
    assert "filter" in calls[1][2]


@pytest.mark.anyio
async def test_writer_retries_on_500():
    transport, state = _mock_tunarr("strict-filter")
    orig = main._SC_FIELDS
    main._SC_FIELDS = ("query", "filter")  # wrong field first → 500 → retry
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
            resp = await main._tunarr_write_smart_collection(
                client, "http://t.test", "/api/smart_collections",
                name="X", structured=main._tunarr_tags_filter("X"))
    finally:
        main._SC_FIELDS = orig
    assert resp.status_code == 201 and resp.json().get("filter")
    assert "query" in state["posts"][0] and "filter" in state["posts"][1]


def test_tags_filter_shape_matches_tunarr_ui():
    f = main._tunarr_tags_filter("Galaxy ONE Movies")
    assert f["type"] == "value"
    spec = f["fieldSpec"]
    # Tunarr's UI-produced fieldSpec carries BOTH key and name.
    assert spec["key"] == "tags" and spec["name"] == "tags"
    assert spec["op"] == "=" and spec["value"] == ["Galaxy ONE Movies"]


@pytest.mark.anyio
async def test_scan_libraries_foreground():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.url.path, dict(request.url.params)))
        return httpx.Response(200, json={"ok": True})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler),
                                 base_url="http://t.test") as client:
        ok = await main._tunarr_scan_libraries(client, "http://t.test", wait=True)
    assert ok is True
    assert seen[0][0] == "/api/tasks/ScanLibrariesTask/run"
    assert seen[0][1].get("background") == "false", "must wait for the scan (foreground run)"
