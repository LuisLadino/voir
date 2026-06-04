---
name: skill-extensions
description: >
  Kit extensions to Claude Code's SKILL.md frontmatter adopting Deep Agents
  patterns (planning, filesystem, subagents, auto_summarize). Required reading
  before adding extension fields to a skill or editing the skill-runtime hooks.
applies_to:
  - ".claude/skills/**/SKILL.md"
  - ".claude/hooks/lib/skill-frontmatter.cjs"
  - ".claude/hooks/lib/skill-runtime.cjs"
  - ".claude/hooks/lib/skill-active.cjs"
  - ".claude/hooks/context/skill-activation.cjs"
  - ".claude/hooks/context/skill-plan-persist.cjs"
  - ".claude/hooks/context/skill-output-offload.cjs"
category: kit
related: ["#321", "#299"]
source: https://github.com/langchain-ai/deepagents
---

# Skill Extensions: Deep Agents Patterns

Four optional SKILL.md frontmatter fields adopt Deep Agents primitives inside
the kit's skill + hook model (#299 Verdict A). Skills without these fields are
unaffected; every consuming hook fast-bails when no extension data is present.

## Fields

### planning
Persists TodoWrite snapshots to `plans/plan.jsonl` and, on re-activation,
resumes the latest. Reuse, not replace, the built-in TodoWrite tool.
`enabled`, `persist` (default true), `resume_on_activation` (default true),
`scope` (session｜thread, default session).

### filesystem
Provisions a working-memory directory at
`.claude/skill-runtime/<scope>/<key>/<skill>/fs/<root_hint>/`, injected at
activation. The skill writes intermediate artifacts there instead of into
project paths. `enabled`, `scope`, `root_hint` (default "scratch").

### subagents
Declares roles, isolation, and target subagent_type. Isolation levels:
`none` (inline phase, no spawn), `forked` (Agent tool, fresh context — default),
`process` (dispatch worker, separate process + worktree). Declaration surfaces
the roles at activation; `process` emits a hint — the operator invokes dispatch.

### auto_summarize
Archives tool outputs over `threshold_tokens` (~4 bytes/token) to
`summaries/<id>.txt` with a retrieval note. This is Deep Agents'
"save-large-outputs-to-files". It does NOT shrink the live transcript —
Claude Code's native compaction owns conversation-level reduction, and
`PreCompact` is side-effects-only. The archive's value is durability: outputs
survive compaction at a predictable, skill-scoped, optionally branch-persistent
path. `preserve` lists tool names never archived.

## Scope resolution
`filesystem.scope` wins, then `planning.scope`, else `session`. `thread` keys by
sanitized git branch and persists across sessions; `session` is swept at 7 days.

## Runtime wiring
- `PreToolUse(Skill)` → `skill-activation.cjs`: provision dirs, inject runtime block.
- `PostToolUse(TodoWrite)` → `skill-plan-persist.cjs`: append plan snapshots.
- `PostToolUse(Bash|Read|WebFetch|WebSearch|Grep|Glob` and `mcp__)` → `skill-output-offload.cjs`: archive large outputs.

Active skills are read from the tracking log (`tool === 'Skill'`), not a registry.

## Type coercion
yaml-mini returns scalars as strings; the parser coerces booleans/numbers.
`field: true` shorthand == `field: {enabled: true}`; `field: false` disables.

## Backward compatibility
All fields optional. Skills without them load and behave identically.

## Migration
1. Add the relevant field(s) to the skill's frontmatter.
2. `planning` — ensure the body uses TodoWrite naturally.
3. `filesystem` — reference the injected working-memory path in the body.
4. `subagents` — reference declared roles by name in instructions.
5. `auto_summarize` — no body change required.

## Related
- #321 implementation issue; #299 Verdict A.
- `.claude/specs/claude-code/skills.md` — Anthropic-shipped fields (not duplicated here).
