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
