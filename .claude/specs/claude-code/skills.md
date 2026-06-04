---
name: skills
description: >
  Configuration and behavior for Claude Code skills: SKILL.md format, frontmatter fields, invocation methods, triggering behavior, forked execution, shell injection, and hook enforcement patterns.
applies_to:
  - ".claude/skills/**/*.md"
category: claude-code
source: https://code.claude.com/docs/en/skills
---

# Claude Code Skills Reference

Skills are reusable workflows defined in SKILL.md files. Claude loads them automatically when relevant, or you invoke them directly with `/skill-name`.

## Skill Location

- **Project** — `.claude/skills/{name}/SKILL.md` (this project only)
- **Personal** — `~/.claude/skills/{name}/SKILL.md` (all your projects)
- **Plugin** — `{plugin}/skills/{name}/SKILL.md` (where plugin is enabled)

When skills share the same name across levels: enterprise > personal > project. Plugin skills use `plugin-name:skill-name` namespace, so they can't conflict.

Each skill is a directory with `SKILL.md` as entrypoint. Supporting files (templates, examples, scripts) go in the same directory. Reference them from SKILL.md so Claude knows when to load them.

## SKILL.md Format

```yaml
---
name: skill-name
description: >
  When this skill triggers. Include natural language patterns.
  Front-load the key use case. Truncated at 250 chars in listing.
---

# Skill Title

Instructions for what the skill does...
```

## Frontmatter Fields

All fields optional. Only `description` is recommended.

**Identity:**
- **`name`** — display name and slash command. Lowercase letters, numbers, hyphens. Max 64 chars. Defaults to directory name
- **`description`** — what the skill does and when to use it. Claude uses this for auto-invocation routing. Truncated at 250 chars in skill listing
- **`argument-hint`** — hint shown during autocomplete (e.g., `[issue-number]`)

**Invocation control:**
- **`disable-model-invocation`** — `true` to prevent Claude from auto-loading this skill. Only manual `/name` works. Description removed from context. Use for side-effect workflows like /commit, /deploy
- **`user-invocable`** — `false` to hide from `/` menu. Only Claude can invoke. Use for background knowledge

| Frontmatter | You can invoke | Claude can invoke | Context loading |
|-------------|---------------|-------------------|-----------------|
| (default) | Yes | Yes | Description always in context, full skill on invoke |
| `disable-model-invocation: true` | Yes | No | Description not in context |
| `user-invocable: false` | No | Yes | Description always in context |

**Model and performance:**
- **`model`** — model to use when skill is active. Overrides session model
- **`effort`** — `low`, `medium`, `high`, `max`. Overrides session effort level. `max` requires Opus 4.6

**Tool access:**
- **`allowed-tools`** — tools Claude can use without permission when skill is active. Comma-separated string or YAML list

**Execution context:**
- **`context`** — set to `fork` to run in a forked subagent. Skill content becomes the subagent's task prompt. No access to conversation history
- **`agent`** — which subagent type to use when `context: fork` is set. Built-in (`Explore`, `Plan`, `general-purpose`) or custom from `.claude/agents/`. Default: `general-purpose`

**Scoping:**
- **`paths`** — glob patterns that limit when skill activates. Claude only auto-loads when working with matching files. Comma-separated string or YAML list
- **`hooks`** — lifecycle hooks scoped to this skill. Register on activation, deregister on completion. Same schema as settings.json hooks

**Shell:**
- **`shell`** — `"bash"` (default) or `"powershell"` for inline shell commands

## String Substitutions

- **`$ARGUMENTS`** — all arguments passed when invoking. If not in content, appended as `ARGUMENTS: {value}`
- **`$ARGUMENTS[N]`** or **`$N`** — specific argument by 0-based index
- **`${CLAUDE_SESSION_ID}`** — current session ID
- **`${CLAUDE_SKILL_DIR}`** — directory containing SKILL.md

## Shell Injection

The `` !`command` `` syntax runs shell commands before skill content is sent to Claude. Output replaces the placeholder.

```yaml
---
name: pr-summary
context: fork
agent: Explore
---

PR diff: !`gh pr diff`
Changed files: !`gh pr diff --name-only`

Summarize this pull request.
```

Each `` !`command` `` executes immediately as preprocessing. Claude only sees the final output.

For multi-line commands, use a fenced block opened with ` ```! `:

````markdown
```!
node --version
npm --version
git status --short
```
````

Disable with `"disableSkillShellExecution": true` in settings.

## Forked Execution

When `context: fork` is set:
1. New isolated context created
2. Subagent receives skill content as its task prompt
3. The `agent` field determines execution environment (model, tools, permissions)
4. Results summarized and returned to main conversation

`context: fork` only makes sense for skills with explicit task instructions. Guidelines-only content without a task produces no output.

**Cache note:** Setting a different `model` on a forked skill breaks the parent's prompt cache. Same model = cache hit.

## Invocation

**Explicit:** User types `/skill-name` or `/skill-name arg1 arg2`

**Skill tool:** Claude invokes programmatically via `Skill(skill: "name", args: "...")`

**Automatic:** User says something matching the description, Claude loads the skill

## Hook Enforcement Pattern

For critical workflows, enforcement hooks add a hard guarantee beyond description matching:

```javascript
// PreToolUse hook blocks direct git commit
if (/\bgit\s+commit\b/i.test(command)) {
  if (!command.includes('SKILL_ACTIVE=1')) {
    console.error('[WORKFLOW REQUIRED] Use commit skill');
    process.exit(2);
  }
}
```

```bash
# Skill uses marker to bypass hook
SKILL_ACTIVE=1 git commit -m "message"
```

## Supporting Files

Keep SKILL.md under 500 lines. Move detailed reference to separate files:

```
my-skill/
├── SKILL.md           # Main instructions (required)
├── template.md        # Template for Claude to fill in
├── examples/          # Example outputs
└── scripts/           # Scripts Claude can execute
```

Reference supporting files from SKILL.md so Claude knows what they contain.

## Skill Description Budget

All skill names are always in context. Descriptions are loaded with a budget of 1% of context window, falling back to 8,000 chars. Too many skills causes descriptions to be shortened. Set `SLASH_COMMAND_TOOL_CHAR_BUDGET` env var to override.

## Permission Control

```
# Allow specific skills
Skill(commit)
Skill(review-pr *)

# Deny specific skills
Skill(deploy *)
```

Use `Skill(name)` for exact match, `Skill(name *)` for prefix match with any arguments.

## Common Issues

- **Skill not triggering** — description doesn't match user's phrasing. Check keywords
- **Wrong skill triggers** — overlapping descriptions. Make one more specific
- **Skill triggers too often** — add `disable-model-invocation: true`
- **Descriptions cut short** — too many skills exhausts the description budget. Front-load key use case
- **Missing frontmatter** — skill won't load without YAML frontmatter

## This Framework's Skills

- **research** — UNDERSTAND phase. "work on #X", "look into", "explore"
- **define** — DEFINE phase. "what are we solving", "root cause", "scope"
- **ideate** — IDEATE phase. "options", "approaches", "what if"
- **build** — PROTOTYPE phase. "build it", "implement", "code it"
- **test** — TEST phase. "does it work", "verify", "test it"
- **review** — Quality gate. "review this", "code review"
- **commit** — Ship. "commit", "save this", "done"
- **plan** — Pre-work. "what's next", "add to backlog"
- **handoff** — Continuity. "handoff", "end session"

## Kit Extensions

The kit layers four optional Deep Agents pattern fields on Claude Code's
frontmatter: `planning`, `filesystem`, `subagents`, `auto_summarize`. They are
kit-specific — Claude Code ignores them; the kit's skill-runtime hooks consume
them. See `.claude/specs/kit/skill-extensions.md` for the full reference and
runtime behavior. Backward compatible: skills without these fields are unchanged.
