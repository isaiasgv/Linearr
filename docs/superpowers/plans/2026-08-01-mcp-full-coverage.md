# Linearr MCP Full-Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand Linearr's MCP server from 25 tools to full coverage (~127 tools across 10 toolsets) of every capability the app exposes, with safety annotations, toolset gating, resources, tests, and accurate docs.

**Architecture:** The MCP surface moves out of `main.py` into a `linearr_mcp/` package, one module per toolset. `main.py` calls `build_mcp_server(sys.modules[__name__])` and binds the result to the module-level name `mcp_server` exactly as today — so the ASGI mount, `/api/mcp/info`, and every existing test keep working. Tool functions call the real route handlers off the passed-in `api` module; they never reimplement handler logic. A `ToolRegistry` owns registration, so annotations, toolset gating, and Activity-Log instrumentation are applied structurally rather than by convention.

**Tech Stack:** Python 3.12, FastAPI, `mcp==1.28.1` (`FastMCP`, `StreamableHTTPSessionManager`, `ToolAnnotations`), SQLite, pytest + respx, React 18 + TypeScript for the Settings control.

**Spec:** `docs/superpowers/specs/2026-08-01-mcp-full-coverage-design.md`

## Global Constraints

- **Never rename an existing tool.** These 25 names are frozen: `list_channels`, `get_channel`, `create_channel`, `update_channel`, `delete_channel`, `list_libraries`, `browse_library`, `search_library`, `get_item`, `get_show_seasons`, `get_season_episodes`, `list_assignments`, `assign_items`, `unassign_item`, `purge_channel_content`, `get_collection_status`, `build_collections`, `list_plex_collections`, `get_collection_items`, `create_smart_collection`, `update_smart_collection`, `delete_collection`, `get_server_info`, `get_now_playing`, `get_recent_events`.
- **`linearr_mcp/*` must never `import main`** at module level. Handlers arrive via the `api` module object passed to `register(reg, api)`.
- **Tools call handlers, never reimplement them.** If a handler is typed `request: Request`, use `linearr_mcp._request.json_request(body)`. If it takes a Pydantic model, construct the model.
- `Dockerfile` line 28 must copy the new package. Without it the container starts with no MCP module.
- Python target is **3.12** (container). Local venv is 3.13 — do not use 3.13-only syntax.
- Toolset names, exactly: `channels`, `icons`, `assignments`, `plex`, `collections`, `blocks`, `tunarr`, `watermark`, `ai`, `system`.
- Never expose over MCP: `/api/plex/stream/*`, `/api/backup`, `/api/restore`, `/api/plex/thumb`, `/api/tunarr/image`, `/api/plex/webhook`, `/api/auth/*`, Plex OAuth PIN start/status, `/api/icons/export|import|library/seed`, `/api/ai-models`, `/api/ai-test`.
- `update_configuration` must **reject** `plex_token` and `openai_api_key`. Secrets are UI-only.
- Run the whole suite with `./.venv-mcp/Scripts/python.exe -m pytest` (Windows dev box). Baseline before any change: **505 passed**.
- Commit after every task. Conventional commits, scope `mcp`.

---

## File Structure

**Create**

| File | Responsibility |
|---|---|
| `linearr_mcp/__init__.py` | `build_mcp_server(api)` → `(FastMCP, toolset_info)`. Resolves enabled toolsets, builds the server, calls each module's `register`. |
| `linearr_mcp/registry.py` | `ToolRegistry`: `tool()` decorator factory (annotations + gating + logging wrapper), `tool_error()`, `args_summary()`, `TOOLSETS`, `resolve_toolsets()`. |
| `linearr_mcp/_request.py` | `json_request(body: dict) -> starlette.requests.Request` — in-process request shim. |
| `linearr_mcp/channels.py` | `channels` toolset (11 tools). |
| `linearr_mcp/icons.py` | `icons` toolset (5 tools). |
| `linearr_mcp/assignments.py` | `assignments` toolset (4 tools). |
| `linearr_mcp/plex.py` | `plex` toolset (21 tools). |
| `linearr_mcp/collections.py` | `collections` toolset (16 tools). |
| `linearr_mcp/blocks.py` | `blocks` toolset (14 tools). |
| `linearr_mcp/tunarr.py` | `tunarr` toolset (35 tools). |
| `linearr_mcp/watermark.py` | `watermark` toolset (4 tools). |
| `linearr_mcp/ai.py` | `ai` toolset (5 tools). |
| `linearr_mcp/system.py` | `system` toolset (12 tools). |
| `linearr_mcp/resources.py` | 4 MCP resources. |
| `tests/test_mcp_registry.py` | Structural tests: annotations, instrumentation, toolset membership, gating, docs-match-code. |
| `tests/test_mcp_tools.py` | Behavioural tests per toolset. |

**Modify**

| File | Change |
|---|---|
| `main.py:7656-8086` | Replace the MCP section with the `build_mcp_server` call; keep `_mcp_asgi` and the mount. |
| `main.py:8090-8106` | `/api/mcp/info` gains `toolsets`; add `PUT /api/mcp/toolsets`. |
| `Dockerfile:28` | `COPY linearr_mcp/ ./linearr_mcp/`. |
| `frontend/src/features/settings/api.ts` | `McpInfo.toolsets`, `setMcpToolsets`. |
| `frontend/src/features/settings/hooks.ts` | `useSetMcpToolsets`. |
| `frontend/src/features/settings/components/SettingsView.tsx` | Toolset checkboxes in `McpServerCard`. |
| `docs/MCP.md` | Full rewrite. |
| `CLAUDE.md` | MCP section rewrite. |
| `README.md` | Tool count. |

---

### Task 1: Extract the MCP server into `linearr_mcp/` with zero behaviour change

Pure move. No new tools, no annotations, no gating. The suite must be green at the end with the same 505 tests, proving the extraction is inert before anything is built on top.

**Files:**
- Create: `linearr_mcp/__init__.py`, `linearr_mcp/registry.py`, `linearr_mcp/_request.py`, and one module per toolset containing the *existing* tools split by domain: `channels.py` (5), `plex.py` (9 — the 6 library tools plus `get_server_info`, `get_now_playing`, `get_recent_events`), `assignments.py` (4), `collections.py` (7)
- Modify: `main.py:7656-8086`, `Dockerfile:28`
- Test: existing `tests/test_mcp.py`, `tests/test_mcp_hardening.py` (unchanged)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `linearr_mcp.build_mcp_server(api) -> tuple[FastMCP, list[dict]]` where each dict is `{"name": str, "enabled": bool, "tool_count": int}`.
  - `linearr_mcp.registry.ToolRegistry` with `.mcp: FastMCP`, `.tool(name: str, *, toolset: str, read_only: bool = False, destructive: bool = False, idempotent: bool = False, open_world: bool = False) -> Callable`, `.counts() -> dict[str, int]`.
  - `linearr_mcp.registry.tool_error(exc: HTTPException) -> RuntimeError`.
  - `linearr_mcp._request.json_request(body: dict) -> Request`.
  - Each toolset module exposes `register(reg: ToolRegistry, api) -> None`.
  - `main.mcp_server: FastMCP` (name unchanged).

- [ ] **Step 1: Create the request shim and its test**

`linearr_mcp/_request.py`:

```python
"""In-process Request shim.

Several route handlers read their body with `await request.json()` instead of a
Pydantic model. MCP tools must call those handlers rather than reimplement them
— that is the invariant that stops the MCP surface and the HTTP surface from
drifting — so we hand them a real Starlette Request over an in-memory body.
"""
import json

from starlette.requests import Request


def json_request(body: dict | list) -> Request:
    """A Starlette Request whose `.json()` returns `body`."""
    payload = json.dumps(body).encode()

    async def receive():
        return {"type": "http.request", "body": payload, "more_body": False}

    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "root_path": "",
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(payload)).encode()),
        ],
    }
    return Request(scope, receive)
```

Add to `tests/test_mcp_registry.py`:

```python
import pytest

from linearr_mcp._request import json_request


@pytest.mark.asyncio
async def test_json_request_round_trips_body():
    req = await_json(json_request({"icon": "data:image/png;base64,AAA"}))
    assert req == {"icon": "data:image/png;base64,AAA"}


def await_json(request):
    import asyncio
    return asyncio.get_event_loop().run_until_complete(request.json())
```

Simpler — the suite has no `pytest-asyncio`, so use `asyncio.run` in a sync test instead:

```python
import asyncio

from linearr_mcp._request import json_request


def test_json_request_round_trips_body():
    req = json_request({"icon": "data:image/png;base64,AAA"})
    assert asyncio.run(req.json()) == {"icon": "data:image/png;base64,AAA"}


def test_json_request_reports_content_length():
    req = json_request({"a": 1})
    assert req.headers["content-length"] == str(len(b'{"a": 1}'))
```

- [ ] **Step 2: Run the shim tests — expect failure**

Run: `./.venv-mcp/Scripts/python.exe -m pytest tests/test_mcp_registry.py -v`
Expected: FAIL, `ModuleNotFoundError: No module named 'linearr_mcp'` (before you create the file) then PASS once `_request.py` exists.

- [ ] **Step 3: Write `linearr_mcp/registry.py`**

This is the move-only version — annotations arrive in Task 2. It must reproduce today's `_tool_error`, `_mcp_args_summary` and `_instrument_mcp_tools` behaviour exactly, with the wrapper applied at registration time instead of afterwards.

```python
"""Tool registration for Linearr's MCP server.

Every tool goes through `ToolRegistry.tool()`, which applies the Activity-Log
wrapper at registration time. That ordering is the point: the previous design
wrapped tools in a pass that ran after the last registration, so any tool added
below that line silently lost its instrumentation.
"""
import inspect
import time
from typing import Callable

import httpx
from fastapi import HTTPException

TOOLSETS = (
    "channels", "icons", "assignments", "plex", "collections",
    "blocks", "tunarr", "watermark", "ai", "system",
)


def tool_error(exc: HTTPException) -> RuntimeError:
    """Convert an internal HTTPException into a human-readable tool error."""
    return RuntimeError(f"{exc.detail}" if exc.detail else f"HTTP {exc.status_code}")


_REDACT_HINTS = ("icon", "image", "token", "key", "secret", "password")


def args_summary(kwargs: dict) -> dict:
    """Compact, log-safe view of a tool call's arguments."""
    out = {}
    for k, v in kwargs.items():
        if any(h in k.lower() for h in _REDACT_HINTS) or (
            isinstance(v, str) and v.startswith("data:")
        ):
            out[k] = "<redacted>"
        elif isinstance(v, list) and len(v) > 5:
            out[k] = f"[{len(v)} items]"
        elif isinstance(v, str) and len(v) > 80:
            out[k] = v[:77] + "..."
        else:
            out[k] = v
    return out


class ToolRegistry:
    """Wraps FastMCP.tool with logging. Gating + annotations land in Task 2."""

    def __init__(self, mcp, api, enabled: set[str]):
        self.mcp = mcp
        self.api = api
        self.enabled = enabled
        self._counts: dict[str, int] = {t: 0 for t in TOOLSETS}

    def counts(self) -> dict[str, int]:
        return dict(self._counts)

    def tool(self, name: str, *, toolset: str, **_ignored) -> Callable:
        if toolset not in TOOLSETS:
            raise ValueError(f"Unknown toolset {toolset!r}")

        def decorate(fn):
            if toolset not in self.enabled:
                return fn
            self._counts[toolset] += 1
            return self.mcp.tool(name=name)(self._instrument(name, fn))

        return decorate

    def _instrument(self, name: str, fn):
        api = self.api

        async def logged(**kwargs):
            t0 = time.monotonic()
            summary = args_summary(kwargs)
            try:
                res = fn(**kwargs)
                if inspect.isawaitable(res):
                    res = await res
            except httpx.HTTPError as e:
                api._log_app("mcp", f"Tool {name} failed", level="error",
                             detail=f"Upstream unreachable: {e}",
                             duration_ms=int((time.monotonic() - t0) * 1000),
                             metadata={"tool": name, "args": summary})
                raise RuntimeError(f"Cannot reach the upstream server: {e}") from e
            except Exception as e:
                api._log_app("mcp", f"Tool {name} failed", level="error",
                             detail=str(e)[:500],
                             duration_ms=int((time.monotonic() - t0) * 1000),
                             metadata={"tool": name, "args": summary})
                raise
            api._log_app("mcp", f"Tool {name}",
                         duration_ms=int((time.monotonic() - t0) * 1000),
                         metadata={"tool": name, "args": summary})
            return res

        logged.__name__ = fn.__name__
        logged.__doc__ = fn.__doc__
        logged.__signature__ = inspect.signature(fn)
        logged.__annotations__ = dict(getattr(fn, "__annotations__", {}))
        return logged
```

The `__signature__` / `__annotations__` copy is load-bearing: `FastMCP` builds the tool's input schema by inspecting the function it is handed. Wrapping before registration (rather than after, as `_instrument_mcp_tools` did) means the wrapper — not the original — is what gets inspected.

- [ ] **Step 4: Write `linearr_mcp/__init__.py`**

```python
"""Linearr's MCP server: tool registration, split by toolset.

Never imports `main`. The FastAPI app module is passed in as `api` and handlers
are read off it, so there is no import cycle and no HTTP-to-self loop.
"""
from mcp.server.fastmcp import FastMCP

from .registry import TOOLSETS, ToolRegistry

INSTRUCTIONS = (
    "Linearr manages TV channel lineups for Plex + Tunarr. Channels hold "
    "content assignments (movies/shows from the user's Plex library). "
    "Typical flow: browse or search the library, create/pick a channel, "
    "assign items to it, then build Plex collections from the channel."
)


def _enabled_toolsets(api) -> set[str]:
    return set(TOOLSETS)


def build_mcp_server(api):
    """Build the FastMCP server. Returns (server, toolset_info)."""
    from . import assignments, channels, collections, plex

    mcp = FastMCP("linearr", instructions=INSTRUCTIONS)
    enabled = _enabled_toolsets(api)
    reg = ToolRegistry(mcp, api, enabled)

    for module in (channels, plex, assignments, collections):
        module.register(reg, api)

    counts = reg.counts()
    info = [{"name": t, "enabled": t in enabled, "tool_count": counts[t]}
            for t in TOOLSETS]
    return mcp, info
```

- [ ] **Step 5: Move the 25 existing tools into their modules verbatim**

Each module follows this shape — `channels.py` shown, the other three are the same pattern with the tools currently under their comment banners in `main.py`:

```python
"""channels toolset — the lineup itself."""
from fastapi import HTTPException

from .registry import tool_error


def register(reg, api):

    @reg.tool(name="list_channels", toolset="channels")
    async def list_channels() -> list[dict]:
        """List all channels in the lineup (number, name, tier, vibe, mode, style, color)."""
        # Strip icon blobs (base64 PNGs) — pure noise for an LLM consumer.
        return [{k: v for k, v in ch.items() if k != "icon"} for ch in api.list_channels()]

    @reg.tool(name="get_channel", toolset="channels")
    async def get_channel(number: int) -> dict:
        """Get one channel plus everything assigned to it (titles, types, years)."""
        ch = api._get_channel(number)
        if not ch:
            raise RuntimeError(f"Channel {number} not found")
        ch.pop("icon", None)
        with api.get_db() as conn:
            rows = conn.execute(
                "SELECT id, plex_rating_key, plex_title, plex_type, plex_year FROM assignments "
                "WHERE channel_number=? ORDER BY plex_title", (number,)).fetchall()
        ch["assignments"] = [dict(r) for r in rows]
        ch["assignment_count"] = len(ch["assignments"])
        return ch

    # ... create_channel, update_channel, delete_channel — copied from
    # main.py, with every bare handler reference qualified as `api.<name>`
    # and `_tool_error` replaced by `tool_error`.
```

Mechanical rules for the move:
- `_get_channel` → `api._get_channel`; `get_db` → `api.get_db`; `list_channels()` (the *handler*) → `api.list_channels()`; `ChannelIn` → `api.ChannelIn`; `plex_item` → `api.plex_item`; `bulk_assignments` → `api.bulk_assignments`; and so on for every name that resolved to a `main` global.
- `_tool_error` → `tool_error` (imported from `.registry`).
- The inner Python function names no longer need the `mcp_` prefix — the MCP tool name comes from `name=`. Drop the prefix for readability.

Split of the 25:
- `channels.py`: `list_channels`, `get_channel`, `create_channel`, `update_channel`, `delete_channel`
- `plex.py`: `list_libraries`, `browse_library`, `search_library`, `get_item`, `get_show_seasons`, `get_season_episodes`, `get_server_info`, `get_now_playing`, `get_recent_events`
- `assignments.py`: `list_assignments`, `assign_items`, `unassign_item`, `purge_channel_content`
- `collections.py`: `get_collection_status`, `build_collections`, `list_plex_collections`, `get_collection_items`, `create_smart_collection`, `update_smart_collection`, `delete_collection`

- [ ] **Step 6: Replace the MCP section in `main.py`**

Delete `main.py:7663-8077` (from `from mcp.server.fastmcp import FastMCP` through `_instrument_mcp_tools()`), keeping the `# ── MCP server` banner comment updated, and put in its place:

```python
# ── MCP server ────────────────────────────────────────────────────────────────
# Streamable-HTTP Model Context Protocol endpoint at /mcp. Tools live in the
# `linearr_mcp` package, one module per toolset; they call the route handlers in
# this module directly — no HTTP-to-self loop. Auth: bearer token (settings key
# `mcp_token`), enforced in auth_middleware.
import sys

from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.server.transport_security import TransportSecuritySettings

from linearr_mcp import build_mcp_server

mcp_server, MCP_TOOLSET_INFO = build_mcp_server(sys.modules[__name__])

_mcp_session_manager: StreamableHTTPSessionManager | None = None

def _make_mcp_session_manager() -> StreamableHTTPSessionManager:
    """One manager per app lifecycle — an instance can only be run once."""
    return StreamableHTTPSessionManager(
        app=mcp_server._mcp_server,
        json_response=True,
        stateless=True,
        # We do our own bearer auth in auth_middleware; Linearr is reached by
        # arbitrary LAN hostnames so Host-header pinning would break setups.
        security_settings=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )
```

`_mcp_asgi`, `app.mount("/mcp", _mcp_asgi)`, `/api/mcp/info` and `/api/mcp/regenerate-token` stay exactly as they are.

**Watch out:** `_make_mcp_session_manager` is referenced from `lifespan` earlier in the file, and `build_mcp_server` must run before it. It does — this is module-level code at the same position.

- [ ] **Step 7: Update the Dockerfile**

`Dockerfile:28` becomes:

```dockerfile
COPY main.py schedule_templates.json network_blocks.json ./
COPY linearr_mcp/ ./linearr_mcp/
```

- [ ] **Step 8: Run the full suite — expect 505 passed + the 2 new shim tests**

Run: `./.venv-mcp/Scripts/python.exe -m pytest`
Expected: `507 passed`. Any failure here means the move was not inert — fix it before continuing. Pay particular attention to `test_list_channels_strips_icons` and `test_mcp_tool_calls_are_logged`, which prove the wrapper survived.

- [ ] **Step 9: Commit**

```bash
git add linearr_mcp tests/test_mcp_registry.py main.py Dockerfile docs/superpowers
git commit -m "refactor(mcp): extract the MCP server into a linearr_mcp package"
```

---

### Task 2: Registry — annotations, structural instrumentation, gating

**Files:**
- Modify: `linearr_mcp/registry.py`, `linearr_mcp/__init__.py`, all four toolset modules (add annotation kwargs)
- Test: `tests/test_mcp_registry.py`

**Interfaces:**
- Consumes: `ToolRegistry` from Task 1.
- Produces:
  - `ToolRegistry.tool(name, *, toolset, read_only=False, destructive=False, idempotent=False, open_world=False)` now attaches `mcp.types.ToolAnnotations`.
  - `linearr_mcp.registry.resolve_toolsets(api) -> set[str]` — env `MCP_TOOLSETS`, then settings key `mcp_toolsets`, then all.
  - `ToolRegistry.toolset_of: dict[str, str]` — tool name → toolset.

- [ ] **Step 1: Write the failing structural tests**

Append to `tests/test_mcp_registry.py`:

```python
import main
from linearr_mcp.registry import TOOLSETS, resolve_toolsets


def _tools():
    return {t.name: t for t in main.mcp_server._tool_manager.list_tools()}


def test_every_tool_has_annotations():
    missing = [n for n, t in _tools().items() if t.annotations is None]
    assert not missing, f"tools without annotations: {missing}"


def test_read_tools_are_marked_read_only():
    tools = _tools()
    for name in ("list_channels", "get_channel", "search_library",
                 "list_assignments", "list_plex_collections"):
        assert tools[name].annotations.readOnlyHint is True, name


def test_destructive_tools_are_marked_destructive():
    tools = _tools()
    for name in ("delete_channel", "purge_channel_content",
                 "delete_collection", "unassign_item"):
        ann = tools[name].annotations
        assert ann.readOnlyHint is not True, name
        assert ann.destructiveHint is True, name


def test_write_tools_are_not_marked_read_only():
    tools = _tools()
    for name in ("create_channel", "assign_items", "build_collections"):
        assert tools[name].annotations.readOnlyHint is not True, name


def test_every_tool_belongs_to_a_declared_toolset():
    from linearr_mcp import TOOLSET_OF
    unknown = [n for n in _tools() if TOOLSET_OF.get(n) not in TOOLSETS]
    assert not unknown, f"tools with no toolset: {unknown}"


def test_toolset_counts_sum_to_registered_total():
    total = sum(t["tool_count"] for t in main.MCP_TOOLSET_INFO)
    assert total == len(_tools())


def test_env_var_selects_toolsets(monkeypatch):
    monkeypatch.setenv("MCP_TOOLSETS", "channels, plex")
    assert resolve_toolsets(main) == {"channels", "plex"}


def test_env_var_all_means_all(monkeypatch):
    monkeypatch.setenv("MCP_TOOLSETS", "all")
    assert resolve_toolsets(main) == set(TOOLSETS)


def test_unknown_toolset_names_are_ignored(monkeypatch):
    monkeypatch.setenv("MCP_TOOLSETS", "channels,bogus")
    assert resolve_toolsets(main) == {"channels"}


def test_empty_selection_falls_back_to_all(monkeypatch):
    monkeypatch.setenv("MCP_TOOLSETS", "bogus")
    assert resolve_toolsets(main) == set(TOOLSETS)


def test_gating_removes_exactly_one_toolset(monkeypatch):
    """Build a second server with `channels` disabled and diff the tool names."""
    from linearr_mcp import build_mcp_server
    monkeypatch.setenv("MCP_TOOLSETS", ",".join(t for t in TOOLSETS if t != "channels"))
    server, info = build_mcp_server(main)
    names = {t.name for t in server._tool_manager.list_tools()}
    assert "list_channels" not in names
    assert "list_assignments" in names
    assert next(i for i in info if i["name"] == "channels")["enabled"] is False
```

- [ ] **Step 2: Run — expect failures**

Run: `./.venv-mcp/Scripts/python.exe -m pytest tests/test_mcp_registry.py -v`
Expected: FAIL — `annotations is None`, `ImportError: cannot import name 'resolve_toolsets'`, `cannot import name 'TOOLSET_OF'`.

- [ ] **Step 3: Add annotations + gating to `registry.py`**

```python
import os

from mcp.types import ToolAnnotations
```

Replace `ToolRegistry.tool` and add `resolve_toolsets`:

```python
def resolve_toolsets(api) -> set[str]:
    """Which toolsets to register. env > settings > all.

    An unparseable or empty selection falls back to all — a typo must not
    silently produce a server with no tools.
    """
    raw = os.environ.get("MCP_TOOLSETS", "").strip()
    if not raw:
        try:
            with api.get_db() as conn:
                row = conn.execute(
                    "SELECT value FROM settings WHERE key='mcp_toolsets'").fetchone()
            raw = (row["value"] if row else "") or ""
        except Exception:
            raw = ""
    raw = raw.strip()
    if not raw or raw.lower() == "all":
        return set(TOOLSETS)
    chosen = {p.strip().lower() for p in raw.split(",") if p.strip()}
    valid = chosen & set(TOOLSETS)
    return valid or set(TOOLSETS)
```

```python
    def tool(self, name: str, *, toolset: str, read_only: bool = False,
             destructive: bool = False, idempotent: bool = False,
             open_world: bool = False) -> Callable:
        """Register an MCP tool.

        read_only   — makes no change; implies idempotent.
        destructive — removes or overwrites data a user would miss.
        idempotent  — calling twice with the same args has the same effect as once.
        open_world  — reaches Plex or Tunarr, so results depend on an external system.
        """
        if toolset not in TOOLSETS:
            raise ValueError(f"Unknown toolset {toolset!r}")
        if read_only and destructive:
            raise ValueError(f"{name}: a tool cannot be both read-only and destructive")

        annotations = ToolAnnotations(
            readOnlyHint=read_only,
            destructiveHint=destructive,
            idempotentHint=True if read_only else idempotent,
            openWorldHint=open_world,
        )

        def decorate(fn):
            self.toolset_of[name] = toolset
            if toolset not in self.enabled:
                return fn
            self._counts[toolset] += 1
            return self.mcp.tool(name=name, annotations=annotations)(
                self._instrument(name, fn))

        return decorate
```

Add `self.toolset_of: dict[str, str] = {}` to `__init__`.

- [ ] **Step 4: Export `TOOLSET_OF` and use `resolve_toolsets` in `__init__.py`**

```python
TOOLSET_OF: dict[str, str] = {}


def build_mcp_server(api):
    from . import assignments, channels, collections, plex

    mcp = FastMCP("linearr", instructions=INSTRUCTIONS)
    enabled = resolve_toolsets(api)
    reg = ToolRegistry(mcp, api, enabled)

    for module in (channels, plex, assignments, collections):
        module.register(reg, api)

    TOOLSET_OF.clear()
    TOOLSET_OF.update(reg.toolset_of)
    counts = reg.counts()
    info = [{"name": t, "enabled": t in enabled, "tool_count": counts[t]}
            for t in TOOLSETS]
    return mcp, info
```

- [ ] **Step 5: Annotate the 25 existing tools**

Apply the table from spec §3.2. Concretely:

| Tool | kwargs |
|---|---|
| `list_channels`, `get_channel`, `list_assignments` | `read_only=True` |
| `list_libraries`, `browse_library`, `search_library`, `get_item`, `get_show_seasons`, `get_season_episodes`, `get_server_info`, `get_now_playing`, `list_plex_collections`, `get_collection_items`, `get_collection_status` | `read_only=True, open_world=True` |
| `get_recent_events` | `read_only=True` |
| `create_channel` | `open_world=True` |
| `update_channel` | `idempotent=True, open_world=True` |
| `delete_channel` | `destructive=True, idempotent=True, open_world=True` |
| `assign_items` | `open_world=True` |
| `unassign_item`, `purge_channel_content` | `destructive=True, idempotent=True` |
| `build_collections`, `create_smart_collection` | `open_world=True` |
| `update_smart_collection` | `idempotent=True, open_world=True` |
| `delete_collection` | `destructive=True, idempotent=True, open_world=True` |

- [ ] **Step 6: Run the tests — expect pass**

Run: `./.venv-mcp/Scripts/python.exe -m pytest tests/test_mcp_registry.py tests/test_mcp.py tests/test_mcp_hardening.py -v`
Expected: PASS.

- [ ] **Step 7: Run the full suite**

Run: `./.venv-mcp/Scripts/python.exe -m pytest`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add linearr_mcp tests/test_mcp_registry.py
git commit -m "feat(mcp): annotate every tool and gate registration by toolset"
```

---

### Task 3: Toolset gating API + Settings UI

**Files:**
- Modify: `main.py` (`/api/mcp/info`, new `PUT /api/mcp/toolsets`)
- Modify: `frontend/src/features/settings/api.ts`, `hooks.ts`, `components/SettingsView.tsx`
- Test: `tests/test_mcp_registry.py`

**Interfaces:**
- Consumes: `main.MCP_TOOLSET_INFO` from Task 1, `resolve_toolsets` from Task 2.
- Produces: `GET /api/mcp/info` → `{endpoint, token, tool_count, toolsets: [{name, enabled, tool_count}], restart_required: bool}`; `PUT /api/mcp/toolsets` body `{toolsets: string[]}` → `{ok: true, toolsets: string[], restart_required: true}`.

- [ ] **Step 1: Write the failing API tests**

```python
def test_mcp_info_reports_toolsets(auth_client):
    info = auth_client.get("/api/mcp/info").json()
    names = [t["name"] for t in info["toolsets"]]
    assert names == list(TOOLSETS)
    assert info["tool_count"] == sum(t["tool_count"] for t in info["toolsets"])


def test_put_toolsets_persists_selection(auth_client):
    r = auth_client.put("/api/mcp/toolsets", json={"toolsets": ["channels", "plex"]})
    assert r.status_code == 200, r.text
    assert r.json()["restart_required"] is True
    with main.get_db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key='mcp_toolsets'").fetchone()
    assert row["value"] == "channels,plex"
    # restore
    auth_client.put("/api/mcp/toolsets", json={"toolsets": list(TOOLSETS)})


def test_put_toolsets_rejects_unknown_names(auth_client):
    r = auth_client.put("/api/mcp/toolsets", json={"toolsets": ["nope"]})
    assert r.status_code == 400


def test_put_toolsets_requires_session(client):
    assert client.put("/api/mcp/toolsets", json={"toolsets": ["channels"]}).status_code == 401
```

- [ ] **Step 2: Run — expect 404 / 405 on the new route**

Run: `./.venv-mcp/Scripts/python.exe -m pytest tests/test_mcp_registry.py -k toolsets -v`
Expected: FAIL.

- [ ] **Step 3: Implement the routes in `main.py`**

Replace `mcp_info` and add the setter, immediately after it:

```python
class McpToolsetsIn(BaseModel):
    toolsets: list[str]


@app.get("/api/mcp/info")
def mcp_info():
    """Connection info for the MCP endpoint (shown in Settings)."""
    return {
        "endpoint": "/mcp",
        "token": _get_mcp_token(),
        "tool_count": len(mcp_server._tool_manager.list_tools()),
        "toolsets": MCP_TOOLSET_INFO,
    }


@app.put("/api/mcp/toolsets")
def mcp_set_toolsets(body: McpToolsetsIn):
    """Choose which MCP toolsets are registered.

    Tools are registered at import, so a change takes effect on the next app
    start — the response says so rather than pretending it was live.
    """
    from linearr_mcp.registry import TOOLSETS as _ALL
    chosen = [t.strip().lower() for t in body.toolsets if t.strip()]
    unknown = [t for t in chosen if t not in _ALL]
    if unknown:
        raise HTTPException(400, f"Unknown toolset(s): {', '.join(unknown)}")
    if not chosen:
        raise HTTPException(400, "Select at least one toolset")
    value = ",".join(t for t in _ALL if t in chosen)
    with get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('mcp_toolsets', ?)", (value,))
    _log_app("system", f"MCP toolsets set to: {value}", "warn")
    return {"ok": True, "toolsets": value.split(","), "restart_required": True}
```

- [ ] **Step 4: Run the API tests — expect pass**

Run: `./.venv-mcp/Scripts/python.exe -m pytest tests/test_mcp_registry.py -k toolsets -v`
Expected: PASS.

- [ ] **Step 5: Frontend — types and API**

In `frontend/src/features/settings/api.ts`, extend `McpInfo` and add the setter:

```ts
export interface McpToolset {
  name: string
  enabled: boolean
  tool_count: number
}

export interface McpInfo {
  endpoint: string
  token: string
  tool_count: number
  toolsets: McpToolset[]
}

function setMcpToolsets(toolsets: string[]): Promise<{ ok: boolean; toolsets: string[] }> {
  return put<{ ok: boolean; toolsets: string[] }>('/api/mcp/toolsets', { toolsets })
}
```

Export `setMcpToolsets` from the api object alongside `getMcpInfo` and `regenerateMcpToken`. Import `put` from the shared client the same way `post` is already imported in this file.

- [ ] **Step 6: Frontend — hook**

In `frontend/src/features/settings/hooks.ts`, mirroring `useRegenerateMcpToken`:

```ts
export function useSetMcpToolsets() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  return useMutation({
    mutationFn: (toolsets: string[]) => settingsApi.setMcpToolsets(toolsets),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mcp', 'info'] })
      addToast('MCP toolsets saved — restart Linearr to apply')
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to save MCP toolsets', true)
    },
  })
}
```

- [ ] **Step 7: Frontend — the toolset checkboxes**

In `McpServerCard` (`SettingsView.tsx`), replace the `{mcpInfo.tool_count} tools available` line with a block that keeps that summary and adds the per-toolset controls. Follow the existing card's Tailwind idiom (`text-xs text-slate-400`, `bg-slate-800`, `rounded`):

```tsx
const setToolsets = useSetMcpToolsets()
const [draft, setDraft] = useState<string[] | null>(null)
const selected = draft ?? mcpInfo.toolsets.filter((t) => t.enabled).map((t) => t.name)
const dirty = draft !== null

function toggle(name: string) {
  setDraft(selected.includes(name)
    ? selected.filter((n) => n !== name)
    : [...selected, name])
}
```

```tsx
<div className="space-y-2">
  <p className="text-xs text-slate-400">
    {mcpInfo.tool_count} tools available across {mcpInfo.toolsets.length} toolsets
  </p>
  <div className="flex flex-wrap gap-1.5">
    {mcpInfo.toolsets.map((ts) => (
      <label
        key={ts.name}
        className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs cursor-pointer ${
          selected.includes(ts.name)
            ? 'bg-indigo-500/15 text-indigo-200'
            : 'bg-slate-800 text-slate-400'
        }`}
      >
        <input
          type="checkbox"
          className="accent-indigo-500"
          checked={selected.includes(ts.name)}
          onChange={() => toggle(ts.name)}
        />
        {ts.name}
        <span className="text-slate-500">{ts.tool_count}</span>
      </label>
    ))}
  </div>
  {dirty && (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={selected.length === 0 || setToolsets.isPending}
        onClick={() => setToolsets.mutate(selected, { onSuccess: () => setDraft(null) })}
        className="rounded bg-indigo-600 px-2.5 py-1 text-xs text-white disabled:opacity-40"
      >
        Save toolsets
      </button>
      <button type="button" onClick={() => setDraft(null)}
              className="text-xs text-slate-400">Cancel</button>
      <span className="text-xs text-amber-400/80">Restart Linearr to apply</span>
    </div>
  )}
</div>
```

Import `useSetMcpToolsets` at the top of `SettingsView.tsx` next to `useMcpInfo`, and `useState` if it is not already imported.

- [ ] **Step 8: Type-check and build the frontend**

Run: `cd frontend && npm run build`
Expected: build succeeds, no TypeScript errors.

- [ ] **Step 9: Run the full suite and commit**

```bash
./.venv-mcp/Scripts/python.exe -m pytest
git add main.py frontend/src/features/settings tests/test_mcp_registry.py
git commit -m "feat(mcp): toolset selection API and Settings control"
```

---

### Task 4: `channels` and `icons` toolsets

**Files:**
- Modify: `linearr_mcp/channels.py`
- Create: `linearr_mcp/icons.py`
- Modify: `linearr_mcp/__init__.py` (register `icons`)
- Test: `tests/test_mcp_tools.py`

**Interfaces:**
- Consumes: `reg.tool`, `tool_error`, `json_request`.
- Produces: tools `reorder_channel`, `sync_channel_to_tunarr`, `create_channel_package`, `suggest_247_channels`, `set_channel_icon`, `clear_channel_icon`, `list_icon_library`, `save_icon`, `update_saved_icon`, `delete_saved_icon`, `import_icons_from_tunarr`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_mcp_tools.py`:

```python
"""Behavioural tests for the expanded MCP tool surface."""
import json

import pytest

import main
from tests.test_mcp import MCP_HEADERS, _call, _token


def _text(result):
    assert not result.get("isError"), result
    return result["content"][0]["text"]


def _json(result):
    return json.loads(_text(result))


# ── channels ─────────────────────────────────────────────────────────────────

def test_reorder_channel_renumbers(auth_client):
    token = _token(auth_client)
    for n, name in ((901, "Alpha"), (902, "Bravo"), (903, "Charlie")):
        auth_client.post("/api/channels", json={"number": n, "name": name,
                                                "tier": "Galaxy Main"})
    try:
        before = [c["number"] for c in auth_client.get("/api/channels").json()]
        idx = before.index(903)
        result = _json(_call(auth_client, token, "reorder_channel",
                             {"moved_number": 903, "target_index": before.index(901)}))
        assert "changed" in result
        after = [c["number"] for c in auth_client.get("/api/channels").json()]
        assert len(after) == len(before)
        assert idx >= 0
    finally:
        for n in (901, 902, 903):
            auth_client.delete(f"/api/channels/{n}")


def test_create_channel_package_creates_many(auth_client):
    token = _token(auth_client)
    try:
        result = _json(_call(auth_client, token, "create_channel_package", {
            "channels": [{"number": 911, "name": "Pack One"},
                         {"number": 912, "name": "Pack Two"}]}))
        assert sorted(result["created"]) == [911, 912]
    finally:
        for n in (911, 912):
            auth_client.delete(f"/api/channels/{n}")


def test_set_and_clear_channel_icon(auth_client):
    token = _token(auth_client)
    auth_client.post("/api/channels", json={"number": 913, "name": "Icon Ch"})
    try:
        _call(auth_client, token, "set_channel_icon",
              {"channel_number": 913, "icon": "data:image/png;base64,AAAA"})
        with main.get_db() as conn:
            row = conn.execute("SELECT icon FROM channels WHERE number=913").fetchone()
        assert row["icon"] == "data:image/png;base64,AAAA"
        _call(auth_client, token, "clear_channel_icon", {"channel_number": 913})
        with main.get_db() as conn:
            row = conn.execute("SELECT icon FROM channels WHERE number=913").fetchone()
        assert row["icon"] is None
    finally:
        auth_client.delete("/api/channels/913")


def test_set_channel_icon_redacts_the_blob_from_logs(auth_client):
    token = _token(auth_client)
    auth_client.post("/api/channels", json={"number": 914, "name": "Redact Ch"})
    try:
        _call(auth_client, token, "set_channel_icon",
              {"channel_number": 914, "icon": "data:image/png;base64," + "Z" * 400})
        logs = auth_client.get("/api/app-logs?limit=1000").json()
        entries = logs.get("logs", logs) if isinstance(logs, dict) else logs
        blob = json.dumps(entries)
        assert "ZZZZZ" not in blob
    finally:
        auth_client.delete("/api/channels/914")


# ── icons ────────────────────────────────────────────────────────────────────

def test_icon_library_round_trip(auth_client):
    token = _token(auth_client)
    saved = _json(_call(auth_client, token, "save_icon",
                        {"name": "Test Icon", "data": "data:image/png;base64,BBBB"}))
    icon_id = saved["id"]
    try:
        listed = _json(_call(auth_client, token, "list_icon_library"))
        entry = next(i for i in listed if i["id"] == icon_id)
        assert entry["name"] == "Test Icon"
        assert "data" not in entry, "icon data must be stripped unless asked for"

        with_data = _json(_call(auth_client, token, "list_icon_library",
                                {"include_data": True}))
        assert any(i["id"] == icon_id and i["data"] for i in with_data)

        _call(auth_client, token, "update_saved_icon",
              {"icon_id": icon_id, "name": "Renamed"})
        listed = _json(_call(auth_client, token, "list_icon_library"))
        assert next(i for i in listed if i["id"] == icon_id)["name"] == "Renamed"
    finally:
        _call(auth_client, token, "delete_saved_icon", {"icon_id": icon_id})
    listed = _json(_call(auth_client, token, "list_icon_library"))
    assert not any(i["id"] == icon_id for i in listed)
```

- [ ] **Step 2: Run — expect "Unknown tool" errors**

Run: `./.venv-mcp/Scripts/python.exe -m pytest tests/test_mcp_tools.py -v`
Expected: FAIL.

- [ ] **Step 3: Add the channel tools to `linearr_mcp/channels.py`**

```python
    @reg.tool(name="reorder_channel", toolset="channels",
              idempotent=True, open_world=True)
    async def reorder_channel(moved_number: int, target_index: int,
                              target_tier: str | None = None) -> dict:
        """Move a channel to a new position in the lineup. This RENUMBERS it —
        `number` is the primary key, so ordering is by number and there is no
        separate order column. `target_index` is the 0-based index the channel
        should occupy in the resulting lineup. Pass `target_tier` only for a
        cross-tier move. Assignments, blocks, collection links, Tunarr links and
        AI logs all follow the channel. Tunarr is renumbered after the local
        commit; entries in `tunarr.failed` mean Tunarr is out of step, NOT that
        the reorder failed."""
        try:
            return await api.reorder_channels(api.ChannelReorderIn(
                moved_number=moved_number, target_index=target_index,
                target_tier=target_tier))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="sync_channel_to_tunarr", toolset="channels",
              idempotent=True, open_world=True)
    async def sync_channel_to_tunarr(channel_number: int) -> dict:
        """Push a channel's name, number and icon to its linked Tunarr channel."""
        try:
            return await api.sync_channel_to_tunarr(channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="create_channel_package", toolset="channels")
    async def create_channel_package(channels: list[dict]) -> dict:
        """Create several channels at once. Each entry needs `number` and `name`;
        `tier`, `vibe`, `mode`, `description`, `color` are optional. Numbers that
        already exist are skipped, not errors. Local only — unlike
        `create_channel` this does NOT create matching Tunarr channels; call
        `export_channels_to_tunarr` afterwards if you want them."""
        try:
            return api.create_channel_package({"channels": channels})
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="suggest_247_channels", toolset="channels",
              read_only=True, open_world=True)
    async def suggest_247_channels() -> dict:
        """Analyse the Plex library and suggest 24/7 single-show or franchise
        channels worth creating. Library analysis, not an AI call — no API key
        needed."""
        try:
            return await api.suggest_247_channels()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="set_channel_icon", toolset="channels",
              idempotent=True, open_world=True)
    async def set_channel_icon(channel_number: int, icon: str | None = None,
                               icon_id: int | None = None) -> dict:
        """Set a channel's icon, from a base64 data URI (`icon`) or an entry in
        the icon library (`icon_id`). Also re-syncs the channel — and any
        icon-following watermark — to Tunarr."""
        if icon_id is not None and not icon:
            with api.get_db() as conn:
                row = conn.execute("SELECT data FROM saved_icons WHERE id=?",
                                   (icon_id,)).fetchone()
            if not row:
                raise RuntimeError(f"Icon {icon_id} not found in the library")
            icon = row["data"]
        if not icon:
            raise RuntimeError("Pass either `icon` (a data URI) or `icon_id`")
        try:
            return await api.set_channel_icon(channel_number, json_request({"icon": icon}))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="clear_channel_icon", toolset="channels",
              destructive=True, idempotent=True, open_world=True)
    async def clear_channel_icon(channel_number: int) -> dict:
        """Remove a channel's icon, clearing it in Tunarr too."""
        try:
            return await api.delete_channel_icon(channel_number)
        except HTTPException as e:
            raise tool_error(e)
```

Add `from ._request import json_request` to the module imports.

- [ ] **Step 4: Write `linearr_mcp/icons.py`**

```python
"""icons toolset — the reusable icon library and Tunarr icon import.

Deliberately omits the icon-pack export/import/seed routes: they move megabytes
of base64 PNG, which is pure cost in an LLM transcript. The UI owns them.
"""
from fastapi import HTTPException

from ._request import json_request
from .registry import tool_error


def register(reg, api):

    @reg.tool(name="list_icon_library", toolset="icons", read_only=True)
    async def list_icon_library(include_data: bool = False) -> list[dict]:
        """List saved icons (id, name, category). Data URIs are stripped unless
        `include_data` is true — they are large and rarely useful to read."""
        rows = api.list_saved_icons()
        if include_data:
            return rows
        return [{k: v for k, v in r.items() if k not in ("data", "composition")}
                for r in rows]

    @reg.tool(name="save_icon", toolset="icons")
    async def save_icon(name: str, data: str, category: str = "custom") -> dict:
        """Save an icon to the library. `data` is a base64 data URI."""
        try:
            return await api.save_icon(json_request(
                {"name": name, "data": data, "category": category}))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="update_saved_icon", toolset="icons", idempotent=True)
    async def update_saved_icon(icon_id: int, name: str | None = None,
                                category: str | None = None,
                                data: str | None = None) -> dict:
        """Rename, recategorise or replace a saved icon. Only fields you pass change."""
        body = {k: v for k, v in
                (("name", name), ("category", category), ("data", data))
                if v is not None}
        if not body:
            raise RuntimeError("Pass at least one of name, category, data")
        try:
            return await api.update_saved_icon(icon_id, json_request(body))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="delete_saved_icon", toolset="icons",
              destructive=True, idempotent=True)
    async def delete_saved_icon(icon_id: int) -> dict:
        """Delete an icon from the library. Channels already using it keep their copy."""
        try:
            return api.delete_saved_icon(icon_id)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="import_icons_from_tunarr", toolset="icons", open_world=True)
    async def import_icons_from_tunarr() -> dict:
        """Pull channel logos from Tunarr into the icon library."""
        try:
            return await api.import_icons_from_tunarr()
        except HTTPException as e:
            raise tool_error(e)
```

- [ ] **Step 5: Register `icons` in `__init__.py`**

Add `icons` to the import line and to the module tuple, keeping the tuple in toolset order.

- [ ] **Step 6: Run the tests — expect pass**

Run: `./.venv-mcp/Scripts/python.exe -m pytest tests/test_mcp_tools.py tests/test_mcp_registry.py -v`
Expected: PASS.

- [ ] **Step 7: Full suite and commit**

```bash
./.venv-mcp/Scripts/python.exe -m pytest
git add linearr_mcp tests/test_mcp_tools.py
git commit -m "feat(mcp): channel reorder, packages, icons and the icon library"
```

---

### Task 5: `assignments` and `watermark` toolsets

**Files:**
- Modify: `linearr_mcp/assignments.py` (rewrite `unassign_item` to use the handler)
- Create: `linearr_mcp/watermark.py`
- Modify: `linearr_mcp/__init__.py`
- Test: `tests/test_mcp_tools.py`

**Interfaces:**
- Produces: tools `get_channel_watermark`, `set_channel_watermark`, `clear_channel_watermark`, `set_watermark_image`.

- [ ] **Step 1: Write the failing tests**

```python
# ── watermark ────────────────────────────────────────────────────────────────

def test_watermark_set_get_clear(auth_client):
    token = _token(auth_client)
    auth_client.post("/api/channels", json={"number": 921, "name": "WM Ch"})
    try:
        assert _json(_call(auth_client, token, "get_channel_watermark",
                           {"channel_number": 921}))["watermark"] is None

        _call(auth_client, token, "set_channel_watermark", {
            "channel_number": 921, "enabled": True, "position": "top-left",
            "width": 12.5, "opacity": 80})
        wm = _json(_call(auth_client, token, "get_channel_watermark",
                         {"channel_number": 921}))["watermark"]
        assert wm["enabled"] is True
        assert wm["position"] == "top-left"
        assert wm["opacity"] == 80

        _call(auth_client, token, "clear_channel_watermark", {"channel_number": 921})
        assert _json(_call(auth_client, token, "get_channel_watermark",
                           {"channel_number": 921}))["watermark"] is None
    finally:
        auth_client.delete("/api/channels/921")


def test_set_watermark_rejects_bad_position(auth_client):
    token = _token(auth_client)
    auth_client.post("/api/channels", json={"number": 922, "name": "WM Bad"})
    try:
        result = _call(auth_client, token, "set_channel_watermark",
                       {"channel_number": 922, "enabled": True, "position": "middle"})
        assert result.get("isError")
    finally:
        auth_client.delete("/api/channels/922")


def test_unassign_item_reports_missing(auth_client):
    token = _token(auth_client)
    auth_client.post("/api/channels", json={"number": 923, "name": "Unassign Ch"})
    try:
        result = _call(auth_client, token, "unassign_item",
                       {"channel_number": 923, "rating_key": "does-not-exist"})
        assert result.get("isError")
    finally:
        auth_client.delete("/api/channels/923")
```

- [ ] **Step 2: Run — expect failure**

Run: `./.venv-mcp/Scripts/python.exe -m pytest tests/test_mcp_tools.py -k "watermark or unassign" -v`
Expected: FAIL.

- [ ] **Step 3: Rewrite `unassign_item` to go through the handler**

In `linearr_mcp/assignments.py`, replace the raw-SQL body:

```python
    @reg.tool(name="unassign_item", toolset="assignments",
              destructive=True, idempotent=True)
    async def unassign_item(channel_number: int, rating_key: str) -> dict:
        """Remove one assigned item from a channel (by Plex rating key)."""
        with api.get_db() as conn:
            row = conn.execute(
                "SELECT id FROM assignments WHERE channel_number=? AND plex_rating_key=?",
                (channel_number, rating_key)).fetchone()
        if not row:
            raise RuntimeError(
                f"Nothing assigned with rating key {rating_key} on channel {channel_number}")
        try:
            api.delete_assignment(row["id"])
        except HTTPException as e:
            raise tool_error(e)
        return {"ok": True, "removed": 1}
```

- [ ] **Step 4: Write `linearr_mcp/watermark.py`**

```python
"""watermark toolset — per-channel Tunarr watermark configuration."""
from fastapi import HTTPException

from .registry import tool_error


def register(reg, api):

    @reg.tool(name="get_channel_watermark", toolset="watermark", read_only=True)
    async def get_channel_watermark(channel_number: int) -> dict:
        """Read a channel's watermark config. `{"watermark": null}` means none is set."""
        try:
            return api.get_channel_watermark(channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="set_channel_watermark", toolset="watermark",
              idempotent=True, open_world=True)
    async def set_channel_watermark(
        channel_number: int, enabled: bool = False,
        position: str = "bottom-right", width: float = 10.0,
        vertical_margin: float = 1.0, horizontal_margin: float = 1.0,
        duration: float = 0.0, opacity: int = 100, fixed_size: bool = False,
        use_channel_icon: bool = True, fade_period_mins: int | None = None,
        fade_leading_edge: bool = True,
    ) -> dict:
        """Set a channel's watermark and re-sync it to Tunarr.

        position: top-left | top-right | bottom-left | bottom-right.
        width is a percent of frame width and must be > 0 (inert when
        `fixed_size`). opacity 0-100, margins 0-100, duration in seconds
        (0 = always on). Set `fade_period_mins` (>= 1) to fade it in and out.
        A watermark cannot be enabled without an image — set one first with
        `set_watermark_image`, or leave `use_channel_icon` true on a channel
        that has an icon."""
        fade = (api.WatermarkFade(period_mins=fade_period_mins,
                                  leading_edge=fade_leading_edge)
                if fade_period_mins is not None else None)
        try:
            body = api.WatermarkIn(
                enabled=enabled, position=position, width=width,
                vertical_margin=vertical_margin, horizontal_margin=horizontal_margin,
                duration=duration, opacity=opacity, fixed_size=fixed_size,
                use_channel_icon=use_channel_icon, fade=fade)
        except ValueError as e:
            raise RuntimeError(str(e))
        try:
            return await api.put_channel_watermark(channel_number, body)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="clear_channel_watermark", toolset="watermark",
              destructive=True, idempotent=True, open_world=True)
    async def clear_channel_watermark(channel_number: int) -> dict:
        """Remove a channel's watermark and push `enabled: false` to Tunarr."""
        try:
            return await api.delete_channel_watermark(channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="set_watermark_image", toolset="watermark",
              idempotent=True, open_world=True)
    async def set_watermark_image(channel_number: int, image: str | None = None,
                                  url: str | None = None) -> dict:
        """Resolve the watermark image to an absolute URL Tunarr can fetch.

        Pass `url` (an absolute URL, stored as-is), `image` (a data URI, uploaded
        to Tunarr), or neither to use the channel's icon. ffmpeg cannot read a
        data URI, which is why this step exists at all."""
        try:
            return await api.set_channel_watermark_image(
                channel_number, api.WatermarkImageIn(image=image, url=url))
        except HTTPException as e:
            raise tool_error(e)
```

- [ ] **Step 5: Register `watermark` in `__init__.py`**

- [ ] **Step 6: Run tests, full suite, commit**

```bash
./.venv-mcp/Scripts/python.exe -m pytest
git add linearr_mcp tests/test_mcp_tools.py
git commit -m "feat(mcp): watermark toolset; route unassign_item through the handler"
```

---

### Task 6: `plex` toolset — 12 new tools

**Files:**
- Modify: `linearr_mcp/plex.py`
- Test: `tests/test_mcp_tools.py`

**Interfaces:**
- Produces: `get_library_filters`, `get_library_stats`, `get_plex_highlights`, `get_plex_hubs`, `get_watch_history`, `list_playlists`, `rate_item`, `scan_library`, `clear_recent_events`, `test_plex_connection`, `get_plex_auth_info`, `refresh_plex_token`.

- [ ] **Step 1: Write the failing tests**

The suite already mocks Plex with `respx`; follow the pattern in `tests/test_mcp.py`. Tools that need no Plex call can be tested directly:

```python
# ── plex ─────────────────────────────────────────────────────────────────────

def test_get_plex_auth_info_reports_mode(auth_client):
    token = _token(auth_client)
    info = _json(_call(auth_client, token, "get_plex_auth_info"))
    assert info["mode"] in ("legacy", "jwt")


def test_clear_recent_events_empties_the_log(auth_client):
    token = _token(auth_client)
    _call(auth_client, token, "clear_recent_events")
    assert _json(_call(auth_client, token, "get_recent_events", {"limit": 5})) == []


def test_get_plex_highlights_rejects_unknown_kind(auth_client):
    token = _token(auth_client)
    result = _call(auth_client, token, "get_plex_highlights", {"kind": "nonsense"})
    assert result.get("isError")
    assert "recently_added" in _text_of_error(result)


def _text_of_error(result):
    return result["content"][0]["text"]
```

- [ ] **Step 2: Run — expect failure**

Run: `./.venv-mcp/Scripts/python.exe -m pytest tests/test_mcp_tools.py -k plex -v`

- [ ] **Step 3: Add the tools to `linearr_mcp/plex.py`**

```python
_HIGHLIGHT_KINDS = {"recently_added", "on_deck", "popular"}


    @reg.tool(name="get_library_filters", toolset="plex",
              read_only=True, open_world=True)
    async def get_library_filters(section_id: str) -> dict:
        """Available filter values for a library section: genres, years, content
        ratings. Use before `browse_library` so you filter on values that exist."""
        try:
            return await api.plex_library_filters(section_id)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_library_stats", toolset="plex",
              read_only=True, open_world=True)
    async def get_library_stats() -> dict:
        """Counts and totals per Plex library section."""
        try:
            return await api.plex_library_stats()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_plex_highlights", toolset="plex",
              read_only=True, open_world=True)
    async def get_plex_highlights(kind: str = "recently_added", limit: int = 20) -> list[dict]:
        """Curated item lists from Plex. kind: recently_added | on_deck | popular."""
        if kind not in _HIGHLIGHT_KINDS:
            raise RuntimeError(
                f"kind must be one of {', '.join(sorted(_HIGHLIGHT_KINDS))}")
        fn = {"recently_added": api.plex_recently_added,
              "on_deck": api.plex_on_deck,
              "popular": api.plex_popular}[kind]
        try:
            return await fn(limit)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_plex_hubs", toolset="plex", read_only=True, open_world=True)
    async def get_plex_hubs(section_id: str | None = None) -> dict | list:
        """Plex's own recommendation hubs — server-wide, or for one section."""
        try:
            if section_id:
                return await api.plex_library_hubs(section_id)
            return await api.plex_hubs()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_watch_history", toolset="plex",
              read_only=True, open_world=True)
    async def get_watch_history(limit: int = 50) -> list[dict]:
        """Recently watched items from the Plex server's history."""
        try:
            return await api.plex_history(limit)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="list_playlists", toolset="plex", read_only=True, open_world=True)
    async def list_playlists() -> list[dict]:
        """Playlists on the Plex server."""
        try:
            return await api.plex_playlists()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="rate_item", toolset="plex", idempotent=True, open_world=True)
    async def rate_item(rating_key: str, rating: float) -> dict:
        """Set the user rating on a Plex item. 0 clears it, 1-10 sets it."""
        try:
            return await api.plex_rate_item(rating_key, api.PlexRateIn(rating=rating))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="scan_library", toolset="plex", idempotent=True, open_world=True)
    async def scan_library(section_id: str) -> dict:
        """Ask Plex to rescan a library section for new files."""
        try:
            return await api.plex_scan_library(section_id)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="clear_recent_events", toolset="plex",
              destructive=True, idempotent=True)
    async def clear_recent_events() -> dict:
        """Delete the stored Plex webhook event history."""
        try:
            return api.clear_plex_events()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="test_plex_connection", toolset="plex",
              read_only=True, open_world=True)
    async def test_plex_connection() -> dict:
        """Check that Linearr can reach Plex with the configured URL and token."""
        try:
            return await api.plex_test()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_plex_auth_info", toolset="plex", read_only=True)
    async def get_plex_auth_info() -> dict:
        """How Linearr authenticates to Plex: legacy token or JWT device key,
        token age, and whether it needs refreshing. Never returns the token."""
        try:
            return api.plex_auth_info()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="refresh_plex_token", toolset="plex",
              idempotent=True, open_world=True)
    async def refresh_plex_token() -> dict:
        """Mint a fresh Plex token from the stored device key (JWT auth only).
        JWT tokens last about 7 days; check `get_plex_auth_info` first."""
        try:
            return await api.plex_jwt_refresh()
        except HTTPException as e:
            raise tool_error(e)
```

**Note:** `plex_recently_added`, `plex_on_deck`, `plex_popular` and `plex_history` are declared with `limit: int = Query(20)`. Calling them positionally with a plain int is correct — `Query(...)` only matters to FastAPI's dependency resolution, not to a direct call.

- [ ] **Step 4: Run tests, full suite, commit**

```bash
./.venv-mcp/Scripts/python.exe -m pytest
git add linearr_mcp tests/test_mcp_tools.py
git commit -m "feat(mcp): plex discovery, history, ratings, scans and auth diagnostics"
```

---

### Task 7: `collections` toolset — 9 new tools

**Files:**
- Modify: `linearr_mcp/collections.py`
- Test: `tests/test_mcp_tools.py`

**Interfaces:**
- Produces: `create_collection`, `add_collection_items`, `remove_collection_item`, `update_collection`, `list_channel_collections`, `assign_collection_to_channel`, `import_collection_to_channel`, `unlink_channel_collection`, `create_channel_smart_collection`.

- [ ] **Step 1: Write the failing tests**

```python
# ── collections ──────────────────────────────────────────────────────────────

def test_assign_collection_to_channel_records_the_slot(auth_client):
    token = _token(auth_client)
    auth_client.post("/api/channels", json={"number": 931, "name": "Coll Ch"})
    try:
        _call(auth_client, token, "assign_collection_to_channel", {
            "channel_number": 931, "plex_type": "movie",
            "collection_rating_key": "555", "collection_title": "Someone Else's Picks"})
        listed = _json(_call(auth_client, token, "list_channel_collections",
                             {"channel_number": 931}))
        assert any(str(c["collection_rating_key"]) == "555" for c in listed)

        _call(auth_client, token, "unlink_channel_collection",
              {"channel_number": 931, "plex_type": "movie"})
        listed = _json(_call(auth_client, token, "list_channel_collections",
                             {"channel_number": 931}))
        assert not any(str(c["collection_rating_key"]) == "555" for c in listed)
    finally:
        auth_client.delete("/api/channels/931")


def test_assign_collection_rejects_a_linearr_owned_title(auth_client):
    """The '{Channel} Movies' name is reserved — assigning it would let a later
    build rewrite the user's own collection."""
    token = _token(auth_client)
    auth_client.post("/api/channels", json={"number": 932, "name": "Owned"})
    try:
        result = _call(auth_client, token, "assign_collection_to_channel", {
            "channel_number": 932, "plex_type": "movie",
            "collection_rating_key": "556", "collection_title": "Owned Movies"})
        assert result.get("isError")
    finally:
        auth_client.delete("/api/channels/932")


def test_unlink_unknown_collection_errors(auth_client):
    token = _token(auth_client)
    result = _call(auth_client, token, "unlink_channel_collection",
                   {"channel_number": 99999, "plex_type": "movie"})
    assert result.get("isError")
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Add the tools to `linearr_mcp/collections.py`**

```python
    @reg.tool(name="create_collection", toolset="collections", open_world=True)
    async def create_collection(section_id: str, title: str,
                                rating_keys: list[str], type: str = "movie") -> dict:
        """Create a regular (non-smart) Plex collection from a list of items.
        type: movie | show. For a rule-based collection that stays current on its
        own, use `create_smart_collection` instead."""
        try:
            return await api.plex_create_collection(json_request({
                "section_id": section_id, "title": title,
                "type": type, "items": rating_keys}))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="add_collection_items", toolset="collections", open_world=True)
    async def add_collection_items(rating_key: str, item_keys: list[str]) -> dict:
        """Add items to an existing Plex collection, by their rating keys."""
        try:
            return await api.plex_add_collection_items(
                rating_key, json_request({"items": item_keys}))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="remove_collection_item", toolset="collections",
              destructive=True, idempotent=True, open_world=True)
    async def remove_collection_item(rating_key: str, item_key: str) -> dict:
        """Remove one item from a Plex collection. The library item is untouched."""
        try:
            return await api.plex_remove_collection_item(rating_key, item_key)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="update_collection", toolset="collections",
              idempotent=True, open_world=True)
    async def update_collection(rating_key: str, title: str | None = None,
                                summary: str | None = None) -> dict:
        """Rename a Plex collection or change its summary."""
        body = {k: v for k, v in (("title", title), ("summary", summary))
                if v is not None}
        if not body:
            raise RuntimeError("Pass title and/or summary")
        try:
            return await api.plex_update_collection(rating_key, json_request(body))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="list_channel_collections", toolset="collections", read_only=True)
    async def list_channel_collections(channel_number: int) -> list[dict]:
        """Which Plex collections a channel uses, per content type."""
        try:
            return api.get_channel_collections(channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="assign_collection_to_channel", toolset="collections",
              idempotent=True)
    async def assign_collection_to_channel(channel_number: int, plex_type: str,
                                           collection_rating_key: str,
                                           collection_title: str,
                                           is_smart: bool = False) -> dict:
        """Point a channel at an EXISTING Plex collection, BY REFERENCE.

        Nothing is copied and nothing in Plex is modified — this only records
        that the channel uses that collection. One collection per type; assigning
        replaces whatever was in that slot. To copy a collection's items into the
        channel's assignments instead, use `import_collection_to_channel`.

        Collections named '{Channel} Movies' or '{Channel} TV' are rejected:
        those names belong to the collections Linearr generates and manages."""
        try:
            return api.assign_channel_collection(
                channel_number, api.ChannelCollectionAssignIn(
                    plex_type=plex_type, collection_rating_key=collection_rating_key,
                    collection_title=collection_title, is_smart=is_smart))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="import_collection_to_channel", toolset="collections",
              open_world=True)
    async def import_collection_to_channel(channel_number: int, plex_type: str,
                                           collection_rating_key: str,
                                           collection_title: str) -> dict:
        """COPY every item in a Plex collection into a channel's assignments.

        A one-time import: later changes to the collection do not follow. To
        track the collection instead, use `assign_collection_to_channel`."""
        try:
            return await api.link_channel_collection(
                channel_number, api.ChannelCollectionIn(
                    plex_type=plex_type, collection_rating_key=collection_rating_key,
                    collection_title=collection_title))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="unlink_channel_collection", toolset="collections",
              destructive=True, idempotent=True)
    async def unlink_channel_collection(channel_number: int, plex_type: str) -> dict:
        """Clear a channel's collection slot for one content type. The Plex
        collection itself is not deleted."""
        try:
            return api.unlink_channel_collection(channel_number, plex_type)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="create_channel_smart_collection", toolset="collections",
              open_world=True)
    async def create_channel_smart_collection(
        channel_number: int, section_id: str, title: str, type: str = "movie",
        genres: list[str] = [], year_min: int | None = None,
        year_max: int | None = None, decade: int | None = None,
        unwatched: bool = False, content_rating: str | None = None,
        title_contains: str | None = None, sort: str | None = None,
        limit: int | None = None,
    ) -> dict:
        """Create a Plex smart collection AND assign it to a channel, atomically.
        Same filters as `create_smart_collection`. If the assign fails the
        collection is deleted again, so a failure never leaves an orphan."""
        body = api.SmartCollectionIn(
            section_id=section_id, type=type, title=title, sort=sort, limit=limit,
            filters=api.SmartCollectionFilters(
                genres=genres, year_min=year_min, year_max=year_max, decade=decade,
                unwatched=unwatched, content_rating=content_rating,
                title_contains=title_contains))
        try:
            return await api.create_and_assign_smart_collection(channel_number, body)
        except HTTPException as e:
            raise tool_error(e)
```

Add `from ._request import json_request` to the module imports.

- [ ] **Step 4: Fix the documented-but-absent `update_filters` argument (audit A2)**

While in this file, leave `update_smart_collection`'s signature alone — the
implementation is correct and the docs are wrong. Task 12 fixes `docs/MCP.md`,
and the docs-match-code test added there stops it recurring.

- [ ] **Step 5: Run tests, full suite, commit**

```bash
./.venv-mcp/Scripts/python.exe -m pytest
git add linearr_mcp tests/test_mcp_tools.py
git commit -m "feat(mcp): Plex collection editing and channel collection links"
```

---

### Task 8: `blocks` toolset — 14 tools, all new

**Files:**
- Create: `linearr_mcp/blocks.py`
- Modify: `linearr_mcp/__init__.py`
- Test: `tests/test_mcp_tools.py`

**Interfaces:**
- Produces: `list_blocks`, `create_block`, `update_block`, `delete_block`, `list_block_slots`, `add_block_slot`, `update_block_slot`, `swap_block_slots`, `delete_block_slot`, `clear_block_slots`, `apply_block`, `get_block_suggestions`, `get_network_block_suggestions`, `list_schedule_templates`.

- [ ] **Step 1: Write the failing tests**

```python
# ── blocks ───────────────────────────────────────────────────────────────────

def test_block_lifecycle(auth_client):
    token = _token(auth_client)
    auth_client.post("/api/channels", json={"number": 941, "name": "Block Ch"})
    try:
        block = _json(_call(auth_client, token, "create_block", {
            "name": "Prime Time", "channel_number": 941,
            "start_time": "20:00", "end_time": "23:00",
            "content_type": "shows", "days": ["mon", "tue"]}))
        bid = block["id"]

        listed = _json(_call(auth_client, token, "list_blocks", {"channel_number": 941}))
        assert [b["id"] for b in listed] == [bid]

        _call(auth_client, token, "update_block", {"block_id": bid, "name": "Late Night"})
        listed = _json(_call(auth_client, token, "list_blocks", {"channel_number": 941}))
        assert listed[0]["name"] == "Late Night"
        assert listed[0]["start_time"] == "20:00", "unpassed fields must not be reset"

        _call(auth_client, token, "delete_block", {"block_id": bid})
        assert _json(_call(auth_client, token, "list_blocks",
                           {"channel_number": 941})) == []
    finally:
        auth_client.delete("/api/channels/941")


def test_list_blocks_without_channel_returns_generic(auth_client):
    token = _token(auth_client)
    block = _json(_call(auth_client, token, "create_block", {"name": "Reusable"}))
    bid = block["id"]
    try:
        generic = _json(_call(auth_client, token, "list_blocks"))
        assert any(b["id"] == bid for b in generic)
        assert all(b["channel_number"] is None for b in generic)
    finally:
        _call(auth_client, token, "delete_block", {"block_id": bid})


def test_block_slot_lifecycle(auth_client):
    token = _token(auth_client)
    block = _json(_call(auth_client, token, "create_block", {"name": "Slots Block"}))
    bid = block["id"]
    try:
        a = _json(_call(auth_client, token, "add_block_slot", {
            "block_id": bid, "slot_time": "09:00", "plex_rating_key": "1001",
            "plex_title": "Show A", "plex_type": "show"}))
        b = _json(_call(auth_client, token, "add_block_slot", {
            "block_id": bid, "slot_time": "10:00", "plex_rating_key": "1002",
            "plex_title": "Show B", "plex_type": "show"}))

        slots = _json(_call(auth_client, token, "list_block_slots", {"block_id": bid}))
        assert len(slots) == 2

        _call(auth_client, token, "swap_block_slots",
              {"block_id": bid, "slot_a": a["id"], "slot_b": b["id"]})
        slots = {s["id"]: s["slot_time"] for s in
                 _json(_call(auth_client, token, "list_block_slots", {"block_id": bid}))}
        assert slots[a["id"]] == "10:00" and slots[b["id"]] == "09:00"

        _call(auth_client, token, "update_block_slot",
              {"slot_id": a["id"], "slot_time": "22:30"})
        slots = {s["id"]: s["slot_time"] for s in
                 _json(_call(auth_client, token, "list_block_slots", {"block_id": bid}))}
        assert slots[a["id"]] == "22:30"

        _call(auth_client, token, "delete_block_slot", {"slot_id": a["id"]})
        assert len(_json(_call(auth_client, token, "list_block_slots",
                               {"block_id": bid}))) == 1

        _call(auth_client, token, "clear_block_slots", {"block_id": bid})
        assert _json(_call(auth_client, token, "list_block_slots", {"block_id": bid})) == []
    finally:
        _call(auth_client, token, "delete_block", {"block_id": bid})


def test_apply_generic_block_to_channel(auth_client):
    token = _token(auth_client)
    auth_client.post("/api/channels", json={"number": 942, "name": "Apply Ch"})
    block = _json(_call(auth_client, token, "create_block",
                        {"name": "Template Block", "start_time": "06:00"}))
    bid = block["id"]
    try:
        _call(auth_client, token, "apply_block",
              {"block_id": bid, "channel_number": 942})
        applied = _json(_call(auth_client, token, "list_blocks", {"channel_number": 942}))
        assert any(b["start_time"] == "06:00" for b in applied)
    finally:
        _call(auth_client, token, "delete_block", {"block_id": bid})
        auth_client.delete("/api/channels/942")


def test_list_schedule_templates_returns_a_list(auth_client):
    token = _token(auth_client)
    templates = _json(_call(auth_client, token, "list_schedule_templates"))
    assert isinstance(templates, (list, dict))
```

- [ ] **Step 2: Run — expect failure**

Run: `./.venv-mcp/Scripts/python.exe -m pytest tests/test_mcp_tools.py -k block -v`

- [ ] **Step 3: Write `linearr_mcp/blocks.py`**

```python
"""blocks toolset — schedule blocks and their slots.

A block is a recurring time window on a channel ("weeknights 20:00-23:00,
shows only"). A slot is one programme placed at a time inside it. A block with
`channel_number = null` is generic — a reusable template you `apply_block` onto
a channel, which copies it (the template is untouched).
"""
from fastapi import HTTPException

from .registry import tool_error

_DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def register(reg, api):

    @reg.tool(name="list_blocks", toolset="blocks", read_only=True)
    async def list_blocks(channel_number: int | None = None) -> list[dict]:
        """List schedule blocks for a channel. Omit `channel_number` to list the
        generic, reusable blocks instead."""
        try:
            if channel_number is None:
                return api.list_generic_blocks()
            return api.list_channel_blocks(channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="create_block", toolset="blocks")
    async def create_block(name: str, channel_number: int | None = None,
                           days: list[str] = list(_DAYS),
                           start_time: str = "00:00", end_time: str = "23:59",
                           content_type: str = "both", notes: str = "",
                           order_index: int = 0) -> dict:
        """Create a schedule block. Times are 24h HH:MM. days: any of
        mon,tue,wed,thu,fri,sat,sun. content_type: movies | shows | both.
        Omit `channel_number` to create a generic, reusable block."""
        try:
            return api.create_block(api.BlockIn(
                name=name, channel_number=channel_number, days=days,
                start_time=start_time, end_time=end_time,
                content_type=content_type, notes=notes, order_index=order_index))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="update_block", toolset="blocks", idempotent=True)
    async def update_block(block_id: int, name: str | None = None,
                           channel_number: int | None = None,
                           days: list[str] | None = None,
                           start_time: str | None = None,
                           end_time: str | None = None,
                           content_type: str | None = None,
                           notes: str | None = None,
                           order_index: int | None = None) -> dict:
        """Update a block. Only the fields you pass change — the rest keep their
        current values."""
        with api.get_db() as conn:
            row = conn.execute("SELECT * FROM blocks WHERE id=?", (block_id,)).fetchone()
        if not row:
            raise RuntimeError(f"Block {block_id} not found")
        current = api._row_to_block(row)
        body = api.BlockIn(
            name=name if name is not None else current["name"],
            channel_number=(channel_number if channel_number is not None
                            else current.get("channel_number")),
            days=days if days is not None else current.get("days") or list(_DAYS),
            start_time=start_time if start_time is not None else current["start_time"],
            end_time=end_time if end_time is not None else current["end_time"],
            content_type=(content_type if content_type is not None
                          else current.get("content_type") or "both"),
            notes=notes if notes is not None else (current.get("notes") or ""),
            order_index=(order_index if order_index is not None
                         else current.get("order_index") or 0))
        try:
            return api.update_block(block_id, body)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="delete_block", toolset="blocks",
              destructive=True, idempotent=True)
    async def delete_block(block_id: int) -> dict:
        """Delete a block and every slot in it."""
        try:
            return api.delete_block(block_id)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="list_block_slots", toolset="blocks", read_only=True)
    async def list_block_slots(block_id: int) -> list[dict]:
        """List the programmes scheduled inside a block, by time."""
        try:
            return api.list_block_slots(block_id)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="add_block_slot", toolset="blocks", open_world=True)
    async def add_block_slot(block_id: int, slot_time: str, plex_rating_key: str,
                             plex_title: str | None = None,
                             plex_type: str | None = None,
                             duration_minutes: int = 60) -> dict:
        """Schedule a programme inside a block at `slot_time` (24h HH:MM).
        Title and type are fetched from Plex when you don't supply them."""
        title, ptype, thumb, year = plex_title, plex_type, None, None
        if not title or not ptype:
            try:
                item = await api.plex_item(plex_rating_key)
            except HTTPException as e:
                raise tool_error(e)
            title = title or item.get("title") or plex_rating_key
            ptype = ptype or item.get("type") or "movie"
            thumb, year = item.get("thumb"), item.get("year")
        try:
            return api.add_block_slot(block_id, api.SlotIn(
                slot_time=slot_time, plex_rating_key=plex_rating_key,
                plex_title=title, plex_type=ptype, plex_thumb=thumb,
                plex_year=year, duration_minutes=duration_minutes))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="update_block_slot", toolset="blocks", idempotent=True)
    async def update_block_slot(slot_id: int, slot_time: str) -> dict:
        """Move a slot to a different time (24h HH:MM)."""
        try:
            return api.update_block_slot(slot_id, {"slot_time": slot_time})
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="swap_block_slots", toolset="blocks")
    async def swap_block_slots(block_id: int, slot_a: int, slot_b: int) -> dict:
        """Swap the times of two slots in the same block."""
        try:
            return api.swap_block_slots(block_id, {"slot_a": slot_a, "slot_b": slot_b})
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="delete_block_slot", toolset="blocks",
              destructive=True, idempotent=True)
    async def delete_block_slot(slot_id: int) -> dict:
        """Remove one slot from its block."""
        try:
            return api.delete_block_slot(slot_id)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="clear_block_slots", toolset="blocks",
              destructive=True, idempotent=True)
    async def clear_block_slots(block_id: int) -> dict:
        """Remove every slot from a block, keeping the block itself."""
        try:
            return api.clear_block_slots(block_id)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="apply_block", toolset="blocks")
    async def apply_block(block_id: int, channel_number: int) -> dict:
        """Copy a generic block (and its slots) onto a channel. The template is
        left as it was."""
        try:
            return api.apply_block(block_id, channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_block_suggestions", toolset="blocks",
              read_only=True, open_world=True)
    async def get_block_suggestions(block_id: int) -> dict | list:
        """Content from the channel's assignments that fits this block's
        content type and length."""
        try:
            return api.block_suggestions(block_id)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_network_block_suggestions", toolset="blocks", read_only=True)
    async def get_network_block_suggestions(channel_number: int | None = None) -> dict | list:
        """Standard cable-network dayparts (morning, prime time, late night…)
        to model a schedule on. Static reference data, not an AI call."""
        try:
            return api.network_block_suggestions(channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="list_schedule_templates", toolset="blocks", read_only=True)
    async def list_schedule_templates() -> dict | list:
        """Prebuilt whole-day schedule templates that can be turned into blocks."""
        try:
            return api.get_schedule_templates()
        except HTTPException as e:
            raise tool_error(e)
```

**Before writing this, confirm two helper names** by reading `main.py`:
`_row_to_block` (used by `update_block`) and the return shape of
`api.create_block` (the tests assume it returns a dict with `id`). If
`create_block` returns something else, adjust the tests to match the real
handler — the handler is the source of truth, not the test.

- [ ] **Step 4: Register `blocks` in `__init__.py`**

- [ ] **Step 5: Run tests, full suite, commit**

```bash
./.venv-mcp/Scripts/python.exe -m pytest
git add linearr_mcp tests/test_mcp_tools.py
git commit -m "feat(mcp): schedule blocks and slots toolset"
```

---

### Task 9: `tunarr` toolset — 35 tools, all new

**Files:**
- Create: `linearr_mcp/tunarr.py`
- Modify: `linearr_mcp/__init__.py`
- Test: `tests/test_mcp_tools.py`

**Interfaces:**
- Produces the 35 tools listed in spec §4 under `tunarr`.

- [ ] **Step 1: Write the failing tests**

Link management needs no Tunarr server, so test that directly. For anything
that calls Tunarr, follow the `respx` mocking already used in
`tests/test_tunarr_sync.py`.

```python
# ── tunarr ───────────────────────────────────────────────────────────────────

def test_tunarr_channel_link_round_trip(auth_client):
    token = _token(auth_client)
    auth_client.post("/api/channels", json={"number": 951, "name": "Tun Ch"})
    try:
        _call(auth_client, token, "link_tunarr_channel", {
            "channel_number": 951, "tunarr_id": "abc-123", "tunarr_name": "Tun Ch"})
        links = _json(_call(auth_client, token, "list_tunarr_links", {"kind": "channel"}))
        assert any(l["channel_number"] == 951 and l["tunarr_id"] == "abc-123"
                   for l in links["channel_links"])

        _call(auth_client, token, "unlink_tunarr_channel", {"channel_number": 951})
        links = _json(_call(auth_client, token, "list_tunarr_links", {"kind": "channel"}))
        assert not any(l["channel_number"] == 951 for l in links["channel_links"])
    finally:
        auth_client.delete("/api/channels/951")


def test_tunarr_collection_link_round_trip(auth_client):
    token = _token(auth_client)
    auth_client.post("/api/channels", json={"number": 952, "name": "Tun Coll"})
    try:
        _call(auth_client, token, "link_tunarr_collection", {
            "channel_number": 952, "plex_type": "movie",
            "tunarr_collection_id": "sc-1", "tunarr_collection_name": "Movies"})
        links = _json(_call(auth_client, token, "list_tunarr_links",
                            {"kind": "collection"}))
        assert any(l["channel_number"] == 952 for l in links["collection_links"])

        _call(auth_client, token, "unlink_tunarr_collection",
              {"channel_number": 952, "plex_type": "movie"})
        links = _json(_call(auth_client, token, "list_tunarr_links",
                            {"kind": "collection"}))
        assert not any(l["channel_number"] == 952 for l in links["collection_links"])
    finally:
        auth_client.delete("/api/channels/952")


def test_list_tunarr_links_all_returns_both(auth_client):
    token = _token(auth_client)
    links = _json(_call(auth_client, token, "list_tunarr_links"))
    assert "channel_links" in links and "collection_links" in links


def test_run_tunarr_task_rejects_unknown_task(auth_client):
    token = _token(auth_client)
    result = _call(auth_client, token, "run_tunarr_task", {"task_name": "DropDatabase"})
    assert result.get("isError")


def test_get_tunarr_endpoints_returns_urls_not_files(auth_client):
    token = _token(auth_client)
    ep = _json(_call(auth_client, token, "get_tunarr_endpoints"))
    assert ep["xmltv_url"].endswith("/api/tunarr/xmltv")
    assert ep["m3u_url"].endswith("/api/tunarr/m3u")
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Write `linearr_mcp/tunarr.py`**

Tunarr is the playout server; Linearr channels are pushed to it. Structure the
module with the same section banners as the spec (status & read, links, push,
smart collections, content, sessions & settings, migration). Every tool that
reaches Tunarr gets `open_world=True`.

```python
"""tunarr toolset — the playout server Linearr pushes channels to.

Naming carries `tunarr` deliberately: a Tunarr "channel" and a Linearr channel
are different objects joined by a link row, and so are Tunarr smart collections
and Plex smart collections. A tool that blurs them produces confident, wrong
work.
"""
from fastapi import HTTPException

from ._request import json_request
from .registry import tool_error

_TASKS = ("UpdateXmlTvTask", "ScanLibrariesTask")


def register(reg, api):

    # ── status & read ────────────────────────────────────────────────────────

    @reg.tool(name="get_tunarr_status", toolset="tunarr",
              read_only=True, open_world=True)
    async def get_tunarr_status() -> dict:
        """Is Tunarr reachable, at what version, and is that version supported?
        Combines the connection test and the version check."""
        try:
            reachable = await api.tunarr_test(None)
        except HTTPException as e:
            raise tool_error(e)
        try:
            version = await api.tunarr_version_check()
        except HTTPException:
            version = {}
        return {"connection": reachable, "version": version}

    @reg.tool(name="list_tunarr_channels", toolset="tunarr",
              read_only=True, open_world=True)
    async def list_tunarr_channels() -> list | dict:
        """Channels that exist in Tunarr (id, number, name)."""
        try:
            return await api.tunarr_list_channels()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_tunarr_channel", toolset="tunarr",
              read_only=True, open_world=True)
    async def get_tunarr_channel(tunarr_id: str) -> dict:
        """Full Tunarr channel record: transcoding, watermark, guide settings."""
        try:
            return await api.tunarr_get_channel_detail(tunarr_id)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_tunarr_schedule", toolset="tunarr",
              read_only=True, open_world=True)
    async def get_tunarr_schedule(tunarr_id: str, hours: int = 6) -> dict | list:
        """What a Tunarr channel will play over the next `hours`."""
        try:
            return await api.tunarr_get_schedule(tunarr_id, hours)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_tunarr_channel_shows", toolset="tunarr",
              read_only=True, open_world=True)
    async def get_tunarr_channel_shows(tunarr_id: str) -> dict | list:
        """Which shows/movies a Tunarr channel draws from."""
        try:
            return await api.tunarr_get_channel_shows(tunarr_id)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_tunarr_guide", toolset="tunarr",
              read_only=True, open_world=True)
    async def get_tunarr_guide(hours: int = 24) -> dict | list:
        """The whole-lineup EPG for the next `hours`."""
        try:
            return await api.tunarr_guide(hours)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_tunarr_endpoints", toolset="tunarr", read_only=True)
    async def get_tunarr_endpoints() -> dict:
        """URLs for the XMLTV guide and M3U playlist, for a TV client. The files
        themselves are downloads and are not returned here."""
        return {
            "tunarr_url": api.get_tunarr_url(),
            "xmltv_url": "/api/tunarr/xmltv",
            "m3u_url": "/api/tunarr/m3u",
        }

    @reg.tool(name="get_tunarr_debug_info", toolset="tunarr",
              read_only=True, open_world=True)
    async def get_tunarr_debug_info() -> dict:
        """Diagnostic dump of what Tunarr's API reports — for troubleshooting a
        sync or push that is not behaving."""
        try:
            return await api.tunarr_debug_api()
        except HTTPException as e:
            raise tool_error(e)

    # ── links ────────────────────────────────────────────────────────────────

    @reg.tool(name="list_tunarr_links", toolset="tunarr", read_only=True)
    async def list_tunarr_links(kind: str = "all") -> dict:
        """Which Linearr channels are linked to which Tunarr channels and
        collections. kind: channel | collection | all."""
        if kind not in ("channel", "collection", "all"):
            raise RuntimeError("kind must be channel, collection or all")
        out = {}
        if kind in ("channel", "all"):
            out["channel_links"] = api.tunarr_get_channel_links()
        if kind in ("collection", "all"):
            out["collection_links"] = api.tunarr_get_collection_links()
        return out

    @reg.tool(name="link_tunarr_channel", toolset="tunarr", idempotent=True)
    async def link_tunarr_channel(channel_number: int, tunarr_id: str,
                                  tunarr_name: str | None = None,
                                  tunarr_number: int | None = None) -> dict:
        """Link a Linearr channel to an existing Tunarr channel by its uuid."""
        try:
            return api.tunarr_save_channel_link(api.TunarrChannelLinkIn(
                channel_number=channel_number, tunarr_id=tunarr_id,
                tunarr_name=tunarr_name, tunarr_number=tunarr_number))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="unlink_tunarr_channel", toolset="tunarr",
              destructive=True, idempotent=True)
    async def unlink_tunarr_channel(channel_number: int) -> dict:
        """Break the link. The Tunarr channel itself is not deleted."""
        try:
            return api.tunarr_delete_channel_link(channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="link_tunarr_collection", toolset="tunarr", idempotent=True)
    async def link_tunarr_collection(channel_number: int, plex_type: str,
                                     tunarr_collection_id: str,
                                     tunarr_collection_name: str | None = None) -> dict:
        """Link a channel's movie or show collection to a Tunarr smart collection.
        plex_type: movie | show."""
        try:
            return api.tunarr_save_collection_link(api.TunarrCollectionLinkIn(
                channel_number=channel_number, plex_type=plex_type,
                tunarr_collection_id=tunarr_collection_id,
                tunarr_collection_name=tunarr_collection_name))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="unlink_tunarr_collection", toolset="tunarr",
              destructive=True, idempotent=True)
    async def unlink_tunarr_collection(channel_number: int, plex_type: str) -> dict:
        """Break a channel↔Tunarr-collection link."""
        try:
            return api.tunarr_delete_collection_link(channel_number, plex_type)
        except HTTPException as e:
            raise tool_error(e)

    # ── push ─────────────────────────────────────────────────────────────────

    @reg.tool(name="push_schedule_to_tunarr", toolset="tunarr",
              idempotent=True, open_world=True)
    async def push_schedule_to_tunarr(channel_number: int, preview: bool = True) -> dict:
        """Turn a channel's blocks into a Tunarr time-slot schedule and push it.

        PREVIEWS BY DEFAULT: with `preview` true nothing is written — you get
        the schedule that would be pushed. Pass `preview=false` to apply it,
        which REPLACES the Tunarr channel's existing schedule."""
        try:
            return await api.tunarr_push_schedule(
                channel_number, api.TunarrPushScheduleIn(preview=preview))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="sync_channel_collections_to_tunarr", toolset="tunarr",
              idempotent=True, open_world=True)
    async def sync_channel_collections_to_tunarr(channel_number: int) -> dict:
        """Create/refresh the Tunarr smart collections backing a channel's Plex
        collections, and link them. Runs a library scan in Tunarr first, because
        a tag-based smart collection needs the Plex collection to exist as a tag
        in Tunarr's index."""
        try:
            return await api.tunarr_sync_collections(channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="run_tunarr_task", toolset="tunarr",
              idempotent=True, open_world=True)
    async def run_tunarr_task(task_name: str) -> dict:
        """Run a Tunarr maintenance task: UpdateXmlTvTask (rebuild the guide) or
        ScanLibrariesTask (re-index Plex sources)."""
        if task_name not in _TASKS:
            raise RuntimeError(f"task_name must be one of {', '.join(_TASKS)}")
        try:
            return await api.tunarr_run_task(task_name, None)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="refresh_tunarr_xmltv", toolset="tunarr",
              idempotent=True, open_world=True)
    async def refresh_tunarr_xmltv() -> dict:
        """Force Tunarr to regenerate its XMLTV guide now."""
        try:
            return await api.tunarr_xmltv_refresh()
        except HTTPException as e:
            raise tool_error(e)

    # ── smart collections ────────────────────────────────────────────────────

    @reg.tool(name="list_tunarr_smart_collections", toolset="tunarr",
              read_only=True, open_world=True)
    async def list_tunarr_smart_collections() -> list | dict:
        """Smart collections defined inside Tunarr (not Plex)."""
        try:
            return await api.tunarr_list_smart_collections()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="create_tunarr_smart_collection", toolset="tunarr",
              open_world=True)
    async def create_tunarr_smart_collection(
        name: str, filter: dict | None = None,
        filter_string: str | None = None) -> dict:
        """Create a Tunarr smart collection. Give either a structured `filter`
        object or a simple `filter_string` like `tags = "My Collection"`, which
        is translated. Tunarr ignores filterString on writes, so a raw
        passthrough would create a collection with no rules — Linearr verifies
        the response echoes the rules back."""
        body = {"name": name}
        if filter is not None:
            body["filter"] = filter
        if filter_string:
            body["filterString"] = filter_string
        try:
            return await api.tunarr_create_smart_collection(body)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="update_tunarr_smart_collection", toolset="tunarr",
              idempotent=True, open_world=True)
    async def update_tunarr_smart_collection(
        sc_id: str, name: str | None = None, filter: dict | None = None,
        filter_string: str | None = None) -> dict:
        """Rename a Tunarr smart collection and/or replace its rules. A
        name-only call is a plain rename and leaves the rules alone."""
        body: dict = {}
        if name is not None:
            body["name"] = name
        if filter is not None:
            body["filter"] = filter
        if filter_string:
            body["filterString"] = filter_string
        if not body:
            raise RuntimeError("Pass name and/or filter/filter_string")
        try:
            return await api.tunarr_update_smart_collection(sc_id, body)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="delete_tunarr_smart_collection", toolset="tunarr",
              destructive=True, idempotent=True, open_world=True)
    async def delete_tunarr_smart_collection(sc_id: str) -> dict:
        """Delete one Tunarr smart collection."""
        try:
            return await api.tunarr_delete_smart_collection(sc_id)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="purge_tunarr_smart_collections", toolset="tunarr",
              destructive=True, idempotent=True, open_world=True)
    async def purge_tunarr_smart_collections() -> dict:
        """DESTRUCTIVE: delete Tunarr smart collections in bulk. Read the
        response to see what went."""
        try:
            return await api.tunarr_purge_smart_collections()
        except HTTPException as e:
            raise tool_error(e)

    # ── content ──────────────────────────────────────────────────────────────

    @reg.tool(name="list_tunarr_custom_shows", toolset="tunarr",
              read_only=True, open_world=True)
    async def list_tunarr_custom_shows() -> list | dict:
        """Tunarr 1.3 custom shows. Empty on older Tunarr versions."""
        try:
            return await api.tunarr_list_custom_shows()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="list_tunarr_filler_lists", toolset="tunarr",
              read_only=True, open_world=True)
    async def list_tunarr_filler_lists() -> list | dict:
        """Filler lists — the interstitials Tunarr plays between programmes."""
        try:
            return await api.tunarr_filler_lists()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_tunarr_filler_list", toolset="tunarr",
              read_only=True, open_world=True)
    async def get_tunarr_filler_list(filler_id: str,
                                     include_programs: bool = False) -> dict:
        """One filler list. Set `include_programs` to also list its contents."""
        try:
            detail = await api.tunarr_filler_list_detail(filler_id)
            if include_programs:
                detail = {"filler_list": detail,
                          "programs": await api.tunarr_filler_list_programs(filler_id)}
            return detail
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="create_tunarr_filler_list", toolset="tunarr", open_world=True)
    async def create_tunarr_filler_list(filler_list: dict) -> dict:
        """Create a filler list. `filler_list` is passed to Tunarr as-is — use
        Tunarr's own filler-list shape (`name`, `programs`)."""
        try:
            return await api.tunarr_create_filler_list(json_request(filler_list))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="update_tunarr_filler_list", toolset="tunarr",
              idempotent=True, open_world=True)
    async def update_tunarr_filler_list(filler_id: str, filler_list: dict) -> dict:
        """Update a filler list. `filler_list` is passed to Tunarr as-is."""
        try:
            return await api.tunarr_update_filler_list(
                filler_id, json_request(filler_list))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="delete_tunarr_filler_list", toolset="tunarr",
              destructive=True, idempotent=True, open_world=True)
    async def delete_tunarr_filler_list(filler_id: str) -> dict:
        """Delete a filler list."""
        try:
            return await api.tunarr_delete_filler_list(filler_id)
        except HTTPException as e:
            raise tool_error(e)

    # ── sessions & settings ──────────────────────────────────────────────────

    @reg.tool(name="list_tunarr_sessions", toolset="tunarr",
              read_only=True, open_world=True)
    async def list_tunarr_sessions() -> list | dict:
        """Who is watching which Tunarr channel right now."""
        try:
            return await api.tunarr_sessions()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="stop_tunarr_sessions", toolset="tunarr",
              destructive=True, idempotent=True, open_world=True)
    async def stop_tunarr_sessions(channel_id: str) -> dict:
        """Cut every active stream on a Tunarr channel. Viewers are disconnected."""
        try:
            return await api.tunarr_kill_sessions(channel_id)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_tunarr_xmltv_settings", toolset="tunarr",
              read_only=True, open_world=True)
    async def get_tunarr_xmltv_settings() -> dict:
        """Tunarr's XMLTV guide settings (refresh interval, programme count)."""
        try:
            return await api.tunarr_get_xmltv_settings()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="update_tunarr_xmltv_settings", toolset="tunarr",
              idempotent=True, open_world=True)
    async def update_tunarr_xmltv_settings(settings: dict) -> dict:
        """Update Tunarr's XMLTV settings. Passed to Tunarr as-is — read
        `get_tunarr_xmltv_settings` first and send back the same shape."""
        try:
            return await api.tunarr_update_xmltv_settings(json_request(settings))
        except HTTPException as e:
            raise tool_error(e)

    # ── migration ────────────────────────────────────────────────────────────

    @reg.tool(name="preview_tunarr_import", toolset="tunarr",
              read_only=True, open_world=True)
    async def preview_tunarr_import(channel_ids: list[str] | None = None) -> dict:
        """Show how Tunarr's channels would map onto Linearr channels — what
        would be created, matched or skipped. Changes nothing."""
        body = {"channel_ids": channel_ids} if channel_ids else {}
        try:
            return await api.tunarr_import_preview(body)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="import_tunarr_channels", toolset="tunarr", open_world=True)
    async def import_tunarr_channels(actions: list[dict]) -> dict:
        """Import channels from Tunarr into Linearr. Run `preview_tunarr_import`
        first and pass the actions you want from its result."""
        try:
            return await api.tunarr_import_channels(
                api.TunarrImportRequest(actions=actions))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="export_channels_to_tunarr", toolset="tunarr", open_world=True)
    async def export_channels_to_tunarr(channel_numbers: list[int] | str = "all",
                                        sync_collections: bool = False) -> dict:
        """Create or link Tunarr channels for Linearr channels. Pass a list of
        numbers, or "all". With `sync_collections` it also builds the backing
        Tunarr smart collections."""
        try:
            return await api.tunarr_export_channels(api.TunarrExportRequest(
                channel_numbers=channel_numbers, sync_collections=sync_collections))
        except HTTPException as e:
            raise tool_error(e)
```

**Before writing, verify by reading `main.py`:** `get_tunarr_url` is a
module-level function (used by `get_tunarr_endpoints`), `tunarr_test` accepts
`None`, and `tunarr_run_task`'s second parameter is an optional body. Adjust the
call sites, not the handlers, if any differ.

- [ ] **Step 4: Register `tunarr` in `__init__.py`**

- [ ] **Step 5: Run tests, full suite, commit**

```bash
./.venv-mcp/Scripts/python.exe -m pytest
git add linearr_mcp tests/test_mcp_tools.py
git commit -m "feat(mcp): tunarr toolset — links, push, guide, smart collections, migration"
```

---

### Task 10: `ai` and `system` toolsets

**Files:**
- Create: `linearr_mcp/ai.py`, `linearr_mcp/system.py`
- Modify: `linearr_mcp/__init__.py`
- Test: `tests/test_mcp_tools.py`

**Interfaces:**
- Produces: `ai_suggest_channels`, `ai_suggest_channel_content`, `ai_network_advisor`, `ai_generate_day`, `ai_autofill_block`; `get_health`, `get_configuration`, `update_configuration`, `export_lineup`, `import_lineup`, `import_channel`, `list_preset_lineups`, `import_preset_lineup`, `get_logs`, `get_log_stats`, `clear_logs`, `purge_logs`.

- [ ] **Step 1: Write the failing tests**

```python
# ── system ───────────────────────────────────────────────────────────────────

def test_get_health_reports_ok(auth_client):
    token = _token(auth_client)
    health = _json(_call(auth_client, token, "get_health"))
    assert health["status"] in ("ok", "degraded")


def test_get_configuration_never_returns_secrets(auth_client):
    token = _token(auth_client)
    cfg = _json(_call(auth_client, token, "get_configuration"))
    assert "plex_token" not in cfg or not cfg.get("plex_token")
    assert "openai_api_key" not in cfg or not cfg.get("openai_api_key")
    assert "plex_token_set" in cfg


def test_update_configuration_rejects_secret_arguments(auth_client):
    token = _token(auth_client)
    result = _call(auth_client, token, "update_configuration",
                   {"plex_token": "hunter2"})
    assert result.get("isError")


def test_export_lineup_round_trips_a_channel(auth_client):
    token = _token(auth_client)
    auth_client.post("/api/channels", json={"number": 961, "name": "Export Ch"})
    try:
        full = _json(_call(auth_client, token, "export_lineup"))
        assert any(c["number"] == 961 for c in full["channels"])
        one = _json(_call(auth_client, token, "export_lineup", {"channel_number": 961}))
        assert one["channel"]["number"] == 961
    finally:
        auth_client.delete("/api/channels/961")


def test_import_lineup_merge_adds_channels(auth_client):
    token = _token(auth_client)
    try:
        result = _json(_call(auth_client, token, "import_lineup", {
            "data": {"channels": [{"number": 962, "name": "Imported"}]},
            "mode": "merge"}))
        assert result["channels_added"] == 1
        assert any(c["number"] == 962 for c in auth_client.get("/api/channels").json())
    finally:
        auth_client.delete("/api/channels/962")


def test_import_lineup_rejects_unknown_mode(auth_client):
    token = _token(auth_client)
    result = _call(auth_client, token, "import_lineup",
                   {"data": {"channels": []}, "mode": "obliterate"})
    assert result.get("isError")


def test_get_logs_kinds(auth_client):
    token = _token(auth_client)
    app_logs = _json(_call(auth_client, token, "get_logs", {"kind": "app", "limit": 5}))
    assert isinstance(app_logs, (list, dict))
    ai_logs = _json(_call(auth_client, token, "get_logs", {"kind": "ai", "limit": 5}))
    assert isinstance(ai_logs, (list, dict))
    assert _call(auth_client, token, "get_logs", {"kind": "nope"}).get("isError")
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Write `linearr_mcp/ai.py`**

```python
"""ai toolset — Linearr's own AI advisors.

Every tool here returns a PROPOSAL and writes nothing. Each call spends the
operator's OpenAI credits through the key configured in Settings, so the tools
say so: an assistant that can already reason about the library should usually
do this itself rather than paying for a second model.
"""
from fastapi import HTTPException

from .registry import tool_error


def register(reg, api):

    @reg.tool(name="ai_suggest_channels", toolset="ai",
              read_only=True, open_world=True)
    async def ai_suggest_channels() -> dict:
        """Propose new channels and channel packages from the current lineup and
        library. Returns suggestions only — nothing is created. Spends the
        OpenAI credits of the key configured in Linearr's Settings."""
        try:
            return await api.ai_suggest_channels()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="ai_suggest_channel_content", toolset="ai",
              read_only=True, open_world=True)
    async def ai_suggest_channel_content(channel_number: int) -> dict:
        """Propose library content that would suit a channel's vibe. Returns
        suggestions only. Spends the configured OpenAI key's credits."""
        try:
            return await api.ai_content_suggestions(channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="ai_network_advisor", toolset="ai",
              read_only=True, open_world=True)
    async def ai_network_advisor() -> dict:
        """Review the whole lineup — gaps, overlaps, balance. Advice only.
        Spends the configured OpenAI key's credits."""
        try:
            return await api.network_ai_advisor()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="ai_generate_day", toolset="ai", read_only=True, open_world=True)
    async def ai_generate_day(channel_number: int, style: str = "cable") -> dict:
        """Draft a full day of schedule blocks for a channel. style: cable |
        kids | anime | movies. Returns the draft — create the blocks yourself
        with `create_block`. Spends the configured OpenAI key's credits."""
        try:
            return await api.ai_generate_full_day(
                api.AIFullDayIn(channel_number=channel_number, style=style))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="ai_autofill_block", toolset="ai", read_only=True, open_world=True)
    async def ai_autofill_block(block_id: int,
                                channel_number: int | None = None) -> dict:
        """Draft slots to fill a block from the channel's assigned content.
        Returns the draft — add them yourself with `add_block_slot`. Spends the
        configured OpenAI key's credits."""
        try:
            return await api.ai_autofill_block(
                block_id, api.AIAutofillIn(channel_number=channel_number))
        except HTTPException as e:
            raise tool_error(e)
```

- [ ] **Step 4: Write `linearr_mcp/system.py`**

```python
"""system toolset — health, configuration, backup-by-export, and logs.

Secrets are deliberately one-way: `get_configuration` reports only whether a
credential is set, and `update_configuration` refuses to write one. Setting a
Plex token or an API key stays a UI action.

The database backup/restore routes are NOT exposed: restore replaces the whole
database, and neither moves usefully through a chat transport.
"""
from fastapi import HTTPException

from ._request import json_request
from .registry import tool_error

_SECRET_ARGS = ("plex_token", "openai_api_key", "token", "api_key", "password")
_LOG_KINDS = ("app", "ai")
_IMPORT_MODES = ("merge", "replace")


def register(reg, api):

    @reg.tool(name="get_health", toolset="system", read_only=True)
    async def get_health() -> dict:
        """Is Linearr healthy? Reports app version and database status."""
        return api.health_check()

    @reg.tool(name="get_configuration", toolset="system", read_only=True)
    async def get_configuration() -> dict:
        """Linearr's configuration: Plex URL, Tunarr URL, AI model and base URL,
        and whether each credential is set. Never returns a credential value."""
        cfg = dict(api.get_settings())
        cfg.pop("plex_token", None)
        cfg.pop("openai_api_key", None)
        return cfg

    @reg.tool(name="update_configuration", toolset="system", idempotent=True)
    async def update_configuration(plex_url: str | None = None,
                                   tunarr_url: str | None = None,
                                   openai_base_url: str | None = None,
                                   openai_model: str | None = None,
                                   **secrets) -> dict:
        """Change Linearr's URLs and AI model. Credentials (Plex token, OpenAI
        API key) CANNOT be set here — do that in Settings in the UI."""
        supplied = [k for k in secrets if k]
        if supplied:
            raise RuntimeError(
                f"Refusing to set {', '.join(supplied)} over MCP. Credentials are "
                f"set in Settings in the UI.")
        current = api.get_settings()
        body = api.SettingsIn(
            plex_url=plex_url if plex_url is not None else current["plex_url"],
            plex_token="",  # empty preserves the stored token
            openai_api_key=None,
            openai_base_url=(openai_base_url if openai_base_url is not None
                             else current.get("openai_base_url")),
            openai_model=(openai_model if openai_model is not None
                          else current.get("openai_model")),
            tunarr_url=(tunarr_url if tunarr_url is not None
                        else current.get("tunarr_url")))
        try:
            api.save_settings(body)
        except HTTPException as e:
            raise tool_error(e)
        return await get_configuration()

    @reg.tool(name="export_lineup", toolset="system", read_only=True)
    async def export_lineup(channel_number: int | None = None) -> dict:
        """Export the whole lineup — channels, assignments, blocks, slots,
        collection links — as JSON. Pass `channel_number` for just one channel."""
        try:
            if channel_number is None:
                return api.export_lineup()
            return api.export_channel(channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="import_lineup", toolset="system",
              destructive=True, idempotent=True)
    async def import_lineup(data: dict, mode: str = "merge") -> dict:
        """Import a lineup export. mode 'merge' adds what is missing and skips
        what exists. mode 'replace' DELETES every channel, assignment, block and
        slot first — there is no undo."""
        if mode not in _IMPORT_MODES:
            raise RuntimeError(f"mode must be one of {', '.join(_IMPORT_MODES)}")
        try:
            return await api.import_lineup(json_request({"data": data, "mode": mode}))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="import_channel", toolset="system", idempotent=True)
    async def import_channel(data: dict) -> dict:
        """Import one channel export (channel + assignments + blocks + slots).
        A channel already on that number is overwritten, keeping its uid."""
        try:
            return await api.import_channel(json_request(data))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="list_preset_lineups", toolset="system", read_only=True)
    async def list_preset_lineups() -> list[dict]:
        """Prebuilt lineups available to import (id, name, channel count)."""
        try:
            return api.list_preset_lineups()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="import_preset_lineup", toolset="system",
              destructive=True, idempotent=True)
    async def import_preset_lineup(lineup_id: str, mode: str = "merge") -> dict:
        """Import a prebuilt lineup. mode 'replace' WIPES the current lineup
        first; 'merge' adds what is missing."""
        if mode not in _IMPORT_MODES:
            raise RuntimeError(f"mode must be one of {', '.join(_IMPORT_MODES)}")
        try:
            return await api.import_preset_lineup(lineup_id, json_request({"mode": mode}))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_logs", toolset="system", read_only=True)
    async def get_logs(kind: str = "app", limit: int = 100) -> dict | list:
        """Read Linearr's logs. kind 'app' is the Activity Log (every action,
        including MCP tool calls); kind 'ai' is the AI request log."""
        if kind not in _LOG_KINDS:
            raise RuntimeError(f"kind must be one of {', '.join(_LOG_KINDS)}")
        try:
            return api.get_app_logs(limit) if kind == "app" else api.get_ai_logs(limit)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="get_log_stats", toolset="system", read_only=True)
    async def get_log_stats() -> dict:
        """Log volume by category and level — a quick health read."""
        try:
            return api.log_stats()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="clear_logs", toolset="system",
              destructive=True, idempotent=True)
    async def clear_logs(kind: str = "app") -> dict:
        """Delete a log entirely. kind: app | ai. There is no other copy."""
        if kind not in _LOG_KINDS:
            raise RuntimeError(f"kind must be one of {', '.join(_LOG_KINDS)}")
        try:
            return api.clear_app_logs() if kind == "app" else api.clear_ai_logs()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="purge_logs", toolset="system",
              destructive=True, idempotent=True)
    async def purge_logs(days: int = 30) -> dict:
        """Delete log entries older than `days`."""
        try:
            return api.purge_logs(days)
        except HTTPException as e:
            raise tool_error(e)
```

**Note on `update_configuration`:** `**secrets` catches any credential-looking
argument a caller invents. FastMCP builds the schema from the declared
parameters, so `**kwargs` does not appear in the tool schema — it exists purely
to make a hand-crafted `{"plex_token": …}` call fail loudly instead of being
silently dropped. Verify with `test_update_configuration_rejects_secret_arguments`;
if `mcp==1.28.1` rejects `**kwargs` in a tool signature, replace it with
explicit `plex_token: str | None = None, openai_api_key: str | None = None`
parameters that raise when supplied, and keep the same test.

- [ ] **Step 5: Register `ai` and `system` in `__init__.py`**

- [ ] **Step 6: Run tests, full suite, commit**

```bash
./.venv-mcp/Scripts/python.exe -m pytest
git add linearr_mcp tests/test_mcp_tools.py
git commit -m "feat(mcp): ai advisors and system toolset (health, config, export/import, logs)"
```

---

### Task 11: Resources and server instructions

**Files:**
- Create: `linearr_mcp/resources.py`
- Modify: `linearr_mcp/__init__.py` (INSTRUCTIONS, register resources)
- Test: `tests/test_mcp_registry.py`

**Interfaces:**
- Produces: resources `linearr://lineup`, `linearr://channel/{number}`, `linearr://libraries`, `linearr://status`.

- [ ] **Step 1: Write the failing tests**

```python
def test_resources_are_listed(auth_client):
    token = _token(auth_client)
    r = auth_client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "method": "resources/list", "id": 1},
        headers={**MCP_HEADERS, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    uris = [x["uri"] for x in r.json()["result"]["resources"]]
    assert "linearr://lineup" in uris
    assert "linearr://status" in uris


def test_lineup_resource_reads(auth_client):
    token = _token(auth_client)
    r = auth_client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "method": "resources/read", "id": 1,
              "params": {"uri": "linearr://lineup"}},
        headers={**MCP_HEADERS, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    body = json.loads(r.json()["result"]["contents"][0]["text"])
    assert "channels" in body
```

`MCP_HEADERS` is already imported at the top of `tests/test_mcp_tools.py`; add
the same import to `tests/test_mcp_registry.py`.

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Write `linearr_mcp/resources.py`**

```python
"""MCP resources — read-only context a client can pull without a tool call."""
import json


def register(mcp, api):

    @mcp.resource("linearr://lineup", name="Channel lineup",
                  mime_type="application/json")
    def lineup() -> str:
        """Every channel with its assignment and block counts."""
        with api.get_db() as conn:
            channels = [dict(r) for r in conn.execute(
                "SELECT number, name, tier, vibe, mode, style, color, uid "
                "FROM channels ORDER BY number")]
            counts = {r["channel_number"]: r["n"] for r in conn.execute(
                "SELECT channel_number, COUNT(*) AS n FROM assignments "
                "GROUP BY channel_number")}
            blocks = {r["channel_number"]: r["n"] for r in conn.execute(
                "SELECT channel_number, COUNT(*) AS n FROM blocks "
                "WHERE channel_number IS NOT NULL GROUP BY channel_number")}
        for ch in channels:
            ch["assignment_count"] = counts.get(ch["number"], 0)
            ch["block_count"] = blocks.get(ch["number"], 0)
        return json.dumps({"channels": channels, "total": len(channels)}, indent=2)

    @mcp.resource("linearr://channel/{number}", name="Channel detail",
                  mime_type="application/json")
    def channel(number: str) -> str:
        """One channel: metadata, assignments, blocks, collection links, watermark."""
        n = int(number)
        ch = api._get_channel(n)
        if not ch:
            return json.dumps({"error": f"Channel {n} not found"})
        ch.pop("icon", None)
        with api.get_db() as conn:
            ch["assignments"] = [dict(r) for r in conn.execute(
                "SELECT plex_rating_key, plex_title, plex_type, plex_year "
                "FROM assignments WHERE channel_number=? ORDER BY plex_title", (n,))]
            ch["blocks"] = [dict(r) for r in conn.execute(
                "SELECT id, name, days, start_time, end_time, content_type "
                "FROM blocks WHERE channel_number=? ORDER BY start_time", (n,))]
            ch["collections"] = [dict(r) for r in conn.execute(
                "SELECT * FROM channel_collections WHERE channel_number=?", (n,))]
        return json.dumps(ch, indent=2, default=str)

    @mcp.resource("linearr://libraries", name="Plex libraries",
                  mime_type="application/json")
    async def libraries() -> str:
        """Plex library sections and their ids."""
        try:
            return json.dumps(await api.plex_libraries(), indent=2)
        except Exception as e:
            return json.dumps({"error": str(e)})

    @mcp.resource("linearr://status", name="System status",
                  mime_type="application/json")
    def status() -> str:
        """Health of Linearr and everything it depends on."""
        cfg = api.get_settings()
        return json.dumps({
            "health": api.health_check(),
            "plex": {"url": cfg.get("plex_url"),
                     "token_configured": cfg.get("plex_token_set", False),
                     "auth": api.plex_auth_info()},
            "tunarr": {"url": cfg.get("tunarr_url")},
            "ai": {"configured": cfg.get("openai_api_key_set", False),
                   "model": cfg.get("openai_model")},
        }, indent=2, default=str)
```

- [ ] **Step 4: Rewrite `INSTRUCTIONS` and register resources**

In `linearr_mcp/__init__.py`:

```python
INSTRUCTIONS = (
    "Linearr builds TV channel lineups from a Plex library and pushes them to "
    "Tunarr for playout.\n\n"
    "The model: a CHANNEL is the unit (number, name, tier). ASSIGNMENTS are the "
    "Plex movies and shows that belong to it. BLOCKS are its schedule — "
    "recurring time windows, each holding SLOTS (a programme at a time). "
    "COLLECTIONS are the Plex-side grouping of a channel's content. Tunarr is "
    "the playout server: link a channel to a Tunarr channel, then push its "
    "schedule.\n\n"
    "Typical flow: search or browse the library, create or pick a channel, "
    "assign items, build its collections, add blocks and slots, link it to "
    "Tunarr, push the schedule.\n\n"
    "Two things that surprise people:\n"
    "- Reordering a channel RENUMBERS it. `number` is the primary key and "
    "ordering is by number; six tables reference it by value and follow the "
    "renumber. Use `reorder_channel`, never `update_channel` twice.\n"
    "- `push_schedule_to_tunarr` previews by default. Pass preview=false to "
    "actually write, which replaces the Tunarr channel's existing schedule."
)
```

and at the end of `build_mcp_server`, before computing `info`:

```python
    from . import resources
    resources.register(mcp, api)
```

- [ ] **Step 5: Run tests, full suite, commit**

```bash
./.venv-mcp/Scripts/python.exe -m pytest
git add linearr_mcp tests/test_mcp_registry.py
git commit -m "feat(mcp): resources for lineup, channel, libraries and status"
```

---

### Task 12: Documentation, and a test that keeps it honest

**Files:**
- Modify: `docs/MCP.md` (rewrite), `CLAUDE.md`, `README.md`
- Test: `tests/test_mcp_registry.py`

**Interfaces:**
- Consumes: every tool from Tasks 1–11.
- Produces: `docs/MCP.md` whose tool tables are machine-checkable.

- [ ] **Step 1: Write the docs-match-code test first**

This is the test that makes audit findings A2–A4 unrepeatable. It parses the
tool tables out of `docs/MCP.md` — every row's first cell is a tool name in
backticks — and compares them to the registered set.

```python
import re
from pathlib import Path

DOC = Path(__file__).resolve().parents[1] / "docs" / "MCP.md"


def _documented_tool_names() -> set[str]:
    names = set()
    for line in DOC.read_text(encoding="utf-8").splitlines():
        if not line.startswith("| `"):
            continue
        m = re.match(r"\|\s*`([a-z0-9_]+)`", line)
        if m:
            names.add(m.group(1))
    return names


def test_docs_list_every_registered_tool():
    registered = {t.name for t in main.mcp_server._tool_manager.list_tools()}
    documented = _documented_tool_names()
    assert registered - documented == set(), \
        f"undocumented tools: {sorted(registered - documented)}"


def test_docs_do_not_invent_tools():
    registered = {t.name for t in main.mcp_server._tool_manager.list_tools()}
    documented = _documented_tool_names()
    assert documented - registered == set(), \
        f"documented but not registered: {sorted(documented - registered)}"


def test_docs_tool_count_matches():
    registered = {t.name for t in main.mcp_server._tool_manager.list_tools()}
    text = DOC.read_text(encoding="utf-8")
    m = re.search(r"\*\*(\d+) tools\*\*", text)
    assert m, "docs/MCP.md must state the tool count as **N tools**"
    assert int(m.group(1)) == len(registered), \
        f"docs say {m.group(1)} tools, {len(registered)} are registered"
```

- [ ] **Step 2: Run — expect failure**

Run: `./.venv-mcp/Scripts/python.exe -m pytest tests/test_mcp_registry.py -k docs -v`
Expected: FAIL, listing ~100 undocumented tools.

- [ ] **Step 3: Rewrite `docs/MCP.md`**

Keep the existing intro, token, and client-setup sections verbatim. Replace the
tool reference and add three new sections. Required structure:

1. **What you can do** — keep, and add two examples that exercise the new
   surface: *"Give channel 42 a weeknight prime-time block of Star Trek, then
   preview the Tunarr push"* and *"Which channels have no schedule blocks yet?"*
2. **Getting your token** — unchanged.
3. **Client setup** — unchanged.
4. **Toolsets** (new) — the ten names, what each covers, the tool count, and how
   to trim them (Settings → System → MCP Server, or `MCP_TOOLSETS=channels,plex`
   in the environment). State plainly that all are on by default, that ~127 tool
   schemas is real context cost for a client, and that a change needs a restart.
5. **Tool reference** — one table per toolset. Every row starts `| \`tool_name\``
   so the test can parse it. Columns: Tool | Arguments | What it does. Mark
   destructive tools with **⚠** in the description, matching the annotations.
   State the total as `**N tools**` exactly once, matching the registered count.
6. **Resources** (new) — the four URIs and what each returns.
7. **Safety annotations** (new) — explain `readOnlyHint` / `destructiveHint` /
   `idempotentHint` / `openWorldHint`, and that a client can use them to
   auto-approve reads and prompt on destructive writes.
8. **What is deliberately not exposed** (new) — the exclusions table from spec
   §2, with the reason for each. This is as important as the tool list: it tells
   an assistant to stop looking.
9. **Security** — keep, and add that the token now reaches ~127 tools including
   `import_lineup` in replace mode, `purge_tunarr_smart_collections`, and
   `clear_logs`.
10. **Troubleshooting** — keep, and add three rows: *a tool is missing* → its
    toolset is disabled, check Settings → System → MCP Server; *"AI is not
    configured"* → the `ai_*` tools need an OpenAI key in Settings; *Tunarr
    tools all fail* → check `get_tunarr_status`.

Correct while rewriting: `update_smart_collection` has **no** `update_filters`
argument (passing only `title` renames without touching rules);
`list_plex_collections` and `get_collection_items` both take `offset` and
`limit`.

- [ ] **Step 4: Run the docs test until green**

Run: `./.venv-mcp/Scripts/python.exe -m pytest tests/test_mcp_registry.py -k docs -v`
Expected: PASS. The failure output names exactly which tools are missing from
the docs — work through the list.

- [ ] **Step 5: Update `CLAUDE.md`**

Replace the `### MCP Server` block under "API Routes" with:

```markdown
### MCP Server
Model Context Protocol endpoint at `/mcp` (streamable HTTP, stateless, JSON
responses) — full coverage of the app: channels, Plex, assignments, collections,
schedule blocks, Tunarr, watermarks, icons, AI advisors, and system/logs.
**~127 tools across 10 toolsets** (`channels`, `icons`, `assignments`, `plex`,
`collections`, `blocks`, `tunarr`, `watermark`, `ai`, `system`), plus 4
resources (`linearr://lineup`, `linearr://channel/{number}`,
`linearr://libraries`, `linearr://status`).

Auth: `Authorization: Bearer <token>`; token auto-generated, stored as settings
key `mcp_token`, enforced in `auth_middleware` (constant-time compare, before
the cookie check). Shown in Settings → System → MCP Server.
User docs: `docs/MCP.md`.

**Code lives in `linearr_mcp/`, one module per toolset** — not in `main.py`.
Three rules hold it together:

- **`linearr_mcp` never imports `main`.** `main.py` calls
  `build_mcp_server(sys.modules[__name__])`; every module gets that module
  object as `api` and reads handlers off it. This is what keeps the import
  acyclic — do not "simplify" it to a direct import.
- **Tools call route handlers, never reimplement them.** A handler typed
  `request: Request` is called with `linearr_mcp._request.json_request(body)`.
  Reimplementing a handler's logic in a tool is how the MCP surface and the HTTP
  surface silently drift apart.
- **`ToolRegistry.tool()` is the only way to register.** It applies the
  Activity-Log wrapper, the annotations, and the toolset gate at registration
  time. (The previous design wrapped tools in a pass that ran after the last
  registration, so anything added below that line lost its instrumentation.)
  Annotate honestly: `destructive=True` is what makes a client prompt before
  deleting a user's channel.

Toolsets are gated by `MCP_TOOLSETS` (env) or the `mcp_toolsets` settings key;
all are on by default and a change needs a restart (tools register at import).
`linearr_mcp/` must stay in the Dockerfile's COPY list.

- `GET /api/mcp/info` — `{endpoint, token, tool_count, toolsets[]}` (session-cookie auth)
- `PUT /api/mcp/toolsets` — body `{toolsets: [...]}`, persists the selection
- `POST /api/mcp/regenerate-token` — rotate the bearer token (invalidates old immediately)
```

Also update the "Key files" list at the top of `CLAUDE.md` to mention
`linearr_mcp/`.

- [ ] **Step 6: Update `README.md`**

Find the MCP line and update the tool count and scope to match. Keep the tone of
the surrounding lines.

- [ ] **Step 7: Full suite and commit**

```bash
./.venv-mcp/Scripts/python.exe -m pytest
git add docs/MCP.md CLAUDE.md README.md tests/test_mcp_registry.py
git commit -m "docs(mcp): rewrite the tool reference and enforce it with a test"
```

---

### Task 13: Verification

**Files:** none changed unless a check fails.

- [ ] **Step 1: Full Python suite**

Run: `./.venv-mcp/Scripts/python.exe -m pytest`
Expected: all pass, no skips that were not skipping before.

- [ ] **Step 2: Frontend build**

Run: `cd frontend && npm run build`
Expected: clean build, no TypeScript errors.

- [ ] **Step 3: Docker build**

Run: `docker compose -f docker-compose.test.yml -p linearr-test build`
Expected: succeeds. This is the check that catches a missing `COPY linearr_mcp/`.

- [ ] **Step 4: Container smoke test**

```bash
docker compose -f docker-compose.test.yml -p linearr-test up -d
```

Then, against `http://localhost:8780`: log in as `admin` / `test`, read the
token from `GET /api/mcp/info`, and list the tools:

```bash
curl -s http://localhost:8780/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | head -c 400
```

Expected: a JSON-RPC result with the full tool list. Then
`docker compose -f docker-compose.test.yml -p linearr-test down`.

- [ ] **Step 5: Confirm no stray files are staged**

Run: `git status --short`
Expected: clean. In particular `.venv-mcp/` must not be tracked — if it is,
add it to `.gitignore` in the same commit as the removal.

- [ ] **Step 6: Final commit if anything changed**

```bash
git add -A
git commit -m "chore(mcp): verification fixes"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| §3.1 Module layout | 1 |
| §3.2 Registry, annotations, instrumentation | 2 |
| §3.3 Toolsets and gating | 2 (resolution), 3 (API + UI) |
| §3.4 Request shim | 1 |
| §3.5 Naming (existing names frozen) | Global Constraints |
| §3.6 Consolidation | 6 (`get_plex_highlights`), 9 (`list_tunarr_links`, `get_tunarr_status`, `get_tunarr_endpoints`, `get_tunarr_filler_list`), 10 (`get_logs`, `clear_logs`, `export_lineup`) |
| §3.7 Resources | 11 |
| §3.8 Server instructions | 11 |
| §4 channels | 4 |
| §4 icons | 4 |
| §4 assignments (incl. A6 fix) | 5 |
| §4 plex | 6 |
| §4 collections | 7 |
| §4 blocks | 8 |
| §4 tunarr | 9 |
| §4 watermark | 5 |
| §4 ai | 10 |
| §4 system | 10 |
| §5 Error handling + argument redaction | 1 (`args_summary`), 4 (redaction test) |
| §6 Testing | every task; structural tests in 2, 3, 12 |
| §7 Documentation | 12 |
| §2 Non-goals honoured | Global Constraints + Task 12 §8 |
| Audit A1 | 2 |
| Audit A2, A3, A4 | 12 |
| Audit A5 | 1–2 (registration-time wrapping) |
| Audit A6 | 5 |
| Audit A7 | not fixed — `browse_library`'s clamp is documented behaviour and changing it would alter results for existing callers. Recorded here as a knowing no-op. |

**Type consistency check**

- `reg.tool(name, *, toolset, read_only, destructive, idempotent, open_world)` — Task 2 defines it, Tasks 4–11 use exactly these kwargs.
- `tool_error(exc)` — defined in Task 1's `registry.py`, imported as `from .registry import tool_error` everywhere.
- `json_request(body)` — defined in Task 1's `_request.py`, imported as `from ._request import json_request` in `channels.py`, `icons.py`, `collections.py`, `tunarr.py`, `system.py`.
- `register(reg, api)` — every toolset module; `resources.register(mcp, api)` takes the raw `FastMCP` instead, because resources are not gated or instrumented. Called differently in `build_mcp_server` — noted in Task 11 Step 4.
- `build_mcp_server(api) -> (FastMCP, list[dict])` — Task 1 defines it, `main.py` unpacks two values into `mcp_server, MCP_TOOLSET_INFO`, and Task 3's `/api/mcp/info` reads `MCP_TOOLSET_INFO`.
- `TOOLSET_OF` — exported from `linearr_mcp/__init__.py` in Task 2, consumed by `test_every_tool_belongs_to_a_declared_toolset`.

**Placeholder scan:** every code step carries real code; no "add error handling"
or "similar to Task N". Three steps ask the implementer to verify a handler's
exact signature against `main.py` before writing the call (Tasks 8, 9, 10) —
those are stated as concrete named checks with a stated fallback, not open
questions.
