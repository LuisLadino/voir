---
name: lenses-system
description: >
  Lens augmentation system overview. Read this before adding lenses, moves, or modifying the lens-router. Explains the registry, hook, skill, and workflow attachment architecture.
applies_to: []
category: lenses
---

# Lens Augmentation System

Lenses are practitioner perspectives such as PM, UX, Engineering. Moves are discipline rituals under a lens: pre-mortem, LNO classification, assumption enumeration. The lens system forces Luis and Claude through augmenting moves at specific moments in the design thinking workflow.

## Why This Exists

The system prompt lists lenses but only describes what practitioners *value*. That produces generic output. Augmenting moves force what senior practitioners *do*: specific rituals that interrupt default reasoning with practitioner-grade pressure tests.

## How It Works

1. User types a prompt.
2. `inject-context.cjs` runs via `UserPromptSubmit`.
3. `lens-router.cjs` module reads `registry.json` and pattern-matches the prompt against every move's triggers.
4. On match, the module emits a directive: "Before responding, invoke the /{skill} skill via the Skill tool."
5. Claude follows the directive. The skill content loads.
6. Claude runs the move, then proceeds with the user's request.

The user never invokes a lens skill. The hook routes. The skill delivers content.

## Entities

- **Lens** — a practitioner perspective. Identity-shaped. 11 total.
- **Move** — an augmenting ritual under a lens. Action-shaped. A lens has zero or more moves.
- **Attachment point** — a workflow moment where a move fires. Phase-state-aware: a move fires only when its trigger matches AND the current design-thinking phase matches the attachment. Current phase is inferred by `.claude/hooks/lib/phase.cjs` from the most recent workflow skill invocation in tracking. Two signals are considered, Skill-tool events and slash-command `skill_invocation` events. Moves without an attachment fall back to trigger-only match for backward compatibility.
- **Trigger** — a phrase in the user prompt that activates a move. User-language, not identity labels.
- **Skill** — the content a move loads when it fires. Lives at `.claude/skills/{name}/SKILL.md`.

## Attachment Points

Each move declares one:

- `session_start` — at `/handoff` reload
- `during_research` — inside `/research`
- `during_define` — inside `/define`
- `during_ideate` — inside `/ideate`
- `ideate_to_build` — commitment gate before `/build`
- `during_build` — inside `/build`
- `build_to_test` — completion gate
- `during_test` — inside `/test`
- `during_review` — inside `/review`
- `review_to_commit` — ship gate

A move fires when its triggers match, regardless of attachment point in v1. Attachment documents intent. v2 will enforce attachment via phase-state tracking.

## Adding a Lens Move

1. Read `move-template.md` for the skill shape contract.
2. Read `async-agent-prompt.md` for the full build protocol.
3. Create `.claude/skills/{move-name}/SKILL.md`.
4. Add a registry entry under the lens in `registry.json`.
5. Verify: `echo '{"prompt":"trigger phrase"}' | node .claude/hooks/context/lens-router.cjs` from repo root.

## Guardrails

- **Augmenting only.** A move Luis already makes by default is reinforcing, not augmenting. Selection test: would Luis skip this without a forcing function?
- **Forcing function shape.** Every move must contain specific questions, classifications, or prompts that interrupt default reasoning. Aspirational content such as "care about X" is rejected.
- **Luis voice.** Plain, direct, no corporate framing. No em dashes. No parentheticals. Contractions. Mix short and medium sentences.
- **Workflow-aware.** Moves attach to design thinking transitions. They enrich phases. They do not replace them.
- **Project-agnostic.** Moves must apply in any downstream project, not only claude-kit.

## Workflow Composition

The lens system sits alongside the workflow skills. It does not replace them.

- Workflow skills `/research`, `/define`, `/ideate`, `/build`, `/test`, `/review`, `/commit` handle phase transitions.
- Lens moves attach at specific transitions to force discipline.
- Example: `/ideate` converges. User says "let's build it." Hook fires the pre-mortem move. Claude runs pre-mortem. If a blocker surfaces, the work routes back to `/define` or `/ideate`. If not, `/build` proceeds.

## Related

- `move-template.md` — skill shape contract
- `async-agent-prompt.md` — protocol for async agents building new moves
- `../../hooks/context/lens-router.cjs` — the hook module
- `registry.json` — the lens registry
- `../../skills/pre-mortem/SKILL.md` — reference implementation
