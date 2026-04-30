---
name: lens-move-template
description: >
  Skill shape contract for lens augmenting moves. Read before creating or modifying a lens move skill. Defines frontmatter, structure, voice, and rejection criteria.
applies_to: []
category: lenses
---

# Lens Move Skill Contract

Every lens augmenting move is a skill at `.claude/skills/{move-name}/SKILL.md`. This spec defines the shape.

## Frontmatter

```yaml
---
name: {move-name}
description: >
  {What the move does in one sentence.} Trigger on {comma-separated user phrases that should fire this move}. {One-sentence differentiator explaining why this produces better output than default reasoning.}
---
```

Requirements:
- `name` matches the directory name.
- `description` follows the triplet: what + triggers + differentiator.
- Description stays under 250 characters when possible. Budget is generous. Brevity still wins.
- Triggers are user-language phrases.

## Body Structure

```markdown
# {Move Name}

You are {role adopted for this move}. Your job is {single-sentence purpose that names the forcing function}.

=== CRITICAL: WHAT THIS SKILL WILL NOT DO ===

You are STRICTLY PROHIBITED from:
- {specific failure mode this skill prevents}
- {another specific failure mode}
- {3-5 total NEVERs}

## Modes

### {Mode 1}
Use when {context}.

**Moves:**
- {Concrete question, classification, or action. Imperative voice.}
- {Another move.}

### {Mode 2}
Use when {context}.

**Moves:**
- {Concrete move.}

## Decision Shapes

When two options are close, prefer the one that:

- {Specific criterion with a reason.}
- {Another criterion.}

## Questions to Ask Luis

Not all at once. Pick the one that unsticks the decision.

- "{Specific question that forces a missing move.}"
- "{Another question.}"

## Anti-Patterns to Call Out

**{Anti-pattern name}.** {Short description of the trap. Why it fails.}

**{Another anti-pattern}.** {Description.}

## How to Respond

1. {First concrete step.}
2. {Second step.}
3. {Third step.}

{Closing prime. One or two sentences that anchor the mode's core discipline.}
```

## Voice Rules

- Plain, direct. Short sentences mixed with medium.
- No em dashes. Use periods, commas, or colons.
- No parentheticals. Integrate details with commas or new sentences.
- No corporate framing. Avoid "leverage", "ensure", "passionate", "utilize", "world-class".
- Contractions are fine.
- Active voice.
- Examples with specifics, not adjectives.

## Length

100-200 lines. Going longer is a warning sign the move is too broad or the content is padded. Split into two moves if the body grows past 200 lines.

## Rejection Criteria

A move skill fails review if any of these apply:

- **Reinforcing, not augmenting.** If Luis already makes this move by default, the skill does not belong in the lens system. Check with Luis before building.
- **Aspirational content.** "Consider user value" is aspirational. "Name the success metric before scoping" is operational. Every rule must be operational.
- **Abstract triggers.** Triggers like "when doing PM work" don't route. Triggers like "let's build" do.
- **No forcing function.** If the body lists what practitioners value without forcing Claude to run specific questions or classifications, the move has no teeth.
- **Workflow replacement.** A move that replaces `/define`, `/build`, or any workflow skill is out of scope. Moves augment transitions between phases, not replace them.

## Invocation Model

Default frontmatter fields are omitted unless specifically required. The skill auto-triggers based on description matching. It also fires deterministically via the `lens-router` hook. Both mechanisms coexist. The hook provides reliability. The description provides fallback coverage.

Do not set `disable-model-invocation: true` on lens move skills. Do not set `user-invocable: false`. Luis should be able to invoke manually if wanted.

## Related

- `README.md` — system overview
- `async-agent-prompt.md` — build protocol for async agents
- `../kit/instruction-format.md` — emphasis words, structural patterns
- `../kit/self-documentation.md` — formatting rules
- `../../skills/pre-mortem/SKILL.md` — reference implementation
