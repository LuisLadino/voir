---
name: session-isolation
description: >
  How the kit isolates parallel Claude Code sessions sharing one repo.
  Required reading before editing .claude/scripts/worktree.cjs, the
  concurrent-session-warning hook, the block-dirty-deploy hook, or the
  enforce-skills branch-shift logic. Covers the worktree helper, the
  SessionStart concurrent-session detection, the dirty-deploy guard,
  the branch-shift commit verification, and the rationale for each.
applies_to:
  - ".claude/scripts/worktree.cjs"
  - ".claude/hooks/context/concurrent-session-warning.cjs"
  - ".claude/hooks/context/session-marker-cleanup.cjs"
  - ".claude/hooks/safety/block-dirty-deploy.cjs"
  - ".claude/hooks/safety/concurrent-session-gate.cjs"
  - ".claude/hooks/safety/enforce-skills.cjs"
category: kit
related: [dispatch, hooks, tracking-persistence]
---

# Session Isolation

How the kit prevents parallel Claude Code sessions from corrupting one shared checkout.

## The Failure Modes

Two or more sessions in the same working tree share one git index. Observed in #451:

1. **Branch race.** Session A's `git checkout` moves Session B's HEAD. B's next commit lands on A's branch.
2. **File race.** B's Read becomes stale before B's Edit because A wrote between them. B's Edit lands on A's content or fails outright when the Edit's exact-string match no longer matches.
3. **Dirty-tree deploy.** `vercel deploy` ships the working tree. A's uncommitted files ride B's deploy to production.
4. **Wrong-branch commit.** B's commit lands on the branch A switched to. Recovery is cherry-pick plus force-edit history.

`/dispatch` already isolates autonomous workers via `git worktree`. This spec covers the interactive case.

## The Four Layers

### Layer 1: Worktree helper, the primary fix

`.claude/scripts/worktree.cjs create <branch>` builds an isolated worktree at `.claude/worktrees/session-<slug>/`, propagates `.claude/` and project-declared dirs, and installs dependencies.

A bare `git worktree add` misses three things:

- **`.claude/`** is excluded from commits via `.git/info/exclude` in client-mode repos. The new worktree gets no hooks or specs without explicit copy.
- **`.vercel/`** is gitignored. `vercel deploy` from the worktree creates a junk project and routes to it.
- **`node_modules`** symlinked from the primary checkout breaks Turbopack: "Symlink node_modules is invalid, it points out of the filesystem root". A real install is required. ESLint and Vitest tolerate the symlink. Only Turbopack panics.

Empirical observations from #451 comment on 2026-05-15, web-next session.

Propagation reuses `dispatch.cjs`'s `propagateUntrackedContext`, `readDispatchConfig`, `resolveBaseRef`, `KIT_DEFAULT_CONTEXT_DIRS`. The kit defaults are platform-neutral with `.claude/` only. Projects declare additions in `stack-config.yaml` under `dispatch:` or `worktree:`. Both blocks are read and merged.

Install command resolution order:
1. `stack-config.yaml` `worktree.install_command` if set
2. Auto-detect by lockfile. `package-lock.json` becomes `npm ci`. `pnpm-lock.yaml` becomes `pnpm install --frozen-lockfile`. `yarn.lock` becomes `yarn install --frozen-lockfile`. `bun.lockb` becomes `bun install --frozen-lockfile`. `poetry.lock` becomes `poetry install`. `Pipfile.lock` becomes `pipenv install --deploy`. `requirements.txt` becomes `pip install -r requirements.txt`.
3. None becomes skip with notice.

### Layer 2: Concurrent-session detection

Each session writes a marker `.claude/sessions/<session-id>.json` at SessionStart with `{ session_id, pid, cwd, started_at }`. The `concurrent-session-warning` hook reads all markers, prunes stale ones by PID gone or older than 24h, and warns if another live marker shares the current cwd.

Stale-marker prune uses `ps -p <pid> -o command=` to verify the PID is still a claude process. Catches PID reuse where an unrelated process inherited the PID after the original session exited.

Markers are cleaned on Stop via `session-marker-cleanup.cjs`. Best-effort. Stale-prune is the durable cleanup path.

Silence with `CLAUDE_KIT_NO_CONCURRENCY_WARN=1`.

**Enforcement (#630).** Detection alone is advisory: it fires only at SessionStart and only in the second-started session, so the first session is blind and collisions that develop mid-session are never caught. `concurrent-session-gate.cjs`, a PreToolUse Bash gating hook, closes both gaps. It reuses `evaluate()` and runs on every git-mutating command: `git checkout/switch/commit/merge/rebase/reset/cherry-pick/revert/pull/push/stash`, `git branch -d/-D/-m/-M`, and `gh pr create/merge/close/ready/edit`. When another live session shares the cwd it blocks with exit 2, names the other session(s), and points to the worktree escape. Deploy collisions stay with Layer 3. Its override is the dedicated `ALLOW_CONCURRENT_GIT=1`, NOT the banner's `CLAUDE_KIT_NO_CONCURRENCY_WARN`: silencing an informational banner must not also disable a protective block.

### Layer 3: Deploy guard

PreToolUse Bash hook `block-dirty-deploy.cjs` refuses unsafe deploy commands — `vercel deploy`, `vercel --prod`, `vercel --production`, `vercel` (bare), `netlify deploy`, `firebase deploy`, `wrangler deploy`, `wrangler publish` — under two rules.

**Rule 1 — dispatch workers never deploy (#472).** If the session's cwd is a `.claude/worktrees/dispatch-*` worktree, the deploy is refused outright. Deploy is the orchestrator's job, run from the main checkout after merge; a worker deploy ships throwaway worktree state to production. Hard block, no override — a worker is non-interactive and cannot meaningfully confirm.

**Rule 2 — no dirty-tree deploy (#451).** Otherwise, the deploy is refused when the working tree has uncommitted files this session did not edit. The "did not edit" check compares `git status --porcelain` paths against `file_change` events in the session's tracking log; files in the dirty set but not the edit log are foreign. Override: prefix with `ALLOW_DIRTY_DEPLOY=1` or set the env var, documented in the refusal message.

The `vercel` bare pattern explicitly excludes subcommands that don't deploy: `env`, `login`, `link`, `switch`, `inspect`, `logs`, `projects`, `teams`, `whoami`, `--version`, `--help`.

### Layer 4: Branch-shift commit guard

At SessionStart, `session-init.cjs` records `session_branch_baseline` with the current branch. The `enforce-skills` hook checks at every `git commit` via SKILL path that the current branch matches the baseline. If it differs AND this session did not run `git checkout` or `git switch` to reach the new branch, refuse.

Override: add `BRANCH_VERIFIED=1` to the commit env. The user confirms the branch change is intentional.

The session's `git checkout` history is detected via tracking events whose Bash commands match `git\s+(?:checkout|switch)(?:\s+-[bc])?\s+<branch>`.

## Module Boundaries

- `.claude/scripts/worktree.cjs`. User-facing CLI. Imports dispatch primitives. No direct hook involvement.
- `.claude/skills/worktree/SKILL.md`. User-facing skill triggered by phrases.
- `.claude/hooks/context/concurrent-session-warning.cjs`. SessionStart observability hook.
- `.claude/hooks/context/session-marker-cleanup.cjs`. Stop observability hook.
- `.claude/hooks/safety/block-dirty-deploy.cjs`. PreToolUse Bash gating hook.
- `.claude/hooks/safety/concurrent-session-gate.cjs`. PreToolUse Bash gating hook. Enforces Layer 2 by reusing `evaluate()` on every git-mutating command. git + gh pr only; deploys are Layer 3.
- `.claude/hooks/safety/enforce-skills.cjs`. Extended with branch-shift check. Gating.

## Invariants

- Worktree path is always `.claude/worktrees/session-<slug>/`. Session prefix distinguishes from dispatch's `dispatch-<id>/`. Both live under the same parent so `.gitignore` can exclude the whole tree with one entry.
- Markers live at `.claude/sessions/<session-id>.json`. Directory is gitignored.
- Session edit log lives at `~/.claude/projects/{workspace-key}/tracking/{session-id}.jsonl`. The dirty-deploy guard reads it. Does not write.
- Override env vars are explicit and documented in refusal messages: `CLAUDE_KIT_NO_CONCURRENCY_WARN` for the Layer 2 banner, `ALLOW_CONCURRENT_GIT` for the Layer 2 git gate, `ALLOW_DIRTY_DEPLOY`, and `BRANCH_VERIFIED`. The banner and git-gate overrides are deliberately separate. Silencing the informational banner must not disable the protective block.

## Stack Config Schema

`.claude/specs/stack-config.yaml` additions:

```yaml
# Optional. Reuses dispatch.context_dirs and context_files if not declared.
worktree:
  install_command: "npm ci"        # override auto-detect
  context_dirs:                    # merged with dispatch.context_dirs
    - .vercel
  context_files:                   # merged with dispatch.context_files
    - .env.local
```

A project that already declared `dispatch.context_dirs: [.vercel]` gets the same propagation for session worktrees automatically. The `worktree:` block adds extras specific to interactive sessions.

## Relationship to Dispatch

This spec and `dispatch.md` cover the same primitive, `git worktree`, used in two modes:

- Dispatch: autonomous workers, often plan-only, ephemeral.
- Sessions: interactive users, durable, manually cleaned up.

Same propagation, same recursion guards via `CLAUDE_COPY_EXCLUDE`, same base-ref resolution. Diverges on install. Sessions need deps; dispatch workers typically don't.

## Failure Modes

- **PID lookup fails on non-POSIX.** The current `isClaudeProcess` uses POSIX-portable `ps -p <pid> -o command=`, which works on both macOS and Linux. Untested on Windows. The kit assumes a POSIX environment.

- **Marker write fails silently.** All `try { fs.writeFileSync } catch {}`. A failed marker write means the next session won't see this one. Acceptable: detection is a discoverability layer, not a correctness gate.

- **Override env vars leak in shell history.** `ALLOW_DIRTY_DEPLOY=1 vercel deploy` leaves the override in history. Acceptable: the override is a deliberate user action.

- **Install command runs in worktree but lockfile is in primary.** Lockfiles are tracked, so `git worktree add` copies them. Install in worktree resolves correctly.

- **Concurrent worktree creates.** Two sessions racing to create the same worktree name: `git worktree add` is atomic. One wins. The other reports `already exists`. The script checks `fs.existsSync(wtPath)` first and bails early. Race window is small but possible.

## Testing

`.claude/scripts/worktree.test.cjs` covers parse, name sanitization, install detection, config merge.
`.claude/hooks/context/concurrent-session-warning.test.cjs` covers marker pruning, evaluation, warning text.
`.claude/hooks/safety/block-dirty-deploy.test.cjs` covers deploy pattern matching, dispatch-worker detection, foreign-file detection.
`.claude/hooks/safety/concurrent-session-gate.test.cjs` covers git-mutating command matching, the dedicated `ALLOW_CONCURRENT_GIT` override, and the no-markers allow path.
`.claude/hooks/safety/enforce-skills.branch.test.cjs` covers the branch-shift override and no-baseline pass-through.

End-to-end live test:
```bash
node .claude/scripts/worktree.test.cjs
node .claude/hooks/context/concurrent-session-warning.test.cjs
node .claude/hooks/safety/block-dirty-deploy.test.cjs
node .claude/hooks/safety/concurrent-session-gate.test.cjs
node .claude/hooks/safety/enforce-skills.branch.test.cjs

# Live worktree test:
node .claude/scripts/worktree.cjs create test-451 --no-install
ls .claude/worktrees/session-test-451/.claude
node .claude/scripts/worktree.cjs list
node .claude/scripts/worktree.cjs remove test-451
```

## See Also

- `dispatch.md`. Autonomous worker isolation with the same primitive.
- `block-dangerous.md`. Sibling safety hook pattern.
- `tracking-persistence.md`. JSONL event log the dirty-deploy guard reads.
- `sensitive-file-protection.md`. Adjacent safety regime.
