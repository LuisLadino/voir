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
  - "scripts/collect-analyze-data.cjs"
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

The projects root is `CLAUDE_PROJECTS_DIR` when set, else `~/.claude/projects`. The override is a test seam honored by both the write side in `session-utils.cjs` and the read side in `collect-analyze-data.cjs`; `scripts/run-tests.cjs` points it at a fresh temp dir per suite so `npm test` never writes hook-errors.log lines or tracking events into the real tree (#889). It is load-bearing for suite hermeticity — do not remove it as a simplification.

## Event Schema

Every line is a JSON object with a `timestamp` in ISO-8601 and a `type`. The rest of the fields are event-specific.

```json
{"timestamp": "2026-04-18T15:30:00.000Z", "type": "tool", "tool": "Bash", "command": "git status"}
{"timestamp": "2026-04-18T15:30:00.100Z", "type": "command", "command": "git status", "exitCode": 0}
{"timestamp": "2026-04-18T15:30:05.200Z", "type": "file_change", "tool": "Edit", "file": "src/foo.ts", "op": "modify"}
```

A Bash `tool` event's `command` is truncated to 100 chars for a compact display log. Completion detection must not depend on that truncated copy: a signal like `git push` or a `SKILL_COMPLETE: <name>` sentinel can sit in a compound-command tail past 100 chars, or after a multi-KB heredoc body, where no fixed head-cap could preserve it (#895). So `tool-tracker` extracts the completion signals from the **full** command at capture time via `skill-patterns.extractCommandSignals` and records them as a `signals` array on the event (present only when non-empty). `verify-before-stop` and `skill-telemetry` read `[command, ...signals]`, so any completion signal present anywhere in the full command is preserved for detection, not just the head. Old events lacking `signals` fall back to the truncated command — the pre-fix behavior — so no session regresses. `extractCommandSignals` stores each matched substring, so its patterns keep their gaps bounded (no `.*`): an unbounded gap would let a long, possibly secret-bearing span into the log and make the scan quadratic on a large command.

### Recognized event types

Observability events (consumed by `readTrackingState`):

| type | Producer | Key fields |
|---|---|---|
| `session_init` | `initSession` in `session-utils.cjs` | `workspace` |
| `tool` | `tool-tracker.cjs` | `tool`, plus tool-specific fields; Bash carries a truncated `command` + a `signals` array (#895) |
| `command` | `command-log.cjs` | `command`, `exitCode`, `stdout` |
| `file_change` | `track-changes.cjs` | `tool`, `file`, `op` |
| `failure` | `tool-failure.cjs` | `tool`, `failureKind`, `error` |
| `subagent_start` | `subagent-tracker.cjs` | `id`, `subagentType`, `description` |
| `subagent_stop` | `subagent-tracker.cjs` | `id` |
| `injection` | `inject-utils.logInjection` | action fields |
| `skill_invocation` | `clear-pending.cjs` on UserPromptSubmit when prompt starts with `/name` or `/plugin:name` | `skill`, `source` |
| `phase_menu_emitted` | `phase-menu.cjs` on phase entry via workflow slash command | `phase` |
| `hook_handler_error` | `stdin-hook.cjs:54` `runStdinHook` observability mode on handler exception | `hook`, `error` |

Per-prompt enforcement events (consumed by `readPromptScopedState`):

| type | Producer | Key fields |
|---|---|---|
| `prompt_start` | `clear-pending.cjs` on UserPromptSubmit | — |
| `spec_read` | `track-spec-reads.cjs` on PostToolUse Read | `name`, `filePath` |
| `plan_skill_read` | `track-spec-reads.cjs` on PostToolUse Read | `filePath` |
| `voice_blocked` | `enforce-voice.cjs` on PreToolUse Bash block | `hash` |

New observability events register in `readTrackingState`. New enforcement events register in `readPromptScopedState`. Readers are segregated so observability and enforcement concerns don't cross-contaminate.

### `failure` event classification

`tool-failure.cjs` writes a `failureKind` discriminator on every failure event so consumers can distinguish genuine errors from intentional non-zero exits.

- **`tool_error`** — genuine tool error: thrown exception, MCP failure, file-not-found on Read, network timeout, auth scope error, etc. This is the default; ambiguous cases classify here.
- **`nonzero_exit`** — Bash exited non-zero as part of normal command semantics. Currently: `grep`/`egrep`/`fgrep`/`ggrep`/`rg`/`ag`/`ack` exit 1 on no match, `diff`/`cmp` exit 1 on differences. Allowlist lives at `classify-failure.cjs:NONZERO_EXIT_BINS`.

Non-Bash tools always classify as `tool_error` since Read/Edit/Write/Glob/Grep/MCP have no normal "intentional non-zero" path.

Awareness reads only `tool_error` events when checking the failure threshold. Old session events without `failureKind` are treated as `tool_error` for backward compatibility.

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

**Per-prompt enforcement.** `readPromptScopedState(sessionId)` / `getRecentPromptScopedState()` return `{ specsRead, planSkillRead, lastVoiceBlockedHash, promptStart }`. State is reset at every `prompt_start` event and fails closed when no `prompt_start` has been written. Use for PreToolUse enforcement hooks where the gate should refresh each prompt. Currently: `enforce-voice` in main-session contexts, where `lastVoiceBlockedHash` is content-specific and per-prompt scoping is correct.

**Session-scoped enforcement.** `readSessionScopedSpecState(sessionId)` / `getRecentSessionScopedSpecState()` return the same shape but scan the entire tracking file without requiring a `prompt_start` boundary. `enforce-specs` and `enforce-plan` use this reader in every context (#459, #452, #552): a spec read or `/plan` read once in a session stays satisfied across prompt cycles and `/build` branch switches, instead of being re-required at every prompt. `enforce-voice` uses it only for subagent contexts. Subagents don't fire `UserPromptSubmit`, so no `prompt_start` is ever written and the prompt-scoped reader would fail closed. `enforce-voice` branches on `data.agent_id` to choose. Dispatch workers are separate sessions with their own tracking files, so session-scoping never leaks reads between them.

**Per-skill telemetry, prompt-scoped.** `readSkillTelemetryState(sessionId)` / `getRecentSkillTelemetryState()` return an array of per-skill window records for the most recent prompt — read-only metric, never a gate. State resets at every `prompt_start` and returns `[]` when none has been written. The cross-session `/analyze` aggregator in `scripts/collect-analyze-data.cjs` produces the same record from a whole-file scan and sums the records into counts. The record shape and its semantics are below. See #347, #603.

`readTrackingEvents` returns the raw event array when you need it.

Malformed lines from partial writes on crash are silently skipped. Readers MUST tolerate this. Do not validate the whole file; validate the events you read. Writers prefix each append with a leading newline so a partially-flushed prior write can't merge into the next good line.

### Per-skill telemetry rollup

`readSkillTelemetryState` reduces the event stream into one record per skill window. Adopted from OpenSpace's runtime telemetry shape (#345 V2 FM8 mitigation, #347). It adds no event types and no write-path change. It reuses `skill_invocation`, `tool`, and `failure` events other hooks already emit.

**Record shape.** One object per window:

| field | type | meaning |
|---|---|---|
| `skill_name` | string | normalized name (leading `/` and `plugin:` prefix stripped) |
| `applied` | `true` | the window existed; always true on a record |
| `completed` | boolean | the window reached its completion signal (see below) |
| `fallback_used` | boolean | incomplete, then a different skill ran later in the same prompt segment |
| `tool_success_count` | number | `tool` events inside the window |
| `tool_failure_count` | number | `failure` events inside the window |
| `source` | `'slash_command'` \| `'skill_tool'` | how the window opened |
| `started_at` | ISO-8601 \| null | opening event timestamp |
| `ended_at` | ISO-8601 \| null | closing timestamp |
| `duration_seconds` | number | `ended_at − started_at`, clamped at 0 |
| `exempt` | boolean | skill is exempt from completion (see the distinction below) |
| `registered` | boolean | skill has an entry in `skill-patterns` |

**Window open/close.** A window opens at a `skill_invocation` event (slash-command path, `source: 'slash_command'`) or a `tool` event with `tool === 'Skill'` carrying a `skill` field (assistant Skill-tool call, `source: 'skill_tool'`). It closes at the next window-opening event, the next `prompt_start`, or end-of-events. Windows never nest. Opening a second skill closes the first.

**Completion is the shared rule.** Whether a window `completed` is decided by `isSkillComplete` in `.claude/hooks/lib/skill-patterns.cjs`, the same rule `verify-before-stop` uses to gate Stop. The signal is a Bash-command regex, a tool name, or a `SKILL_COMPLETE: <name>` sentinel. One rule, two consumers: edit the table once and both the gate and the metric move together. `skill-patterns` deliberately has no dependency on `session-utils`, so the require graph stays a DAG.

**Fallback attribution.** After all windows in a prompt segment close, a window is marked `fallback_used` when it is non-exempt, did not complete, and a window for a *different* skill ran later in the same segment. The reading: the skill was invoked, didn't finish, and something else took over. Exempt and completed windows never count.

**Exempt vs unregistered, the distinction consumers must respect.** Three states come out of `skill-patterns`:

- **Registered with a completion rule** (`registered: true`, `exempt: false`), e.g. `commit`, `build`, `test`, `research`, `plan`, `dispatch`. Completion is measurable. Report completion and fallback rates.
- **Exempt** (`registered: true`, `exempt: true`), e.g. `review`, `define`, `ideate`, and the lens skills. They complete by definition: `isSkillComplete` returns `complete: true` unconditionally, so `completed` is always true and `fallback_used` always false. A completion rate is a constant 100% and carries no signal.
- **Unregistered** (`registered: false`, `exempt: false`), no entry in the table, e.g. `/cost` or a downstream project-custom skill. There is no completion *rule*, so no rate is measurable. A Skill-tool invocation of an unregistered skill still trips verify-before-stop's drift tripwire (#231), but the tripwire is **satisfiable**: `isSkillComplete` computes the `SKILL_COMPLETE: <name>` sentinel for unregistered skills too (#902, before which the sentinel sat behind registration and left the gate unclearable), and the Stop message names that echo as the expected action. For a kit skill someone forgot to register, the resolution is still the registration decision (rule, exempt, or consciously accept the tripwire), as done for `board` (#896) and `verify`/`audit` (#900); for a genuinely project-custom skill the sentinel is the completion contract. A raw `completed` count is therefore sentinel-driven, not a hard 0 — but it is still not a measured rate.

Consumers MUST NOT report a completion or fallback rate for exempt or unregistered skills. Doing so reads as noise (unregistered: no completion rule, so a sentinel-driven `completed` count is not a rate) or a meaningless constant (exempt: a hard 100%). The measurable set is exactly `registered && !exempt`. `applied` counts and the tool-success ratio stay meaningful for all three states. The reference renderer is `formatTelemetrySkillLine` in `scripts/collect-analyze-data.cjs`: it tags `(exempt)` / `(unregistered)` and suppresses the rate lines for both.

**Two windowers, on purpose.** `readSkillTelemetryState` is prompt-scoped: it resets at every `prompt_start`, returns only the last prompt's windows, and returns `[]` when no `prompt_start` was written. That fits Stop-time and current-turn reads. The `/analyze` aggregator needs the opposite, every window across every prompt and every session including subagent sessions that never write a `prompt_start`, and it works from a raw events array per file rather than a resolved `(sessionId, workspacePath)` pair. So `collect-analyze-data.cjs` segments on `prompt_start`, runs the identical window logic per segment, keeps all records, then sums the per-window booleans into per-skill counts. The windower itself is shared: both `session-utils.readSkillTelemetryState` and `collect-analyze-data.cjs` call `reduceSkillTelemetry`/`reduceSkillWindows` in `hooks/lib/skill-telemetry.cjs` (hoisted in #614), so only the segmentation mode differs, and the completion rule is shared via `skill-patterns`. Because both consumers go through that one windower, the `signals`-aware completion read (#895) covers the aggregator too, not just Stop-time enforcement.

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
