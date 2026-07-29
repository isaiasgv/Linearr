"""The CSP and the frontend's assets have to agree.

Linearr sends `img-src 'self' data: blob:`, deliberately: Plex art is proxied
same-origin through /api/plex/thumb, Tunarr art through /api/tunarr/image, and
channel icons are stored as data URIs. Nothing in the app needs a remote image
host.

That makes any hotlinked `<img src="https://…">` in the frontend a guaranteed
silent failure — the browser blocks it and the user just sees a missing image,
with nothing in the server logs. It happened once: the Oribion footer logo was
added after the CSP was written and loaded from oribion.com, so it never
rendered. Third-party marks that ARE vendored (plex.svg, plexpass.svg,
tunarr.svg in frontend/public/) render fine.

So this guards the agreement from both sides: the policy stays strict, and no
component reaches past it. Vendor the asset instead — it also keeps a
self-hosted instance working with no internet.
"""
import re
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
_FRONTEND_SRC = _ROOT / "frontend" / "src"

# `src="http…"` / `src={'http…'}` / url(http…) in a style — anything that makes
# the browser fetch an image from another origin.
_REMOTE_ASSET_RE = re.compile(
    r"""(?:src\s*=\s*["'{]{1,2}|url\(\s*["']?)https?://""",
    re.IGNORECASE,
)


def _frontend_sources():
    for path in sorted(_FRONTEND_SRC.rglob("*")):
        if path.suffix in {".ts", ".tsx", ".css"} and path.is_file():
            yield path


def test_no_frontend_asset_is_loaded_from_a_remote_origin():
    offenders = []
    for path in _frontend_sources():
        text = path.read_text(encoding="utf-8", errors="replace")
        for lineno, line in enumerate(text.splitlines(), 1):
            if _REMOTE_ASSET_RE.search(line):
                offenders.append(f"{path.relative_to(_ROOT)}:{lineno}: {line.strip()}")
    assert not offenders, (
        "These load an asset from a remote origin, which the app's own CSP "
        "(img-src 'self' data: blob:) blocks — the asset will silently never "
        "render. Vendor it into frontend/public/ instead, like plex.svg and "
        "tunarr.svg:\n  " + "\n  ".join(offenders)
    )


def test_csp_img_src_stays_same_origin_only(auth_client):
    """If this ever needs widening, vendor the asset instead."""
    csp = auth_client.get("/api/channels").headers["content-security-policy"]
    img_src = next(d.strip() for d in csp.split(";") if d.strip().startswith("img-src"))
    assert img_src == "img-src 'self' data: blob:", (
        "img-src was widened. A remote image host is not needed: Plex art is "
        "proxied via /api/plex/thumb, Tunarr art via /api/tunarr/image, and "
        f"icons are data URIs. Got: {img_src!r}"
    )
