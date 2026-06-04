---
name: agents
description: >
  Configuration and behavior for Claude Code agents: file format, frontmatter fields, tool permissions, model selection, memory, hooks, and invocation patterns.
applies_to:
  - ".claude/agents/**/*.md"
category: claude-code
source: https://code.claude.com/docs/en/sub-agents
---

# Claude Code Agents Reference

Agents are specialized subprocesses that handle tasks in their own context window with a custom system prompt, specific tool access, and independent permissions.

## Agent Location

- **Managed** — deployed by org admins via managed settings (highest priority)
- **CLI** — `--agents '{json}'` (current session only)
- **Project** — `.claude/agents/{name}.md` (this project only, check into version control)
- **Personal** — `~/.claude/agents/{name}.md` (all your projects)
- **Plugin** — `{plugin}/agents/{name}.md` (where plugin is enabled, lowest priority)

When multiple agents share the same name, higher-priority location wins.

## File Format

```yaml
---
name: agent-name
description: When Claude should delegate to this agent
tools: Read, Grep, Glob
model: haiku
---

You are [role]. Your primary responsibility is [what you do].

Instructions for the agent...
```

The frontmatter defines metadata and configuration. The body becomes the system prompt. Agents receive only this system prompt plus basic environment details, not the full Claude Code system prompt.

## Frontmatter Fields

**Required:**
- **`name`** — unique identifier, lowercase letters and hyphens
- **`description`** — when Claude should delegate to this agent. Claude uses this for auto-delegation

**Tool access:**
- **`tools`** — comma-separated list of allowed tools. Inherits all tools if omitted
- **`disallowedTools`** — tools to deny, removed from inherited or specified list. If both set, disallowedTools applied first

**Model and performance:**
- **`model`** — `sonnet`, `opus`, `haiku`, a full model ID, or `inherit` (default). Resolution order: CLAUDE_CODE_SUBAGENT_MODEL env var > per-invocation parameter > frontmatter > parent model
- **`effort`** — `low`, `medium`, `high`, `max`. Overrides session effort level. `max` requires Opus 4.6

**Lifecycle:**
- **`maxTurns`** — maximum agentic turns before agent stops
- **`background`** — `true` to always run as a background task. Default: `false`
- **`isolation`** — `worktree` to run in a temporary git worktree. Auto-cleaned if no changes made
- **`color`** — display color in task list and transcript: `red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, `cyan`

**Memory:**
- **`memory`** — persistent memory scope: `user`, `project`, or `local`
  - `user` — `~/.claude/agent-memory/{name}/`. Learnings across all projects
  - `project` — `.claude/agent-memory/{name}/`. Project-specific, shareable via version control
  - `local` — `.claude/agent-memory-local/{name}/`. Project-specific, gitignored
- When enabled, system prompt includes instructions for reading/writing memory. First 200 lines or 25KB of MEMORY.md is injected. Read, Write, Edit tools auto-enabled

**Integration:**
- **`skills`** — skills to preload into agent context at startup. Full content injected, not just made available. Agents don't inherit parent skills
- **`mcpServers`** — MCP servers available to this agent. Each entry is a server name (reuses parent connection) or inline definition (scoped to agent lifecycle)
- **`hooks`** — lifecycle hooks scoped to this agent. Same schema as settings.json. Register on activation, deregister on completion
- **`permissionMode`** — `default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, `plan`. Parent `bypassPermissions` takes precedence. Parent `auto` mode is inherited and overrides frontmatter

**Session agent only:**
- **`initialPrompt`** — auto-submitted as first user turn when running as main agent via `--agent`. Commands and skills are processed

## Built-in Agents

- **Explore** — fast, read-only (haiku). File discovery, code search, codebase exploration. No Write/Edit
- **Plan** — research for plan mode (inherits parent model). Read-only
- **general-purpose** — complex multi-step tasks (inherits parent model). All tools

## Triggering Agents

### Via Agent Tool (preferred)

```python
Agent({
  description: "Establish project context",
  subagent_type: "context-agent",
  model: "haiku",
  prompt: "Evaluate the current project state.",
  run_in_background: true
})
```

### Via hook injection

Hooks inject instructions telling the main session to spawn agents. This avoids the unreliable `type: "agent"` hook pattern.

```javascript
// Hook outputs instruction text
console.log(`IMPORTANT: Spawn the context agent in the background.
Use the Agent tool with these parameters:
- subagent_type: "context-agent"
- model: "haiku"
- run_in_background: true`);
```

### Via @-mention

Type `@` and pick the agent from typeahead. Guarantees that specific agent runs.

### Via --agent flag

Run entire session as an agent: `claude --agent code-reviewer`

## Agent Tool Parameters

When Claude spawns an agent via the Agent tool, these parameters are available:
- **`description`** — short task description (3-5 words)
- **`subagent_type`** — name of the agent to use
- **`model`** — override model for this invocation
- **`prompt`** — the task for the agent
- **`run_in_background`** — `true` for async execution
- **`isolation`** — `"worktree"` for isolated git copy
- **`name`** — addressable name for SendMessage

## Scoped Hooks Example

```yaml
---
name: db-reader
description: Execute read-only database queries
tools: Bash
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-readonly-query.sh"
---
```

Hooks defined in agent frontmatter only run while that agent is active.

## Restricting Agent Spawning

Use `Agent(agent_type)` in the `tools` field to allowlist which agents can be spawned:

```yaml
tools: Agent(worker, researcher), Read, Bash
```

Deny specific agents via permissions:
```json
{ "permissions": { "deny": ["Agent(Explore)", "Agent(my-agent)"] } }
```

## Memory Tips

- `project` is the recommended default scope. Shareable via version control
- Include memory read/write instructions in the agent body for proactive maintenance

## Plugin Agent Limitations

Plugin agents do NOT support `hooks`, `mcpServers`, or `permissionMode` fields. These are ignored when loading from plugins. Copy to `.claude/agents/` if needed.

## Common Issues

- **Agent doesn't run** — hook output not acted on by main session
- **Agent can't use tool** — tool not in `tools` list or blocked by `disallowedTools`
- **Output not visible** — background agents return results asynchronously
- **Wrong model** — using opus for simple tasks wastes tokens. Use haiku for quick tasks
- **Subagents can't spawn subagents.** Agent(type) in tools only works for main thread agents via --agent
