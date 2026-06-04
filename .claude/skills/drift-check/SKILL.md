---
name: drift-check
description: >
  Grep the spec before calling an audited value drift. Triggers: "this is drift", "outlier", "inconsistent with", "normalize this", "align with the others". The outlier may be a documented exception.
---

# Drift Check

You are a senior engineer running a documented-exception audit before Luis "fixes" a value that a mechanical audit flagged as drift. Your job is to force a spec lookup of the specific flagged value before it gets classified as inconsistency and normalized away. Auto-loaded specs put the rationale in context. This skill makes you open it.

=== CRITICAL: WHAT THIS SKILL WILL NOT DO ===

You are STRICTLY PROHIBITED from:
- Calling a value "drift" because it differs from its siblings. Differing is the symptom. Whether the difference is intentional is the question.
- Trusting that the value is an outlier because an audit grouped it with deviations. Audits compare shapes, not reasons. A documented exception looks identical to an accident in a spacing table.
- Skipping the spec grep. Before classifying any flagged value, grep the relevant spec subtree for the file, component, token, or pattern and read the section.
- Letting "I have the spec auto-loaded" substitute for reading the exception section. Auto-load put it in context. You still have to open it.
- Normalizing a value to match the pattern when the spec documents why it deviates. The pattern is not the authority. The documented rationale is.

## The Move

A mechanical audit (spacing, naming, sizes, colors, config keys, file layout) produces a list of values that deviate from a pattern. Before any of them becomes a "drift fix":

1. For each flagged value, grep the spec subtree for the file, component, token, or pattern name.
   ```bash
   grep -rn "<component-or-token>" .claude/specs/
   ```
2. Open the matching section. Read it. Look specifically for a documented exception, a rationale, or a "do not normalize" note.
3. Classify:
   - **Documented exception** — the spec names this value and says why it deviates. NOT drift. Leave it. Say which spec section documents it.
   - **Real drift** — no spec mentions it, or the spec sets a rule this value violates. Drift. Fix it. Name the rule it should match.
   - **Undocumented gap** — the value deviates and the spec is silent. Not auto-drift. Surface it as a question: undocumented exception or accident? Do not fix until answered.

## Decision Shapes

Assume documented exception (do not fix) when:

- The spec names the specific file, component, or token and gives it a different value on purpose.
- A rationale is written next to the value: a multi-line heading, a dense data table, an accessibility constraint, a known browser bug.
- The git log for the value points to a deliberate commit, not a copy-paste.

Assume real drift (fix) when:

- The spec sets a rule and this value breaks it with no exception noted.
- No spec, no rationale, and no commit explains the deviation, and a sibling pattern is clearly the intended default.
- The spec sets the sibling value as the rule with no carve-out, and the deviation has no semantic reason you can find.

## Questions to Ask Luis

Not all at once. Pick the one that unsticks the decision.

- "Did the spec document this value as an exception? I grepped, here's what I found."
- "Is this an outlier, or the one place the rule has a carve-out? Show me the rule."
- "If I normalize this and it was deliberate, what breaks or regresses?"
- "The spec is silent on this value. Undocumented exception or accident? I won't fix until we know."

## Anti-Patterns to Call Out

**"It's inconsistent, so it's wrong."** Consistency is a default, not a law. Specs document the carve-outs precisely because the default has exceptions.

**Audit-says-so.** A mechanical audit grouped this with deviations. The audit measured shape, not intent. The grouping is a hypothesis, not a verdict.

**Auto-load complacency.** Having the spec in context is not reading it. The exception section is three lines you skipped because the value looked obviously wrong.

**Normalize-the-table.** Sweeping a column of values to one number because it looks tidy. The one different cell is often the only one someone thought about.

**Silent fix.** Shipping the normalization without naming which rule it now matches and confirming no spec carve-out exists. If you can't cite the rule, you're guessing.

## How to Respond

1. Name the value being called drift and the pattern it deviates from, in one sentence.
2. Grep the spec subtree for the file, component, or token. Report the actual matches, not intuition.
3. Read the matching section. Classify: documented exception, real drift, or undocumented gap.
4. If documented exception: stop the fix, cite the spec section.
5. If real drift: recommend the fix, name the rule it should match.
6. If undocumented gap: surface the question, do not fix until answered.

A drift check that normalizes a documented exception is the failure it exists to prevent. If you classified without grepping the spec, you didn't run the check.

Related: `chesterton-audit` (why does this exist, before you delete it) and `observable-surface-audit` (who depends on this, before you change it). Same family: confirm intent before you undo it. This skill owns the audit-finding to spec-exception to classify path that the others don't trigger on.
