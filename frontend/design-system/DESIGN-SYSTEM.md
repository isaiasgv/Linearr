# Linearr Design System

The written spec for Linearr's design system — scaffolded by `/setup-design-system`. Read this alongside the living, openable catalog at [`design-system/showcase.html`](./showcase.html); this file explains the *why* and lists every token, the showcase demonstrates the *what* by rendering it.

## Principles

- **Oribion / Linear-clean aesthetic** — calm neutrals, subtle hairline borders over shadows, generous 8px-rhythm spacing, sharp legible type. Default aesthetic is `oribion`; `--aesthetic neutral` reproduces the prior generic look for non-portfolio repos.
- **One restrained accent** — a single brand hue (`--primary`) used sparingly for primary actions and focus states. Never a rainbow of accent colors.
- **Light + dark, always** — every semantic color token defined for light mode has a matching override in `.dark`, with the sole exception of tokens explicitly documented as mode-invariant (`--oribion`).
- **8px spacing rhythm** — compose spacing as multiples of the base scale; no arbitrary pixel values.
- **Four states per component** — every data-bound / async component renders one of **empty / loading (skeleton) / error (with retry) / ready** — never assumes "ready".
- **Accessible by default** — WCAG 2.2 AA contrast, visible `focus-visible` rings, `prefers-reduced-motion` honored. See the `accessibility-checklist` rule for the full contract.

## Token reference

Every token below is defined in the app's token file (`app.css` / `styles.css` / `wwwroot/css/app.css`) inside the `@theme` block (Light) and its `.dark` override (Dark). Values shown are the scaffolded Oribion defaults — a product may retune them (see Usage below), but the token **names** and the light/dark **pairing** stay fixed.

| Token | Light | Dark | Use for |
| --- | --- | --- | --- |
| `--background` | `#ffffff` | `#020617` | Page background |
| `--foreground` | `#0f172a` | `#f8fafc` | Default body text |
| `--card` | `#ffffff` | `#0f172a` | Card / panel surface |
| `--card-foreground` | `#0f172a` | `#f8fafc` | Text on `--card` |
| `--popover` | `#ffffff` | `#0f172a` | Popover / menu / tooltip surface |
| `--popover-foreground` | `#0f172a` | `#f8fafc` | Text on `--popover` |
| `--primary` | `#176bff` | `#176bff` | Brand actions — primary buttons, links, key CTAs (the Oribion accent) |
| `--primary-foreground` | `#ffffff` | `#ffffff` | Text/icons on `--primary` |
| `--secondary` | `#f1f5f9` | `#1e293b` | Secondary buttons / surfaces |
| `--secondary-foreground` | `#0f172a` | `#f8fafc` | Text on `--secondary` |
| `--muted` | `#f1f5f9` | `#1e293b` | De-emphasized surfaces (subtle panels) |
| `--muted-foreground` | `#64748b` | `#94a3b8` | De-emphasized text (captions, placeholders) |
| `--accent` | `#f1f5f9` | `#1e293b` | **Neutral hover/highlight state — NOT the brand.** Hover/active background for menu items, list rows, etc. Do not confuse with `--primary` |
| `--accent-foreground` | `#0f172a` | `#f8fafc` | Text on `--accent` |
| `--destructive` | `#dc2626` | `#ef4444` | Destructive actions (delete, irreversible ops) |
| `--destructive-foreground` | `#ffffff` | `#2c0808` | Text/icons on `--destructive` |
| `--success` | `#15803d` | `#22c55e` | Success feedback (toasts, badges, banners) |
| `--success-foreground` | `#ffffff` | `#052e16` | Text on `--success` |
| `--warning` | `#b45309` | `#f59e0b` | Warning feedback |
| `--warning-foreground` | `#ffffff` | `#422006` | Text on `--warning` |
| `--info` | `#0e7490` | `#06b6d4` | Informational feedback |
| `--info-foreground` | `#ffffff` | `#083344` | Text on `--info` |
| `--border` | `#e2e8f0` | `#1e293b` | Default hairline border / divider |
| `--border-strong` | `#cbd5e1` | `#334155` | Emphasized border (e.g. focused input container) |
| `--input` | `#e2e8f0` | `#1e293b` | Form control border |
| `--ring` | `#176bff` | `#3b82ff` | Focus ring color |
| `--oribion` | `#176bff` | `#176bff` *(invariant — no `.dark` override)* | "Powered By Oribion" family badge/mark **only**. Never reuse for `--primary`/`--accent` — it stays the fixed Oribion blue regardless of the product's accent choice |

### Type scale

| Token | Value | Use for |
| --- | --- | --- |
| `--font-sans` | `"Inter", ui-sans-serif, system-ui, sans-serif` | Default body/UI font |
| `--font-mono` | `"JetBrains Mono", ui-monospace, "Cascadia Code", Consolas, monospace` | Code / monospace content |
| `--text-xs` | `0.75rem` | Fine print, badges |
| `--text-sm` | `0.875rem` | Secondary text, form labels |
| `--text-base` | `1rem` | Body text |
| `--text-lg` | `1.125rem` | Emphasized body text |
| `--text-xl` | `1.25rem` | Small headings |
| `--text-2xl` | `1.5rem` | Section headings |
| `--text-3xl` | `1.875rem` | Page headings |
| `--text-4xl` | `2.25rem` | Hero / display headings |

### Radius scale

| Token | Value | Use for |
| --- | --- | --- |
| `--radius` | `0.5rem` | Default corner radius (buttons, inputs, cards) |
| `--radius-sm` | `calc(var(--radius) - 4px)` | Tight radius (badges, chips) |
| `--radius-lg` | `calc(var(--radius) + 4px)` | Larger surfaces (modals, large cards) |

### Motion tokens

| Token | Value | Use for |
| --- | --- | --- |
| `--ease-quiet` | `cubic-bezier(0.4, 0, 0.2, 1)` | Default transition easing |
| `--duration-fast` | `150ms` | Micro-interactions (hover, focus) |
| `--duration` | `200ms` | Standard transitions |

> All `@keyframes` / `transition-*` / `animate-*` usage must respect `@media (prefers-reduced-motion: reduce)` — see the base-layer override in `app.css`.

## Usage

- **Always reference semantic tokens, never raw palette values.** Use `bg-primary`, `text-foreground`, `border-border`, etc. — never `bg-slate-900`, `text-white`, or a bare hex/`bg-[#…]` in component code.
- **`--accent` is a neutral hover state, not the brand accent.** For brand-colored actions (primary buttons, links, focus emphasis), reach for `--primary`. Mixing these up is the single most common naming trap when porting from a non-shadcn token set.
- **`--oribion` is invariant.** It never gets a `.dark` override and is never substituted for `--primary`/`--accent` — it exists solely to keep the "Powered By Oribion" mark a fixed blue regardless of the product's own accent choice.
- **Check before you add.** Before minting a new token, color, or component, check this table and the living `design-system/showcase.html` first — reuse what already fits. This is the binding contract of the `design-system-consistency` rule ("reuse before you add"): a genuinely new token or component gets added to `@theme` **and** to the showcase in the same change, never as a follow-up, and a raw value never gets inlined in a component.
- Depth reference for the full token/component pattern set: the `ui-styling-tailwind` skill. Compliance contract: the `design-system-checklist` rule.

## Generated files — do not hand-edit

Two artifacts are **generated**, not authored, and any manual edit is silently overwritten on the next build:

- **`showcase.html`'s `/* TOKENS:START */` … `/* TOKENS:END */` block** — the resolved `:root` / `.dark` literal values shown in the showcase's Design Tokens page. Regenerated from this app's `@theme` block by `npm run showcase:build`.
- **`tokens.json`** — a machine-readable export of the same resolved token set, emitted alongside the showcase by `npm run showcase:build` (see the design-system tooling plan for consumers).

Both are re-synced by running:

```bash
npm run showcase:build
```

Hand-edit `app.css`'s `@theme` block instead, then re-run the build so `showcase.html` and `tokens.json` stay current. The showcase's `<!-- BRAND:START -->…<!-- BRAND:END -->` and `<!-- MOCKUPS:START -->…<!-- MOCKUPS:END -->` blocks are the opposite — hand-authored HTML that the build script never touches. (A `<!-- KIT:START -->…<!-- KIT:END -->` marker is reserved for a future component-kit section but is not currently present in the showcase.)

## Related

- [`design-system/showcase.html`](./showcase.html) — the living, openable catalog of every token + component pattern
- `design-system-consistency` rule — reuse-before-you-add compliance contract
- `design-system-checklist` rule — the token/state compliance contract this spec documents
- `design-system-auditor` agent — read-only audit against the checklist
- `ui-styling-tailwind` skill — full token + component-state depth reference
- `/setup-design-system` command — scaffolds this file, the token system, and the showcase
