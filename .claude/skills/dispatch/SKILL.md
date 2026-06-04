---
name: dispatch
description: >
  Fire parallel autonomous workers on GitHub issues. Each worker runs research, build, commit, PR in its own worktree. Triggers: "dispatch", "delegate these", "work in parallel", "run autonomously", "hand off these issues". Reports back next prompt.
argument-hint: '[issue-numbers...] or "task description" [--repo O/R] [--repo-path PATH] [--model M] [--max N] [--no-track] [--dry-run] [--plan-only] [--no-auto-plan-only] [--list] [--kill ID] [--synthesize] [--cleanup]'
allowed-tools: Bash, Read, Monitor
---

# Dispatch

Delegates work to independent Claude Code worker sessions running in the background.

Each worker is a full session. It fires SessionStart hooks, loads CLAUDE.md, inherits all kit specs, skills, and hooks. Workers run the kit workflow `/research` → `/define` → `/ideate` → `/build` → `/test` → `/review` → `/commit` autonomously and emit a structured JSON result at the end.

## What this is not

- Not subagents. The Agent tool gives you in-process subagents that share this session's process.
- Not Agent Teams. That's in-process teammates with `TeamCreate` + `SendMessage`.
- Not Anthropic's "Dispatch" product. That's mobile → terminal remote control.

This spawns separate `claude -p` OS processes. Each worker has its own session, own context window, own tracking. Workers survive this session dying.

## Invocation

Run through the `dispatch.cjs` module.

```bash
node .claude/hooks/lib/dispatch.cjs <args>
```

### Common forms

- `/dispatch 42` — single issue in current repo
- `/dispatch 42 43 44` — parallel issues
- `/dispatch "refactor the button component"` — ad-hoc task; auto-creates tracking issue
- `/dispatch --no-track "quick experiment"` — ad-hoc without issue creation
- `/dispatch --dry-run 42 43` — show what would fire without spawning
- `/dispatch --plan-only 42` — worker stops after ideate; plan posted as issue comment. Use for issues touching `.claude/{hooks,skills,specs,docs,commands,agents,research}/` paths, which Claude Code's built-in sensitive-file gate blocks non-interactively. Dispatch auto-applies this flag per-target when the issue references one of these subtrees; the explicit flag forces it on every target.
- `/dispatch --no-auto-plan-only 42` — disable the per-target auto-detect. Dispatch as if `--plan-only` were not set, even if the issue body references a gated subtree.
- `/dispatch 42 --repo LuisLadino/voir` — cross-repo; auto-resolves local clone
- `/dispatch 42 --repo LuisLadino/voir --repo-path /abs/path` — explicit cross-repo path
- `/dispatch 42 --model sonnet` — use Sonnet for cost control
- `/dispatch 42 43 --max 2` — cap concurrency below default
- `/dispatch --list` — show active workers
- `/dispatch --kill abc123ef4567` — stop a specific worker
- `/dispatch --synthesize` — read completed workers' results and report
- `/dispatch --cleanup` — remove old output files and orphaned worktrees

## What happens when you dispatch

1. `dispatch.cjs` parses args and validates them. `--repo` must match `owner/name` regex.
2. Auth pre-flight warns if `ANTHROPIC_API_KEY` is set. Max users should unset it.
3. Worker cwd is resolved. Without `--repo` or `--repo-path`, worker inherits the orchestrator's project root. With `--repo`, the script looks for a local clone under `~/Repositories/{Personal,Work}/<name>`. With `--repo-path`, that absolute path is used.
4. Opportunistic cleanup: output files older than 7 days, stale `active.json` entries, and orphaned worktrees.
5. For each target, spawn a `claude -p` child process with canonical flags:
   - `--model opus` by default
   - `--output-format stream-json --verbose`
   - `--permission-mode bypassPermissions`
   - Process detached, env restricted to a safe allowlist, writes to `.claude/dispatch/<session-id>.jsonl`.
6. Append worker to `.claude/dispatch/active.json`.
7. Emit `dispatch_spawned` tracking event so awareness and analyze can see dispatch activity.
8. Return immediately. Workers run in background.
9. Monitor watches `.claude/dispatch/*.jsonl` and surfaces events.

## Running the skill

After the user's request, invoke the module and start the Monitor:

```bash
node .claude/hooks/lib/dispatch.cjs <parsed-args>
```

Then start the watcher via the Monitor tool, persistent, session-long:

```
Monitor({
  description: "Dispatch worker events",
  persistent: true,
  command: "node .claude/hooks/lifecycle/watch-workers.cjs"
})
```

The watcher polls `.claude/dispatch/*.jsonl` every 2 seconds and picks up new workers as they spawn. Early versions tailed a glob that expanded once. This one handles the ordering: watcher starts, dispatch fires after, watcher sees the new files on the next poll.

Monitor output is filtered by default. The watcher streams only actionable lines: worker done (`[sid] done status=...`), PR URLs, and the idle/crashed lifecycle lines. Per-tool `tool_use` and `tool_error` events are suppressed, because at 3-5 parallel workers their volume floods the Monitor tool's output-rate cap, which auto-stops the watcher and leaves workers unmonitored (#634). Plan-only dispatch makes this worse, since every sensitive-file write emits a `tool_error`. Set `DISPATCH_VERBOSE=1` in the orchestrator's environment before `/dispatch` to restore full per-event streaming for debugging.

The watcher also fires OS desktop notifications on three lifecycle events: graceful worker exit, worker idle > 5 minutes, and worker crash. See the Notifications section below.

When the user asks for status `/dispatch --list` or results `/dispatch --synthesize`, re-invoke the module with those flags.

## Auto-detect plan-only mode

`dispatch.cjs` runs a per-target check before spawning each worker. If an issue's title or body mentions any of `.claude/{hooks,skills,specs,docs,commands,agents,research}/`, Claude Code's built-in gate will refuse Write/Edit in the worker's non-interactive session. The check auto-applies `--plan-only` for that target so the worker stops after `/ideate` and posts its plan as a comment instead of crashing on the first sensitive-path Write.

The auto-apply is logged at dispatch time:

```
Auto-applied --plan-only to 1 target(s) (use --no-auto-plan-only to disable):
  - issue #374 references .claude/research/, .claude/hooks/; ...
```

When you genuinely need a worker to run the full workflow on an issue that references a sensitive path in context but does not actually edit one, pass `--no-auto-plan-only` to disable the heuristic for the entire dispatch.

Heuristic limits:

- Issues that don't name a path but still touch `.claude/` are not detected. The worker will fail on the first Write; the kit recovers by surfacing the plan as a comment, but burns more quota than upfront detection would have.
- Issues that mention a sensitive path in passing trigger a false positive: that target produces a plan comment, the orchestrator applies it manually.

See `.claude/specs/kit/dispatch.md` Plan-Only Mode for the full list of gated subtrees and audit history.

## Notifications

Workers fire OS desktop notifications at three points in their lifecycle:

1. Graceful exit (success, plan_complete, error). Fired by the watcher when it sees a `result` event in the worker's `.jsonl`.
2. Idle > 5 minutes. Fired by the watcher when the worker has stopped emitting events.
3. Crash. Fired by the watcher when the worker's PID dies before emitting a `result` event.

Notifications go through `osascript -e 'display notification ...'`, so they appear as desktop banners only. Phone routing via Remote Control is not wired up; tracked separately as a follow-up issue.

### Silence them

Set `DISPATCH_NO_NOTIFY=1` in your shell before running `/dispatch`. The flag silences both the watcher's notification calls and any future worker-side notification path.

### Examples

- `dispatch 6445d2b8: done success` — worker finished cleanly
- `dispatch 6445d2b8: done error_during_execution` — worker errored out
- `dispatch 6445d2b8: idle>5m on Bash` — worker has not moved in 5 min
- `dispatch 6445d2b8: crashed (pid 12345 gone)` — worker process died

### macOS permission

osascript posts under `Script Editor` on stock macOS. If banners do not appear, open System Settings, then Notifications, find `Script Editor`, enable `Allow Notifications`, and set Alert Style to `Banners` or `Alerts`. See `.claude/specs/kit/dispatch.md` Notifications section for the full event taxonomy and architecture rationale.

## Synthesizing results

When workers complete, the watcher emits `[SESSION] done status=...`. Run:

```bash
node .claude/hooks/lib/dispatch.cjs --synthesize
```

The module reads each active worker's output file using a read-from-end optimization, extracts the structured JSON result, caches a parsed copy to `<session-id>.result.json`, aggregates costs, and prints a formatted report. Relay that report to the user.

## Decisions the user should see

Each worker's result includes `decisions_needing_review`, the judgment calls the worker made that Luis might want to revisit. Always surface these prominently in your response.

## Costs

Workers run on Max auth by default. Cost is weekly-quota consumption, not dollar-billing. Each worker typically costs $2-5 in quota-equivalent for a medium issue. Parallel dispatch of 5 workers at once is $15-25 quota. Not a money concern on Max, a time-quota concern.

If `ANTHROPIC_API_KEY` is set, the warning fires and dollars DO apply. User chooses whether to proceed.

## Failure modes

- **Worker crashes mid-run.** Its output file still exists. `--synthesize` parses what's there and reports partial status.
- **`claude` CLI not found.** `dispatch.cjs` logs to `.claude/dispatch/spawn-errors.log` and auto-removes the worker from `active.json`.
- **Hook block in worker.** Worker handles it. Reads the required spec, retries the tool call. The `tool_use`/`tool_error` events this generates are suppressed from Monitor output by default (#634); set `DISPATCH_VERBOSE=1` to see them.
- **Session disconnects.** Workers keep running as detached processes. Next session's `--list` shows them. Resume via `claude --resume <session-id>`.
- **PID recycled after worker exited.** `--kill` runs an identity check and removes the entry from the registry without signaling if the PID is no longer a claude process.

## NEVER

- NEVER dispatch more than 5 workers at once without `--max` override and a good reason
- NEVER dispatch when `ANTHROPIC_API_KEY` is set unless the user explicitly accepts the cost warning
- NEVER use `/dispatch` for interactive work where you need live collaboration; workers are one-shot
- NEVER invoke `dispatch.cjs` directly in a way that bypasses the skill's output-shaping; always relay results through your own synthesis

## Related

- `.claude/specs/kit/dispatch.md` — schema, failure modes, invariants
- `.claude/hooks/lib/dispatch.cjs` — the module, source of truth for behavior
- `.claude/hooks/lib/project-root.cjs` — shared project-root resolution
- `.claude/hooks/lifecycle/watch-workers.cjs` — Monitor-compatible watcher
- `.claude/hooks/lifecycle/watch-ship.cjs` — precedent pattern for Monitor watchers
