# Design System Showcase

A self-contained, living view of Linearr's design system. Open `showcase.html`
in a browser to see the token foundations (rendered live from the actual
`@theme` block) plus a gallery of the real UI components in their dark/indigo
styling.

## Build / refresh

```bash
cd frontend
npm run showcase:build
```

This does two things:

1. **Regenerates the Foundations** (`<!-- TOKENS -->` region of `showcase.html`)
   by parsing the `@theme` block in `src/index.css` — color ramps and the type
   scale. Deterministic and sorted, so an unchanged token set produces a
   byte-identical file.
2. **Compiles the project CSS** to `design-system/app.css` so the page renders
   correctly when opened directly via `file://`.

## Editing

- **Tokens** — edit `src/index.css` (`@theme`), then run `npm run showcase:build`.
  Never hand-edit the `<!-- TOKENS -->` region; it's overwritten on every build.
- **Component gallery** — hand-authored inside the `<!-- KIT:START -->…<!-- KIT:END -->`
  region of `showcase.html`. The build never touches it. Add new primitives here
  as they're created.

## Notes

- Linearr is **dark-only**: the page is fixed to the `dark` class; there is no
  light mode and no `dark:` variants in the app.
- Full written reference (rules, primitive APIs): [`docs/DESIGN_SYSTEM.md`](../../docs/DESIGN_SYSTEM.md).
- `app.css` is a compiled artifact — gitignored, not committed (regenerate locally).
