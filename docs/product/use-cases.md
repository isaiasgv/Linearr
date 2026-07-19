# Linearr — Use Cases

> A structured actor + goal + preconditions + main success scenario +
> alternate flows + postconditions description of a single interaction.
> More formal than a user flow — reach for a use case when a flow has
> meaningful branching (permission checks, payment failure, concurrent
> edits) that a linear [user-flows.md](./user-flows.md) diagram can't hold.

## Use case template

Copy this block per use case.

### UC-<number>: <name — e.g. "Process refund">

- **Actor(s):** _who initiates this (which persona, or which system)?_
- **Goal:** _what does the actor want to accomplish?_
- **Preconditions:** _what must be true before this use case can start?_

**Main success scenario:**

1.
2.
3.

**Alternate flows:**

| Trigger | Alternate steps | Result |
|---|---|---|
| | | |

**Postconditions:**

- _Success:_ what state is the system/data in afterward?
- _Failure:_ what state is the system/data in if it fails partway?

---

## Use cases in this product

_List the use cases mapped so far. Not every feature needs a formal use
case — reserve these for the ones with real branching complexity._

## Related

- User Flows: [user-flows.md](./user-flows.md)
- Requirements: [requirements.md](./requirements.md)
- Acceptance Criteria: [acceptance-criteria.md](./acceptance-criteria.md)
