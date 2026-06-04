---
name: hooks
description: >
  Hook configuration and behavior. Required reading before creating or editing
  hook scripts (.cjs files in .claude/hooks/).
applies_to:
  - ".claude/hooks/**/*.cjs"
category: claude-code
source: https://code.claude.com/docs/en/hooks
---

# Claude Code Hooks Reference

Hooks execute code in response to Claude Code lifecycle events. They can block operations, inject context, modify tool inputs, and control permissions.

## Configuration

Hooks are defined in `~/.claude/settings.json` (global) or `.claude/settings.json` (project).

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/script.cjs"
          }
        ]
      }
    ]
  }
}
```

## Hook Types

| Type | Purpose | Required Fields |
|------|---------|-----------------|
| `command` | Execute a shell script | `command` |
| `http` | Send POST to a URL | `url` |
| `prompt` | Run a model prompt | `prompt` |
| `agent` | Spawn a multi-turn subagent | `prompt` |

**Command-specific fields:**
- **`command`** — shell command to execute
- **`async`** — `true` to run in background without blocking. Default: `false`
- **`asyncRewake`** — `true` to run async but block on exit code 2. Default: `false`
- **`shell`** — `"bash"` (default) or `"powershell"`

**Agent/prompt-specific fields:**
- **`prompt`** — instructions for the model. `$ARGUMENTS` = hook input JSON
- **`model`** — model to use. Defaults to a fast model
- **`timeout`** — seconds before canceling. Agent: 60, prompt: 30

**Common fields (all types):**
- **`type`** — required. `"command"`, `"http"`, `"prompt"`, or `"agent"`
- **`if`** — permission rule filter (e.g., `"Bash(git *)"`, `"Edit(*.ts)"`). Only on tool events
- **`timeout`** — seconds before canceling. Command: 600
- **`statusMessage`** — custom spinner text while running
- **`once`** — `true` to run once per session then remove. Skills only

The `matcher` field also works and uses the same string patterns as `if`.

## Matchers

- **`"Bash"`** — all Bash calls
- **`"Bash(*git commit*)"`** — Bash with git commit anywhere in command
- **`"Edit\|Write"`** — Edit or Write calls
- **`"Read(*.md)"`** — Read calls on markdown files
- **`""` or omitted** — all tool calls for that event type

NEVER use object matchers (`{"tool": "Bash"}`) — deprecated, causes errors.

## Event Types

| Event | When | Matcher Input | Decision Support |
|-------|------|---------------|------------------|
| `SessionStart` | Session begins | — | additionalContext |
| `UserPromptSubmit` | User sends message | — | block, additionalContext |
| `PreToolUse` | Before tool executes | Tool name | allow/deny/ask, updatedInput, additionalContext |
| `PostToolUse` | After tool succeeds | Tool name | block, additionalContext, updatedMCPToolOutput |
| `PostToolUseFailure` | After tool fails | Tool name | additionalContext |
| `PermissionRequest` | Permission prompt shown | Tool name | allow/deny, updatedInput, updatedPermissions |
| `PermissionDenied` | User denies permission | Tool name | retry |
| `SubagentStart` | Subagent launches | Agent type | additionalContext |
| `SubagentStop` | Subagent completes | Agent type | block, additionalContext |
| `Stop` | Before Claude stops | — | block, additionalContext |
| `PreCompact` | Before context compaction | — | side effects only |
| `ConfigChange` | Settings modified | — | block |
| `SessionEnd` | Session ends gracefully | — | UNRELIABLE: doesn't fire on terminal close |
| `CwdChanged` | Working directory changes | — | additionalContext |
| `Elicitation` | Form shown to user | — | accept/decline/cancel |

## Exit Codes

| Code | Meaning | JSON Parsed? | Feedback |
|------|---------|-------------|----------|
| 0 | Success/Allow | Yes, from stdout | Normal |
| 2 | Block/Deny | No | stderr shown to Claude as error |
| Other | Error | No | stderr shown in verbose mode only |

NEVER use `|| true` in settings.json. It converts exit code 2 to 0, swallowing denials.

## Hook Input

Hooks receive JSON on stdin:

```json
{
  "session_id": "abc123",
  "tool_name": "Bash",
  "tool_input": {
    "command": "git commit -m 'message'"
  }
}
```

**Common fields across all events:**
- **`session_id`** — current session identifier. Subagents inherit the parent's `session_id`.
- **`transcript_path`** — path to the conversation JSONL.
- **`cwd`** — current working directory when the hook fires.
- **`permission_mode`** — e.g. `"default"`, `"plan"`, `"acceptEdits"`, `"bypassPermissions"`.
- **`hook_event_name`** — the event that fired.
- **`agent_id`** — string, present only when the hook fires inside a subagent context. Absent in main-session events.
- **`agent_type`** — string, subagent type name, for example `"general-purpose"` or `"Explore"`. Present only alongside `agent_id`.

Branch on `agent_id` to detect subagent context. Main sessions never receive this field. Subagent PreToolUse, PostToolUse, SubagentStart, and SubagentStop events all carry it.

## JSON Response Schema

Hooks return JSON on stdout when exiting 0. All fields optional.

### Universal Fields

```json
{
  "continue": true,
  "stopReason": "why to stop",
  "suppressOutput": false,
  "systemMessage": "warning shown to user"
}
```

### PreToolUse Response

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow|deny|ask|defer",
    "permissionDecisionReason": "shown to user/Claude",
    "updatedInput": { "command": "modified command" },
    "additionalContext": "extra context for Claude"
  }
}
```

- **`permissionDecision`** — `"allow"` skips prompt, `"deny"` blocks, `"ask"` prompts user, `"defer"` pauses for external handling (requires `-p` flag, v2.1.89+)
- **`updatedInput`** — replaces the entire tool input object. Include unchanged fields
- **`additionalContext`** — string injected into Claude's context
- **Precedence** when multiple hooks disagree: deny > defer > ask > allow

### PostToolUse Response

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "context for Claude",
    "updatedMCPToolOutput": "replacement output"
  }
}
```

`updatedMCPToolOutput` replaces MCP tool output. MCP tools only.

### SessionStart / UserPromptSubmit Response

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "context added to session"
  }
}
```

For UserPromptSubmit, also supports `"decision": "block"` with `"reason"`.

For SessionStart, plain `console.log()` text also works as context injection.

### Stop / SubagentStop Response

```json
{
  "decision": "block",
  "reason": "explanation to Claude"
}
```

Stop and SubagentStop responses use `{decision, reason}` at the top level only. Claude Code's validator REJECTS `hookSpecificOutput` on these events — that field is valid only for PreToolUse, UserPromptSubmit, and PostToolUse responses.

### PermissionRequest Response

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow|deny",
      "updatedInput": { "field": "value" },
      "message": "for deny only"
    }
  }
}
```

## Environment Variables

- **`$CLAUDE_PROJECT_DIR`** — project root. Quote for paths with spaces
- **`$CLAUDE_ENV_FILE`** — file for persisting env vars. SessionStart, Setup, CwdChanged, and FileChanged
- **`$CLAUDE_CODE_REMOTE`** — `"true"` in remote web environments

## async vs asyncRewake

- **`async: true`** — fire and forget, never blocks. Use for logging, tracking, side effects
- **`asyncRewake: true`** — runs async but blocks on exit code 2. Zero-latency happy path with blocking on failure. Use for safety checks where most calls pass

## Hooks in Skills and Agents

Skills and agents can define scoped hooks in their frontmatter. These register when activated and deregister when completed. Same schema as settings.json hooks.

```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate.sh"
```

## File Extensions

Use `.cjs` for hooks, not `.js`. Projects with `"type": "module"` in package.json treat `.js` as ES modules, breaking `require()`. The `.cjs` extension forces CommonJS.

## Output Limits

Hook output injected into context is capped at 10,000 characters. Shell profiles that print on startup can break JSON parsing. Ensure stdout contains only JSON.

## Reading Hook Input (Node.js)

```javascript
#!/usr/bin/env node
let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  const input = JSON.parse(data);
  // Process input
  process.exit(0);
});
```

## Debugging

1. Test manually: `echo '{"tool_name":"Bash","tool_input":{"command":"git commit"}}' | node hook.cjs && echo $?`
2. Check stderr: `echo '...' | node hook.cjs 2>&1`
3. Validate settings: `cat ~/.claude/settings.json | jq .`

## Known Limitations

- **SessionEnd unreliable.** Doesn't fire on terminal close or trash icon
- **PostToolUse success only.** Failed commands trigger PostToolUseFailure instead
- **No exit_code in tool_response.** Can't check command exit status in PostToolUse
- **JSON on exit 0 only.** Exit code 2 ignores stdout, uses stderr for feedback
