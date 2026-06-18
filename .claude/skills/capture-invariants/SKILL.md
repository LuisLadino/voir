---
name: capture-invariants
description: >
  Capture a project's load-bearing invariants and conventions. Triggers:
  "architectural invariants", "what shouldn't break", "rules for this repo",
  "document the conventions". Emits an enforced spec.
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, AskUserQuestion
---

# Capture Invariants

Capture the load-bearing architectural invariants of a project — the unwritten rules a new developer breaks on day one — and emit them as an enforced spec. These are the project-specific application of the universal `engineering-principles` floor: the floor is the why, these are this codebase's what.

The hard truth from the prior art: the load-bearing invariants are usually **unstated**. They live in the architect's head and the domain, not in the requirements or the (possibly transitional) code. You cannot scan them out. You have to ask.

## The method

### 0. Check what's already captured
Before generating anything, read the project's existing invariant and architecture specs (look in `coding/` and `architecture/`). If an invariants spec already exists you are **updating** it, not adding a second — a duplicate `name:` collides in `enforce-specs`, and two specs drift. Reconcile against what's there; capture only what's missing.

### 1. Interview, do not scan
Do not reverse-engineer the current code — it may already violate the invariant you are trying to capture. Capture the **decision**, not the current state. Read code only to confirm an invariant the user states, never to infer one.

**When there is no technical architect in the room** (the owner is a product founder, not a dev): the invariants are not in their head as code decisions — they live in the project's locked architecture docs (`CLAUDE.md`, ADRs, strategy docs). Derive candidates from those, present each as a **business risk** in plain terms, and interview the owner for product-level confirmation — "does breaking this hurt the business?" — not dev-mechanism adjudication. Reading locked *decision* docs is not scanning transitional code. A docs-derived draft is shallower than a code-grounded pass; deepen it against the code where you can, and treat it as a draft to harden.

### 2. Surface candidates with the typed catalog
The user names the obvious ones. Walk this catalog to surface the rest — for each, ask "does this codebase have a rule here?":

- **Dependency boundaries** — which layers or modules may not import which?
- **Construction** — must some objects be built one way only (factory, injection)? Any ban on module-level singletons or global clients?
- **Determinism** — what must stay deterministic, and which nondeterministic component (LLM, randomness, clock, network) must stay at the edges?
- **Data routing** — facts vs documents, reads vs writes: which path is mandatory for which?
- **Tenancy / scoping** — is anything strictly per-tenant or per-entity, never hardcoded?
- **Validation** — where must untrusted input be checked?
- **Idempotency** — what must be safe to run twice (jobs, webhooks, retries)?

### 3. Force each into a testable statement
A vague invariant ("be reliable") cannot be enforced. Push each to a checkable form: "X never does Y", "Z is built only through W". For each, name how a violation would be detected. If you can't name a detection, it's a value, not an invariant — keep refining or drop it.

### 4. Cap to the load-bearing few
Keep ~3-5. Over-capture is a defect: a wall of rules gets disabled wholesale the first time it blocks someone under deadline. Dedup, prioritize, cap. The test: would a new dev breaking this actually cause a real failure?

**Product, not instance-one.** For a multi-tenant product with a pilot or first deployment, run each candidate through one more test: *is this true for every tenant, or just instance-one?* A specific vendor tool, a specific source system, the pilot's CRM — these are the **concrete case** of a rule, never the rule. Capture the product invariant ("pricing is a deterministic tool over a versioned table"); name the instance only as an example ("for the pilot, `size_event`"). A standalone rule built on a pilot detail is a capture error.

### 5. Emit one artifact, two faces
Write ONE project spec where each invariant carries:
- **the rule** (the what),
- **the why + a "revisit if" clause** — mandatory, so a future cleanup doesn't delete a load-bearing rule it doesn't understand,
- and, **only where a regex can actually decide it**, a `conformance_rule` that fires on violation.

Mechanizable invariants (a banned import, a module-level construction, a hardcoded tenant literal) get a `conformance_rule`. Semantic ones ("the LLM never computes a number") stay prose, enforced by `/review`. Never emit a regex you can't trust — a false-positive gate is worse than none.

See `references/golden-set.md` for a full worked example (cosmo) and the pass/fail rubric.

## Output

A project spec under `coding/` or `architecture/` with the invariants and their `conformance_rules`. Register it in `stack-config.yaml` (or rely on its frontmatter `applies_to`) so `enforce-specs` gates the files it governs and the conformance gate fires on commit/push.

## Relationship

- Inherits the universal `engineering-principles` floor; this skill captures the project-specific application of it.
- `/sync-stack` invokes this for its project-reality capture (the high-value half of the docs a new dev needs), instead of dumping generic library patterns.
- Decoupled from `/sync-stack`'s code-scanning by design: capture the decision, then enforce it, even before the code conforms.
