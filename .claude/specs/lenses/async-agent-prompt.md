---
name: lens-async-agent-prompt
description: >
  Protocol for async Claudes building lens moves. Feed this content to an agent along with the target lens name. The agent follows this protocol to research, select, and build augmenting moves.
applies_to: []
category: lenses
---

# Async Agent Build Protocol

Use this document as the prompt for async Claudes building out lens move skills. Each agent handles one lens.

## Agent Instructions

```
You are building lens augmenting moves for the kit.

Target lens: {LENS_NAME}

Before you start, read in order:
1. .claude/specs/lenses/README.md — system overview
2. .claude/specs/lenses/move-template.md — skill shape contract
3. .claude/skills/pre-mortem/SKILL.md — reference implementation
4. .claude/specs/lenses/registry.json — registry format
5. .claude/specs/kit/instruction-format.md — structural patterns
6. .claude/specs/kit/self-documentation.md — formatting rules

Step 1: Research senior practitioners

Research what senior {LENS_NAME} practitioners do that generalists don't. Use web search and practitioner sources. You are NOT researching Luis's baseline. You are researching practitioner excellence.

Candidate sources depend on the lens:
- PM: Cagan, Torres, Doshi, Rachitsky, Gupta
- UX: Nielsen Norman Group, Don't Make Me Think, Dan Saffer, Indi Young
- Engineering: Kent Beck, Hyrum's Law, Martin Fowler, Choose Boring Technology
- Design: Dieter Rams, Design of Everyday Things, typography craft
- Systems Thinking: Donella Meadows, Rich Hickey, feedback loops
- Data Science: Hadley Wickham, experiment design, causal inference
- AI/ML: Chip Huyen, model evaluation, drift detection, responsible AI
- Business: Porter, Roger Martin, Richard Rumelt, Blue Ocean
- Leadership: Julie Zhuo, Patrick Lencioni, decision-making frameworks
- Marketing: April Dunford, Jobs-to-be-Done for positioning, GTM
- Communication: Chip and Dan Heath, BLUF, executive communication

You decide which sources fit your lens.

Step 2: Identify augmenting moves

For each practitioner move you surface, apply the selection test:

- Is this a specific action, ritual, or classification? If yes, continue. If a value or principle, reject.
- Would Luis skip this move by default? If yes, continue. If he already does it, reject.
- Does it have a forcing function? Specific questions, classifications, or prompts that interrupt default reasoning? If yes, continue.
- Does it apply to solo kit work, not only team or company PM? If yes, continue. If team-only, reject.

Shortlist 3 to 5 moves that pass all tests. Do not build more than 5 per lens in one pass.

Step 3: For each selected move

1. Pick an attachment point from the registry. Match the move to a workflow transition where it has the most leverage.
2. Write 5 to 10 user-language trigger phrases. These are phrases Luis might actually say, not identity labels.
3. Create .claude/skills/{move-name}/SKILL.md following move-template.md.
4. Add registry entry to .claude/specs/lenses/registry.json under the lens.

Step 4: Validate

For each skill you built:

- Run: echo '{"prompt":"trigger phrase"}' | node .claude/hooks/context/lens-router.cjs
- Confirm the directive injection fires.
- Re-read the skill body. If any line is aspirational rather than operational, rewrite.
- Verify under 200 lines.
- Verify no em dashes, no parentheticals, no corporate framing.

Step 5: Report

Create a PR titled "feat: {LENS_NAME} lens augmenting moves".

PR body includes:
- Moves selected with one-sentence justification each.
- Moves considered and rejected with reason.
- Sources consulted.
- Sample trigger phrase and expected injection output.
- Any spec changes needed.

Do not merge the PR. Luis reviews and merges.

Rejection criteria self-check

Before opening the PR, verify none of these apply:

- A move's content is aspirational. "Care about X" rather than "run this classification".
- A move's triggers are identity labels like "when doing design work".
- A move replaces a workflow skill rather than augmenting a transition.
- A move is reinforcing Luis's default behavior rather than augmenting a skip.
- A skill body exceeds 200 lines.
- Frontmatter is malformed or missing.

If any apply, fix before opening.
```

## Running an Agent

To launch: spawn a subagent with the above content as the prompt, substituting `{LENS_NAME}` with the target lens. Run agents in parallel for independent lenses. Do not run agents for `pm` unless adding new PM moves beyond pre-mortem.

## Lens Assignment Order

Suggested order based on transfer to solo kit work:

1. Engineering
2. Systems Thinking
3. UX
4. Design
5. AI/ML
6. Data Science
7. Business
8. Communication
9. Leadership
10. Marketing

`pm` is already seeded with pre-mortem. Add more PM moves only after other lenses have coverage.

## Related

- `README.md` — system overview
- `move-template.md` — skill shape contract
- `registry.json` — registry
- `../../skills/pre-mortem/SKILL.md` — reference
