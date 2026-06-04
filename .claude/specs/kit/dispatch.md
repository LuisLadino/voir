---
name: dispatch
description: >
  How the /dispatch skill spawns independent Claude Code worker sessions.
  Required reading before editing dispatch.cjs, watch-workers.cjs, or the
  dispatch SKILL.md. Covers storage layout, invocation flags, worker prompt
  schema, result schema, auth handling, failure modes, and invariants.
applies_to:
  - ".claude/hooks/lib/dispatch.cjs"
  - ".claude/hooks/lib/dispatch-registry.cjs"
  - ".claude/hooks/lifecycle/watch-workers.cjs"
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

### Pruning lifecycle

`active.json` entries are removed by four mechanisms. Together they guarantee the registry tracks running workers, not historical workers.

| Trigger | Effect |
|---------|--------|
| `--kill SESSION` | Explicit removal of a single entry after SIGTERM and identity check |
| `--synthesize` | After result extraction and worktree cleanup, drops entries whose terminal result has been cached |
| `--list`, `--cleanup`, every `dispatch` invocation | Sweeps entries that fail liveness rules |
| `spawn 'error'` ENOENT | Removes a just-added entry when the `claude` CLI is missing |

The sweep applies a four-rule prune decision per entry:

| Rule | Condition | Outcome |
|------|-----------|---------|
| R1 | `outputFile` does not exist | Prune, `output_file_missing` |
| R2 | `startedAt` older than `DEFAULT_TTL_DAYS`, 7d | Prune, `older_than_ttl` |
| R3 | PID dead or recycled AND `type:"result"` event present AND `<sid>.result.json` cached | Prune, `synthesized_terminal` |
| R4 | PID dead or recycled AND no `result` event AND past `DEFAULT_GRACE_PERIOD_MS`, 60s, from `startedAt` | Prune, `crashed_abandoned` |

Soft keeps. Entry retained:

- PID alive AND running a `claude` process: `live`
- PID dead AND `result` event present AND no `.result.json` cached: `awaiting_synthesize`. Gives the operator a chance to run `--synthesize` later. Eventually R2 catches it.
- PID dead AND no `result` event AND within `DEFAULT_GRACE_PERIOD_MS` of `startedAt`: `within_grace_period`. Spawn race window.

PID liveness uses `pidIsClaudeWorker`, not bare `pidAlive`. A recycled PID, meaning the claude process is gone and an unrelated process inherited the PID, is treated as dead. This prevents stale entries from being pinned by PID reuse.

The sweep runs as a best-effort wrapper, `try { pruneActive(projectRoot); } catch {}`, at every call site. A failure in pruning never blocks the calling command.

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
- `--plan-only`: stop worker after `/ideate`. Worker does research, define, ideate, posts a full implementation plan as an issue comment, emits `status: "plan_complete"`. Auto-applied per-target when an issue body references a CC-gated `.claude/` subtree (see Plan-Only Mode section). Use the explicit flag to force plan-only on every target regardless of detection.
- `--no-auto-plan-only`: disable the per-target auto-apply heuristic. Workers run as if the global `--plan-only` were not set; targets that hit CC's gate will fail their `/build` write step.
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
  --model MODEL \
  --output-format stream-json \
  --verbose \
  --permission-mode bypassPermissions
```

`bypassPermissions` is required for non-interactive sessions. It does NOT bypass hook enforcement. `enforce-specs`, `enforce-voice`, and others still fire. Worker reads spec error messages and retries.

`dispatch.cjs` owns worktree creation. Each worker runs in its own isolated git worktree at `<repo>/.claude/worktrees/dispatch-<sessionId>/` on branch `dispatch-<sessionId>`. The branch bases off `origin/HEAD` (falls back to `origin/main`, `origin/master`, `HEAD`). The spawn step sets the worker's `cwd` to the worktree path.

CC's native `--worktree` flag was used previously and dropped per #463. The native flag created the worktree inside the worker process, leaving no insertion point for kit-side setup. Dispatch now runs `git worktree add` itself before spawn, then propagates untracked project context into the worktree, then spawns `claude -p` with `cwd` set to the new worktree path.

## Worktree Context Propagation

`git worktree add` checks out tracked files only. In client-mode repos `.claude/` is untracked (via `.git/info/exclude`), so a freshly created worktree has no kit hooks, skills, or specs. `.vercel/` and `.env.local` are gitignored in every repo, so a worker running `vercel` in an unlinked worktree creates a junk throwaway Vercel project and deploys real work into it.

After `git worktree add`, `dispatch.cjs` copies untracked project context from the source checkout into the worktree:

- **Kit defaults** are platform-neutral: `KIT_DEFAULT_CONTEXT_DIRS = ['.claude']`, `KIT_DEFAULT_CONTEXT_FILES = []`. The kit ships no platform-specific defaults.
- **Project additions** come from `.claude/specs/stack-config.yaml`:

```yaml
dispatch:
  context_dirs:
    - .vercel
  context_files:
    - .env.local
```

`readDispatchConfig` reads that block and merges its lists with the kit defaults. Projects opt in to whatever propagation their workflow needs. A pure Anthropic-API project declares nothing. A Vercel-deployed project declares `.vercel/` (and optionally `.env.local`). A future Netlify project declares `.netlify/`. The kit-synced code stays platform-neutral.

**Validation of project items:**

- Single path segment only (no `sub/dir`)
- No path traversal (no `..`)
- No absolute paths (no leading `/`)
- No null bytes

Items that fail validation are silently dropped from the propagation list. This prevents stack-config from being an arbitrary-file-copy primitive.

**`.claude/` copy is a non-clobber overlay.** When the worktree already has a tracked `.claude/` (non-client repo), the copy uses `cpSync({ force: false })` so committed files are preserved; only gitignored extras (e.g. `settings.local.json`) come along. In client-mode repos where `.claude/` is fully untracked, the copy provisions the whole tree.

**Recursion guards.** `.claude/worktrees/` is skipped because the worktree lives inside it (infinite recursion). `.claude/dispatch/` is skipped because it holds worker stream-JSON output that can reach 100MB. The skip list is `CLAUDE_COPY_EXCLUDE`.

## See Also: Session Worktrees

The same propagation primitives, `propagateUntrackedContext`, `readDispatchConfig`, `resolveBaseRef`, back the interactive worktree helper at `.claude/scripts/worktree.cjs`. See `session-isolation.md` for the user-facing equivalent of dispatch's worker isolation.

## Parallel Dispatch Safety

Every worker runs in its own worktree. Invariants:

- Worker cwd is `<repo>/.claude/worktrees/dispatch-<sessionId>/`, not the orchestrator's cwd
- Worker branches from `origin/HEAD` (typically `main`), not from whatever branch the orchestrator is on
- Worker's `/build` creates a feature branch inside its worktree. That branch is visible to all worktrees in the repo, same `.git` dir, but the files on disk are isolated
- Cleanup: `cmdSynthesize` removes worktrees for `completed` and `plan_complete` workers via `git worktree remove --force` and drops the dispatch branch. Worker records carry `worktreePath` and `branch` so cross-repo cleanup hits the right clone, not just `projectRoot`. Worktrees the registry no longer tracks, killed, crashed, blocked, or TTL-pruned workers plus pre-#463 worktrees, are removed by the `cleanupOrphanWorktrees` sweep. See Worktree Cleanup.
- Worktree names are `dispatch-<sessionId>` where sessionId is 12-char hex from `crypto.randomBytes(6)`. Collision probability is negligible.
- `.gitignore` must include `.claude/worktrees/` so worktree contents do not appear as untracked files in the main repo
- Deploy is out of scope for workers. The prompt forbids `vercel`, `netlify`, and any other deploy command. Even if a worker tries, `.vercel/` propagation (when projects opt in) means it lands in the real project, not a junk one. A hard PreToolUse block is tracked in #472.

For non-git VCS such as SVN, Mercurial, or Perforce, dispatch's worktree mechanism does not apply. Such projects would need a different isolation primitive.

## Plan-Only Mode

Claude Code's built-in sensitive-file protection applies to Write and Edit tools targeting paths under `.claude/`. The kit's own `block-sensitive-bash-writes` hook protects only `.claude/hooks/**/*.{cjs,js,sh,mjs}` and `settings[.local].json` (see `sensitive-file-protection.md`), but Claude Code's built-in Write/Edit gate is broader. `bypassPermissions` does not override that protection. Dispatched workers that try to edit these paths are refused without an approval path.

### Empirical scope

CC's built-in gate refuses non-interactive Write/Edit on these subtrees:

- `.claude/hooks/**/*.cjs` — refused (kit-protected and CC-protected)
- `.claude/skills/**/*.md` — refused by CC's gate. Worker #222 hit on `review/SKILL.md`.
- `.claude/specs/**/*.md` — refused by CC's gate. Worker #266 hit on `mcp-configuration.md`.
- `.claude/docs/**/*.md` — refused by CC's gate. Workers #260, #267 hit on install runbook and decision doc.
- `.claude/commands/**` — refused by CC's gate. Assumed in #274 audit, not exercised at audit time.
- `.claude/agents/**` — refused by CC's gate. Assumed in #274 audit, not exercised at audit time.
- `.claude/research/**` — refused by CC's gate. Workers #353, #355, #356, #359, #361 hit on 2026-04-27.

Sources: #274 audit (2026-04-24) for hooks/skills/specs/docs/commands/agents; #374 (2026-04-27 batch, 5 of 9 workers blocked) for research.

### How `--plan-only` behaves

When the flag is set:

- Worker prompt is rewritten to stop after `/ideate`. `/build`, `/test`, `/review`, `/commit` are explicitly forbidden.
- Worker posts its full implementation plan (file contents for new modules, exact diffs, migration tables, tests to add, spec updates) as a comment on the referenced issue via `gh issue comment`.
- Worker emits result with `status: "plan_complete"`, `pr_url: ""`, and a summary describing the plan.
- Orchestrator's synthesize recognizes `plan_complete`, posts a completion comment prefixed "Dispatch Worker: Plan Delivered", cleans up the worktree, and caches the result.
- Orchestrator applies the plan in a follow-up session with human approval.

Use `--plan-only` for any issue whose Definition of Done requires editing files in the empirical-scope subtrees above. Non-plan-only dispatch on those issues will burn worker quota trying to Write and failing before surfacing the plan anyway; this flag short-circuits the failure path and preserves all the research / define / ideate work.

### Per-target auto-detect (#374)

`dispatch.cjs` runs `checkAutoPlanOnly` per issue target before spawning. The check fetches the issue's title and body via `gh issue view --json title,body`, scans for any reference to `.claude/<sensitive-dir>/` where `<sensitive-dir>` is one of `hooks|skills|specs|docs|commands|agents|research`, and auto-applies `--plan-only` for that target if any reference is found.

The auto-apply is logged at dispatch time with a reason naming the matched dirs:

```
Auto-applied --plan-only to 1 target(s) (use --no-auto-plan-only to disable):
  - issue #374 references .claude/research/, .claude/hooks/; CC's built-in gate refuses non-interactive writes there
```

The check is opt-out via the `--no-auto-plan-only` flag for cases where the issue mentions a sensitive path in context but the actual fix is elsewhere. Auto-detect is also skipped when `--plan-only` is already set globally and for ad-hoc targets (no body to scan).

Heuristic limitations:

- An issue that does not name a sensitive path explicitly but whose fix touches one will not auto-apply. The user must add `--plan-only` manually, or the worker will hit the gate and fail.
- An issue that names a sensitive path in passing triggers a false positive. Cost: that target produces a plan comment instead of a PR. Orchestrator applies it.

### Deprecation path

When the sensitive-file constraint is removed at the Claude Code level (feature flag, env var, or new approval mode), this mode becomes redundant and the flag can be deprecated. The auto-detect helper would be removed alongside it.

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

## Pre-Spawn Skip Signals

`checkExistingPlan` runs before `spawnWorker` for every issue target and skips dispatch when any of these signals fire (case-insensitive). `--force` overrides all of them.

1. **Issue state non-OPEN.** `gh issue view --json state` returns CLOSED, MERGED, or anything but OPEN.
2. **Prior plan comment.** Comment body contains `**Status:** plan_complete` (orchestrator's auto-posted marker) or `Posted (full )?implementation plan` (worker prose).
3. **Merged fix PR.** A merged PR's body contains `(addresses|closes|fixes|resolves) #NUM` with word boundary on `#NUM`. Catches the kit-convention case where a fix shipped via "Addresses #N" without auto-closing the issue (#293).

Origins:
- Signals 1-2 from #280 (PR #289). Cases: #228 dispatched twice, #251 sat 2 days post-ship, #246 had a stale plan from prior batch.
- Signal 3 from #293. Case: two workers ran on #263 after PR #285 (`Addresses #263`) had merged.

The merged-fix-PR signal applies a fix-verb regex on PR bodies, not on raw text. Naive `#NUM in:body` over-matches. Example: PR #311 with "Related to #263" should not block dispatch. The verb filter reduces false positives to zero in observed history while keeping the lookup to a single `gh pr list` call.

## Concurrency

Default max is 5. Hard ceiling is 16. Dispatching more targets than `--max` returns an error:
```
Target count (N) exceeds --max (M).
Raise --max or dispatch in smaller batches.
```

The tunable default lives at `DEFAULT_MAX_CONCURRENT` in `dispatch.cjs`. Override via CLI `--max` or future `stack-config.yaml.dispatch.max_concurrent`.

## TTL and Cleanup

`--cleanup` runs three sweeps unconditionally. A dispatch invocation runs `pruneActive` every time; the file-removal and orphan-worktree sweeps are gated by a `.last-cleanup` marker.

1. `.jsonl` and `.result.json` files older than `DEFAULT_TTL_DAYS`, 7 days, are deleted from `.claude/dispatch/`.
2. `active.json` entries are passed through `pruneActive`. See Storage Layout, Pruning lifecycle for the rule table. The same call runs at `--list`, `--synthesize`, and `--cleanup`.
3. Orphaned dispatch worktrees are removed by `cleanupOrphanWorktrees`. See Worktree Cleanup below.

Sweeps 1 and 2 decay on the same 7-day TTL. Output files are bulk data, 10 to 100MB per worker; `active.json` is the registry. The entry-level rules in `pruneActive` also catch crashed and synthesized workers ahead of the TTL.

`active.json` also self-bounds on the write path. `addActiveWorker` calls `pruneTerminalWorkers` before pushing a new entry, dropping any worker whose pid is dead AND whose `.result.json` cache exists. Crashed-but-not-synthesized workers stay in the registry for post-hoc inspection.

### Hot-path cleanup gate

`cmdDispatch` runs `cmdCleanup` opportunistically before spawning workers. Without a gate, every dispatch invocation pays for a `readdirSync` + `statSync` loop over `.claude/dispatch/` plus the orphan-worktree sweep. The gate is `.claude/dispatch/.last-cleanup`. `shouldRunCleanup` returns true when the marker is missing or older than `CLEANUP_GATE_MS`, 24 hours. `cmdCleanup` rewrites the marker on completion, so explicit `/dispatch --cleanup` always resets the gate. `pruneActive` is never gated; only the file removal and orphan-worktree sweeps are.

## Worktree Cleanup

A dispatch worktree is removed by one of two paths.

**Tracked cleanup, `cmdSynthesize`.** After result extraction, workers whose status is `completed` or `plan_complete` get `git worktree remove --force` plus `git branch -D` on the `dispatch-<sid>` branch. This is the happy path: a worker finished, its work is on a pushed PR branch, or for plan-only there is no work, so the worktree is disposable.

**Orphan sweep, `cleanupOrphanWorktrees`.** Runs inside `cmdCleanup`, so it fires on `--cleanup` and on every dispatch invocation. It removes any `.claude/worktrees/dispatch-*` worktree that no `active.json` entry references.

The two paths divide cleanly. `cmdSynthesize` plus the `active.json` registry own *tracked* worktrees: a worktree with a live entry, or a dead entry still awaiting `--synthesize`, is left alone. The orphan sweep is the safety net for worktrees the registry no longer references at all:

- Workers killed via `--kill`. `cmdKill` drops the registry entry but does not remove the worktree.
- Workers whose entry `pruneActive` dropped, crashed (R4, 60s past `startedAt`) or 7-day TTL (R2), before `--synthesize` ran. `cmdSynthesize` only cleans `completed` and `plan_complete` workers, so a `blocked` or `error` worker's worktree always falls to this sweep.
- Pre-#463 worktrees created by Claude Code's native `--worktree` flag, which were never in this registry. Their branches use the `worktree-dispatch-<sid>` naming; the sweep reads the actual branch from `git worktree list --porcelain`, so it deletes the right ref regardless of naming era.

Force-removal is safe by construction. A worktree reaches the orphan sweep only after its registry entry is gone, which means the worker was killed, crashed over a minute ago, or is 7+ days stale, never a live or recently-active worker. The `dispatch-<sid>` branch is the worktree's throwaway base branch; workers commit on feature branches that `/build` creates, so `git branch -D` never deletes a PR branch.

The sweep skips two things. The caller's own checkout: if `/dispatch` is ever run from inside a worktree, that worktree is not removed out from under the running process. And worktrees younger than `ORPHAN_WORKTREE_MIN_AGE_MS`, 5 minutes: this closes the cross-session spawn race, where a concurrent dispatch has created a worktree but not yet written its `active.json` entry. A genuine orphan is always older than the floor by the time its entry is pruned, so the floor never blocks real cleanup, it only defers a too-fresh worktree to the next sweep.

`cleanupOrphanWorktrees` is best-effort. A git failure on one worktree is recorded in the returned `failed` list and never blocks the rest of the sweep or the calling command. `cmdCleanup` prints both the removed and the failed worktrees.

## Monitor stream

`watch-workers.cjs` writes one stdout line per surfaced event; the Monitor tool turns each line into a notification. Monitor auto-stops any watcher that exceeds its output-rate cap, so the watcher streams only actionable events and suppresses high-volume per-tool ones.

Streamed by default:

- `[<sid>] done status=<subtype> cost=$<n>` — `result` event, the worker's terminal line.
- `[<sid>] PR: <url>` — `pr_url` event.
- `[<label>] idle>5m on <tool>` and `[<label>] crashed` — lifecycle lines from `lifecycleScan`.

Suppressed by default:

- `tool_use` and `tool_error` events. At 3-5 parallel workers, the concurrency the skill documents as supported, the per-tool event rate alone floods the cap and the watcher auto-stops, leaving workers unmonitored. Plan-only dispatch compounds it: every sensitive-file write the built-in gate refuses emits a `tool_error`, so three plan-only workers generate a continuous error stream. These events are still parsed; the `tool_use` branch resets the idle marker. They just do not reach stdout.

`DISPATCH_VERBOSE=1` in the orchestrator's environment restores full per-event streaming for debugging. The decision is the pure `shouldStreamEvent(kind, verbose)` in `watch-workers.cjs`, covered in `watch-workers.test.cjs`. See #634.

## Notifications

Three lifecycle events fire OS desktop notifications via `osascript -e 'display notification ...'`. All three are emitted by `watch-workers.cjs`. The notification path has no dependency on `PushNotification` or any tool only callable from inside an assistant session.

### Events

1. **Worker done.** When the watcher's per-tick lifecycle scan sees a `result` event in a tracked `.jsonl`, it fires once per worker. Done suppresses idle and crashed markers; once a worker has finished, neither follow-up notification fires.
2. **Worker idle > 5 min.** The watcher checks each tracked `.jsonl` mtime every 30 seconds. When mtime is older than 300 seconds and the worker has not emitted a `result` event, the watcher prints an `idle>5m on TOOL` line to stdout and notifies. A marker file under the per-watcher tempdir prevents repeat spam. The marker clears on the next tool_use event so re-blocking re-notifies. **Prior-session guard.** If the `.jsonl` is already older than `IDLE_THRESHOLD_SECS` at discovery time, the watcher stamps `<sid>.skip_idle` and never fires this notification for that file. Combined with `pruneActive`, leftover `.jsonl` files from previous sessions stay quiet.
3. **Worker crashed.** When `active.json`'s recorded PID is no longer alive and no `result` event has been written, the watcher prints a `crashed` line and notifies. Once per worker per watcher invocation. **Prior-session guard.** If the `.jsonl` is already older than `IDLE_THRESHOLD_SECS` at discovery time, the watcher stamps `<sid>.skip_crashed` and suppresses this notification. The primary defense is `pruneActive`, which removes the entry from `active.json` so `worker_pid_for` returns empty and the crashed branch never enters. The marker is belt-and-suspenders.

### Message format

```
<LABEL>: <STATUS or DESCRIPTION>
```

`LABEL` is built by `worker_label_for(sessionId)` from `active.json` data, cached once per worker in the per-watcher tempdir:

- Issue target with title: `<repo-name>#<issue-num> (<title>)` — title fetched via `gh issue view --json title`, capped at 50 chars
- Issue target without title (gh call failed): `<repo-name>#<issue-num>`
- Ad-hoc target: `<repo-name>/adhoc: <task>` — task capped at 50 chars
- Lookup failure (active.json missing, session not found): first 8 hex chars of session id

`<repo-name>` is the basename of the worker's `repo` field, or the basename of `cwd` when `repo` is null (current-repo dispatch). Title bar reads `Claude Code Dispatch`.

Examples:
- `claude-kit#445 (fix: Cognee MCP launcher missing required env va...): done success`
- `web-next#42 (feat: add login flow): done error_during_execution`
- `claude-kit#445 (fix: Cognee MCP launcher missing required env va...): idle>5m on Bash`
- `claude-kit#445 (fix: Cognee MCP launcher missing required env va...): crashed (pid 12345 gone)`
- `claude-kit/adhoc: refactor button component: done success`
- `6445d2b8: done success` — fallback shape when active.json lookup fails

Implementation lives in `buildWorkerLabel` plus `makeLabelResolver` in `.claude/hooks/lifecycle/watch-workers.cjs`. The resolver calls `gh issue view` at most once per worker per watcher invocation, then caches the resolved label in memory so re-notification (e.g. idle re-trigger after a tool_use event) does not re-call gh.

### Silencing

Set `DISPATCH_NO_NOTIFY=1` in the orchestrator's environment. The watcher's `notify_osa` helper short-circuits to no-op when the var is `1`. The flag is also propagated to workers via `WORKER_ENV_ALLOWLIST` so future worker-side notification paths can read it.

`--dry-run` does not spawn workers, so no notifications fire.

### Why osascript

Two alternatives were considered.

- **`PushNotification` tool.** Routes through Remote Control to phone if paired, which would close the "stepped away" gap. Rejected for now because the tool is only callable from inside an assistant session, and the watcher is a shell script. Routing through a short-lived `claude -p haiku` call adds latency and cost, and depends on `PushNotification` working in non-interactive `-p` mode, which is undocumented and requires empirical verification. Tracked as a separate kit issue for follow-up investigation.
- **`terminal-notifier`.** Cleaner attribution because it posts as itself, easy to grant permission to in System Settings. Rejected because it requires a `brew install` and is not on the kit's tooling baseline.

`osascript` ships on every macOS install, requires no auth, no extra processes, and surfaces banners through the standard notification system. The trade-off is desktop-only with no phone routing, and the requirement that the parent app calling osascript has notification permission in System Settings.

### macOS notification permission

osascript notifications post under the parent app that calls `osascript`, typically `Script Editor` on stock macOS. If notifications do not appear visibly:

1. Open System Settings, then Notifications.
2. Find `Script Editor` in the app list. Enable `Allow Notifications`. Set Alert Style to `Banners` or `Alerts`.
3. Verify Focus or Do Not Disturb is not filtering them.

Notifications still land in Notification Center even when banners are silenced. Verify with the date/time menu at the top-right of the screen.

## Failure Modes to Watch For

**Worker crashes mid-run.** The output file still exists. `--synthesize` parses whatever is there and reports partial status. `active.json` still lists the worker until `--kill` or manual cleanup.

**`claude` CLI not found.** `child_process.spawn` throws ENOENT. Error surfaces to stderr. Skill should catch and report.

**Hook block in worker.** Kit hooks still fire despite `bypassPermissions`. Worker reads error stderr, reads the required spec, retries the tool call. The resulting `tool_use` and `tool_error` events are suppressed from the Monitor stream by default, per the Monitor stream section above; `DISPATCH_VERBOSE=1` surfaces them.

**Watcher misses events.** The filter in `parseEventLine` (`watch-workers.cjs`) may miss new event types Claude Code adds. If users report missing progress events, widen the regex patterns and add a covering case to `watch-workers.test.cjs`.

**Permission denial logged as "permission_denial" but is actually a hook block.** Claude Code logs both in the same field. Not a bug; worth knowing when debugging.

**Session disconnects.** Workers are detached. They keep running. On next session, `/dispatch --list` shows them. Results can still be synthesized.

**`active.json` corruption.** `readActive` tolerates parse errors and returns empty. Workers may be forgotten. Recovery: grep `ps` for `claude -p` processes, rebuild `active.json` manually. The `pruneActive` sweep is a best-effort wrapper, `try {} catch {}`, at every call site so a corrupt registry never blocks the calling command.

**Pre-pruning history, resolved.** Before 2026-05-20, `active.json` had no pruning path beyond `--kill`. Records accumulated indefinitely. Symptom: the watcher fired spurious `idle>5m` and `crashed` notifications on `.jsonl` files from prior sessions because PID lookups returned dead PIDs and mtimes were stale. Resolved by `pruneActive` plus the watcher's discovery-time skip markers (`shouldStampSkipOnDiscovery`). See #483.

**Multiple dispatch sessions racing.** If two orchestrator sessions run `/dispatch` simultaneously, their writes to `active.json` may race. Low probability. Not fixed in the current implementation.

**Stale-queue dispatch on shipped issue.** Workers can fire on an issue whose fix already merged to main when the kit convention used `Addresses #N`, so the PR did not auto-close the issue, and no prior dispatch worker had logged a plan comment. Mitigated by the merged-fix-PR skip signal in `checkExistingPlan` (#293): a `gh pr list --state merged --search "#NUM in:body"` query, post-filtered for `(addresses|closes|fixes|resolves) #NUM` with word boundary, blocks dispatch when a merged fix exists. Override with `--force` for verified regressions or intentional re-dispatch.

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
1. Replace `watch-workers.cjs` implementation with a Channels subscriber
2. Keep the module API unchanged
3. `dispatch.cjs` continues to write output files even if Channels is primary, as a dual-write safety net during migration
