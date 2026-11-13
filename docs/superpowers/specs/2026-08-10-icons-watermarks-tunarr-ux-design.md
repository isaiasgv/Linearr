# Icons, watermarks and Tunarr UX — design

**Date:** 2026-08-10
**Status:** For review.
**Input:** A batch of ten items from testing — quick-start scrolling, icon canvas
size, icon upload, an auto icon generator, a public Tunarr domain for assets, a
watermark audit, watermark opacity, watermark upload, now-playing, the Tunarr
view refactor, and a dead Plex chip in the collections bar.

---

## 1. What this covers

Ten items, grouped into four areas that share code. They are ordered so each
group ends somewhere shippable and testable.

| # | Item | Area |
|---|---|---|
| 1 | New-channel quick start needs too much scrolling | Channel form |
| 2 | Icon designer: editable canvas width/height | Icons |
| 3 | Upload an existing icon instead of designing one | Icons |
| 4 | Auto icon generation from a brand line + channel name | Icons |
| 5 | Public Tunarr domain for icons and watermarks | Tunarr assets |
| 6 | Audit the icon/watermark work landed so far | Tunarr assets |
| 7 | Watermark default opacity 20 → 30 | Watermark |
| 8 | Watermark image: upload a file, not just icon-or-URL | Watermark |
| 9 | Now Playing on the channel view | Guide |
| 10 | Tunarr view refactor | Tunarr UX |
| 11 | Plex chip in the collections bar does nothing | Collections |

(Eleven rows for ten items — the Plex chip arrived mid-review.)

---

## 2. Channel form quick start (item 1)

**Now.** `ChannelFormModal` is `max-w-lg` (512 px). Quick start is three
mutually-exclusive accordion panels; only one can be open, and each renders its
results as a **single-column list capped at `max-h-56`** (224 px). With 60-plus
network presets that is roughly four visible rows out of sixty.

**Change.** Widen the modal to `max-w-5xl` and split it into two panes on `lg`
and up: quick start on the left at full height, the channel form on the right.
Below `lg` they stack, quick start first.

Within the quick-start pane:

- The three sources stay as tabs — they are genuinely different things and a
  single merged list would be worse — but the panel is no longer collapsible.
  One is always open, defaulting to Network Presets.
- Results become a responsive grid: `grid-cols-2 xl:grid-cols-3` for presets,
  `grid-cols-2` for AI and 24/7 (those cards carry more text and a poster).
- The scroll region grows from `max-h-56` to `max-h-[52vh]`.

At `xl` that is roughly 24 presets visible at once against the current four.

**Not doing:** virtualising the preset list. Sixty items do not need it, and
`content-visibility` is already the codebase's answer for long grids.

---

## 3. Icons

### 3.1 Editable canvas size (item 2)

`Composition.size: number` is used as both width and height in six places
(`render.ts` background, viewBox and `<svg>` attributes; `rasterizeToPng`;
`autoFitLayers`; `ExportPanel`). It becomes:

```ts
export type Composition = {
  layers: Layer[]
  background: Background
  width: number
  height: number
}
```

**Back-compatibility is required, not optional.** Compositions are persisted as
JSON in the icons table, so every stored project has `size` and no
`width`/`height`. A reader normalises on load:

```ts
export function normalizeComposition(raw: unknown): Composition
```

which maps a legacy `size: n` to `width: n, height: n`. It runs wherever a
stored composition enters the app — `IconEditorModal`'s hydrate path and the
icon library. Nothing rewrites stored rows; old projects keep working and are
upgraded the next time they are saved.

The editor gets a Canvas section in `PropertiesPanel` (shown when no layer is
selected, which is currently a dead empty state): numeric width and height, a
lock-aspect toggle, and preset buttons for 512×512, 1024×1024, 1280×720 and
1920×1080. Bounds 64–4096.

`EditorCanvas` currently assumes square. It switches to fitting the composition
box inside the available area preserving aspect ratio.

### 3.2 Upload an existing icon (item 3)

`LayerPanel` can already add an *image layer* from a file, and
`ChannelFormModal` already has an Upload button. Two gaps remain:

- `IconLibraryView` has no way to add an image, so an icon made elsewhere cannot
  join the library and be reused.
- The channel-view icon action goes straight to the designer; there is no
  "upload one I already have".

Both get an Upload control writing a PNG/JPEG/WebP/SVG data URI — to
`POST /api/icons` for the library, and to the existing
`PUT /api/channels/{n}/icon` for the channel.

### 3.3 Auto icon generation (item 4)

The house style is two stacked text lines: a brand line (`Galaxy`) in Baloo
Thambi 500 over the channel line in Baloo Thambi 2 400, white, on transparent.
`newTextLayer500` / `newTextLayer400` already encode exactly this, and
`IconEditorModal` already seeds them — but only inside the designer, only when
opened, and with a crude split of the channel name on whitespace.

**Extract it into one pure function** in a new `features/icons/generate.ts`:

```ts
export interface IconBrandDefaults {
  brand_line: string        // 'Galaxy'
  brand_font: string        // 'Baloo Thambi'
  brand_weight: number      // 500
  name_font: string         // 'Baloo Thambi 2'
  name_weight: number       // 400
  color: string             // '#ffffff'
  width: number             // 512
  height: number            // 512
}

export function generateIconComposition(
  brandLine: string, channelLine: string, d: IconBrandDefaults,
): Composition
```

Defaults live in the `settings` table under an `icon_brand_*` prefix, are served
by `GET /api/settings`, and are editable in Settings → a new Icons section. The
listed values are the fallbacks when nothing is stored.

**Filling the canvas properly.** The existing `autoFitLayers` estimates text
width as `text.length * 0.6 * fontSize`, which is why generated icons do not
reach the edges — the estimate runs wide for most strings, so the fitted size
comes out small. Replace it with real measurement: a module-level
`CanvasRenderingContext2D` obtained once, `ctx.font` set to the layer's real
weight/size/family, and `ctx.measureText(line).width`. The fit then scales each
line to the larger of (canvas width − 2×margin) / measured width and the height
budget for its row, so the longest line lands on the margins. Margin is 5% per
side, as now.

This depends on the font being loaded. `ensureFontLoaded` triggers the Google
Fonts `<link>`, but measurement before the face is ready silently falls back to
a system metric and the fit is wrong. The generator therefore awaits
`document.fonts.load(...)` for both faces before measuring, and is `async` for
that reason alone.

**Where it runs.**

- *New Channel form.* Two inputs — brand line (prefilled from the stored
  default) and channel line (mirrors the Name field until edited) — with a live
  preview beside them, regenerating on a 250 ms debounce. Buttons: Use, Edit in
  designer, and Clear. Nothing is written until the channel is created.
- *Channel view.* A Generate Icon action alongside Edit Icon, using the stored
  defaults and the channel's own name.

The generated composition is carried into the designer intact, so Edit in
designer is a true continuation rather than a re-seed.

---

## 4. Tunarr assets: the public domain (items 5, 6)

### 4.1 The actual problem

Icons do not render in remote Plex clients because **Linearr pushes the channel
icon to Tunarr as a `data:` URI**. `_tunarr_icon_obj(icon_data)` puts the whole
base64 payload in the icon `path`, and that is what Tunarr writes into XMLTV.
Local clients that render inline data survive it; remote ones do not. A domain
setting alone would not have fixed this — the icon has to become an HTTP URL.

Watermarks are already uploaded (`_tunarr_upload_image`), but the URL is built
on the **internal** base (`http://tunarr:8000`), which is equally unreachable
from outside.

### 4.2 Design

One new optional setting, `tunarr_public_url`. Empty means "same as
`tunarr_url`", so nothing changes for anyone who does not set it.

```python
def _tunarr_asset_base() -> str:
    """Base URL for asset links written INTO Tunarr (icons, watermarks).
    API calls keep using get_tunarr_url()."""
```

**Icons become uploads.** A new `channels.icon_url` column holds the absolute
URL of the icon as uploaded to Tunarr. `_resolve_channel_icon_url(n)` uploads
the stored data URI under `linearr-icon-ch{n}-{sha1[:10]}.{ext}` — the same
collision-free scheme `_watermark_image_filename` already uses, and for the same
reason. `_tunarr_icon_obj` then receives a URL rather than a data URI.

Degradation is deliberate: if the upload fails, the icon falls back to the
current data-URI behaviour rather than clearing the channel's logo. An icon that
renders only locally beats no icon.

**Re-basing, not migrating.** Stored URLs are absolute and already exist in the
database, so changing the setting must not require a migration or leave stale
hosts behind. `_tunarr_asset_url(stored)` takes any stored URL, and:

- if its path starts with `/images/` **and** its host matches the current
  internal or public Tunarr host → re-base the path onto the current asset base;
- otherwise → return it untouched.

That second branch is what protects a hand-pasted third-party watermark URL from
being rewritten onto the Tunarr domain. Applied at push time and on read, a
settings change takes effect on the next sync with no migration step.

**A caveat that must be stated in the UI.** The watermark URL is fetched by
**ffmpeg inside the Tunarr container**, not by the browser. Pointing it at a
public domain means Tunarr's watermark fetch now depends on external DNS and TLS
resolving from inside that container. If it does not, the watermark image fails
to load — and an enabled watermark whose image fails is the exact condition that
kills a channel. The Settings field says so plainly, and
`POST /api/tunarr/test` gains a reachability probe of the public base so the
setting can be verified before it is trusted.

### 4.3 The audit (item 6)

Two documentation defects found while reading, both worth fixing because they
actively mislead:

1. `WatermarkEditorModal`'s hint reads "No image set — Tunarr will use the
   channel icon." That is false. `put_channel_watermark` resolves the icon to a
   real uploaded URL and **rejects the save with a 400** when there is no icon to
   derive one from. The copy describes behaviour that was removed after the
   ffmpeg exit-254 evidence.
2. `CLAUDE.md` still carries the paragraph asserting there is "deliberately NO
   set-an-image-before-enabling gate", citing the Tunarr 1.3.10 probe that showed
   `url` is optional. The API does accept it; playback does not survive it. The
   code is right and the doc is stale.

Both are corrected. A test asserts the 400 path, so the copy and the behaviour
cannot drift apart again silently.

---

## 5. Watermark (items 7, 8)

**Opacity default 20 → 30**, in the three places that must agree:
`_WATERMARK_DEFAULTS` in `main.py`, `DEFAULT_WATERMARK` in
`features/watermark/types.ts`, and the `set_channel_watermark` MCP tool.
`tests/test_mcp_tools.py` already asserts the MCP half; the assertion is
updated rather than removed. Existing channels keep their stored value — this is
the default for a *new* watermark only.

**Image source becomes a three-way choice.** The backend's `WatermarkImageIn`
already accepts `image` (a data URI), `url`, or neither; only the UI is missing
the upload path. The Image fieldset becomes radio-selected:

- Channel icon (default) → `POST {}`
- Upload a file → `POST {image: <data URI>}`, with a thumbnail preview
- Image URL → `POST {url}`

`use_channel_icon` keeps its current meaning — it is what makes the watermark
follow later icon changes via `_refollow_channel_icon_watermark` — and is set
true only for the first option.

---

## 6. Now Playing (item 9)

The bulk-EPG fix landed, so titles are real. `TunarrView` already has a
`nowPlaying(schedule)` helper; it is per-channel and returns a bare string.

Promote it to `features/tunarr/nowPlaying.ts` as a shared, tested pure function
returning the current programme plus the next one and a progress fraction, and
add a `useNowPlaying(channelNumber)` hook reading the existing
`['tunarr','guide']` query — **not** a new per-channel request. One bulk EPG
fetch already covers the whole lineup and that invariant is guarded by a test.

`ChannelDetail`'s header gains a compact strip: title, episode detail when
present, a progress bar, and time remaining. It refreshes on a 60-second
interval and hides entirely when the channel is not linked to Tunarr or the EPG
has nothing for it.

---

## 7. Tunarr view refactor (item 10)

`TunarrView.tsx` is 1,284 lines rendering six sections stacked in one scroll —
channels, a 24/7 builder, AI suggestions, smart collections, XMLTV/M3U, sessions
and filler lists — plus two inline modals. The guide is a full-page swap driven
by local state, so opening it loses everything else.

**Split into sub-tabs**, one file each under
`features/tunarr/components/panels/`:

| Tab | Contents |
|---|---|
| Channels | Tunarr channel cards, scan/refresh, import, export |
| Guide | `TunarrGuide`, no longer a page swap |
| Collections | Smart collections, filler lists |
| Build | 24/7 builder, AI channel suggestions |
| System | XMLTV/M3U, active sessions, connection and version |

`TunarrView` keeps the header and version banner and becomes a tab host of
roughly 150 lines. The active tab persists in `ui.store` under
`linearr:tunarrTab`, matching how Cable Plex already persists its view mode.

Alongside the split:

- A sticky toolbar carrying connection status, version, and the actions that are
  currently scattered across section headers.
- Channel search and a linked/unlinked filter — with 40-plus channels the grid
  is unnavigable without one.
- Consistent loading and empty states; several sections currently render nothing
  at all while loading.

The two inline modals move to their own files unchanged.

**Explicitly not doing:** touching the Tunarr API layer, the hooks, or any
behaviour. This is a presentation refactor and existing tests must pass
untouched.

---

## 8. Plex chip in the collections bar (item 11)

In `ContentTab`'s `CollectionTypeStatus`, the Tunarr chip is a `<button>` wired
to `onPushToTunarr`; the Plex chip beside it is a `<span>`. They are styled
identically, so the Plex one reads as a button and does nothing when clicked.

It becomes a `<button>` calling the same build the "Build collections" action
uses (`POST /api/collections/generate/{n}`), which is the Plex-side counterpart
of pushing to Tunarr. It carries the same assigned→owned confirmation, because
that endpoint switches an assigned slot back to owned — a chip must not be a
quieter route to a consequence the main button warns about.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Public URL unreachable from the Tunarr container → watermark fails → channel dies | Stated in the Settings copy; reachability probe on the test endpoint; `_watermark_to_tunarr` already refuses to emit `enabled: true` without an image |
| Composition `size` → `width`/`height` breaks stored icon projects | `normalizeComposition` on every read; no rewrite of stored rows; test covers a legacy `size`-only payload |
| Icon upload to Tunarr fails and channels lose their logos | Falls back to the current data-URI behaviour rather than clearing |
| Re-basing rewrites a user's own external watermark URL | Only `/images/` paths on a known Tunarr host are re-based; test covers a third-party URL passing through untouched |
| Tunarr refactor regresses behaviour | Presentation only; no API/hook changes; existing tests must pass unmodified |
| Text measurement runs before the font loads → wrong fit | Generator awaits `document.fonts.load` for both faces before measuring |

---

## 10. Out of scope

- The content-health and re-linking work from
  `2026-08-08-playback-failures-linearr-response.md`. Still pending, untouched here.
- Writing Tunarr transcode configs. Linearr does not own that surface.
- Any change to the channel renumber path.
