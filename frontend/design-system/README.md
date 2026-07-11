# Design System Showcase

A single, self-contained page showing Linearr's design system — the token
palette, type scale, and a gallery of the real UI components in their dark/indigo
styling.

## How to open it

Just open **`showcase.html`** in a browser. Double-click it, or drag it into a
tab (`file://`). **No build step, no npm, no server** — it's plain HTML + CSS.

## Editing

Everything lives in `showcase.html`:

- **Tokens** — the color/spacing values are plain CSS custom properties in the
  `:root` block at the top. They mirror the `@theme` block in
  [`../src/index.css`](../src/index.css); if you change a token there, update the
  matching `:root` variable here (or ask Claude to regenerate this section).
- **Components** — the gallery is plain HTML styled by the `<style>` block, made
  to match the shared primitives in `../src/shared/components/ui/`. Add new
  primitives here as they're created.

## Notes

- Linearr is **dark-only** — no light mode, no `dark:` variants in the app.
- Full written reference (rules, primitive APIs): [`docs/DESIGN_SYSTEM.md`](../../docs/DESIGN_SYSTEM.md).
