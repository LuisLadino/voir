---
name: dispatch
description: "Fire parallel autonomous workers on GitHub issues. Each worker gets its own git worktree, runs the full kit workflow (research → build → commit → PR), and reports back on your next prompt. Use when you have 1+ independent issues and want to keep working while they run. Trigger on 'dispatch', 'delegate', 'work these in parallel', 'run autonomously', 'hand off', or when multiple independent issues are open and ready. Each worker is a full Claude Code session with the kit's hooks, specs, and skills inherited."
argument-hint: [issue-numbers...] or "task description" [--repo O/R] [--repo-path PATH] [--model M] [--max N] [--no-track] [--dry-run] [--list] [--kill ID] [--synthesize] [--cleanup]
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
- `/dispatch --plan-only 42` — worker stops after ideate; plan posted as issue comment. Use for issues touching `.claude/hooks/*.cjs` or user-scope settings, which Claude Code's built-in gate blocks non-interactively.
- `/dispatch 42 --repo LuisLadino/voir` — cross-repo; auto-resolves local clone
- `/dispatch 42 --repo LuisLadino/voir --repo-path /abs/path` — explicit cross-repo path
- `/dispatch 42 --model sonnet` — use Sonnet for cost control
- `/dispatch 42 43 --max 2` — cap concurrency below default
- `/dispatch --list` — show active workers
- `/dispatch --kill abc123ef4567` — stop a specific worker
- `/dispatch --synthesize` — read completed workers' results and report
- `/dispatch --cleanup` — remove old output files

## What happens when you dispatch

1. `dispatch.cjs` parses args and validates them. `--repo` must match `owner/name` regex.
2. Auth pre-flight warns if `ANTHROPIC_API_KEY` is set. Max users should unset it.
3. Worker cwd is resolved. Without `--repo` or `--repo-path`, worker inherits the orchestrator's project root. With `--repo`, the script looks for a local clone under `~/Repositories/{Personal,Work}/<name>`. With `--repo-path`, that absolute path is used.
4. Opportunistic cleanup of files older than 7 days.
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
  command: "bash .claude/hooks/lifecycle/watch-workers.sh"
})
```

The watcher polls `.claude/dispatch/*.jsonl` every 2 seconds and picks up new workers as they spawn. Early versions tailed a glob that expanded once. This one handles the ordering: watcher starts, dispatch fires after, watcher sees the new files on the next poll.

When the user asks for status `/dispatch --list` or results `/dispatch --synthesize`, re-invoke the module with those flags.

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
- **Hook block in worker.** Worker handles it. Reads the required spec, retries the tool call. Surfaced in watcher output as `tool_use` events.
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
- `.claude/hooks/lifecycle/watch-workers.sh` — Monitor-compatible watcher
- `.claude/hooks/lifecycle/watch-ship.sh` — precedent pattern for Monitor watchers
