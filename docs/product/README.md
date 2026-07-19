# Linearr — Product Requirements

Index of the product-requirements artifact set for Linearr. See the
`product-requirements` skill (hydra-standards) for what each artifact is,
when it's needed, and how it links to ADRs and to `/create-feature`.

| Artifact | File | Answers |
|---|---|---|
| Business Requirements | [BRD.md](./BRD.md) | Why does the business need this? What does success look like? |
| Product Requirements | [PRD.md](./PRD.md) | What exactly are we building? |
| Personas | [personas.md](./personas.md) | Who uses this? |
| User Journeys | [user-journeys.md](./user-journeys.md) | How does a persona discover, adopt, and get value over time? |
| User Flows | [user-flows.md](./user-flows.md) | What are the concrete in-app steps for one task? |
| Use Cases | [use-cases.md](./use-cases.md) | What are the branching interactions for a goal? |
| Requirements | [requirements.md](./requirements.md) | Functional + non-functional requirements. |
| Acceptance Criteria | [acceptance-criteria.md](./acceptance-criteria.md) | What does "done" look like, testably? |
| MVP | [mvp.md](./mvp.md) | What's the smallest slice that delivers real value? |
| Roadmap | [roadmap.md](./roadmap.md) | What ships when? |

## Keep these living

- Update PRD/BRD when scope actually changes.
- Revisit the roadmap on the same cadence as `.repo-meta.yml`'s
  `review_cadence`.
- When the MVP ships, move deferred items into the next roadmap entry.
- A stale product doc is worse than no product doc. If the team can't keep
  the full set current, prefer a short summary here over an unmaintained
  artifact set.

## Traceability

- Cite the relevant `requirements.md` functional requirement ID (`FR-#`) from
  any ADR whose decision exists to satisfy it.
- `/create-feature` should start from a functional requirement + its
  acceptance criteria, not from an ad hoc description.
