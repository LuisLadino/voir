---
name: dispatch
description: >
  How the /dispatch skill spawns independent Claude Code worker sessions.
  Required reading before editing dispatch.cjs, watch-workers.sh, or the
  dispatch SKILL.md. Covers storage layout, invocation flags, worker prompt
  schema, result schema, auth handling, failure modes, and invariants.
applies_to:
  - ".claude/hooks/lib/dispatch.cjs"
  - ".claude/hooks/lifecycle/watch-workers.sh"
  - ".claude/skills/dispatch/SKILL.md"
category: kit
related: [hooks, tracking-persistence, self-documentation]
---

# Dispatch

How the kit delegates work to independent Claude Code worker sessions.

## The Model

`/dispatch` spawns separate OS processes running `claude -p`. Each is a full independent session with its own context window, tracking, and lifecycle. Workers survive this session dying and are resumable via `claude --resume <session-id>`.

This is not Agent Teams. Not subagents. Not Anthropic's "Dispatch" product. Three distinct orchestration models exist in the ecosystem; this skill uses the `claude -p` model.

## Storage Layout

Per-project directory at `.claude/dispatch/`:

```
.claude/dispatch/
  active.json                        project-owned registry of active workers
  <session-id>.jsonl                 stream-json output from claude -p
  <session-id>.result.json           parsed final result (written on synthesize)
```

`active.json` schema:
```json
{
  "workers": [
    {
      "sessionId": "abc123def456",
      "pid": 12345,
      "target": { "type": "issue", "value": "42" },
      "model": "opus",
      "repo": "owner/name",
      "startedAt": "2026-04-20T23:00:00.000Z",
      "outputFile": "/abs/path/to/abc123def456.jsonl"
    }
  ]
}
```

The dispatch directory is auto-created by `dispatch.cjs` on first worker spawn (`fs.mkdirSync({ recursive: true })`). No sync-kit setup required. The directory is project-owned and never synced back to the kit.

## Invocation

```
/dispatch [FLAGS] TARGET...
```

**Targets.** Positional args. Numeric maps to GitHub issue number. String maps to ad-hoc task description.

**Flags:**
- `--repo OWNER/REPO`: cross-repo dispatch. Validated against `^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$`. Looks up a local clone under `~/Repositories/{Personal,Work}/<name>`.
- `--repo-path PATH`: explicit absolute path for cross-repo workers. Wins over `--repo` path resolution.
- `--model MODEL`: opus is default. sonnet and haiku supported.
- `--max N`: max concurrent workers. Default 5, hard ceiling 16.
- `--no-track`: ad-hoc mode only. Do not auto-create tracking issue.
- `--dry-run`: show what would fire without spawning workers. Use to sanity-check args.
- `--plan-only`: stop worker after `/ideate`. Worker does research, define, ideate, posts a full implementation plan as an issue comment, emits `status: "plan_complete"`. Use for issues touching `.claude/hooks/*.cjs` or other sensitive-file paths Claude Code's built-in gate will refuse to Write/Edit in non-interactive sessions.
- `--list`: show active workers table.
- `--kill SESSION`: stop a specific worker. Includes PID identity check to prevent hitting a recycled PID.
- `--synthesize`: read completed workers and print report. Caches parsed result to `<session-id>.result.json`.
- `--cleanup`: remove stale output files older than 7 days.

## Worker Prompt Schema

Every worker receives a prompt with these sections:

1. **Target clause.** Issue number plus repo, or ad-hoc task description.
2. **Workflow clause.** Explicit ordering: `/research`, `/define`, `/ideate`, `/build`, `/test`, `/review`, `/commit`.
3. **Autonomy clause.** Worker has autonomy on standard dev decisions. Must flag taste calls, scope expansion, and ambiguity under `decisions_needing_review`.
4. **Output schema clause.** Worker must emit a single JSON object at the end matching the result schema.
5. **Subagent clause.** Worker may use the Agent tool for internal parallel work, for example review spawns or research threads.

For ad-hoc targets with `track: true` (default), prompt includes a pre-step to create a GitHub issue before proceeding through the workflow.

## Result Schema

Worker's final JSON, parsed by `parseWorkerResult` from the `type: "result"` event:

```json
{
  "status": "completed",
  "pr_url": "URL if PR created",
  "summary": "what changed",
  "blockers": ["list if status is not completed"],
  "decisions_needing_review": ["judgment calls Luis might want to revisit"]
}
```

The worker typically wraps the JSON in a fenced code block inside the `result.result` string. The parser extracts it either way.

## Canonical `claude -p` Flags

Every worker is spawned with:

```
claude -p <prompt> \
  --worktree dispatch-<sessionId> \
  --model MODEL \
  --output-format stream-json \
  --verbose \
  --permission-mode bypassPermissions
```

`bypassPermissions` is required for non-interactive sessions. It does NOT bypass hook enforcement. `enforce-specs`, `enforce-voice`, and others still fire. Worker reads spec error messages and retries.

`--worktree dispatch-<sessionId>` gives each worker its own isolated git worktree at `<repo>/.claude/worktrees/dispatch-<sessionId>/` with branch `worktree-dispatch-<sessionId>`. Claude Code's native worktree support handles creation, base (from `origin/HEAD`), and cleanup. This is the isolation guarantee that makes parallel dispatch safe: workers do not share a working tree, cannot race on `git checkout`, and cannot commit each other's files.

## Parallel Dispatch Safety

Every worker runs in its own worktree. Invariants:

- Worker cwd is `<repo>/.claude/worktrees/dispatch-<sessionId>/`, not the orchestrator's cwd
- Worker branches from `origin/HEAD` (typically `main`), not from whatever branch the orchestrator is on
- Worker's `/build` creates a feature branch inside its worktree. That branch is visible to all worktrees in the repo, same `.git` dir, but the files on disk are isolated
- Cleanup: if the worker makes no changes the worktree auto-removes; if it commits and pushes, the worktree remains for post-hoc inspection and is swept by Claude Code's orphan cleanup after `cleanupPeriodDays`
- Worktree names are `dispatch-<sessionId>` where sessionId is 12-char hex from `crypto.randomBytes(6)`. Collision probability is negligible.
- `.gitignore` must include `.claude/worktrees/` so worktree contents do not appear as untracked files in the main repo

For non-git VCS such as SVN, Mercurial, or Perforce, configure `WorktreeCreate` and `WorktreeRemove` hooks per Claude Code docs. Kit does not ship these by default.

## Plan-Only Mode

Claude Code's built-in sensitive-file protection applies to Write and Edit tools targeting `.claude/hooks/**/*.cjs` and `~/.claude/settings[.local].json`. `bypassPermissions` does not override that protection. Dispatched workers that try to edit these files are refused without an approval path, which blocks any hook-editing issue from normal dispatch.

`--plan-only` is the workaround. When the flag is set:

- Worker prompt is rewritten to stop after `/ideate`. `/build`, `/test`, `/review`, `/commit` are explicitly forbidden.
- Worker posts its full implementation plan (file contents for new modules, exact diffs, migration tables, tests to add, spec updates) as a comment on the referenced issue via `gh issue comment`.
- Worker emits result with `status: "plan_complete"`, `pr_url: ""`, and a summary describing the plan.
- Orchestrator's synthesize recognizes `plan_complete`, posts a completion comment prefixed "Dispatch Worker: Plan Delivered", cleans up the worktree, and caches the result.
- Orchestrator applies the plan in a follow-up session with human approval.

Use `--plan-only` for any issue whose Definition of Done requires editing `.claude/hooks/*.cjs` or the user-scope settings file. Non-plan-only dispatch on those issues will burn worker quota trying to Write and failing before surfacing the plan anyway; this flag short-circuits the failure path and preserves all the research / define / ideate work.

When the sensitive-file constraint is removed at the Claude Code level (feature flag, env var, or new approval mode), this mode becomes redundant and the flag can be deprecated.

## Auth Handling

Pre-flight detection:
- `ANTHROPIC_API_KEY` in env returns `api-key`, warns before firing
- Otherwise returns `oauth`, assumes Max auth, the common case

Warning text when `api-key` is detected:
```
WARNING: ANTHROPIC_API_KEY is set. Workers will bill to your API key, not Max.
To use Max auth, unset ANTHROPIC_API_KEY and ensure `claude login` is active.
```

User can proceed despite warning. The skill does not auto-abort.

## Concurrency

Default max is 5. Hard ceiling is 16. Dispatching more targets than `--max` returns an error:
```
Target count (N) exceeds --max (M).
Raise --max or dispatch in smaller batches.
```

The tunable default lives at `DEFAULT_MAX_CONCURRENT` in `dispatch.cjs`. Override via CLI `--max` or future `stack-config.yaml.dispatch.max_concurrent`.

## TTL and Cleanup

Output files older than 7 days are removed on `--cleanup` or at the start of every dispatch invocation. `active.json` is not touched by cleanup.

## Failure Modes to Watch For

**Worker crashes mid-run.** The output file still exists. `--synthesize` parses whatever is there and reports partial status. `active.json` still lists the worker until `--kill` or manual cleanup.

**`claude` CLI not found.** `child_process.spawn` throws ENOENT. Error surfaces to stderr. Skill should catch and report.

**Hook block in worker.** Kit hooks still fire despite `bypassPermissions`. Worker reads error stderr, reads the required spec, retries the tool call. Surfaced as `tool_use` plus `tool error` events in watcher output.

**Watcher misses events.** The filter in `watch-workers.sh` may miss new event types Claude Code adds. If users report missing progress events, widen the awk patterns.

**Permission denial logged as "permission_denial" but is actually a hook block.** Claude Code logs both in the same field. Not a bug; worth knowing when debugging.

**Session disconnects.** Workers are detached. They keep running. On next session, `/dispatch --list` shows them. Results can still be synthesized.

**`active.json` corruption.** `readActive` tolerates parse errors and returns empty. Workers may be forgotten. Recovery: grep `ps` for `claude -p` processes, rebuild `active.json` manually.

**Multiple dispatch sessions racing.** If two orchestrator sessions run `/dispatch` simultaneously, their writes to `active.json` may race. Low probability. Not fixed in the current implementation.

## Invariants

- Worker spawn uses `claude -p` with `--permission-mode bypassPermissions`. Never a raw interactive session.
- Workers are always `detached: true` and `unref()`-ed so the orchestrator doesn't block on them.
- `active.json` writes go through `writeActive` which always ensures the dispatch dir exists.
- Session IDs are 12-char hex from `crypto.randomBytes(6)`. Collision probability is negligible.
- Hook enforcement in workers is intact. Verified by PR #47 on heading-site: worker hit an `enforce-specs` block, read the specs, retried, shipped.

## Extension Points

Adding a new target type, for example PR number or milestone:
1. Add detection in `parseArgs` to distinguish from `issue` and `adhoc`
2. Add target-specific clause in `buildPrompt`
3. Update spec, skill, and tests

Adding a new flag:
1. Add arg handling in `parseArgs`
2. Validate in the switch
3. Thread through to `spawnWorker` or `buildPrompt` as needed
4. Document in spec and skill

Swapping file-tail for Channels when or if that primitive matures:
1. Replace `watch-workers.sh` implementation with a Channels subscriber
2. Keep the module API unchanged
3. `dispatch.cjs` continues to write output files even if Channels is primary, as a dual-write safety net during migration
