# Linearr — PROGRESS

> **Created:** 2026-07-19 | **Last Updated:** 2026-07-19

An **append-only** phase log — the chronological *diary* of the project. (For a
*dashboard* of "what's the real state of each feature?", that's the Feature
Registry, not this file.) Newest entries at the top of the log; never rewrite a
past entry — correct it with a new dated note.

## Summary
Running stats, refreshed as phases land. **Hedge counts with `~`** and, for
anything with an authoritative source, **quote the live index, not a fixed
number** (a hard-coded count rots the moment the source moves):

- Phases complete: **~{{N}}**
- ADRs: *quote the live count from `docs/adr/README.md`, do not hard-code it here.*
- Tests / endpoints / entities: ~{{N}} each (hedge; the test runner is authoritative).

## Log

### 2026-07-19 — Phase {{N}}: {{PHASE_NAME}}
- What shipped, in one or two lines.
- **Cumulative:** {{running totals for this entry}}.

### 2026-07-19 — Phase 1: {{PHASE_NAME}}
- The first entry.
- **Cumulative:** {{running totals}}.

---
*Maintained as a task deliverable (a human or an AI session updates it as work
lands), not by a bot. Periodic rollups are welcome; anti-staleness `~` hedging
and "quote the live index" are the conventions that keep it honest.*
