# Linearr UI Patterns — Reference

Shared UI patterns used across the app. Use these as starting points when building similar features.

---

## Floating Action Bar (Sticky Save Bar)

A sticky/floating action bar anchored to the bottom of a scrollable container. Clicks pass through the empty margins around the bar so the content below remains interactive. Used for the Settings page Save button.

### When to use
- Save / Apply / Publish actions on long scrollable forms
- Confirm-Cancel pairs on a modal with a lot of content
- Primary CTA that needs to remain visible while the user scrolls
- Any place where the action is important enough to always be in sight

### When NOT to use
- Short forms that fit in a single screen (use a regular inline button)
- Modal dialogs with a proper footer (use the native modal footer pattern)
- Navigation actions (use the TopBar)

### Implementation

```tsx
// 1. Parent wrapper: must be `relative` so the floating bar positions against it
<div className="flex-1 flex flex-col overflow-hidden relative">

  {/* 2. Header — stays fixed at top */}
  <div className="px-6 py-4 border-b border-slate-800 shrink-0">
    <h1>Page Title</h1>
  </div>

  {/* 3. Scrollable body — add `pb-24` so content doesn't hide under the floating bar */}
  <div className="flex-1 overflow-auto px-6 py-4 pb-24">
    {/* page content */}
  </div>

  {/* 4. Floating save bar */}
  <div className="absolute bottom-0 left-0 right-0 pointer-events-none p-4 z-10">
    <div className="pointer-events-auto max-w-2xl mx-auto flex items-center justify-between gap-3 bg-slate-800/95 backdrop-blur-md border border-slate-700 rounded-xl px-4 py-3 shadow-2xl">
      <p className="text-xs text-slate-400">Optional hint text</p>
      <button className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium">
        Save
      </button>
    </div>
  </div>

</div>
```

### Key tricks

| Trick | Why |
|-------|-----|
| `relative` on parent + `absolute bottom-0` on bar | Keeps the bar anchored to the scrollable container, not the viewport (use `fixed` if you want viewport-anchored) |
| `pointer-events-none` on outer wrapper | Makes the empty margins pass clicks through to content underneath |
| `pointer-events-auto` on inner card | Restores interactivity just on the bar itself |
| `max-w-2xl mx-auto` on inner card | Centers and constrains the bar width — doesn't stretch edge-to-edge |
| `pb-24` on scrollable body | Ensures last content isn't hidden behind the bar |
| `bg-slate-800/95 backdrop-blur-md` | Translucent card with a blur so content is hinted at underneath |
| `z-10` | Floats above content |

### Alternative: Viewport-Fixed (not scoped to container)

Use `fixed` instead of `absolute` if the bar should stay pinned to the viewport regardless of parent:

```tsx
<div className="fixed bottom-0 left-0 right-0 pointer-events-none p-4 z-50">
  <div className="pointer-events-auto max-w-2xl mx-auto ...">
    ...
  </div>
</div>
```

### Alternative: Edge-to-edge

Drop `max-w-2xl mx-auto` and you get a full-width bottom bar like mobile apps:

```tsx
<div className="absolute bottom-0 left-0 right-0 bg-slate-800 border-t border-slate-700 px-6 py-3 flex justify-end gap-3">
  <button>Cancel</button>
  <button>Save</button>
</div>
```

### Alternative: Floating Pill (single CTA)

Compact pill with just the action button, often top-right or bottom-right:

```tsx
<div className="absolute bottom-6 right-6 z-10">
  <button className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full shadow-lg">
    Save
  </button>
</div>
```

### Real usage in Linearr

**Settings page** — `frontend/src/features/settings/components/SettingsView.tsx`
- Bar visible only on the Plex / AI / Tunarr config tabs (not on Logs or System)
- Bar contains a hint "Changes are saved to all tabs at once" + Save button
- Uses `absolute` scoped to the Settings view container

---

## Usage shorthand for future requests

When you want this pattern in a new place, say:
- **"Use the floating save bar pattern"** — default (absolute, max-w-2xl, centered, with hint text)
- **"Floating pill"** — minimal single-button variant
- **"Edge-to-edge bottom bar"** — full-width bottom bar
- **"Fixed floating bar"** — viewport-pinned version

All documented here in `docs/UI_PATTERNS.md`.
