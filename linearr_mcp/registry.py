"""Tool registration for Linearr's MCP server.

Every tool goes through `ToolRegistry.tool()`, which applies the Activity-Log
wrapper at registration time. That ordering is the point: the previous design
wrapped tools in a pass that ran after the last registration, so any tool added
below that line silently lost its instrumentation.
"""
import inspect
import os
import time
from typing import Callable

import httpx
from fastapi import HTTPException
from mcp.types import ToolAnnotations

TOOLSETS = (
    "channels", "icons", "assignments", "plex", "collections",
    "blocks", "tunarr", "watermark", "ai", "system",
)


def tool_error(exc: HTTPException) -> RuntimeError:
    """Convert an internal HTTPException into a human-readable tool error."""
    return RuntimeError(f"{exc.detail}" if exc.detail else f"HTTP {exc.status_code}")


_REDACT_HINTS = ("icon", "image", "token", "key", "secret", "password")


def args_summary(kwargs: dict) -> dict:
    """Compact, log-safe view of a tool call's arguments.

    Icon writes and configuration changes must not fill the Activity Log with
    base64 blobs or credentials, so anything that looks like one is redacted
    before it is written.
    """
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


class ToolRegistry:
    """Registers MCP tools with annotations, toolset gating and logging."""

    def __init__(self, mcp, api, enabled: set[str]):
        self.mcp = mcp
        self.api = api
        self.enabled = enabled
        self.toolset_of: dict[str, str] = {}
        self._counts: dict[str, int] = {t: 0 for t in TOOLSETS}

    def counts(self) -> dict[str, int]:
        return dict(self._counts)

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

    def _instrument(self, name: str, fn):
        """Wrap a tool so every call lands in the Activity Log (category 'mcp')
        with duration, a redacted argument summary, and the outcome — successes
        and failures alike. Raw network errors (Plex/Tunarr down) become a
        readable tool error instead of an httpx traceback.

        Wrapping happens BEFORE registration, and FastMCP builds the input
        schema by inspecting whatever it is handed — hence the signature and
        annotation copy below.
        """
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
