# Channel Icon System Overhaul — Implementation Plan

## Context
Linearr needs a proper icon system so users can build polished channel logos. Currently:
- Channels have an `icon` field but it's NOT settable during creation
- The current `IconEditorModal` is limited: one text input, one font, no layers, no PNG import, no SVG export, no color-variant exports
- Cable Plex channel cards don't display icons
- Icons from the library can't be attached during channel creation

This plan overhauls the editor into a true multi-layer canvas editor, integrates it into channel creation, and adds icon display everywhere channels appear.

---

## Part 1: New Icon Editor (the big one)

Replace [frontend/src/features/channels/components/IconEditorModal.tsx](../frontend/src/features/channels/components/IconEditorModal.tsx) with a layer-based SVG editor.

### Data model

```ts
type Layer =
  | {
      id: string
      kind: 'text'
      text: string
      font: string
      size: number
      weight: number
      color: string
      x: number
      y: number
      rotation: number
      letterSpacing?: number
      align?: 'left' | 'center' | 'right'
    }
  | {
      id: string
      kind: 'image'
      src: string // data URL
      format: 'png' | 'svg'
      tint: string | null
      x: number
      y: number
      width: number
      height: number
      rotation: number
      opacity: number
    }

type Composition = {
  layers: Layer[]
  background: {
    type: 'transparent' | 'solid' | 'gradient'
    value: string // color or "angle|color1|color2"
  }
  size: number // always 512
}
```

### UI layout
Three-panel editor inside a full-screen modal:

- **Left sidebar (layers panel)** — list of layers with visibility toggle and delete buttons. Buttons at top: `+ Text`, `+ Image`, `+ Upload SVG`.
- **Center canvas** — live SVG at 512x512 with selection handles (drag to move, corner handles to resize, top handle to rotate).
- **Right sidebar (properties panel)** — properties for the selected layer. Below that: background options and export options.

### Rendering
- Use **SVG** (not Canvas) as the authoring surface — easier to manipulate layers, preserves quality, exports directly to SVG
- Each layer is a `<g transform="translate(x,y) rotate(r)">` with either `<text>` or `<image>` inside
- Selection = click a layer → blue outline + transform handles
- Drag with `onPointerDown/Move/Up` to move; corner handles to resize; top handle to rotate

### Text layer features
- Multiline text content (Shift+Enter for new line)
- Font family dropdown: Inter, Arial, Impact, Georgia, Courier New, Trebuchet MS, Verdana, Palatino, Garamond, Comic Sans MS, Bebas Neue (Google Fonts CDN)
- Font size (16–400)
- Font weight (100–900)
- Color picker + preset swatches
- Letter spacing slider
- Text alignment (left/center/right)

### Image layer features
- Upload PNG/JPG/WebP via file input
- Upload SVG separately (parse SVG text so we can recolor it)
- Opacity slider
- **Tint color** — apply a color filter to PNGs (SVG `<filter>` with `feColorMatrix`) or replace SVG `fill`/`stroke` attrs — this is what lets the user turn a Harry Potter PNG into a white version
- Maintain aspect ratio toggle
- Rotation

### Background options
- Transparent (default)
- Solid color
- Linear gradient (two colors + angle)

### Export — 5 color modes

Mode names (dropdown in export panel):
1. **Original** — as designed
2. **All Black** — every element's color forced to black, background transparent
3. **All White** — every element's color forced to white, background transparent
4. **Text White / Image Original** — text color forced white, images keep original colors
5. **Custom** — user picks per-type color overrides

Each mode outputs both formats:
- **PNG** (rasterized from SVG using canvas)
- **SVG** (direct SVG download)

**Implementation:** `applyColorMode(composition, mode)` returns a copy of the composition with colors overridden, then `renderSVG(copy)` returns the string, and `rasterizeToPng(svgString, size)` returns a PNG blob.

### Single-line vs two-line layout
Interpretation: the user composes layers freely. Stacked layers (one above another) produce a two-line effect naturally. A **"Layout: Single-line | Two-line"** toggle at the top rearranges text layers horizontally or vertically, making it easy to generate both variants from the same composition.

### Save to library
When saving, the full `Composition` (JSON) AND the rendered PNG data URL are saved together, so users can **re-edit** later. Add a `composition` column to `saved_icons` for this.

### Assign to channel
From the editor's save menu, user picks:
- Save to library (standalone icon)
- Save and assign to channel X
- Export files (multi-format download as ZIP)

---

## Part 2: Channel Creation + Editing Integration

### `ChannelFormModal` changes
Add an "Icon" section above the form fields:

```
┌────────────────────────────────────┐
│ [🖼️ Icon Preview]                  │
│  [Pick from Library] [Create New]  │
│  [Upload File] [Clear]             │
└────────────────────────────────────┘
```

Options:
- **Pick from Library** → opens `IconPickerModal` (new lightweight component) that lists `saved_icons` and returns a data URL
- **Create New** → opens the full Icon Editor
- **Upload File** → file input → reads as data URL
- **Clear** → sets to null

The icon is stored in local form state and sent as part of the channel create/update mutation.

### Backend
- `POST /api/channels` must accept `icon` in the body (add to `ChannelIn` model and INSERT)
- `PUT /api/channels/{number}` already updates the channel; ensure it also handles `icon`

### Files to modify
- [main.py](../main.py) — Add `icon` to `ChannelIn` model, INSERT in `create_channel`, update logic
- [frontend/src/features/channels/components/ChannelFormModal.tsx](../frontend/src/features/channels/components/ChannelFormModal.tsx) — Icon section
- [frontend/src/features/channels/components/IconPickerModal.tsx](../frontend/src/features/channels/components/IconPickerModal.tsx) — **NEW** lightweight library picker

---

## Part 3: Display Icons in Cable Plex

### `CablePlexView` — Compact Card
Add small icon (`w-10 h-10 rounded`) next to the channel number badge at bottom-left of the poster strip.

### `CablePlexView` — Expanded Card
Replace the plain channel-number badge with a composite: icon (`w-11 h-11`) + number, OR side-by-side icon and number.

### `ChannelSidebar`
Add a small `w-6 h-6` icon before the channel number in the sidebar list.

All displays use `<img src={channel.icon} />` with a fallback to the number badge when icon is null.

---

## Files to modify / create

### Modify
- [main.py](../main.py) — accept `icon` in channel create; add `composition TEXT` column to `saved_icons`
- [frontend/src/features/channels/components/ChannelFormModal.tsx](../frontend/src/features/channels/components/ChannelFormModal.tsx) — icon picker UI
- [frontend/src/features/channels/components/IconEditorModal.tsx](../frontend/src/features/channels/components/IconEditorModal.tsx) — **full rewrite** as shell calling editor sub-components
- [frontend/src/features/channels/components/ChannelSidebar.tsx](../frontend/src/features/channels/components/ChannelSidebar.tsx) — icon display
- [frontend/src/features/cable-plex/components/CablePlexView.tsx](../frontend/src/features/cable-plex/components/CablePlexView.tsx) — icon in both cards
- [frontend/src/features/icons/api.ts](../frontend/src/features/icons/api.ts) — add `composition` to SavedIcon type
- [frontend/src/features/icons/hooks.ts](../frontend/src/features/icons/hooks.ts) — update hooks if needed

### Create
- [frontend/src/features/channels/components/IconPickerModal.tsx](../frontend/src/features/channels/components/IconPickerModal.tsx) — library browser for picking an icon
- `frontend/src/features/icons/editor/` — editor sub-components:
  - `EditorCanvas.tsx` — SVG canvas with selection/drag
  - `LayerPanel.tsx` — left sidebar
  - `PropertiesPanel.tsx` — right sidebar
  - `ExportPanel.tsx` — export options
  - `types.ts` — `Layer` and `Composition` types
  - `render.ts` — SVG rendering + PNG rasterization + color mode logic
  - `fonts.ts` — font list + Google Fonts loader

---

## Build order (suggested sequence)

1. **Backend** — add `icon` to `ChannelIn`, add `composition` column to `saved_icons` — smallest risk, unlocks the rest
2. **Editor types + render module** — `types.ts`, `render.ts`, `fonts.ts` — foundation with no UI
3. **Editor shell** — new `IconEditorModal` with empty panels + canvas placeholder
4. **LayerPanel** — add/remove/reorder/select layers
5. **EditorCanvas** — render layers, selection, drag
6. **PropertiesPanel** — edit selected layer properties
7. **Background options + Export panel** — wire up the 5 color modes + PNG/SVG download
8. **IconPickerModal** — lightweight library browser
9. **ChannelFormModal integration** — icon section during create/edit
10. **Display: ChannelSidebar, CablePlexView** — final polish

---

## Verification
1. Create a new channel with icon from library → icon shows up in sidebar and Cable Plex
2. Open the icon editor, add 2 text layers (stacked) + 1 PNG → export all 5 color modes as PNG and SVG → verify each output
3. Re-open a saved icon → layers restore correctly
4. Edit an existing channel, change its icon → Cable Plex reflects immediately
5. `npm run typecheck` and `npm run format:check` both pass
6. Docker build succeeds
