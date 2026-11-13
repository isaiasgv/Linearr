"""Server-side channel icon renderer — the Galaxy house style, in Pillow.

Icons used to be generated only in the browser (``frontend/src/features/icons``),
which meant nothing without a browser — the MCP server, a channel create from
the API — could make one, and the browser version had drifted from the logos
actually on air: it stretched every line to the full canvas width, so "Galaxy"
came out roughly twice the size of the name under it.

The real logos (the hand-made ones on CH 100–131 and 150–156) are measured, not
guessed. At scale 1 a reference icon is 83 px tall and tightly cropped:

    "Galaxy"       Baloo Thambi 2 Bold    -> 146-147 x 41 px
    9 px gap
    "Puerto Rico"  Baloo Thambi 2 Regular -> ~233 x 33 px

Both lines share (almost) one font size; each line keeps its natural width and
the canvas is just wide enough for the widest. Franchise channels swap the name
line for the show's own logo art, scaled to sit under the brand.

Everything is expressed in those scale-1 units and multiplied by ``scale``, so
the default output is the same artwork at 4x for crisp TV rendering.
"""
from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT_PATH = Path(__file__).resolve().parent / "assets" / "fonts" / "BalooThambi2-Variable.ttf"

# Scale-1 metrics, measured from the reference icons (see module docstring).
BRAND_SIZE = 48
NAME_SIZE = 47
LINE_GAP = 9
# A name wider than this many brand-widths wraps onto two lines rather than
# producing a sliver of an icon that is unreadable at guide size.
MAX_NAME_RATIO = 2.4
# Logo art under the brand: as wide as the brand plus a little, never taller
# than this many brand-heights (matches the Simpsons / Friends / BTTF logos).
LOGO_WIDTH_RATIO = 1.15
LOGO_MAX_HEIGHT_RATIO = 1.5
LOGO_MIN_HEIGHT_RATIO = 0.7
LOGO_MAX_WIDTH_RATIO = 1.8

DEFAULT_SCALE = 4
# Longest first, so "Galaxy+" wins over "Galaxy".
DEFAULT_BRANDS = ("Galaxy+", "Galaxy")
PREMIUM_BRAND = "Galaxy+"
DEFAULT_BRAND = "Galaxy"


@dataclass(frozen=True)
class IconSpec:
    brand: str
    name: str
    color: str = "#ffffff"


def split_channel_name(name: str, brands: tuple[str, ...] = DEFAULT_BRANDS) -> tuple[str, str] | None:
    """Peel a leading brand off a channel name.

    "Galaxy+ Premieres" -> ("Galaxy+", "Premieres"); "Galaxy Cartoon Network" ->
    ("Galaxy", "Cartoon Network"). Returns None when the name carries no brand.
    The brand must be followed by whitespace, so "Galaxy+" never splits as
    "Galaxy" over "+ Premieres" and "Galaxyland" is not a Galaxy channel.
    """
    trimmed = " ".join((name or "").split())
    low = trimmed.lower()
    for b in sorted(brands, key=len, reverse=True):
        bl = b.lower()
        if low.startswith(bl + " ") and trimmed[len(b):].strip():
            return trimmed[:len(b)], trimmed[len(b):].strip()
    return None


def brand_for(name: str, tier: str | None = None, *, default: str = DEFAULT_BRAND) -> IconSpec:
    """The two lines for a channel: its own brand prefix if it has one, else
    one chosen by tier (premium tiers are "Galaxy+")."""
    split = split_channel_name(name)
    if split:
        return IconSpec(*split)
    t = (tier or "").lower()
    brand = PREMIUM_BRAND if ("premium" in t or "+" in t) else default
    return IconSpec(brand, " ".join((name or "").split()))


def _font(size: float, weight: str) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FONT_PATH), max(1, round(size)))
    f.set_variation_by_name(weight)
    return f


def _text_image(text: str, font: ImageFont.FreeTypeFont, color: str) -> Image.Image:
    """One line of text on a transparent canvas cropped to its ink."""
    x0, y0, x1, y1 = font.getbbox(text)
    im = Image.new("RGBA", (max(1, x1 - x0), max(1, y1 - y0)), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((-x0, -y0), text, font=font, fill=color)
    return im


def _wrap(text: str, font: ImageFont.FreeTypeFont, max_width: float) -> list[str]:
    """Split into two balanced lines when one is too wide; never more than two."""
    words = text.split()
    if len(words) < 2 or font.getlength(text) <= max_width:
        return [text]
    best = min(
        range(1, len(words)),
        key=lambda i: max(font.getlength(" ".join(words[:i])), font.getlength(" ".join(words[i:]))),
    )
    return [" ".join(words[:best]), " ".join(words[best:])]


def _trim(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    box = im.getchannel("A").getbbox()
    return im.crop(box) if box else im


def _stack(parts: list[Image.Image], gap: int) -> Image.Image:
    width = max(p.width for p in parts)
    height = sum(p.height for p in parts) + gap * (len(parts) - 1)
    out = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    y = 0
    for p in parts:
        out.alpha_composite(p, ((width - p.width) // 2, y))
        y += p.height + gap
    return out


def render_icon(spec: IconSpec, *, logo: bytes | None = None, scale: float = DEFAULT_SCALE,
                padding: int = 0) -> bytes:
    """Render a channel icon and return PNG bytes.

    `logo`, when given, is image bytes (a show's clear logo) drawn in place of
    the name line. Either line may be blank; an icon needs at least one.
    """
    scale = max(0.5, min(float(scale), 16.0))
    brand_font = _font(BRAND_SIZE * scale, "Bold")
    name_font = _font(NAME_SIZE * scale, "Regular")
    gap = round(LINE_GAP * scale)

    parts: list[Image.Image] = []
    brand_img = _text_image(spec.brand, brand_font, spec.color) if spec.brand.strip() else None
    if brand_img is not None:
        parts.append(brand_img)
    ref_w = brand_img.width if brand_img else _text_image(DEFAULT_BRAND, brand_font, spec.color).width
    ref_h = brand_img.height if brand_img else round(41 * scale)

    if logo:
        art = _trim(Image.open(io.BytesIO(logo)))
        target_w = ref_w * LOGO_WIDTH_RATIO
        ratio = min(target_w / art.width, (ref_h * LOGO_MAX_HEIGHT_RATIO) / art.height)
        # A long, flat wordmark (Game of Thrones) is unreadable at brand width;
        # let it grow wider until it is at least LOGO_MIN_HEIGHT_RATIO tall.
        if art.height * ratio < ref_h * LOGO_MIN_HEIGHT_RATIO:
            ratio = min((ref_h * LOGO_MIN_HEIGHT_RATIO) / art.height,
                        (ref_w * LOGO_MAX_WIDTH_RATIO) / art.width)
        art = art.resize((max(1, round(art.width * ratio)), max(1, round(art.height * ratio))),
                         Image.Resampling.LANCZOS)
        parts.append(art)
    elif spec.name.strip():
        for line in _wrap(spec.name, name_font, ref_w * MAX_NAME_RATIO):
            parts.append(_text_image(line, name_font, spec.color))

    if not parts:
        raise ValueError("an icon needs a brand line, a name line or a logo")
    out = _stack(parts, gap)
    if padding:
        pad = round(padding * scale)
        framed = Image.new("RGBA", (out.width + 2 * pad, out.height + 2 * pad), (0, 0, 0, 0))
        framed.alpha_composite(out, (pad, pad))
        out = framed
    buf = io.BytesIO()
    out.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
