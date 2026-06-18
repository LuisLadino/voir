# capture-invariants — golden set (eval-first scorecard)

The quality bar for the skill, worked against cosmo (the AI-native venue-brain product that surfaced #682). Written before the workflow, so the workflow is built to produce this.

## Input the skill works from (domain + intent, NOT current code)

cosmo: multi-tenant venue platform. An LLM reads contracts and generates ops docs. Pricing must be exact. Facts live in SQL; long documents are retrieved. Every venue is a separate tenant. External service clients (Tripleseat, Intercard) are per-venue.

## Expected captured invariants (the load-bearing few — capped at 5)

| # | Invariant (testable form) | Catalog shape | Enforcement |
|---|---|---|---|
| 1 | The LLM never computes or emits a number; numbers come deterministically from real data. | determinism | prose + `/review` (semantic — hard to regex precisely) |
| 2 | External clients are constructed only through the venue-scoped factory; no module-level clients. | construction | `conformance_rule` (regex: module-level `new XClient(`) + prose |
| 3 | `tenant_id` is structural, never hardcoded to one venue. | tenancy | `conformance_rule` (regex: hardcoded tenant literal) + prose |
| 4 | Facts go through SQL; documents go through retrieval. | data routing | prose + `/review` |
| 5 | Pricing routes through `size_event`, never generated SQL. | data routing | prose + `conformance_rule` (regex: raw SQL in pricing path) |

## Expected output (one artifact, two faces)

A project spec (`coding/cosmo-invariants.md`) where each invariant has: the rule, the **why** + a **revisit-if** clause, and — for 2, 3, 5 — a `conformance_rule` regex that fires on violation. Invariants 1 and 4 stay prose, enforced by `/review`.

## Rubric — a capture run passes if it:

- [ ] **Checked existing specs first** (`coding/`, `architecture/`) and updated rather than duplicated.
- [ ] **Interviewed**, did not reverse-engineer the current (possibly transitional) code. With a non-technical owner, derived candidates from the locked architecture docs and confirmed product intent in plain terms.
- [ ] Walked the **typed catalog** to surface candidates the user didn't volunteer.
- [ ] **Filtered product vs instance-one** — captured the product rule, named pilot specifics only as the instance's case.
- [ ] Forced each invariant into a **testable** statement (a violation is detectable).
- [ ] **Capped** to the load-bearing few (~3-5), not every -ility.
- [ ] Emitted **one artifact, two faces**: prose rationale (mandatory, with revisit-if) + `conformance_rules` for the mechanizable subset.
- [ ] Left the semantic invariants as prose rather than forcing a brittle regex.

## Fail signals

- Captured 15+ invariants (over-capture — a wall that gets disabled wholesale).
- Emitted a regex for a semantic rule it can't actually detect (false-positive gate).
- Scanned current code and codified a bug as an invariant.
- Prose with no enforcement, or a `conformance_rule` with no recorded why.
- **Captured an instance-one specific** (the pilot's vendor tool / source system) as a standalone product invariant, instead of the product rule with the instance as an example.
- **Generated a duplicate** of an invariants spec that already existed — didn't check `coding/`/`architecture/` first.
