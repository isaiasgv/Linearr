# Tunarr Foundation + Watermark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Linearr's broken Tunarr channel-write path and add complete per-channel watermark support with a live preview.

**Architecture:** Route every Tunarr channel write through one canonical read-modify-write helper (`_tunarr_save_channel`), because Tunarr's `PUT /api/channels/:id` requires the full `SaveableChannel` object and rejects partials. Watermark config is stored as a JSON blob on `channels` (the schema is identical across all supported Tunarr versions, so there is nothing to normalize) plus a cached hosted-image URL, since Tunarr feeds the watermark image to ffmpeg as an HTTP input and cannot read the base64 data URIs Linearr stores icons as.

**Tech Stack:** Python 3.12 / FastAPI / httpx / SQLite; React 18 + Vite + TypeScript, Zustand + TanStack React Query, Tailwind CSS v4. Tests: pytest + `httpx.MockTransport`.

## Global Constraints

- Tunarr support floor is `TUNARR_MIN_VERSION` (1.2.10); tested against 1.3.6. Support is a floor, not a ceiling.
- Watermark schema is **byte-identical from Tunarr v1.0.0 → v1.3.9** — one payload works for all; do not version-shim it.
- Tunarr route prefix is `/api`. `/api/smart_collections` is **underscored in all supported versions**; the hyphen variant does not exist.
- `POST /api/channels` takes **only** `{"type":"new","channel":{…}}` in every 1.x release. No flat form exists.
- `PUT /api/channels/:id` takes the **full** `SaveableChannel`. Only `onDemand` is partial.
- `id` is required by Tunarr's schema but ignored by the server (it generates its own uuid).
- Read-only keys Tunarr strips on write: `programCount`, `transcoding`, `sessions`, `fallback`.
- Never compute `guideMinimumDuration` (inconsistent unit inside Tunarr) or `duration` (server-maintained) — always echo back the existing value.
- Duplicate channel `number` returns **HTTP 500, not 409**. There is no 409 anywhere in Tunarr's channel API.
- Watermark validation: `width` strictly `> 0`; `opacity` an **integer** 0–100; margins 0–100; `duration >= 0`; `fadeConfig[0].periodMins >= 1`.
- Only `fadeConfig[0]` is ever applied by Tunarr. `fadeConfig[].programType` and `watermark.animated` are never read by any pipeline builder.
- Watermark `url` must be an **absolute** URL. No data-URI support, no relative paths.
- Schema migrations use `ALTER TABLE … ADD COLUMN` in `try/except sqlite3.OperationalError`. Never recreate tables.
- Thumbnails must stay transcoded via `/api/plex/thumb` with `w`/`h`; do not regress the performance invariants in CLAUDE.md.

---

### Task 1: Resolve a valid Tunarr transcode config id

Tunarr 1.3.x validates `transcodeConfigId` as `z.uuid()` **and** checks existence — both 400 on failure. Linearr currently reads `/api/ffmpeg-settings` and can end up with the literal string `"default"` (`main.py:4458`) or `None`. When it is `None`, the builder falls back to `obj["transcoding"] = {...}` (`main.py:4290-4291`), but `transcoding` is read-only/stripped while `transcodeConfigId` is required — so the create is a guaranteed 400.

**Files:**
- Modify: `main.py` (add helper next to `_tunarr_channel_obj`, ~line 4262)
- Test: `tests/test_tunarr_channel_writer.py` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `async def _tunarr_resolve_transcode_config(client: httpx.AsyncClient, url: str) -> str | None` — returns a transcode-config uuid string, or `None` if none can be resolved.

- [ ] **Step 1: Write the failing test**

Create `tests/test_tunarr_channel_writer.py`:

```python
"""Tests for the canonical Tunarr channel writer.

Tunarr's PUT /api/channels/:id takes the FULL SaveableChannel — a partial body
is a 400. These tests pin the read-modify-write behavior and the transcode
config resolution that a create needs to be valid on 1.3.x (where
transcodeConfigId is z.uuid() and must exist).
"""
import json

import httpx
import pytest

import main


@pytest.fixture
def anyio_backend():
    return "asyncio"


TC_UUID = "11111111-2222-3333-4444-555555555555"


@pytest.mark.anyio
async def test_resolve_transcode_config_prefers_transcode_configs_route():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/transcode_configs":
            return httpx.Response(200, json=[
                {"id": TC_UUID, "name": "Default", "isDefault": True},
            ])
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
        got = await main._tunarr_resolve_transcode_config(client, "http://t.test")
    assert got == TC_UUID


@pytest.mark.anyio
async def test_resolve_transcode_config_picks_default_over_first():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/transcode_configs":
            return httpx.Response(200, json=[
                {"id": "aaaaaaaa-0000-0000-0000-000000000000", "name": "Other"},
                {"id": TC_UUID, "name": "Default", "isDefault": True},
            ])
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
        got = await main._tunarr_resolve_transcode_config(client, "http://t.test")
    assert got == TC_UUID


@pytest.mark.anyio
async def test_resolve_transcode_config_falls_back_to_ffmpeg_settings():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/transcode_configs":
            return httpx.Response(404)
        if request.url.path == "/api/ffmpeg-settings":
            return httpx.Response(200, json={"defaultTranscodeConfigId": TC_UUID})
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
        got = await main._tunarr_resolve_transcode_config(client, "http://t.test")
    assert got == TC_UUID


@pytest.mark.anyio
async def test_resolve_transcode_config_never_returns_a_non_uuid():
    """The old code could yield the literal 'default', which Tunarr 1.3 rejects."""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/transcode_configs":
            return httpx.Response(200, json=[{"id": "default", "name": "Bogus"}])
        if request.url.path == "/api/ffmpeg-settings":
            return httpx.Response(200, json={})
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
        got = await main._tunarr_resolve_transcode_config(client, "http://t.test")
    assert got is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_tunarr_channel_writer.py -v`
Expected: FAIL — `AttributeError: module 'main' has no attribute '_tunarr_resolve_transcode_config'`

- [ ] **Step 3: Write the implementation**

In `main.py`, immediately **above** `def _tunarr_icon_obj(` (currently line 4262), insert:

```python
_UUID_RE = _re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


async def _tunarr_resolve_transcode_config(
    client: "httpx.AsyncClient", url: str
) -> str | None:
    """Resolve a transcode-config uuid Tunarr will actually accept.

    Tunarr 1.3.x validates `transcodeConfigId` as a uuid AND checks it exists;
    both failures are a 400. Prefers the config flagged default, else the first
    one with a uuid-shaped id, else `/api/ffmpeg-settings`. Returns None rather
    than a bogus value — the caller must not send a non-uuid.
    """
    def _uuid_or_none(value) -> str | None:
        return value if isinstance(value, str) and _UUID_RE.match(value) else None

    try:
        r = await client.get(f"{url}/api/transcode_configs")
        if r.status_code == 200:
            data = r.json()
            configs = data if isinstance(data, list) else data.get("data", [])
            if isinstance(configs, list) and configs:
                for cfg in configs:
                    if isinstance(cfg, dict) and cfg.get("isDefault"):
                        found = _uuid_or_none(cfg.get("id"))
                        if found:
                            return found
                for cfg in configs:
                    if isinstance(cfg, dict):
                        found = _uuid_or_none(cfg.get("id"))
                        if found:
                            return found
    except Exception as e:
        log.debug("transcode_configs lookup failed: %s", e)

    try:
        r = await client.get(f"{url}/api/ffmpeg-settings")
        if r.status_code == 200:
            fj = r.json()
            if isinstance(fj, dict):
                for key in ("defaultTranscodeConfigId", "transcodeConfigId", "configId", "id"):
                    found = _uuid_or_none(fj.get(key))
                    if found:
                        return found
    except Exception as e:
        log.debug("ffmpeg-settings lookup failed: %s", e)

    return None
```

Verify `_re` is already the module-level alias for `re` in `main.py` (it is — used by `_FILTER_STRING_RE` at `main.py:5272`). If not, add `import re as _re` to the imports.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_tunarr_channel_writer.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add main.py tests/test_tunarr_channel_writer.py
git commit -m "fix(tunarr): resolve a real transcode config uuid for channel writes

Tunarr 1.3.x validates transcodeConfigId as z.uuid() and checks existence.
The old lookup read /api/ffmpeg-settings and could yield the literal string
'default' or None, both of which produce a 400 on create."
```

---

### Task 2: Canonical read-modify-write channel writer

The core fix. `_sync_channel_to_tunarr` PUTs only `{name, number, groupTitle, icon}` (`main.py:614-622`), but `SaveableChannel` is not partial — every required scalar is missing, so Tunarr returns 400 and channel metadata never propagates.

**Files:**
- Modify: `main.py` (add helper after `_tunarr_create_channel`, ~line 4308)
- Test: `tests/test_tunarr_channel_writer.py` (append)

**Interfaces:**
- Consumes: nothing from Task 1 (independent).
- Produces: `async def _tunarr_save_channel(client, url, tunarr_id: str, changes: dict) -> httpx.Response` — GETs the channel, strips read-only keys, applies `changes`, PUTs the full object. Returns the PUT response, or the failing GET response if the read fails.
- Produces: `_TUNARR_READONLY_CHANNEL_KEYS: frozenset[str]`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_tunarr_channel_writer.py`:

```python
CH_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

# A realistic full channel as Tunarr's GET returns it, including the read-only
# keys that must be stripped before a PUT.
def _existing_channel() -> dict:
    return {
        "id": CH_UUID,
        "name": "Old Name",
        "number": 101,
        "groupTitle": "Galaxy Main",
        "duration": 86400000,
        "startTime": 1700000000000,
        "stealth": False,
        "disableFillerOverlay": True,
        "guideMinimumDuration": 30000,
        "streamMode": "hls",
        "subtitlesEnabled": False,
        "transcodeConfigId": TC_UUID,
        "icon": {"path": "", "width": 0, "duration": 0, "position": "bottom-right"},
        "offline": {"mode": "pic"},
        "onDemand": {"enabled": False},
        # read-only — Tunarr strips these, we must not send them
        "programCount": 42,
        "transcoding": {"targetResolution": "1920x1080"},
        "sessions": [{"id": "s1"}],
        "fallback": [{"id": "p1"}],
    }


def _mock_channel_server(existing: dict | None = None, put_status: int = 200):
    """MockTransport serving GET/PUT for one channel. Records the PUT body."""
    state: dict = {"put_body": None, "gets": 0, "puts": 0}
    current = existing if existing is not None else _existing_channel()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path == f"/api/channels/{CH_UUID}":
            state["gets"] += 1
            return httpx.Response(200, json=current)
        if request.method == "PUT" and request.url.path == f"/api/channels/{CH_UUID}":
            state["puts"] += 1
            state["put_body"] = json.loads(request.content or b"{}")
            if put_status != 200:
                return httpx.Response(put_status, json={})
            merged = {**current, **state["put_body"]}
            return httpx.Response(200, json=merged)
        return httpx.Response(404, json={})

    return httpx.MockTransport(handler), state


REQUIRED_SAVEABLE_KEYS = [
    "id", "name", "number", "groupTitle", "duration", "startTime", "stealth",
    "disableFillerOverlay", "guideMinimumDuration", "streamMode",
    "subtitlesEnabled", "transcodeConfigId", "icon", "offline",
]


@pytest.mark.anyio
async def test_save_channel_sends_every_required_key():
    """Regression: the old code PUT only 4 keys and Tunarr 400'd."""
    transport, state = _mock_channel_server()
    async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
        r = await main._tunarr_save_channel(
            client, "http://t.test", CH_UUID, {"name": "New Name"})
    assert r.status_code == 200
    body = state["put_body"]
    for key in REQUIRED_SAVEABLE_KEYS:
        assert key in body, f"required key {key!r} missing from PUT body"


@pytest.mark.anyio
async def test_save_channel_applies_changes_and_preserves_the_rest():
    transport, state = _mock_channel_server()
    async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
        await main._tunarr_save_channel(
            client, "http://t.test", CH_UUID,
            {"name": "New Name", "number": 205, "groupTitle": "Classics"})
    body = state["put_body"]
    assert body["name"] == "New Name"
    assert body["number"] == 205
    assert body["groupTitle"] == "Classics"
    # untouched values echoed back verbatim — never recomputed
    assert body["duration"] == 86400000
    assert body["startTime"] == 1700000000000
    assert body["guideMinimumDuration"] == 30000
    assert body["transcodeConfigId"] == TC_UUID


@pytest.mark.anyio
async def test_save_channel_strips_readonly_keys():
    transport, state = _mock_channel_server()
    async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
        await main._tunarr_save_channel(
            client, "http://t.test", CH_UUID, {"name": "X"})
    body = state["put_body"]
    for key in ("programCount", "transcoding", "sessions", "fallback"):
        assert key not in body, f"read-only key {key!r} must not be sent"


@pytest.mark.anyio
async def test_save_channel_returns_get_failure_without_putting():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
        r = await main._tunarr_save_channel(
            client, "http://t.test", CH_UUID, {"name": "X"})
    assert r.status_code == 404


@pytest.mark.anyio
async def test_save_channel_surfaces_a_500_as_is():
    """Tunarr returns 500 (not 409) for a duplicate number, with an empty body."""
    transport, state = _mock_channel_server(put_status=500)
    async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
        r = await main._tunarr_save_channel(
            client, "http://t.test", CH_UUID, {"number": 999})
    assert r.status_code == 500
    assert state["puts"] == 1
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_tunarr_channel_writer.py -v -k save_channel`
Expected: FAIL — `AttributeError: module 'main' has no attribute '_tunarr_save_channel'`

- [ ] **Step 3: Write the implementation**

In `main.py`, immediately **after** `_tunarr_create_channel` ends (currently line 4308, before `class TunarrTestIn`), insert:

```python
# Tunarr's ChannelSchema exposes these but SaveableChannel omits them — they are
# stripped by its zod object, so sending them is harmless but pointless. We drop
# them explicitly so a read-modify-write PUT carries only writable fields.
_TUNARR_READONLY_CHANNEL_KEYS = frozenset(
    {"programCount", "transcoding", "sessions", "fallback", "programs"}
)


async def _tunarr_save_channel(
    client: "httpx.AsyncClient", url: str, tunarr_id: str, changes: dict
) -> "httpx.Response":
    """Update a Tunarr channel by read-modify-write.

    Tunarr's `PUT /api/channels/:id` body is the FULL SaveableChannel — only
    `onDemand` is partial — so a body carrying just the changed keys is a 400.
    Read the channel, apply `changes`, and write the whole object back.

    Values we do not touch are echoed verbatim, which is required for
    `guideMinimumDuration` (whose unit is inconsistent inside Tunarr) and
    `duration` (server-maintained; sending 0 zeroes it).

    Returns the PUT response, or the failing GET response when the read fails
    (so the caller sees one status either way).
    """
    r = await client.get(f"{url}/api/channels/{tunarr_id}")
    if r.status_code != 200:
        return r
    try:
        current = r.json()
    except Exception:
        return r
    if not isinstance(current, dict):
        return r

    payload = {k: v for k, v in current.items() if k not in _TUNARR_READONLY_CHANNEL_KEYS}
    payload.update(changes)
    payload.setdefault("id", tunarr_id)
    return await client.put(f"{url}/api/channels/{tunarr_id}", json=payload)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_tunarr_channel_writer.py -v`
Expected: 9 passed

- [ ] **Step 5: Commit**

```bash
git add main.py tests/test_tunarr_channel_writer.py
git commit -m "fix(tunarr): channel updates need the full object, not a partial

Tunarr's PUT /api/channels/:id validates the body as the complete
SaveableChannel (only onDemand is partial), so Linearr's 4-key partial PUT
was rejected with 400 and channel metadata never reached Tunarr. Add a
read-modify-write writer that echoes untouched fields back verbatim."
```

---

### Task 3: Route the sync path through the new writer

**Files:**
- Modify: `main.py:599-665` (`_sync_channel_to_tunarr`)
- Modify: `main.py:4268-4292` (`_tunarr_channel_obj` — drop the `transcoding` fallback)
- Modify: `main.py:4294-4308` (`_tunarr_create_channel` — drop the dead flat fallback)
- Modify: `main.py:4450-4495` (`tunarr_create_channel` — use the resolver)
- Test: `tests/test_tunarr_channel_writer.py` (append)

**Interfaces:**
- Consumes: `_tunarr_resolve_transcode_config` (Task 1), `_tunarr_save_channel` (Task 2).
- Produces: `_sync_channel_to_tunarr` unchanged signature/return contract
  (`{"synced": bool, "action": "updated"|"created"|"error", …}`).

- [ ] **Step 1: Write the failing test**

Append to `tests/test_tunarr_channel_writer.py`:

```python
@pytest.mark.anyio
async def test_channel_obj_never_sends_readonly_transcoding():
    """`transcoding` is read-only in SaveableChannel; sending it instead of
    transcodeConfigId produced an invalid create body."""
    obj = main._tunarr_channel_obj(
        name="X", number=1, group_title="G", transcode_id=None)
    assert "transcoding" not in obj


def test_create_body_is_always_the_discriminated_union():
    """No flat-object create form exists in any supported Tunarr version."""
    import inspect
    src = inspect.getsource(main._tunarr_create_channel)
    assert '"type": "new"' in src
    assert "flat" not in src.lower()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_tunarr_channel_writer.py -v -k "readonly_transcoding or discriminated"`
Expected: FAIL — `assert 'transcoding' not in obj` fails, and `assert "flat" not in src.lower()` fails

- [ ] **Step 3a: Drop the `transcoding` fallback from the builder**

In `main.py`, replace lines 4286-4292 (the tail of `_tunarr_channel_obj`):

```python
    if channel_id:
        obj["id"] = channel_id
    if transcode_id:
        obj["transcodeConfigId"] = transcode_id
    else:
        obj["transcoding"] = {"targetResolution": "1920x1080"}
    return obj
```

with:

```python
    if channel_id:
        obj["id"] = channel_id
    if transcode_id:
        obj["transcodeConfigId"] = transcode_id
    # No `transcoding` fallback: it is read-only in Tunarr's SaveableChannel
    # (stripped on write) while transcodeConfigId is required. Sending it in
    # place of a real config id guarantees a 400 — the caller must resolve one
    # via _tunarr_resolve_transcode_config.
    return obj
```

Also add `watermark` support now, since Task 7 needs it. Change the signature (line 4268-4270) from:

```python
def _tunarr_channel_obj(*, name: str, number: int, group_title: str,
                        channel_id: str | None = None, transcode_id: str | None = None,
                        icon_data: str | None = None) -> dict:
```

to:

```python
def _tunarr_channel_obj(*, name: str, number: int, group_title: str,
                        channel_id: str | None = None, transcode_id: str | None = None,
                        icon_data: str | None = None,
                        watermark: dict | None = None) -> dict:
```

and immediately before `if channel_id:` add:

```python
    if watermark is not None:
        obj["watermark"] = watermark
```

- [ ] **Step 3b: Drop the dead flat-create fallback**

Replace `_tunarr_create_channel` (`main.py:4294-4308`) entirely with:

```python
async def _tunarr_create_channel(client: "httpx.AsyncClient", url: str, channel_obj: dict):
    """POST a new channel.

    Tunarr's create body is a discriminated union — `{"type":"new","channel":{…}}`
    — in every 1.x release (verified against v1.0.0 through v1.3.9); there has
    never been a flat-object form. The client must supply `channel.id` because
    the schema requires it, but Tunarr ignores the value and assigns its own
    uuid, so the real id must be read from the response.
    """
    obj = dict(channel_obj)
    obj.setdefault("id", str(uuid.uuid4()))
    return await client.post(f"{url}/api/channels", json={"type": "new", "channel": obj})
```

- [ ] **Step 3c: Rewrite the sync helper's update + create branches**

In `main.py`, replace the body of `_sync_channel_to_tunarr` from `    # Build metadata payload for Tunarr` (line 613) through the end of the `try` block (line 662) with:

```python
    # Only the keys Linearr owns; _tunarr_save_channel preserves everything else.
    changes = {
        "name": ch.get("name", ""),
        "number": ch.get("number", 0),
        "groupTitle": ch.get("tier", "Linearr"),
    }
    icon_data = ch.get("icon")
    if icon_data and icon_data.startswith("data:"):
        changes["icon"] = _tunarr_icon_obj(icon_data)
    watermark = _watermark_for_tunarr(ch)
    if watermark is not None:
        changes["watermark"] = watermark

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            if link:
                tunarr_id = link["tunarr_id"]
                r = await _tunarr_save_channel(client, url, tunarr_id, changes)
                if r.status_code in (200, 204):
                    with get_db() as conn:
                        conn.execute(
                            "UPDATE tunarr_channel_links SET tunarr_name=?, tunarr_number=? WHERE channel_number=?",
                            (ch.get("name"), ch.get("number"), channel_number)
                        )
                    return {"synced": True, "action": "updated", "tunarr_id": tunarr_id}
                # Tunarr has no 409 — a duplicate number surfaces as a 500 with
                # an empty body, so say so rather than reporting a bare status.
                hint = (" — the channel number may already be in use in Tunarr"
                        if r.status_code >= 500 else "")
                return {"synced": False, "action": "error",
                        "message": f"Tunarr {r.status_code}{hint}"}
            else:
                transcode_id = await _tunarr_resolve_transcode_config(client, url)
                channel_obj = _tunarr_channel_obj(
                    name=ch.get("name", ""),
                    number=ch.get("number", 0),
                    group_title=ch.get("tier", "Linearr"),
                    transcode_id=transcode_id,
                    icon_data=icon_data if (icon_data and icon_data.startswith("data:")) else None,
                    watermark=watermark,
                )
                r = await _tunarr_create_channel(client, url, channel_obj)
                if r.status_code in (200, 201):
                    new_ch = r.json()
                    with get_db() as conn:
                        conn.execute(
                            "INSERT OR REPLACE INTO tunarr_channel_links VALUES (?,?,?,?)",
                            (channel_number, new_ch["id"], new_ch.get("name"), new_ch.get("number"))
                        )
                    return {"synced": True, "action": "created", "tunarr_id": new_ch["id"]}
                hint = (" — the channel number may already be in use in Tunarr"
                        if r.status_code >= 500 else "")
                return {"synced": False, "action": "error",
                        "message": f"Tunarr {r.status_code}{hint}"}
```

`_watermark_for_tunarr` is defined in Task 7. To keep this task independently green, add this temporary stub directly above `_sync_channel_to_tunarr` (Task 7 replaces it):

```python
def _watermark_for_tunarr(ch: dict) -> dict | None:
    """Watermark payload for a channel row, or None when unset. Task 7 fills this in."""
    return None
```

- [ ] **Step 3d: Use the resolver in the standalone create route**

In `main.py`, replace lines 4456-4481 (the transcode-id discovery inside `tunarr_create_channel`) with:

```python
    async with httpx.AsyncClient(timeout=15.0) as client:
        transcode_id = await _tunarr_resolve_transcode_config(client, url)
```

Keep the `icon_in`/`channel_obj`/`_tunarr_create_channel` lines that follow.

- [ ] **Step 4: Run the full backend suite**

Run: `python -m pytest tests/ -v`
Expected: all pass, including the 11 tests in `tests/test_tunarr_channel_writer.py`

- [ ] **Step 5: Commit**

```bash
git add main.py tests/test_tunarr_channel_writer.py
git commit -m "fix(tunarr): route channel writes through the read-modify-write writer

- update path now sends the full object (was a rejected 4-key partial)
- create resolves a real transcode config uuid and never sends read-only
  \`transcoding\`
- drop the dead flat-create fallback (no Tunarr 1.x accepts a flat body)
- report a 5xx on write as a probable channel-number conflict, since Tunarr
  has no 409"
```

---

### Task 4: Remove the dead smart-collections hyphen fallback

`/api/smart_collections` is underscored in v1.2.10 **and** v1.3.6; the hyphen variant has never existed, so the 404 retry is dead code that doubles latency on every list call.

**Files:**
- Modify: `main.py:5232-5246` (`tunarr_list_smart_collections`), `main.py:5459-5472` (the `sc_path` probe in `tunarr_sync_collections`)
- Modify: `CLAUDE.md` (correct the note)
- Test: `tests/test_tunarr_smart_collections.py` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: no new symbols; `_TUNARR_SC_PATH = "/api/smart_collections"` module constant.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_tunarr_smart_collections.py`:

```python
@pytest.mark.anyio
async def test_smart_collections_path_is_underscored_only():
    """The hyphen route does not exist in any supported Tunarr version."""
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        return httpx.Response(200, json=[])

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://t.test") as client:
        await client.get(f"http://t.test{main._TUNARR_SC_PATH}")

    assert seen == ["/api/smart_collections"]
    assert main._TUNARR_SC_PATH == "/api/smart_collections"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/test_tunarr_smart_collections.py -v -k underscored`
Expected: FAIL — `AttributeError: module 'main' has no attribute '_TUNARR_SC_PATH'`

- [ ] **Step 3: Write the implementation**

In `main.py`, directly above `@app.get("/api/tunarr/smart-collections")` (line 5232), add:

```python
# Tunarr's smart-collections route is underscored in every supported version
# (verified in server/src/api/smartCollectionsApi.ts at v1.2.10 and v1.3.6).
# There is no hyphenated alias — a wrong separator is a plain 404.
_TUNARR_SC_PATH = "/api/smart_collections"
```

Replace the body of `tunarr_list_smart_collections` (lines 5234-5246) with:

```python
    url = get_tunarr_url()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{url}{_TUNARR_SC_PATH}")
        if r.status_code != 200:
            raise HTTPException(r.status_code, f"Tunarr error: {r.text[:200]}")
        return r.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Cannot reach Tunarr: {e}")
```

In `tunarr_sync_collections`, replace lines 5461-5472 (the `sc_path` probe) with:

```python
    sc_path = _TUNARR_SC_PATH
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{url}{sc_path}")
        existing = r.json() if r.status_code == 200 else []
    except Exception as e:
        log.warning("Failed to fetch Tunarr smart collections: %s", e)
        raise HTTPException(502, f"Cannot reach Tunarr smart collections API: {e}")
```

Replace the hardcoded `"/api/smart_collections"` strings at the `_tunarr_write_smart_collection` call sites in `tunarr_create_smart_collection` (line 5311) and `tunarr_update_smart_collection` (line 5331) with `_TUNARR_SC_PATH`, and the `tunarr_delete_smart_collection` URL (line 5357) with `f"{url}{_TUNARR_SC_PATH}/{sc_id}"`.

- [ ] **Step 4: Run the tests**

Run: `python -m pytest tests/test_tunarr_smart_collections.py -v`
Expected: all pass

- [ ] **Step 5: Update CLAUDE.md**

In `CLAUDE.md`, in the Tunarr version-support blockquote, replace the sentence beginning
"The smart-collection search body field is **`filter`**" so the route note reads:

```markdown
> **`/api/smart_collections` is underscored in every supported version** (verified in
> Tunarr's `smartCollectionsApi.ts` at v1.2.10 and v1.3.6) — there is no hyphenated
> alias, so a wrong separator is a plain 404. The smart-collection search body field is
> **`filter`** (all versions; `query` is only Tunarr's DB column) and it's optional in
> Tunarr's schema — so writes must verify the response echoes the rules back, not just
> trust a 2xx (`_tunarr_write_smart_collection` retries with the other field name on
> 400/422/500 **or** a rule-dropping 2xx).
```

- [ ] **Step 6: Commit**

```bash
git add main.py tests/test_tunarr_smart_collections.py CLAUDE.md
git commit -m "refactor(tunarr): drop the dead smart-collections hyphen fallback

/api/smart_collections is underscored in v1.2.10 and v1.3.6 alike; the
hyphenated route has never existed, so the 404 retry only added latency."
```

---

### Task 5: Watermark storage + validation + CRUD routes

**Files:**
- Modify: `main.py` (migration block near `main.py:257-260`; models near `main.py:513`; routes after the channel-icon routes, ~`main.py:748`)
- Test: `tests/test_watermark.py` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class WatermarkFade(BaseModel)`: `period_mins: int`, `leading_edge: bool = True`
  - `class WatermarkIn(BaseModel)`: `enabled: bool`, `url: str | None`, `position: str`, `width: float`, `vertical_margin: float`, `horizontal_margin: float`, `duration: float`, `opacity: int`, `fixed_size: bool`, `fade: WatermarkFade | None`
  - `def _watermark_to_tunarr(wm: dict, image_url: str | None) -> dict`
  - Routes `GET|PUT|DELETE /api/channels/{channel_number}/watermark`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_watermark.py`:

```python
"""Watermark config: storage, validation, and the Tunarr payload mapping.

Validation mirrors Tunarr's real zod constraints so users get a clear message
instead of an opaque 400 from Tunarr:
  width strictly > 0, opacity an integer 0-100, margins 0-100,
  duration >= 0, fade period >= 1 minute.
"""
import pytest


def _make_channel(auth_client, number=701):
    r = auth_client.post("/api/channels", json={
        "number": number, "name": f"WM {number}", "tier": "Galaxy Main",
        "vibe": "", "mode": "Shuffle", "style": "", "color": "blue", "icon": None,
    })
    assert r.status_code in (201, 409), r.text
    return number


def test_watermark_defaults_to_absent(auth_client):
    n = _make_channel(auth_client, 701)
    r = auth_client.get(f"/api/channels/{n}/watermark")
    assert r.status_code == 200
    assert r.json() == {"watermark": None}


def test_put_and_get_watermark_roundtrip(auth_client):
    n = _make_channel(auth_client, 702)
    payload = {
        "enabled": True, "position": "top-left", "width": 12.5,
        "vertical_margin": 2, "horizontal_margin": 3, "duration": 0,
        "opacity": 80, "fixed_size": False,
        "fade": {"period_mins": 5, "leading_edge": True},
    }
    r = auth_client.put(f"/api/channels/{n}/watermark", json=payload)
    assert r.status_code == 200, r.text
    got = auth_client.get(f"/api/channels/{n}/watermark").json()["watermark"]
    assert got["enabled"] is True
    assert got["position"] == "top-left"
    assert got["width"] == 12.5
    assert got["opacity"] == 80
    assert got["fade"] == {"period_mins": 5, "leading_edge": True}


def test_delete_watermark_clears_it(auth_client):
    n = _make_channel(auth_client, 703)
    auth_client.put(f"/api/channels/{n}/watermark", json={
        "enabled": True, "width": 10, "vertical_margin": 1,
        "horizontal_margin": 1, "position": "bottom-right",
    })
    r = auth_client.delete(f"/api/channels/{n}/watermark")
    assert r.status_code == 200
    assert auth_client.get(f"/api/channels/{n}/watermark").json() == {"watermark": None}


@pytest.mark.parametrize("bad,field", [
    ({"width": 0}, "width"),
    ({"width": -5}, "width"),
    ({"opacity": 101}, "opacity"),
    ({"opacity": -1}, "opacity"),
    ({"vertical_margin": 101}, "vertical_margin"),
    ({"horizontal_margin": -1}, "horizontal_margin"),
    ({"duration": -1}, "duration"),
    ({"position": "center"}, "position"),
])
def test_watermark_validation_rejects_values_tunarr_would_reject(auth_client, bad, field):
    n = _make_channel(auth_client, 704)
    payload = {
        "enabled": True, "width": 10, "vertical_margin": 1,
        "horizontal_margin": 1, "position": "bottom-right", "duration": 0,
        "opacity": 100,
    }
    payload.update(bad)
    r = auth_client.put(f"/api/channels/{n}/watermark", json=payload)
    assert r.status_code == 422, f"{field}={bad[field]!r} should be rejected"


def test_fade_period_must_be_at_least_one_minute(auth_client):
    n = _make_channel(auth_client, 705)
    r = auth_client.put(f"/api/channels/{n}/watermark", json={
        "enabled": True, "width": 10, "vertical_margin": 1, "horizontal_margin": 1,
        "position": "bottom-right", "fade": {"period_mins": 0},
    })
    assert r.status_code == 422


def test_watermark_404_for_unknown_channel(auth_client):
    r = auth_client.put("/api/channels/99999/watermark", json={
        "enabled": True, "width": 10, "vertical_margin": 1,
        "horizontal_margin": 1, "position": "bottom-right",
    })
    assert r.status_code == 404


def test_tunarr_payload_uses_tunarr_field_names_and_types():
    """Maps snake_case storage to Tunarr's camelCase, and only fadeConfig[0]."""
    import main
    out = main._watermark_to_tunarr({
        "enabled": True, "position": "top-right", "width": 10.0,
        "vertical_margin": 1.0, "horizontal_margin": 2.0, "duration": 30.0,
        "opacity": 75, "fixed_size": True,
        "fade": {"period_mins": 5, "leading_edge": False},
    }, "http://tunarr:8000/images/uploads/logo.png")

    assert out["enabled"] is True
    assert out["position"] == "top-right"
    assert out["width"] == 10.0
    assert out["verticalMargin"] == 1.0
    assert out["horizontalMargin"] == 2.0
    assert out["duration"] == 30.0
    assert out["opacity"] == 75
    assert isinstance(out["opacity"], int)
    assert out["fixedSize"] is True
    assert out["url"] == "http://tunarr:8000/images/uploads/logo.png"
    assert out["fadeConfig"] == [{"periodMins": 5, "leadingEdge": False}]
    # programType is never read by Tunarr's pipeline — don't send it
    assert "programType" not in out["fadeConfig"][0]
    # animated is persisted but never read at 1.3.6 — don't send it
    assert "animated" not in out


def test_tunarr_payload_omits_fade_when_unset():
    import main
    out = main._watermark_to_tunarr({
        "enabled": True, "position": "bottom-right", "width": 10.0,
        "vertical_margin": 1.0, "horizontal_margin": 1.0, "duration": 0.0,
        "opacity": 100, "fixed_size": False, "fade": None,
    }, None)
    assert "fadeConfig" not in out
    assert out.get("url", "") == ""
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_watermark.py -v`
Expected: FAIL — 404s on the watermark routes and `AttributeError: … '_watermark_to_tunarr'`

- [ ] **Step 3a: Add the migration**

In `main.py`, in `init_db`, immediately after the existing `channels.icon` migration block (lines 257-260), add:

```python
        # Watermark config as a JSON blob: Tunarr's watermark schema is identical
        # across every supported version (v1.0.0-v1.3.9), so there is nothing to
        # normalize into columns. NULL = no watermark.
        try:
            conn.execute("ALTER TABLE channels ADD COLUMN watermark TEXT")
        except sqlite3.OperationalError:
            pass
        # Absolute URL of the watermark image hosted BY TUNARR. Tunarr feeds this
        # to ffmpeg as an HTTP input, so a base64 data URI (how Linearr stores
        # icons) cannot be used directly — it must be uploaded and cached here.
        try:
            conn.execute("ALTER TABLE channels ADD COLUMN watermark_image_url TEXT")
        except sqlite3.OperationalError:
            pass
```

- [ ] **Step 3b: Add the models**

In `main.py`, directly after `class ChannelCollectionIn` (line 516), add:

```python
_WATERMARK_POSITIONS = ("top-left", "top-right", "bottom-left", "bottom-right")


class WatermarkFade(BaseModel):
    # Tunarr requires periodMins >= 1 and silently drops entries <= 0.
    period_mins: int = Field(ge=1)
    leading_edge: bool = True


class WatermarkIn(BaseModel):
    """Watermark config, validated against Tunarr's real constraints.

    Mirrors Tunarr's WatermarkSchema so an invalid value is rejected here with a
    clear message rather than as an opaque 400 from Tunarr. Deliberately omits
    `animated` and `fadeConfig[].programType`: both are persisted by Tunarr but
    never read by any pipeline builder at 1.3.6.
    """
    enabled: bool = False
    url: str | None = None
    position: str = "bottom-right"
    width: float = Field(default=10.0, gt=0)          # percent of frame width, strictly > 0
    vertical_margin: float = Field(default=1.0, ge=0, le=100)
    horizontal_margin: float = Field(default=1.0, ge=0, le=100)
    duration: float = Field(default=0.0, ge=0)        # seconds; 0 = always on
    opacity: int = Field(default=100, ge=0, le=100)   # must be an int for Tunarr
    fixed_size: bool = False                          # true makes `width` inert
    use_channel_icon: bool = True
    fade: WatermarkFade | None = None

    @field_validator("position")
    @classmethod
    def _check_position(cls, v: str) -> str:
        if v not in _WATERMARK_POSITIONS:
            raise ValueError(
                f"position must be one of {', '.join(_WATERMARK_POSITIONS)}"
            )
        return v
```

Ensure `Field` and `field_validator` are imported from `pydantic` at the top of `main.py`; add them to the existing import if absent.

- [ ] **Step 3c: Add the Tunarr mapper**

In `main.py`, directly above `_tunarr_icon_obj` (before the `_UUID_RE` block from Task 1), add:

```python
def _watermark_to_tunarr(wm: dict, image_url: str | None) -> dict:
    """Map stored watermark config to Tunarr's WatermarkSchema.

    Only `fadeConfig[0]` is ever applied by Tunarr, so at most one entry is
    sent. `animated` and `fadeConfig[].programType` are omitted: Tunarr
    persists both but no pipeline builder reads them (1.3.6).
    """
    out: dict = {
        "enabled": bool(wm.get("enabled", False)),
        "position": wm.get("position", "bottom-right"),
        "width": float(wm.get("width", 10.0)),
        "verticalMargin": float(wm.get("vertical_margin", 1.0)),
        "horizontalMargin": float(wm.get("horizontal_margin", 1.0)),
        "duration": float(wm.get("duration", 0.0)),
        "opacity": int(wm.get("opacity", 100)),
        "fixedSize": bool(wm.get("fixed_size", False)),
        "url": image_url or "",
    }
    fade = wm.get("fade")
    if isinstance(fade, dict) and int(fade.get("period_mins", 0)) >= 1:
        out["fadeConfig"] = [{
            "periodMins": int(fade["period_mins"]),
            "leadingEdge": bool(fade.get("leading_edge", True)),
        }]
    return out
```

- [ ] **Step 3d: Add the routes**

In `main.py`, immediately after `delete_channel_icon` ends (line 748), add:

```python
# ── Channel watermark ─────────────────────────────────────────────────────────

@app.get("/api/channels/{channel_number}/watermark")
def get_channel_watermark(channel_number: int):
    with get_db() as conn:
        row = conn.execute(
            "SELECT watermark, watermark_image_url FROM channels WHERE number=?",
            (channel_number,),
        ).fetchone()
    if row is None:
        raise HTTPException(404, "Channel not found")
    stored = row["watermark"]
    if not stored:
        return {"watermark": None}
    try:
        wm = json.loads(stored)
    except (TypeError, ValueError):
        return {"watermark": None}
    wm["image_url"] = row["watermark_image_url"]
    return {"watermark": wm}


@app.put("/api/channels/{channel_number}/watermark")
async def put_channel_watermark(channel_number: int, body: WatermarkIn):
    with get_db() as conn:
        exists = conn.execute(
            "SELECT 1 FROM channels WHERE number=?", (channel_number,)
        ).fetchone()
        if exists is None:
            raise HTTPException(404, "Channel not found")
        conn.execute(
            "UPDATE channels SET watermark=? WHERE number=?",
            (json.dumps(body.model_dump()), channel_number),
        )
    _log_app("channel", f"Updated watermark for channel {channel_number}",
             metadata={"number": channel_number, "enabled": body.enabled})
    sync = await _sync_channel_to_tunarr(channel_number)
    return {"ok": True, "watermark": body.model_dump(), "tunarr_sync": sync}


@app.delete("/api/channels/{channel_number}/watermark")
async def delete_channel_watermark(channel_number: int):
    """Clear the watermark.

    Tunarr has no way to null the watermark column via its API, so the channel
    is synced with `enabled: false` rather than an absent object.
    """
    with get_db() as conn:
        cur = conn.execute(
            "UPDATE channels SET watermark=NULL, watermark_image_url=NULL WHERE number=?",
            (channel_number,),
        )
    if cur.rowcount == 0:
        raise HTTPException(404, "Channel not found")
    _log_app("channel", f"Cleared watermark for channel {channel_number}",
             level="warn", metadata={"number": channel_number})
    sync = await _sync_channel_to_tunarr(channel_number)
    return {"ok": True, "tunarr_sync": sync}
```

Confirm `json` is imported at the top of `main.py` (it is — used by `_log_app`).

- [ ] **Step 4: Run the tests**

Run: `python -m pytest tests/test_watermark.py -v`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add main.py tests/test_watermark.py
git commit -m "feat(watermark): per-channel watermark storage, validation, and CRUD

Validation mirrors Tunarr's zod constraints (width strictly > 0, integer
opacity, margins 0-100, fade period >= 1min) so bad values fail with a clear
message instead of an opaque 400. Omits \`animated\` and fadeConfig
\`programType\`, which Tunarr persists but never reads."
```

---

### Task 6: Host the watermark image on Tunarr

Tunarr resolves `watermark.url` as an ffmpeg HTTP input, so a `data:` URI cannot work — and when `url` is blank Tunarr falls back to `icon.path`, which Linearr sets to a data URI. The image must be uploaded to Tunarr and referenced by absolute URL.

**Files:**
- Modify: `main.py` (helpers near `_watermark_to_tunarr`; route after the watermark routes)
- Test: `tests/test_watermark.py` (append)

**Interfaces:**
- Consumes: `_watermark_to_tunarr` (Task 5).
- Produces:
  - `def _decode_data_uri(data_uri: str) -> tuple[bytes, str, str] | None` → `(raw_bytes, content_type, filename)`
  - `async def _tunarr_upload_image(client, url, raw, content_type, filename) -> str | None` → absolute URL, host-rewritten onto `url`
  - Route `POST /api/channels/{channel_number}/watermark/image`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_watermark.py`:

```python
import base64

import httpx


@pytest.fixture
def anyio_backend():
    return "asyncio"


# 1x1 transparent PNG
_PNG_B64 = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGMAAQAABQAB"
            "oIJXOQAAAABJRU5ErkJggg==")
_PNG_DATA_URI = f"data:image/png;base64,{_PNG_B64}"


def test_decode_data_uri_extracts_bytes_and_type():
    import main
    got = main._decode_data_uri(_PNG_DATA_URI)
    assert got is not None
    raw, content_type, filename = got
    assert raw == base64.b64decode(_PNG_B64)
    assert content_type == "image/png"
    assert filename.endswith(".png")


def test_decode_data_uri_rejects_non_data_uri():
    import main
    assert main._decode_data_uri("http://example.com/x.png") is None
    assert main._decode_data_uri("") is None


@pytest.mark.anyio
async def test_upload_image_rewrites_the_returned_host():
    """Tunarr builds fileUrl from the inbound Host header, so the URL it returns
    is unreachable when Linearr talks to it as http://tunarr:8000."""
    import main

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/upload/image"
        return httpx.Response(200, json={
            "name": "logo.png",
            "fileUrl": "http://localhost:8000/images/uploads/logo.png",
        })

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://tunarr:8000") as client:
        got = await main._tunarr_upload_image(
            client, "http://tunarr:8000", b"\x89PNG", "image/png", "logo.png")
    assert got == "http://tunarr:8000/images/uploads/logo.png"


@pytest.mark.anyio
async def test_upload_image_returns_none_on_rejection():
    import main

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://tunarr:8000") as client:
        got = await main._tunarr_upload_image(
            client, "http://tunarr:8000", b"nope", "image/png", "logo.png")
    assert got is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_watermark.py -v -k "data_uri or upload_image"`
Expected: FAIL — `AttributeError: module 'main' has no attribute '_decode_data_uri'`

- [ ] **Step 3a: Add the helpers**

In `main.py`, directly above `_watermark_to_tunarr`, add:

```python
_DATA_URI_RE = _re.compile(r"^data:(?P<mime>[\w.+/-]+);base64,(?P<b64>.+)$", _re.DOTALL)

_MIME_EXT = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
    "image/svg+xml": "svg", "image/gif": "gif",
}


def _decode_data_uri(data_uri: str) -> tuple[bytes, str, str] | None:
    """Decode a base64 data URI into (bytes, content_type, filename).

    Returns None for anything that is not a base64 data URI, including the
    absolute URLs a user may paste as a watermark override.
    """
    if not isinstance(data_uri, str):
        return None
    m = _DATA_URI_RE.match(data_uri.strip())
    if not m:
        return None
    mime = m.group("mime").lower()
    try:
        raw = base64.b64decode(m.group("b64"), validate=True)
    except Exception:
        return None
    if not raw:
        return None
    return raw, mime, f"linearr-watermark.{_MIME_EXT.get(mime, 'png')}"


async def _tunarr_upload_image(
    client: "httpx.AsyncClient", url: str, raw: bytes,
    content_type: str, filename: str,
) -> str | None:
    """Upload an image to Tunarr and return an absolute, reachable URL.

    Tunarr builds `fileUrl` from the inbound Host header, so the URL it returns
    is often unreachable from Linearr (which talks to `http://tunarr:8000`).
    The path is kept and the host rewritten onto the configured base URL.
    """
    try:
        r = await client.post(
            f"{url}/api/upload/image",
            files={"file": (filename, raw, content_type)},
        )
    except Exception as e:
        log.warning("Tunarr image upload failed: %s", e)
        return None
    if r.status_code not in (200, 201):
        log.warning("Tunarr rejected image upload: %s %s", r.status_code, r.text[:200])
        return None
    try:
        file_url = (r.json() or {}).get("fileUrl") or ""
    except Exception:
        return None
    if not file_url:
        return None
    path = _urlparse(file_url).path or ""
    if not path:
        return None
    return f"{url.rstrip('/')}{path}"
```

Add `import base64` and `from urllib.parse import urlparse as _urlparse` to `main.py`'s imports if not already present (`_urlencode` from the same module is already imported, so extend that line).

- [ ] **Step 3b: Add the route**

In `main.py`, after `delete_channel_watermark`, add:

```python
class WatermarkImageIn(BaseModel):
    # Omit both to fall back to the channel's icon.
    image: str | None = None   # data URI to upload
    url: str | None = None     # absolute URL to use as-is


@app.post("/api/channels/{channel_number}/watermark/image")
async def set_channel_watermark_image(channel_number: int, body: WatermarkImageIn):
    """Resolve the watermark image to an absolute URL Tunarr can fetch.

    An explicit absolute `url` is stored verbatim. A data URI — either supplied
    directly or taken from the channel's icon — is uploaded to Tunarr, because
    Tunarr passes this value to ffmpeg as an HTTP input and cannot read a
    `data:` URI (which is also why leaving `url` blank to inherit the channel
    icon does not work: the icon is itself stored as a data URI).
    """
    with get_db() as conn:
        row = conn.execute(
            "SELECT icon FROM channels WHERE number=?", (channel_number,)
        ).fetchone()
    if row is None:
        raise HTTPException(404, "Channel not found")

    if body.url:
        parsed = _urlparse(body.url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise HTTPException(
                400, "Watermark URL must be absolute (http:// or https://) — "
                     "Tunarr fetches it over HTTP and cannot use a relative path"
            )
        image_url = body.url
    else:
        source = body.image or row["icon"]
        decoded = _decode_data_uri(source or "")
        if decoded is None:
            raise HTTPException(
                400, "No usable image — supply a data URI, an absolute URL, or "
                     "set a channel icon first"
            )
        raw, content_type, filename = decoded
        tunarr_url = get_tunarr_url()
        if not tunarr_url:
            raise HTTPException(400, "Tunarr not configured")
        async with httpx.AsyncClient(timeout=30.0) as client:
            image_url = await _tunarr_upload_image(
                client, tunarr_url, raw, content_type, filename)
        if not image_url:
            raise HTTPException(502, "Tunarr rejected the watermark image upload")

    with get_db() as conn:
        conn.execute(
            "UPDATE channels SET watermark_image_url=? WHERE number=?",
            (image_url, channel_number),
        )
    _log_app("channel", f"Set watermark image for channel {channel_number}",
             metadata={"number": channel_number, "image_url": image_url})
    sync = await _sync_channel_to_tunarr(channel_number)
    return {"ok": True, "image_url": image_url, "tunarr_sync": sync}
```

- [ ] **Step 4: Run the tests**

Run: `python -m pytest tests/test_watermark.py -v`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add main.py tests/test_watermark.py
git commit -m "feat(watermark): host the watermark image on Tunarr

Tunarr feeds watermark.url to ffmpeg as an HTTP input, so the base64 data URIs
Linearr stores icons as cannot be used — not even via Tunarr's blank-url
fallback to the channel icon. Upload to POST /api/upload/image and rewrite the
returned host, which Tunarr derives from the inbound Host header."
```

---

### Task 7: Send the watermark on every channel sync

**Files:**
- Modify: `main.py` (replace the `_watermark_for_tunarr` stub added in Task 3)
- Test: `tests/test_watermark.py` (append)

**Interfaces:**
- Consumes: `_watermark_to_tunarr` (Task 5), the `watermark`/`watermark_image_url` columns (Task 5).
- Produces: `def _watermark_for_tunarr(ch: dict) -> dict | None` — real implementation.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_watermark.py`:

```python
def test_watermark_for_tunarr_reads_the_channel_row():
    import json as _json

    import main
    ch = {
        "watermark": _json.dumps({
            "enabled": True, "position": "top-left", "width": 15.0,
            "vertical_margin": 2.0, "horizontal_margin": 2.0, "duration": 0.0,
            "opacity": 90, "fixed_size": False, "fade": None,
        }),
        "watermark_image_url": "http://tunarr:8000/images/uploads/a.png",
    }
    out = main._watermark_for_tunarr(ch)
    assert out is not None
    assert out["enabled"] is True
    assert out["position"] == "top-left"
    assert out["url"] == "http://tunarr:8000/images/uploads/a.png"


def test_watermark_for_tunarr_is_none_when_unset():
    import main
    assert main._watermark_for_tunarr({"watermark": None}) is None
    assert main._watermark_for_tunarr({}) is None


def test_watermark_for_tunarr_survives_corrupt_json():
    import main
    assert main._watermark_for_tunarr({"watermark": "{not json"}) is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_watermark.py -v -k watermark_for_tunarr`
Expected: FAIL — the stub returns `None`, so `test_watermark_for_tunarr_reads_the_channel_row` fails on `assert out is not None`

- [ ] **Step 3: Replace the stub**

In `main.py`, replace the Task 3 stub with:

```python
def _watermark_for_tunarr(ch: dict) -> dict | None:
    """Tunarr watermark payload for a channel row, or None when unset.

    Corrupt JSON is treated as unset rather than raised: a bad blob must not
    break channel metadata sync.
    """
    stored = ch.get("watermark")
    if not stored:
        return None
    try:
        wm = json.loads(stored) if isinstance(stored, str) else stored
    except (TypeError, ValueError):
        return None
    if not isinstance(wm, dict):
        return None
    return _watermark_to_tunarr(wm, ch.get("watermark_image_url"))
```

- [ ] **Step 4: Run the full backend suite**

Run: `python -m pytest tests/ -v`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add main.py tests/test_watermark.py
git commit -m "feat(watermark): include the watermark in every Tunarr channel sync"
```

---

### Task 8: Frontend API client, types, and hooks

**Files:**
- Create: `frontend/src/features/watermark/api.ts`
- Create: `frontend/src/features/watermark/hooks.ts`
- Create: `frontend/src/features/watermark/types.ts`
- Modify: `frontend/src/features/icons/api.ts:38-40` (fix the 405)

**Interfaces:**
- Consumes: the routes from Tasks 5–6.
- Produces:
  - `types.ts`: `WatermarkFade`, `Watermark`, `WatermarkPosition`, `WATERMARK_POSITIONS`, `DEFAULT_WATERMARK`
  - `hooks.ts`: `useWatermark(channelNumber)`, `useSaveWatermark()`, `useDeleteWatermark()`, `useSetWatermarkImage()`
  - Query key `['watermark', channelNumber]`

- [ ] **Step 1: Fix the icon-assign 405**

`frontend/src/features/icons/api.ts:38-40` sends `POST` to `/api/channels/{n}/icon`, but the backend registers only `PUT` and `DELETE` (`main.py:728`, `main.py:741`) — so assigning an icon from the Icon Library or Icon Editor currently fails with 405. The watermark image flow inherits this path, so fix it first.

Replace:

```ts
function assignToChannel(channelNumber: number, icon: string): Promise<void> {
  return post<void>(`/api/channels/${channelNumber}/icon`, { icon })
}
```

with:

```ts
function assignToChannel(channelNumber: number, icon: string): Promise<void> {
  // The backend registers PUT (and DELETE) for this path — a POST is a 405.
  return put<void>(`/api/channels/${channelNumber}/icon`, { icon })
}
```

Update the import at the top of that file to include `put` and drop `post` if now unused.

- [ ] **Step 2: Verify the fix compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors (in particular no unused-import error)

- [ ] **Step 3: Create the types**

Create `frontend/src/features/watermark/types.ts`:

```ts
/** Tunarr's four watermark corners — it supports no other placement. */
export const WATERMARK_POSITIONS = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
] as const

export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number]

export interface WatermarkFade {
  /** Minutes on, then the same off. Tunarr requires >= 1. */
  period_mins: number
  /** Visible immediately at segment start when true. */
  leading_edge: boolean
}

export interface Watermark {
  enabled: boolean
  /** Absolute URL override. Blank means "use the channel icon". */
  url?: string | null
  position: WatermarkPosition
  /** Percent of the output frame width. Tunarr requires strictly > 0. */
  width: number
  vertical_margin: number
  horizontal_margin: number
  /** Seconds per program segment; 0 means always on. */
  duration: number
  /** Integer 0-100. */
  opacity: number
  /** When true Tunarr skips scaling entirely and `width` has no effect. */
  fixed_size: boolean
  use_channel_icon: boolean
  fade: WatermarkFade | null
  /** Read-only: the absolute URL Tunarr will fetch. */
  image_url?: string | null
}

export const DEFAULT_WATERMARK: Watermark = {
  enabled: false,
  url: null,
  position: 'bottom-right',
  width: 10,
  vertical_margin: 1,
  horizontal_margin: 1,
  duration: 0,
  opacity: 100,
  fixed_size: false,
  use_channel_icon: true,
  fade: null,
}
```

- [ ] **Step 4: Create the API client**

Create `frontend/src/features/watermark/api.ts`:

```ts
import { del, get, post, put } from '@/shared/api/client'
import type { Watermark } from './types'

interface TunarrSync {
  synced: boolean
  action: 'updated' | 'created' | 'error'
  message?: string
}

function getWatermark(channelNumber: number): Promise<{ watermark: Watermark | null }> {
  return get<{ watermark: Watermark | null }>(`/api/channels/${channelNumber}/watermark`)
}

function saveWatermark(
  channelNumber: number,
  data: Watermark,
): Promise<{ ok: boolean; watermark: Watermark; tunarr_sync: TunarrSync }> {
  return put(`/api/channels/${channelNumber}/watermark`, data)
}

function deleteWatermark(channelNumber: number): Promise<{ ok: boolean }> {
  return del(`/api/channels/${channelNumber}/watermark`)
}

/** Omit both fields to fall back to the channel's icon. */
function setWatermarkImage(
  channelNumber: number,
  payload: { image?: string; url?: string },
): Promise<{ ok: boolean; image_url: string }> {
  return post(`/api/channels/${channelNumber}/watermark/image`, payload)
}

export const watermarkApi = {
  getWatermark,
  saveWatermark,
  deleteWatermark,
  setWatermarkImage,
}
```

- [ ] **Step 5: Create the hooks**

Create `frontend/src/features/watermark/hooks.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useToastStore } from '@/shared/store/toast.store'
import { watermarkApi } from './api'
import type { Watermark } from './types'

export function useWatermark(channelNumber: number) {
  return useQuery({
    queryKey: ['watermark', channelNumber],
    queryFn: () => watermarkApi.getWatermark(channelNumber),
    enabled: Boolean(channelNumber),
  })
}

/** Reports a Tunarr sync failure separately: the local save still succeeded. */
function useWatermarkMutation<TVars>(
  fn: (vars: TVars) => Promise<{ tunarr_sync?: { synced: boolean; message?: string } }>,
  channelNumber: number,
  successMessage: string,
) {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['watermark', channelNumber] })
      void queryClient.invalidateQueries({ queryKey: ['channels'] })
      const sync = data?.tunarr_sync
      if (sync && !sync.synced) {
        addToast(`${successMessage}, but Tunarr sync failed: ${sync.message ?? 'unknown error'}`, true)
      } else {
        addToast(successMessage)
      }
    },
    onError: (error: Error) => {
      addToast(error.message || 'Watermark update failed', true)
    },
  })
}

export function useSaveWatermark(channelNumber: number) {
  return useWatermarkMutation<Watermark>(
    (data) => watermarkApi.saveWatermark(channelNumber, data),
    channelNumber,
    'Watermark saved',
  )
}

export function useDeleteWatermark(channelNumber: number) {
  return useWatermarkMutation<void>(
    () => watermarkApi.deleteWatermark(channelNumber),
    channelNumber,
    'Watermark cleared',
  )
}

export function useSetWatermarkImage(channelNumber: number) {
  return useWatermarkMutation<{ image?: string; url?: string }>(
    (payload) => watermarkApi.setWatermarkImage(channelNumber, payload),
    channelNumber,
    'Watermark image updated',
  )
}
```

- [ ] **Step 6: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/watermark frontend/src/features/icons/api.ts
git commit -m "feat(watermark): frontend api client, types, and hooks

Also fixes assignToChannel POSTing to a PUT-only route, which made assigning
an icon from the Icon Library or Editor fail with 405."
```

---

### Task 9: Watermark editor modal with live preview

**Files:**
- Create: `frontend/src/features/watermark/components/WatermarkPreview.tsx`
- Create: `frontend/src/features/watermark/components/WatermarkEditorModal.tsx`
- Modify: `frontend/src/shared/types/index.ts:292-302` (add `'watermarkEditor'` to `ModalName`)
- Modify: `frontend/src/shared/store/ui.store.ts:109-120` (add `watermarkEditor: false` to `defaultModals`)
- Modify: `frontend/src/App.tsx:146-156` (lazy-mount the modal)
- Modify: `frontend/src/features/channels/components/ChannelDetail.tsx` (add the entry point near the icon action at `:155`)

**Interfaces:**
- Consumes: `useWatermark`, `useSaveWatermark`, `useDeleteWatermark`, `useSetWatermarkImage`, `DEFAULT_WATERMARK`, `WATERMARK_POSITIONS`, `Watermark` (Task 8).
- Produces: `WatermarkPreview` (`{ watermark, imageUrl }`), `WatermarkEditorModal` (propless, store-driven).

- [ ] **Step 1: Create the preview component**

Create `frontend/src/features/watermark/components/WatermarkPreview.tsx`:

```tsx
import type { Watermark } from '../types'

interface WatermarkPreviewProps {
  watermark: Watermark
  imageUrl?: string | null
}

/**
 * Models Tunarr's ffmpeg filter chain: `width` is a percentage of the output
 * frame width, margins are percentages of frame width/height from the chosen
 * corner, and `fixedSize` skips scaling entirely (so `width` stops mattering).
 */
export function WatermarkPreview({ watermark, imageUrl }: WatermarkPreviewProps) {
  const { position, width, vertical_margin, horizontal_margin, opacity, fixed_size } = watermark

  const vertical = position.startsWith('top') ? 'top' : 'bottom'
  const horizontal = position.endsWith('left') ? 'left' : 'right'

  const style: React.CSSProperties = {
    position: 'absolute',
    [vertical]: `${vertical_margin}%`,
    [horizontal]: `${horizontal_margin}%`,
    width: fixed_size ? undefined : `${width}%`,
    opacity: opacity / 100,
  }

  return (
    <div>
      <div
        className="relative w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-950"
        style={{ aspectRatio: '16 / 9' }}
      >
        {/* stand-in for video content, so placement and opacity are legible */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-900 to-black"
        />
        {!watermark.enabled ? (
          <p className="absolute inset-0 grid place-items-center text-xs text-slate-500">
            Watermark disabled
          </p>
        ) : imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            style={style}
            className={fixed_size ? 'max-w-[40%]' : undefined}
          />
        ) : (
          <div style={style} className="grid aspect-square place-items-center rounded bg-indigo-500/40 text-[10px] text-indigo-100">
            logo
          </div>
        )}
      </div>
      <p className="mt-1.5 text-xs text-slate-500">
        {fixed_size
          ? 'Fixed size — Tunarr skips scaling, so width has no effect.'
          : `Scaled to ${width}% of the frame width.`}
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Create the editor modal**

Create `frontend/src/features/watermark/components/WatermarkEditorModal.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Button, Field, Input, ModalWrapper, Select } from '@/shared/components/ui'
import { useUIStore } from '@/shared/store/ui.store'
import {
  useDeleteWatermark,
  useSaveWatermark,
  useSetWatermarkImage,
  useWatermark,
} from '../hooks'
import { DEFAULT_WATERMARK, WATERMARK_POSITIONS, type Watermark } from '../types'
import { WatermarkPreview } from './WatermarkPreview'

export function WatermarkEditorModal() {
  const open = useUIStore((s) => s.modals.watermarkEditor)
  const closeModal = useUIStore((s) => s.closeModal)
  const channel = useUIStore((s) => s.selectedChannel)
  const channelNumber = channel?.number ?? 0

  const { data } = useWatermark(channelNumber)
  const save = useSaveWatermark(channelNumber)
  const remove = useDeleteWatermark(channelNumber)
  const setImage = useSetWatermarkImage(channelNumber)

  const [form, setForm] = useState<Watermark>(DEFAULT_WATERMARK)
  const [fadeOn, setFadeOn] = useState(false)

  // Hydrate when the modal opens or the stored config arrives.
  useEffect(() => {
    if (!open) return
    const stored = data?.watermark
    setForm(stored ? { ...DEFAULT_WATERMARK, ...stored } : DEFAULT_WATERMARK)
    setFadeOn(Boolean(stored?.fade))
  }, [open, data])

  const set = <K extends keyof Watermark>(key: K, value: Watermark[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const handleSave = () => {
    const payload: Watermark = {
      ...form,
      fade: fadeOn ? (form.fade ?? { period_mins: 5, leading_edge: true }) : null,
    }
    save.mutate(payload, { onSuccess: () => closeModal('watermarkEditor') })
  }

  const titleId = 'watermark-editor-title'

  return (
    <ModalWrapper
      open={open}
      onClose={() => closeModal('watermarkEditor')}
      maxWidth="max-w-3xl"
      titleId={titleId}
    >
      <div className="flex max-h-[85vh] flex-col">
        <div className="flex items-start justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <h2 id={titleId} className="text-lg font-bold text-slate-100">
              Watermark
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {channel ? `Channel ${channel.number} — ${channel.name}` : ''}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => set('enabled', e.target.checked)}
              className="h-4 w-4 accent-indigo-500"
            />
            Enabled
          </label>
        </div>

        <div className="grid flex-1 gap-5 overflow-y-auto p-5 md:grid-cols-2">
          <div className="space-y-4">
            <Field label="Image">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={form.use_channel_icon}
                    onChange={(e) => set('use_channel_icon', e.target.checked)}
                    className="h-4 w-4 accent-indigo-500"
                  />
                  Use this channel&rsquo;s icon
                </label>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={setImage.isPending}
                  onClick={() => setImage.mutate(form.use_channel_icon ? {} : { url: form.url ?? '' })}
                >
                  {form.use_channel_icon ? 'Upload icon to Tunarr' : 'Use this URL'}
                </Button>
                {!form.use_channel_icon && (
                  <Input
                    value={form.url ?? ''}
                    onChange={(e) => set('url', e.target.value)}
                    placeholder="https://example.com/logo.png"
                  />
                )}
                <p className="text-xs text-slate-500">
                  Tunarr fetches this over HTTP, so the image must be hosted — an
                  uploaded icon is copied to Tunarr automatically.
                </p>
              </div>
            </Field>

            <Field label="Position">
              <Select
                value={form.position}
                onChange={(e) => set('position', e.target.value as Watermark['position'])}
              >
                {WATERMARK_POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Width (% of frame)" hint="Must be greater than 0.">
              <Input
                type="number"
                min={0.1}
                step={0.5}
                value={form.width}
                disabled={form.fixed_size}
                onChange={(e) => set('width', Number(e.target.value))}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Vertical margin (%)">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={form.vertical_margin}
                  onChange={(e) => set('vertical_margin', Number(e.target.value))}
                />
              </Field>
              <Field label="Horizontal margin (%)">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={form.horizontal_margin}
                  onChange={(e) => set('horizontal_margin', Number(e.target.value))}
                />
              </Field>
            </div>

            <Field label="Opacity (%)">
              <Input
                type="number"
                min={0}
                max={100}
                step={1}
                value={form.opacity}
                onChange={(e) => set('opacity', Math.round(Number(e.target.value)))}
              />
            </Field>

            <Field
              label="Duration (seconds)"
              hint="0 keeps the watermark on for the whole program."
            >
              <Input
                type="number"
                min={0}
                value={form.duration}
                onChange={(e) => set('duration', Number(e.target.value))}
              />
            </Field>

            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.fixed_size}
                onChange={(e) => set('fixed_size', e.target.checked)}
                className="h-4 w-4 accent-indigo-500"
              />
              Fixed size (disable scaling)
            </label>

            <div className="space-y-2 rounded-lg border border-slate-800 p-3">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={fadeOn}
                  onChange={(e) => setFadeOn(e.target.checked)}
                  className="h-4 w-4 accent-indigo-500"
                />
                Intermittent fade
              </label>
              {fadeOn && (
                <>
                  <Field label="Period (minutes)" hint="Shown for this long, then hidden for the same.">
                    <Input
                      type="number"
                      min={1}
                      value={form.fade?.period_mins ?? 5}
                      onChange={(e) =>
                        set('fade', {
                          period_mins: Math.max(1, Math.round(Number(e.target.value))),
                          leading_edge: form.fade?.leading_edge ?? true,
                        })
                      }
                    />
                  </Field>
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={form.fade?.leading_edge ?? true}
                      onChange={(e) =>
                        set('fade', {
                          period_mins: form.fade?.period_mins ?? 5,
                          leading_edge: e.target.checked,
                        })
                      }
                      className="h-4 w-4 accent-indigo-500"
                    />
                    Visible immediately
                  </label>
                  <p className="text-xs text-slate-500">
                    Tunarr applies only one fade rule per channel.
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <WatermarkPreview watermark={form} imageUrl={data?.watermark?.image_url} />
            <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-200/80">
              A watermark will not appear if the channel&rsquo;s transcode config has
              &ldquo;disable channel overlay&rdquo; set. It is also hidden during filler
              when the channel disables the filler overlay.
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-800 px-5 py-4">
          <Button
            variant="dangerSoft"
            size="sm"
            loading={remove.isPending}
            onClick={() => remove.mutate(undefined, { onSuccess: () => closeModal('watermarkEditor') })}
          >
            Clear watermark
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => closeModal('watermarkEditor')}>
              Cancel
            </Button>
            <Button size="sm" loading={save.isPending} onClick={handleSave}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </ModalWrapper>
  )
}
```

- [ ] **Step 3: Register the modal**

In `frontend/src/shared/types/index.ts`, add `| 'watermarkEditor'` to the `ModalName` union (line 292-302).

In `frontend/src/shared/store/ui.store.ts`, add `watermarkEditor: false,` to `defaultModals` (lines 109-120).

In `frontend/src/App.tsx`, alongside the other lazy modal imports, add:

```tsx
const WatermarkEditorModal = lazy(() =>
  import('@/features/watermark/components/WatermarkEditorModal').then((m) => ({
    default: m.WatermarkEditorModal,
  })),
)
```

and mount it inside the same `<Suspense>` block as the other modals:

```tsx
<WatermarkEditorModal />
```

- [ ] **Step 4: Add the entry point**

In `frontend/src/features/channels/components/ChannelDetail.tsx`, next to the existing icon-editor action (around line 155), add a button:

```tsx
<Button
  size="sm"
  variant="secondary"
  onClick={() => openModal('watermarkEditor')}
>
  Watermark
</Button>
```

Confirm `openModal` is already pulled from `useUIStore` in that component; if not, add
`const openModal = useUIStore((s) => s.openModal)`.

- [ ] **Step 5: Typecheck and build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: no type errors; build succeeds

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "feat(watermark): per-channel watermark editor with live preview

Preview models Tunarr's filter chain (width as a percentage of frame width,
percentage margins from the chosen corner, and fixedSize disabling scaling).
Surfaces the two transcode/filler kill switches that silently suppress a
correctly configured watermark."
```

---

### Task 10: Documentation

**Files:**
- Modify: `CLAUDE.md` (routes, schema, Tunarr notes)

**Interfaces:**
- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Document the new routes**

In `CLAUDE.md`, under the Channels route list, add:

```markdown
- `GET|PUT|DELETE /api/channels/{n}/watermark` — per-channel Tunarr watermark config
- `POST /api/channels/{n}/watermark/image` — resolve the watermark image to an absolute
  URL Tunarr can fetch (uploads a data URI, or the channel icon, via Tunarr's
  `POST /api/upload/image`)
```

- [ ] **Step 2: Document the schema change**

In the Database Schema block, extend the `channels` description:

```markdown
channels             -- TV channels (authoritative source)
  fields: number (PK), name, tier, vibe, mode, style, color, icon,
          watermark (JSON, NULL = none), watermark_image_url
```

- [ ] **Step 3: Document the Tunarr write contract**

In the Tunarr version-support blockquote, add:

```markdown
> **Channel writes go through `_tunarr_save_channel` (read-modify-write).** Tunarr's
> `PUT /api/channels/:id` validates the body as the FULL `SaveableChannel` — only
> `onDemand` is partial — so a partial PUT is a 400. Never compute
> `guideMinimumDuration` (its unit is inconsistent inside Tunarr) or `duration`
> (server-maintained); echo them back. Creates use only the discriminated
> `{"type":"new","channel":{…}}` body — no Tunarr 1.x accepts a flat object — and must
> carry a real `transcodeConfigId` from `_tunarr_resolve_transcode_config` (1.3.x
> validates it as a uuid AND checks existence; `transcoding` is read-only and stripped).
> A duplicate channel number returns **500, not 409** — there is no 409 anywhere in the
> channel API. The watermark schema is byte-identical from v1.0.0 to v1.3.9; `animated`
> and `fadeConfig[].programType` are persisted but never read, and only `fadeConfig[0]`
> is applied.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: watermark routes, schema, and the Tunarr channel-write contract"
```

---

## Deliberately out of scope

The spec proposed a `_tunarr_capabilities(url)` helper that probes Tunarr's
`/openapi.json` to record version and route/field availability. It is **dropped from
this plan**: every fallback it would have informed (the flat-create form, the
smart-collections hyphen route) has instead been *deleted* on the strength of reading
Tunarr's tagged source, so nothing left in the code branches on a runtime capability
check. Adding it now would be speculative infrastructure with no consumer. Revisit it
when a genuine version-conditional behavior appears — at which point `/openapi.json`
remains the right probe.

---

## Verification before opening the PR

- [ ] `python -m pytest tests/ -v` — full backend suite green
- [ ] `cd frontend && npx tsc --noEmit && npm run build` — typecheck + build clean
- [ ] **Live Tunarr verification** (needs the Tunarr base URL, which is not yet available):
  - rename a linked channel → confirm the name changes in Tunarr (this is the bug fix; it currently 400s)
  - renumber a linked channel → confirm the number changes in Tunarr
  - set a watermark with an uploaded icon → confirm it appears in Tunarr's channel detail and renders on the stream
  - set a duplicate channel number → confirm the 500 is reported as a probable conflict
  - Anything not verified live is called out explicitly in the PR description rather than claimed as working.
