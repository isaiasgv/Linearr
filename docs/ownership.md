# Linearr — Part ownership (who works which part)

> **Created:** 2026-07-19 | **Last Updated:** 2026-07-19

This map answers **"who may *pick up* this work?"** — kept deliberately
**orthogonal** to CODEOWNERS, which answers **"who must *approve* the merge?"**.
It lives in this one doc, read by both people and tooling; there is **no
separate machine file to keep in sync**.

## The rule (advisory)
You work on the parts you're allowed to. Browse issues, read the `part:*` label,
and pick one up only if you're an allowed worker for that part. **No CI gate** —
a blocking gate would fire too late (at PR time) and add friction. The
list-visible label prevents *accidental* off-lane pickup, which is the real
failure mode.

## The map
Fill this in for THIS project. One row per part; keep it small.

| Part | `part:*` label | Allowed workers (GitHub login) | Repo path(s) |
|------|----------------|--------------------------------|--------------|
| {{PART}} | `part:{{x}}` | {{Name}} (`{{login}}`) | `{{path}}/**` |
| cross-cutting | `part:cross-cutting` | (marker — triage splits it) | — |

## Part vs CODEOWNERS — orthogonal on purpose
|  | Answers | Lives in |
|---|---|---|
| Part (`part:*`) | Who may **pick up**? | this map + the label |
| CODEOWNERS | Who must **approve**? | `.github/CODEOWNERS` |

They **may** differ, and that is correct: a `part:db` ticket may be *picked up*
by anyone on the db lane, yet a schema change inside it still needs the *owner's*
approval to merge. **Do not derive one axis from the other, or "reconcile" them
field-by-field** — that re-couples two deliberately independent axes.

## How a ticket gets its label — Claude infers it
Humans rarely run `gh issue create` by hand — they ask Claude, which infers the
part from the description + changed-area heuristics + CODEOWNERS and applies the
label (`/label-issue`). The work-rule is advisory *for people*; **Claude's
labeling is rule-enforced** — clean label data is what makes the advisory signal
trustworthy. This binding rule is mirrored in the root `CLAUDE.md` (always-on).

## Multi-part tickets — split at triage
A genuinely multi-part ticket gets a `part:cross-cutting` marker; triage splits
it into a **parent + one child per part** (each independently pickup-able).
**Exception:** a small coherent change one person can do end-to-end gets two
`part:*` labels instead of a split.
