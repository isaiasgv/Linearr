# /og/

Open Graph and social-preview images for the landing site.

## Current state

The branded source images are committed as **SVG** and are referenced directly in
`index.html` (`og:image`, `twitter:image`, `apple-touch-icon`):

| File | Size | Purpose |
|---|---|---|
| `default.svg` | **1200×630** | Default OG / Twitter `summary_large_image` preview |
| `apple-180.svg` | **180×180** | iOS home-screen icon (`apple-touch-icon`) |

> ⚠️ SVG works in most modern scrapers but **some social platforms (Facebook,
> older Twitter/X, LinkedIn) ignore SVG `og:image`**. Export raster PNGs before a
> public launch and switch the meta tags back to the `.png` URLs.

## Exporting PNG (recommended before launch)

This was deferred because the build host was offline (no `sharp`/`@resvg/resvg-js`
available and the npm registry was unreachable). To render the PNGs:

```bash
# Option A — resvg (crisp, no browser)
npx @resvg/resvg-js-cli default.svg -o default.png --width 1200
npx @resvg/resvg-js-cli apple-180.svg -o apple-180.png --width 180

# Option B — sharp
npx sharp-cli -i default.svg -o default.png resize 1200 630
npx sharp-cli -i apple-180.svg -o apple-180.png resize 180 180

# Option C — headless Chrome / Inkscape / online SVG→PNG converter
```

Then update `index.html` meta tags from `/og/default.svg` → `/og/default.png`
and `/og/apple-180.svg` → `/og/apple-180.png` (keep the absolute
`https://linearr.oribion.com/og/...` URLs).

## Generating (from scratch)

- Quick mock: https://og-playground.vercel.app/
- From scratch (Figma / Affinity / Photoshop)
- Programmatically: `@vercel/og`, `satori`

## Verifying after upload

- Slack / Discord / Twitter / Facebook debugger paste-test
- https://www.opengraph.xyz/url/https%3A%2F%2Flinearr.oribion.com
- Twitter card validator: https://cards-dev.twitter.com/validator

> Placeholder files committed here are intentionally small — replace before launch.
