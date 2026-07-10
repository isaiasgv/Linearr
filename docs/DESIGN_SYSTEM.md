# Linearr Design System

Canonical reference for the frontend's visual language and shared UI primitives.
Dark-only app: slate surfaces, indigo brand. Primitives live in
`frontend/src/shared/components/ui/` and are exported from the barrel:

```tsx
import { Button, Input, Field, Card, confirmDialog } from '@/shared/components/ui'
```

---

## Tailwind v4

Styling is **Tailwind CSS v4** with CSS-first config. There is **no
`tailwind.config.js`** — tokens live in a `@theme` block at the top of
`frontend/src/index.css`, and the entry is `@import "tailwindcss"` (not the old
`@tailwind base/components/utilities` directives). Build runs through
`@tailwindcss/postcss`; content sources are auto-detected (no `content` array).

Custom tokens defined in `@theme`: the `brand`/`success`/`danger`/`warning`
semantic ramps (mapped to indigo/emerald/red/amber), `slate-750` (`#293548`),
the `galaxy-*` legacy palette, and `text-2xs` (0.6875rem). Raw palette names
(`indigo-600`, `slate-900`, …) remain valid and are what most components use.

**Two v4 compatibility shims live in `@layer base` in `index.css` — keep them:**
- **Border color** — v4 defaults `border` to `currentColor`; a base rule restores
  the v3 `gray-200` default so the ~176 bare-`border` sites render unchanged.
- **Button cursor** — v4's Preflight no longer sets `cursor: pointer` on buttons;
  a base rule restores it for enabled `button` / `[role=button]` elements.

**Dark-only:** the app never uses `dark:` variants — it is always dark, so there
is no dark-mode toggle or `@custom-variant dark`. Do not introduce `dark:`
utilities; style directly with the slate/indigo tokens below.

The **four component states** (empty / loading / error / ready) have a reference
implementation at `frontend/src/shared/components/ui/StateExample.tsx` — copy its
`Result<T>` discriminated-union pattern rather than assuming "ready".

---

## Tokens

### Surface hierarchy

| Layer | Class | Use |
|---|---|---|
| Shell | `bg-slate-950` | App background behind everything |
| Card | `bg-slate-900` | Panels, cards, inputs on the shell |
| Raised | `bg-slate-800` | Modals, nested cards, secondary buttons |
| Hover step | `bg-slate-750` | Hover on slate-800 surfaces (custom token, `#293548`) |

Default border: `border-slate-700`. Subtle dividers: `border-slate-800`.

### Text

| Role | Class |
|---|---|
| Headings | `text-slate-100` |
| Body | `text-slate-300` |
| Secondary / labels | `text-slate-400` |
| Muted (ONLY at ≥14px / `text-sm`+) | `text-slate-500` |

Never use `text-slate-600`/`text-slate-700` for content — they fail contrast on dark surfaces (decorative icons in empty states are the exception).

### Brand + semantic colors

| Token | Value | Use |
|---|---|---|
| Brand | `indigo-600`, hover `indigo-500` (alias `brand-*`) | Primary actions, focus rings, active states |
| Success | `emerald-*` (alias `success-*`) | OK states, success buttons/toasts |
| Danger | `red-*` (alias `danger-*`) | Destructive actions, errors, invalid inputs |
| Warning | `amber-*` (alias `warning-*`) | Degraded states, cautions |
| Movie badge | `purple-*` | Plex type badge for movies |
| Show badge | `blue-*` | Plex type badge for shows |

The `brand`/`success`/`danger`/`warning` aliases are defined in `tailwind.config.js` and map to the full indigo/emerald/red/amber scales — prefer them in new code; the raw color names remain valid.

### Radii

- `rounded-lg` — controls (buttons, inputs, selects, list rows)
- `rounded-xl` — cards, panels, modals
- `rounded-md` — nested elements inside a `rounded-lg` container (e.g. segments)

### Type scale

Standard Tailwind sizes plus `text-2xs` (0.6875rem / 11px) for dense metadata like badge text and grid captions.

### States

- **Focus:** every interactive element needs `focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500` (add `ring-offset-2 ring-offset-slate-900` on solid buttons).
- **Disabled:** `disabled:opacity-50 disabled:cursor-not-allowed`.
- **Invalid inputs:** `border-red-500` + `aria-invalid` (built into Input/Select/Textarea via `invalid`).

---

## Primitives

### Button

Variants: `primary` (default), `secondary`, `ghost`, `danger`, `dangerSoft`, `success`. Sizes: `xs`, `sm`, `md` (default). `loading` shows a spinner and disables.

```tsx
<Button onClick={save} loading={isSaving}>Save</Button>
<Button variant="secondary" size="sm">Cancel</Button>
<Button variant="dangerSoft" size="xs" onClick={remove}>Remove</Button>
```

### IconButton

Icon-only button — `label` is required and becomes `aria-label` + `title`. 36px hit area. Variants: `ghost` (default), `danger`.

```tsx
<IconButton label="Delete block" variant="danger" onClick={handleDelete}>
  <TrashIcon className="w-4 h-4" />
</IconButton>
```

### Input / Select / Textarea

Canonical form control recipe (slate-900 field, slate-700 border, indigo focus). `invalid` switches to a red border and sets `aria-invalid`.

```tsx
<Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://plex:32400" />
<Select value={tier} onChange={(e) => setTier(e.target.value)}>…</Select>
<Textarea rows={3} invalid={!!errors.notes} />
```

### Field

Label + control + hint/error. Wires `htmlFor`/`id` automatically (clones the child with a generated id; an explicit id on the child wins).

```tsx
<Field label="Channel name" hint="Shown in the EPG" error={errors.name}>
  <Input value={name} onChange={…} invalid={!!errors.name} />
</Field>
```

### Card

`level="base"` (slate-900, default) or `"raised"` (slate-800); `padding` `none|sm|md`; `interactive` adds a hover border for clickable cards.

```tsx
<Card interactive onClick={select}>…</Card>
<Card level="raised" padding="sm">…</Card>
```

### SegmentedControl

Inline toggle group for view modes / filters. Real buttons with `aria-pressed`. `tone="brand"` (indigo active) or `"neutral"` (slate active).

```tsx
<SegmentedControl
  options={[{ value: 'grid', label: 'Grid' }, { value: 'list', label: 'List' }]}
  value={mode}
  onChange={setMode}
/>
```

### StatusDot

Health indicator: `ok` (emerald, pulses by default), `error` (red), `warn` (amber), `unknown` (slate).

```tsx
<StatusDot state={plexOk ? 'ok' : 'error'} label={plexOk ? 'Connected' : 'Unreachable'} />
```

### EmptyState

Centered placeholder for empty lists / no results / not configured. (Distinct from `features/channels/components/EmptyState.tsx`, which is the channel dashboard view.)

```tsx
<EmptyState
  title="No blocks yet"
  description="Create a schedule block to start planning this channel."
  action={<Button size="sm" onClick={openCreate}>New block</Button>}
/>
```

### confirmDialog

Promise-based SweetAlert2 confirm with the app's dark theme. Use for ALL destructive confirmations.

```tsx
if (await confirmDialog({ title: 'Delete this block?', text: 'Slots are removed too.', danger: true })) {
  deleteBlock.mutate(block.id)
}
```

### Existing primitives

- **ModalWrapper** — dialog shell with focus trap, Escape, focus restore. Pass `titleId` (preferred) or `ariaLabel`.
- **Spinner** — sizes `sm|md|lg`, indigo accent.
- **Skeleton** (+ `ChannelSkeleton`, `PosterSkeleton`, `PosterGridSkeleton`, `BlockSkeleton`) — loading placeholders.
- **TierBadge / tierColor**, **Logo**, **ToastContainer**, **ErrorBoundary**, **UpdateBanner**.

---

## Rules

1. **Dialogs** — all dialogs go through `ModalWrapper` with `titleId` or `ariaLabel`. Never hand-roll a fixed overlay.
2. **Icon-only buttons** — must use `IconButton` so the accessible name is never forgotten.
3. **Destructive actions** — must confirm via `confirmDialog({ …, danger: true })` before mutating.
4. **Loading lists** — use `Skeleton` components matching the layout, not a spinner swap (spinners are for inline/button-level waits).
5. **Empty states** — use `EmptyState`, not ad-hoc centered text.
6. **Focus** — no interactive element ships without a visible `focus-visible` ring.
7. **New form fields** — wrap controls in `Field` for label/error wiring instead of bare `<label>` + input pairs.
