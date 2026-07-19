# Linearr — Lookbook

> **Created:** 2026-07-19 | **Last Updated:** 2026-07-19

**Level 3 of the knowledge cascade.** The real, shipped code on the default
branch is the canonical pattern; this file is a set of **pointers** to it, each
with one line on *why that instance is the reference*. It wins over prose on
**composition / pattern / wiring** — but **visual treatment is explicitly
excluded** (that follows the design-system hierarchy, not this file).

## Rules
- An entry is a **pointer + one line**, **never a copy** — copies drift the
  moment the real code changes.
- If the canonical instance **moves or is replaced, update the pointer in the
  same PR** (a stale pointer is worse than none).
- **Headings name patterns in the terms the rules use**, so `.claude/rules/*.md`
  can cite a pattern by its heading here.
- Keep a **"Near-miss, for contrast:"** sub-note where a tempting-but-wrong
  nearby instance exists — it teaches the boundary of the pattern.

## Patterns

### {{PATTERN_NAME}}
- **Canonical:** `path/to/real/file.ext:LINE` — why this instance is the reference (composition/wiring, one line).
- **Near-miss, for contrast:** `path/to/other.ext:LINE` — why it looks similar but is *not* the pattern to copy.

### {{ANOTHER_PATTERN}}
- **Canonical:** `path/to/file.ext:LINE` — the one-line why.
