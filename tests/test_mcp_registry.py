"""Structural tests for the MCP tool registry.

These are the tests that keep the surface honest as the app grows: every tool
annotated, every tool instrumented, every tool in a declared toolset, and the
docs matching the code.
"""
import asyncio

import main
from linearr_mcp._request import json_request


# ── request shim ─────────────────────────────────────────────────────────────

def test_json_request_round_trips_body():
    req = json_request({"icon": "data:image/png;base64,AAA"})
    assert asyncio.run(req.json()) == {"icon": "data:image/png;base64,AAA"}


def test_json_request_reports_content_length():
    req = json_request({"a": 1})
    assert req.headers["content-length"] == str(len(b'{"a": 1}'))
