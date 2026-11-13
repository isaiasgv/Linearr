"""Inlined fonts keep their `unicode-range`, or exported icons change font.

The icon editor previews text as inline SVG in the DOM, where `src/fonts.css`
supplies the faces. Export is different: `rasterizeToPng` draws the SVG through
an `<img>`, and an SVG loaded that way resolves NO external references — so the
faces have to be base64-inlined into the SVG or the canvas rasterizes a
substitute.

The subtlety that actually bit: each family ships as two disjoint subsets, and
**`latin-ext` contains no basic Latin at all** (verified against the shipped
files with fontTools — no `A`, no `a`, no `G`; 330 glyphs, all accented forms
and symbols). Two `@font-face` rules with the same family, style and weight and
no `unicode-range` are a plain override, so the later one — latin-ext — wins for
*every* character. The exported SVG then asked a face with no `G` to render
"Galaxy" and the browser silently substituted its default. On screen it was
perfect, because `fonts.css` declares the ranges properly.

There is no JS test runner in `frontend/`, and the failure mode is invisible
(no error, no warning, just different letterforms in the saved PNG), so these
are static assertions on the source. They are cheap and they catch the one
edit that reintroduces the bug: "simplifying" the emitted CSS.
"""
import re
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
FONTS_TS = FRONTEND / "src" / "features" / "icons" / "editor" / "fonts.ts"
FONTS_CSS = FRONTEND / "src" / "fonts.css"


@pytest.fixture(scope="module")
def fonts_ts() -> str:
    if not FONTS_TS.exists():
        pytest.skip("frontend sources not present")
    return FONTS_TS.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def fonts_css() -> str:
    if not FONTS_CSS.exists():
        pytest.skip("frontend sources not present")
    return FONTS_CSS.read_text(encoding="utf-8")


def test_inlined_font_faces_declare_a_unicode_range(fonts_ts):
    """The regression itself."""
    # The template literal that builds the inlined @font-face for export.
    assert "@font-face{font-family:" in fonts_ts, "the inlining template moved — update this test"
    face_block = fonts_ts.split("@font-face{font-family:", 1)[1][:400]
    assert "unicode-range:" in face_block, (
        "the inlined @font-face has no unicode-range. The latin-ext subset "
        "contains no basic Latin, so without a range it overrides the latin "
        "face and exported icons render in a substitute font."
    )


def test_both_subsets_are_inlined(fonts_ts):
    """Only inlining `latin` would silently drop accented characters from
    exports — a channel named 'Cine Español' would lose its ñ."""
    assert "-latin.woff2" in fonts_ts
    assert "-latin-ext.woff2" in fonts_ts


def test_every_stylesheet_face_declares_a_range(fonts_css):
    """The same invariant on the DOM side. Both subsets are declared per family
    with identical family/style/weight, so a face without a range would shadow
    its sibling here too."""
    faces = re.findall(r"@font-face\s*\{[^}]*\}", fonts_css, re.S)
    assert faces, "no @font-face rules found — did fonts.css move?"
    missing = [f for f in faces if "unicode-range" not in f]
    assert not missing, (
        f"{len(missing)} @font-face rule(s) in fonts.css have no unicode-range"
    )


def test_the_font_files_referenced_actually_exist(fonts_ts):
    """A typo'd path fails exactly like the CSP bug did: no error, just the
    wrong letterforms."""
    # Paths are built per family from a slug — `subsets('baloo-thambi-2')` —
    # so resolve the slugs and rebuild the two filenames each one implies.
    slugs = set(re.findall(r"subsets\(\s*'([a-z0-9-]+)'\s*\)", fonts_ts))
    assert slugs, "no font families registered — the registry moved"
    expected = {f"{s}-{sub}.woff2" for s in slugs for sub in ("latin", "latin-ext")}
    missing = sorted(n for n in expected if not (FRONTEND / "public" / "fonts" / n).exists())
    assert not missing, f"referenced but not present in public/fonts: {missing}"


def test_preview_and_export_use_the_same_font_family_string():
    """They used to differ — export emitted the bare face name while the preview
    used the full CSS stack, so the two could resolve differently and only the
    export was wrong. One code path now, so they cannot drift."""
    render_ts = FRONTEND / "src" / "features" / "icons" / "editor" / "render.ts"
    if not render_ts.exists():
        pytest.skip("frontend sources not present")
    body = render_ts.read_text(encoding="utf-8")
    assert "embedMode" not in body, (
        "renderTextLayer has an embed-mode branch again — that is what let the "
        "exported font-family diverge from the previewed one"
    )
    assert "familyFor(layer.font)" in body
