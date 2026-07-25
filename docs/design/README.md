# Design Docs — Conventions

> **Created:** 2026-07-19 | **Last Updated:** 2026-07-19

Technical **design docs** capture the *reasoning* behind how a domain area is
built. They are distinct from `docs/product/` (what/why for the business) and
from ADRs (the short decision record an ADR *extracts from* a design doc).

## Naming: `{domain}-{descriptive-name}.md`
A **domain prefix** groups docs by area and makes code references predictable;
the rest is a kebab-case descriptive name. **No numbers, no dates in filenames**
— numbers cause collision/rename chains, and dates belong in the header. Keep a
small prefix table for THIS project and grow it as areas emerge:

| Prefix | Domain area |
|--------|-------------|
| `{{PREFIX}}` | {{AREA}} |

## Companion docs: `-{suffix}`
A main doc may spawn companions by suffix — e.g.
`{{domain}}-architecture.md` (main) · `{{domain}}-examples.md` (presentation) ·
`{{domain}}-plan.md` (implementation).

## Header (mandatory)
```
# Title
> **Created:** 2026-07-19 | **Last Updated:** 2026-07-19
> **Status:** Draft | Active | Superseded by [doc](link)
```

## When to write one
A **new domain area** · a **multi-entity / schema decision** · **reasoning worth
preserving**. NOT for: bug fixes, minor refactors, or a decision that already
lives in an ADR.

## Reference from code by path + anchor
```
// See docs/design/<domain>-<name>.md §N for the rationale.
```

## Feeds the ADR `Source` column
When a design doc drives a decision, record the decision with `/new-adr` and
point the ADR index's **Source** column back at
`docs/design/<domain>-<name>.md §N`. The ADR captures the *decision*; the design
doc keeps the full reasoning behind it.

> Create a new design doc with **`/new-design-doc <domain> <name>`** (pre-fills
> the header with today's dates and `Status: Draft`).
