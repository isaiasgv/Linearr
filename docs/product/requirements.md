# Linearr — Requirements

> What the system must do (functional) and how it must behave
> (non-functional). Numbered so [acceptance-criteria.md](./acceptance-criteria.md)
> and tests can cite them.

## Functional requirements

_What the system must DO — testable, unambiguous statements. Number them
(`FR-1`, `FR-2`, …) so ADRs, acceptance criteria, and tests can cite a
specific one._

| ID | Requirement | Source (PRD feature / use case) |
|---|---|---|
| FR-1 | The system shall … | |
| FR-2 | The system shall … | |

## Non-functional requirements

_How the system must BEHAVE. Write down "no special requirement, default
applies" explicitly rather than leaving a row blank — an omitted NFR gets
discovered in production._

### Performance

_Target latency (e.g. p95 response time), throughput, resource budgets._

### Scalability

_Expected concurrent users/requests now and at a stated future horizon._

### Availability

_Uptime SLA / SLO, planned-maintenance windows, disaster-recovery target
(RTO/RPO)._

### Security

_Data classification, auth strength required, encryption at rest/in
transit, secrets handling — cross-reference the `security-hardening` skill
and `security-checklist` rule rather than restating them here._

### Accessibility

_Target WCAG conformance level — cross-reference the
`accessibility-checklist` rule rather than restating it here._

### Compliance

_Regulatory scope — GDPR, SOC2, HIPAA, PCI, industry-specific — or
explicitly "none applicable"._

### Observability

_What must be logged, traced, or alerted on for this to be operable in
production — cross-reference `logging-observability` /
`observability-opentelemetry` skills rather than restating them here._

## Related

- Acceptance Criteria: [acceptance-criteria.md](./acceptance-criteria.md)
- PRD: [PRD.md](./PRD.md)
- ADR convention (`repo-standards` skill) — cite the `FR-#` a decision
  exists to satisfy
