# 1. Record architecture decisions

Date: 2026-06-25

## Status

Accepted

## Context

We need to record the architectural decisions made on this project, so that the
reasoning behind them is preserved for future contributors (and our future selves).

## Decision

We will use Architecture Decision Records, as [described by Michael Nygard][nygard].

Each record is a short Markdown file in `docs/adr/`, numbered sequentially
(`0001-...`, `0002-...`). A record describes a single decision: its context, the
decision itself, and the consequences. Records are immutable once accepted —
superseding decisions get a new record that references the old one.

[nygard]: https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions

## Consequences

- The motivation behind significant changes is documented and discoverable.
- New contributors can read the ADR log to understand how the system reached its
  current shape.
- Each non-trivial architectural change should add an ADR.
