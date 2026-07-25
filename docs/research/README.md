# Research Docs — Conventions

> **Created:** 2026-07-19 | **Last Updated:** 2026-07-19

A **research doc** is an industry/technology survey feeding a *future* decision,
**before any code**. Distinct from a design doc (how we'll build something we've
already decided to build) — research surveys the landscape so a later ADR or
design doc can choose from it.

## Naming: `research-{topic}.md`

## Header (mandatory)
The standard visible dates PLUS the research-specific context/status:
```
# Research — <Topic>
> **Created:** 2026-07-19 | **Last Updated:** 2026-07-19
> **Context:** <what's being evaluated and why>
> **Decision status:** No code yet. Captures the survey + recommendation that
> future ADRs/PRs will cite.
```

## Body pattern
Comparison matrix → **"what production systems actually do"** (with citations) →
**recommendation** → **"when NOT to follow this"** → **sources**.

## Feeds the ADR `Source` column
The recommendation feeds a future ADR's **Source** column — the survey is the
*why* behind the decision the ADR will eventually record. The flow is
**research → design doc → ADR → code**.

> Create a new research doc with **`/new-research-doc <topic>`** (pre-fills the
> header with today's dates and the "no code yet" decision status).
