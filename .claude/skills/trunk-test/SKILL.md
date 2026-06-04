---
name: trunk-test
description: >
  Drop into the surface cold and see if you orient. Triggers: "does this make sense", "is this oriented", "first-time user", "cold read", "fresh eyes". Krug's test; cold user is Luis six months later.
---

# Trunk Test

You are a first-time user encountering Luis's surface for the first time. Your job is to walk through it cold, with no builder's context, and report whether orientation, identity, and next action are obvious.

=== CRITICAL: WHAT THIS SKILL WILL NOT DO ===

You are STRICTLY PROHIBITED from:
- Using any knowledge you have about why Luis built this. Forget the commit message. Forget the issue. Pretend you woke up here.
- Reading code to figure out what the surface does. If the answer isn't visible on the surface, that's a finding.
- Accepting "it's obvious once you know" as a pass. The whole test is about not knowing.
- Running the test on a surface that has no user-facing moment. A private helper function has no trunk test.
- Reporting outcomes without answering the four questions in order. Skipping the order hides the failure mode.

## The Four Questions

In order. A failure at any step is a finding.

1. **Where am I?** What is this thing. One sentence the cold user can read off the surface.
2. **What does this do?** What problem it solves or what action it takes.
3. **What are my options?** What can I do from here. What next actions are visible.
4. **How do I know it worked?** What signal confirms success or failure.

## Modes

### Entry Point Test
Use for a skill, command, hook, or page that a user lands on without prior steps.

**Moves:**
- Open the surface. Look at only what is visible in the first screen or first prompt.
- Answer the four questions using only what you can see.
- For each question without a clean answer, write the finding: "Question N unanswered because {specific reason}."
- Rate severity. A missing answer to question 1 is a blocker. A missing answer to question 4 is major.

### Mid-Flow Test
Use for a surface the user reaches after some other step, like a hook error, a skill directive, or a mid-workflow prompt.

**Moves:**
- Assume the user arrived here without reading the previous step's output. A hook fired and dropped them here.
- Answer the four questions. The surface must stand alone even when reached from context.
- If orientation requires reading upstream output the user no longer has, that's a failure of question 1.

### Cold-Return Test
Use for a surface Luis built months ago and might reopen without memory of why.

**Moves:**
- Treat Luis six months from now as the cold user. He wrote it, he forgot it, he's back.
- Answer the four questions from the surface alone. No digging through git history.
- If the surface fails, recommend one concrete addition: a top-line comment, a help flag, a first-line description.

## Decision Shapes

When a finding is borderline, prefer:

- Trust the cold read over the builder's intent. If it's ambiguous cold, it's ambiguous.
- Visible next action beats buried documentation. "Run X to start" on the surface beats the same line three clicks away.
- Concrete evidence over generic advice. Quote the exact text the user sees. If the fix is a one-line change, write that line.
- Prefer fixing on the surface over adding external docs. If the answer has to live in README.md, the surface failed.

## Questions to Ask Luis

Not all at once. Pick the one that unsticks the review.

- "If you opened this cold six months from now, would you know what to do?"
- "What's the one sentence this surface should show that it doesn't?"
- "When this errors out, can the user tell whether it's them or the system?"
- "Is the next action visible or does it require reading code?"
- "What would the surface need to stand alone as a help topic?"

## Anti-Patterns to Call Out

**Builder's curse.** Luis wrote it so he knows what it is. The curse is assuming the cold user has the same context. Every trunk test exists to break that assumption.

**Documentation deflection.** "It's documented in X." The surface has to work without the user knowing X exists. Docs are a fallback, not the first line of defense.

**Overloaded surface.** The surface tries to answer all four questions at once in a wall of text. The user bounces before reading. Concision matters more than completeness.

**Generic naming.** The skill or command has a name that doesn't hint at the job. "Helper", "util", "check". The name is part of the surface. If the name doesn't answer question 2, that's a finding.

**Invisible exits.** The user got here by mistake, or the task doesn't fit. If there's no visible way to back out or choose another path, heuristic 3 from the usability heuristics and question 3 here both fail.

## How to Respond

1. Name the surface and the mode that fits.
2. Walk the four questions in order. Answer each using only what the surface shows. Mark each as clean or finding.
3. For each finding, quote the evidence. Rate severity.
4. Recommend the one change that would convert the most findings to clean. Often a top-line description or a visible next-action line.

The test is not complete until all four questions have a verdict. A scan that skips question 4 has skipped the hardest one.
