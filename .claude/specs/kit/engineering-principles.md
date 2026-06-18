---
name: engineering-principles
description: >
  Universal engineering principles every project inherits — the correct-way
  defaults for building professionally, independent of stack. The floor is
  enforced through its lens skills, the /review and /commit diff-walks, and
  per-project conformance_rules — not by read-gating edits. 43 lines by design.
applies_to: []
category: kit
---

# Engineering Principles

The default correct way to build software in any project here, independent of language or framework. Project specs from `/sync-stack` apply these to a codebase's particulars, and `conformance_rules` plus linters enforce the mechanizable ones automatically.

Each principle carries its enforcement mode. `[check]` fires automatically at zero read cost — a few rules are context-free enough for a universal `conformance_rule`, but **most are per-project**: the principle is universal, the executable rule (which layers, which client) is context-specific and ships in the project's own spec via `capture-invariants` and `/sync-stack`. `[lens]` is a judgment skill the kit carries. `[review]` is caught walking the diff at `/review` and `/commit`. Few are prose to re-read.

## Decide & change well

- **Two-way vs one-way doors.** Classify a decision's reversibility before deliberating. Ship reversible decisions fast. Reserve scrutiny for the irreversible ones: data migrations, public contracts, storage engines. `[lens: reversibility-classify]`
- **Solve today's problem.** Build for the requirement in front of you. Speculative generality is a defect, not foresight. `[review]`
- **Understand before you remove.** Don't delete code whose purpose you can't explain. Find out why it exists first. `[lens: chesterton-audit]`

## Structure for change

- **One responsibility per module; layers don't reach across.** A module does one thing. Higher layers depend on lower, never the reverse. `[review + per-project AST linter — the layers are project-specific; regex can't parse an import graph]`
- **Build dependencies at the edges.** Construct concrete dependencies at the entry point and inject them. No module-level singletons or hidden global clients. `[check: per-project — capture-invariants emits the conformance_rule for the project's named client]`
- **Nondeterminism at the edges, deterministic core.** IO, randomness, time, and model calls live at the boundary. The core stays deterministic and unit-testable. `[review]`

## Be correct, fail safely

- **Fail loud.** Surface errors. Never swallow an exception or return a silent fallback that hides a bug. `[review — judgment: an empty catch may be an intentional fail-open, not a swallowed bug]`
- **Validate at the boundary.** Untrusted input is checked and typed at the edge. The interior trusts its types. `[review — "is this the boundary, is this validated" is semantic]`
- **Idempotent by default.** Anything that can run twice, like jobs, webhooks, retries, and syncs, must be safe to. `[review + tests]`
- **Make it work, then right, then fast.** In that order. Premature optimization is a defect. `[review]`

## Prove it, see it

- **Eval/test-first for AI and load-bearing logic.** Write the scorecard or golden set before the feature, not after. `[lens: eval-first]`
- **Observable by default.** Log decisions and failures with enough context to debug them later. You can't fix what you can't see. `[review]`

## How a project applies these

The principles don't change per project. The application does. A project's own spec names the specific rule, for example "clients are built only through the venue-scoped factory," and `capture-invariants` ships it as a `conformance_rule` where a regex can decide a violation (a banned token, a hardcoded literal). Graph rules (layer boundaries) and semantic ones (validation, fail-loud) are caught at `/review` and `/commit` by walking the diff against this prose; a project can harden a boundary with its own AST linter. The principle is the why, the project spec is the what, the check or the review is the teeth.
