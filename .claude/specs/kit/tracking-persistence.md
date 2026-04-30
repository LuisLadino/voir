---
name: tracking-persistence
description: >
  How hooks persist session tracking data. Required reading before creating
  or editing any hook that writes to session tracking. Explains the
  append-only JSONL pattern that prevents concurrent-write races.
applies_to:
  - ".claude/hooks/tracking/**/*.cjs"
  - ".claude/hooks/lib/session-utils.cjs"
  - ".claude/hooks/context/clear-pending.cjs"
  - ".claude/hooks/context/enforce-specs.cjs"
  - ".claude/hooks/context/enforce-voice.cjs"
  - ".claude/hooks/safety/enforce-plan.cjs"
category: kit
---

# Tracking Persistence

How session tracking is stored and why it's append-only.

## The Problem We Solved

Claude Code runs matching hooks in parallel. Every Bash tool call fires `tool-tracker`, `command-log`, and `detect-pivot` simultaneously. When hooks shared one JSON file and did `load → mutate → save`, they raced. Concurrent `fs.writeFileSync` calls corrupted the file in roughly 29% of sessions measured locally, and silently lost updates even when the file parsed clean.

The fix: append-only JSONL event log, one line per event. `fs.appendFileSync` is atomic on POSIX for writes under PIPE_BUF, and every tracking event fits well under that limit. Parallel writers no longer collide.

## File Layout

```
~/.claude/projects/{workspace-key}/
  tracking/
    {session-id}.jsonl
    .active-session
```

One file per session. Extension is `.jsonl`, one JSON object per line. Legacy `.json` files from before this refactor get swept by `cleanupOldSessions` after 7 days.

## Event Schema

Every line is a JSON object with a `timestamp` in ISO-8601 and a `type`. The rest of the fields are event-specific.

```json
{"timestamp": "2026-04-18T15:30:00.000Z", "type": "tool", "tool": "Bash", "command": "git status"}
{"timestamp": "2026-04-18T15:30:00.100Z", "type": "command", "command": "git status", "exitCode": 0}
{"timestamp": "2026-04-18T15:30:05.200Z", "type": "file_change", "tool": "Edit", "file": "src/foo.ts", "op": "modify"}
```

### Recognized event types

Observability events (consumed by `readTrackingState`):

| type | Producer | Key fields |
|---|---|---|
| `session_init` | `initSession` in `session-utils.cjs` | `workspace` |
| `tool` | `tool-tracker.cjs` | `tool`, plus tool-specific fields |
| `command` | `command-log.cjs` | `command`, `exitCode`, `stdout` |
| `file_change` | `track-changes.cjs` | `tool`, `file`, `op` |
| `failure` | `tool-failure.cjs` | `tool`, `error` |
| `subagent_start` | `subagent-tracker.cjs` | `id`, `subagentType`, `description` |
| `subagent_stop` | `subagent-tracker.cjs` | `id` |
| `injection` | `inject-utils.logInjection` | action fields |
| `skill_invocation` | `clear-pending.cjs` on UserPromptSubmit when prompt starts with `/name` | `skill`, `source` |
| `phase_menu_emitted` | `phase-menu.cjs` on phase entry via workflow slash command | `phase` |

Per-prompt enforcement events (consumed by `readPromptScopedState`):

| type | Producer | Key fields |
|---|---|---|
| `prompt_start` | `clear-pending.cjs` on UserPromptSubmit | — |
| `spec_read` | `track-spec-reads.cjs` on PostToolUse Read | `name`, `filePath` |
| `plan_skill_read` | `track-spec-reads.cjs` on PostToolUse Read | `filePath` |
| `voice_blocked` | `enforce-voice.cjs` on PreToolUse Bash block | `hash` |

New observability events register in `readTrackingState`. New enforcement events register in `readPromptScopedState`. Readers are segregated so observability and enforcement concerns don't cross-contaminate.

## Writer Contract

Hooks call `appendTrackingEvent(sessionId, event, workspacePath?)`:

```js
const { appendTrackingEvent, getSessionId } = require('../lib/session-utils.cjs');

appendTrackingEvent(getSessionId(session_id), {
  type: 'tool',
  tool: tool_name,
});
```

Rules:
- `event.type` is required. The function throws if missing.
- `timestamp` is added automatically when not provided.
- Keep payload under a few KB so append stays atomic.
- NEVER read-then-append. If you need prior state, use `readTrackingState` but do NOT write back a mutated object.

## Reader Contract

Three reducers over the same event stream, segregated by concern:

**Observability, session-wide.** `readTrackingState(sessionId)` / `getRecentTrackingState()` return the legacy shape: `tools[]`, `commands[]`, `filesModified[]`, `filesCreated[]`, `operations[]`, `failures[]`, `subagents[]`, `injections[]`. Use for `/analyze` (kit only), `/audit`, `awareness`, and anything that cares about "what happened this session."

**Observability, prompt-scoped.** `readPromptScopedTrackingState(sessionId)` / `getRecentPromptScopedTrackingState()` return the same shape as `readTrackingState` but events only count after the most recent `prompt_start`. Use for Stop-time checks that care about "what happened in the current turn." Example: `verify-before-stop`'s incomplete-skill detector. See #231. When no `prompt_start` has been written, returns empty collections. The caller treats that as "nothing to check" rather than fail-closed, because Stop-time observability is a nudge, not a gate.

**Per-prompt enforcement.** `readPromptScopedState(sessionId)` / `getRecentPromptScopedState()` return `{ specsRead, planSkillRead, lastVoiceBlockedHash, promptStart }`. State is reset at every `prompt_start` event and fails closed when no `prompt_start` has been written. Use for PreToolUse enforcement hooks `enforce-specs`, `enforce-plan`, `enforce-voice` in main-session contexts.

**Session-scoped enforcement for subagents.** `readSessionScopedSpecState(sessionId)` / `getRecentSessionScopedSpecState()` return the same shape but scan the entire tracking file without requiring a `prompt_start` boundary. Subagents don't fire `UserPromptSubmit`, so no `prompt_start` event is ever written in a subagent session. The prompt-scoped reader fails closed there and blocks every edit even after required specs have been read. Enforcement hooks branch on `data.agent_id` in the hook payload: present means use this reader, absent means use the prompt-scoped reader. Single-turn by design. Safe because subagents have no follow-up prompts to isolate from.

`readTrackingEvents` returns the raw event array when you need it.

Malformed lines from partial writes on crash are silently skipped. Readers MUST tolerate this. Do not validate the whole file; validate the events you read. Writers prefix each append with a leading newline so a partially-flushed prior write can't merge into the next good line.

## Anti-Patterns

**Don't read-modify-write.** `loadSessionTracking` and `saveSessionTracking` were removed. If you see `const t = load(); t.foo.push(x); save(t)`, rewrite as `appendTrackingEvent(sid, {type, ...x})`.

**Don't mutate past events.** The old `subagent-tracker` found its matching start event and patched a `stoppedAt` onto it. With append-only, write a second `subagent_stop` event. The reader pairs them by `id`.

**Don't share a writer file across hooks.** If you need a new tracking concern, add a new event `type`. Don't create a second file that multiple hooks write to.

**Don't skip `getSessionId`.** Always resolve the session id via `getSessionId(session_id)`. The hook input's `session_id` is the canonical source; the fallback exists for pre-session events.

## Known Limitations

- **`.active-session` fallback still uses read-modify-write.** When a hook runs without a `claudeSessionId`, `getSessionId` reads and may write `.active-session` without locking. Claude Code supplies `session_id` on every tool event in practice, so the fallback is rarely hit. Worth revisiting if a hook ever needs to fire without a session id in the input.
- **Atomicity is empirical, not a POSIX guarantee.** `fs.appendFileSync` with `O_APPEND` is atomic for small writes on APFS and ext4 in practice, and the concurrency test validates this. POSIX only formally guarantees atomicity for pipe writes ≤ PIPE_BUF. On networked filesystems the guarantee is weaker. The kit targets local disk; revisit if that changes.

## Concurrency Test

`.claude/hooks/tracking/tracking.test.cjs` spawns 8 forked workers that each append 100 events and asserts no corruption, no duplicates, no missing events. Run it manually after changing anything in this directory:

```bash
node .claude/hooks/tracking/tracking.test.cjs
```
