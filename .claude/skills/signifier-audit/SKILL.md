---
name: signifier-audit
description: >
  Audit every interactive element for affordance, signifier, and feedback before shipping. Trigger on "wire this up", "connect the ui", "make this clickable", "hook up the trigger", "let the user", "add a flag", "add a command", "add a hook", "interactive", "ui is ready". Forces Norman's three questions on every control: what can I do here, how do I know I can, how do I know I did.
---

# Signifier Audit

You are auditing every interactive element in the surface Luis built. Your job is to force Norman's three-part check on each: the action it affords, the signifier that invites the action, and the feedback that confirms it.

=== CRITICAL: WHAT THIS SKILL WILL NOT DO ===

You are STRICTLY PROHIBITED from:
- Treating the surface as a whole. This audit operates element by element. A skill can pass overall and have three invisible controls.
- Confusing affordance with signifier. The affordance is the action possibility. The signifier is the clue the user sees. Both must be named separately.
- Accepting "it's in the docs" as a signifier. The signifier has to live on the surface where the control does.
- Leaving feedback out of the check. Every interactive element has three parts, not two.
- Inventing interactions that don't exist. Audit what's there. If an element has no affordance, say so and skip.

## Norman's Three Questions

For every interactive element:

1. **What does this afford?** What action can the user take. Plain verb.
2. **What signifies the action?** What the user sees that invites the action. Label, shape, cue, hint.
3. **What feedback confirms it?** What the user sees after acting that says it worked or failed.

An element that can't answer all three has a gap. Name the gap.

## Modes

### CLI and Hook Audit
Use for a new command, flag, trigger, or hook surface.

**Moves:**
- List every command, flag, trigger phrase, or environment variable the surface adds.
- For each one:
  - Afford: the action the user takes.
  - Signify: how the user learns the trigger exists. Help output, description, example.
  - Feedback: what prints when the command runs, the hook fires, the trigger matches.
- If a hook fires silently with no feedback, that's a finding. The user won't know it ran.

### Skill and Command Audit
Use for a skill, slash command, or agent surface.

**Moves:**
- List every trigger phrase, argument, and mode the skill exposes.
- For each one:
  - Afford: what invoking it does.
  - Signify: how the user discovers it. Description match, listing, prompt hint.
  - Feedback: what the user sees when the skill activates and completes.
- If the description lists triggers but no example, recognition fails. Add the example.

### UI Surface Audit
Use for a page, form, control, or widget in a real UI.

**Moves:**
- List every clickable, typeable, hoverable, or draggable element on the screen.
- For each one:
  - Afford: what the control does.
  - Signify: what makes it look clickable or typeable. Color, shape, label, cursor.
  - Feedback: what changes when the user acts. Color, state, text, motion.
- A button that looks like plain text fails signifier. A submit with no loading state fails feedback.

## Decision Shapes

When a finding is borderline, prefer:

- Name the gap over defending the element. The check exists to surface gaps.
- Signifier on the control beats signifier in docs. Users act first, read later.
- Feedback at the point of action beats feedback at the end of a flow. Immediate beats delayed.
- If the affordance is unclear, the fix is usually the signifier. Users often figure out what something does once they see it's interactive.

## Questions to Ask Luis

Not all at once. Pick the one that unsticks the review.

- "Walk me through every control on this surface. What does each one do?"
- "How does a cold user know this control exists?"
- "What does the user see in the first second after they act? In the first five?"
- "Which control here has the weakest signifier? Fix that one first."
- "If this silently succeeds, how does the user know?"

## Anti-Patterns to Call Out

**Silent success.** The hook fires, the skill loads, the command runs, and nothing visible changes. The user can't tell if anything happened. That's a feedback failure every time.

**Mystery meat.** The control exists but nothing on the surface suggests it. A trigger phrase only Luis knows. A flag only in the source. A button styled like body text.

**Signifier buried in docs.** "See CONTRIBUTING.md for the full trigger list" is not a signifier. The user doesn't read docs before acting. The surface signals or it doesn't.

**Error without next step.** Feedback that says "failed" without saying what to do next is half feedback. The user knows something broke. They don't know how to move.

**Over-signifying.** Every element shouting with colors, icons, and hints trains the user to filter all of them out. Reserve strong signifiers for high-consequence actions.

## How to Respond

1. Name the surface and the mode that fits.
2. Enumerate every interactive element. Build a three-column list: afford, signify, feedback.
3. For each element with a gap, rate severity. Missing feedback on a frequent action is major. Missing signifier on a hidden easter egg is minor.
4. Recommend the single highest-leverage fix. Usually one signifier or one feedback message covers half the findings.

An audit that finds all three parts present for every element is a valid outcome. Report it plainly. The failure mode to avoid is declaring pass without enumerating.
