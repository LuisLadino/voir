---
name: session-isolation
description: >
  How the kit isolates parallel Claude Code sessions sharing one repo, how it
  keeps a deploy worktree current, and how it keeps a downstream's kit-owned
  files current. Required reading before editing the concurrent-session-warning
  hook, the concurrent-session-gate hook, the block-dirty-deploy hook, the
  deploy-drift-warning hook, the kit-drift-warning hook, the deploy-guard CLI,
  the deploy-currency lib, or the enforce-skills branch-shift logic. Covers
  native worktree isolation (claude -w and Conductor), the SessionStart
  concurrent-session detection, the git gate, the dirty-deploy guard, the
  branch-shift commit verification, the deploy-worktree currency discipline and
  guard, the kit-file currency model under Conductor, and the rationale for each.
applies_to:
  - ".claude/hooks/context/concurrent-session-warning.cjs"
  - ".claude/hooks/context/session-marker-cleanup.cjs"
  - ".claude/hooks/context/deploy-drift-warning.cjs"
  - ".claude/hooks/context/kit-drift-warning.cjs"
  - ".claude/hooks/lib/deploy-currency.cjs"
  - ".claude/scripts/deploy-guard.cjs"
  - ".claude/hooks/safety/block-dirty-deploy.cjs"
  - ".claude/hooks/safety/concurrent-session-gate.cjs"
  - ".claude/hooks/safety/enforce-skills.cjs"
category: kit
related: [dispatch, hooks, tracking-persistence, client-mode]
---

# Session Isolation

How the kit prevents parallel Claude Code sessions from corrupting one shared checkout.

## The Failure Modes

Two or more sessions in the same working tree share one git index. Observed in #451:

1. **Branch race.** Session A's `git checkout` moves Session B's HEAD. B's next commit lands on A's branch.
2. **File race.** B's Read becomes stale before B's Edit because A wrote between them. B's Edit lands on A's content or fails outright when the Edit's exact-string match no longer matches.
3. **Dirty-tree deploy.** `vercel deploy` ships the working tree. A's uncommitted files ride B's deploy to production.
4. **Wrong-branch commit.** B's commit lands on the branch A switched to. Recovery is cherry-pick plus force-edit history.

`/dispatch` isolates autonomous workers via `git worktree`. This spec covers the interactive case.

## The Primary Fix: Native Worktrees

Each interactive session runs in its own git worktree, so the four failure modes can't occur: separate working directory, separate index, separate cwd. The kit no longer ships a worktree CLI. Claude Code's native worktree support replaced the kit's bespoke `worktree.cjs` + `/worktree` skill in #714 (they predated native support and were the manual, no-auto-cleanup variant).

### Documented posture

- **Conductor — the daily driver.** A Mac-native orchestrator that runs each task in its own isolated git worktree with a per-task branch, terminal, diff, and review path, then merges back. Free, runs on the existing Claude Code login, no external orchestration server. Use it as the default way to run parallel work.
- **`claude -w` — the zero-dependency floor.** When Conductor isn't in play (CI, a plain terminal, a non-Mac box), native `claude --worktree <name>` (`-w`) creates an isolated worktree at `.claude/worktrees/<name>/` on a new branch `worktree-<name>`, branched from `origin/HEAD`, and starts Claude in it. Omit the name and Claude generates one. Pass `#<PR>` to base off a pull request. Mid-session, ask Claude to "work in a worktree" and it uses the `EnterWorktree` tool.

```bash
claude -w feature-auth      # isolated session at .claude/worktrees/feature-auth/ on branch worktree-feature-auth
claude -w bugfix-123        # a second, independent session in another terminal
```

Both land worktrees under `.claude/worktrees/`, the same parent `/dispatch` uses (`dispatch-<id>/`). That directory is already gitignored, so worktree contents never show as untracked in the primary checkout.

### Carrying gitignored context: `.worktreeinclude`

A worktree is a fresh checkout, so tracked files come along but untracked/gitignored files (`.env`, `.vercel/`, local config) do not. Native Claude Code reads a `.worktreeinclude` file at the **project root** (`.gitignore` syntax) and copies each matching file that is **also gitignored** into every new worktree. Tracked files are never duplicated.

```text
# .worktreeinclude — copies only files that match AND are gitignored
.env
.env.local
.vercel/
```

This is the native replacement for dispatch's `propagateUntrackedContext`. Two project shapes:

- **Personal-mode repos (`.claude/` tracked, e.g. the kit itself).** `.claude/` and all hooks/skills/specs are committed, so `claude -w` gets them automatically via the worktree checkout. A `.worktreeinclude` is only needed for genuinely gitignored extras (`.env`, `.vercel/`; `node_modules` is better re-installed than copied). The kit-as-project needs none: it has no `.env`, no dependencies, and its `.claude/` is tracked.
- **Client-mode repos (`.claude/` gitignored via `.git/info/exclude`, e.g. cosmo).** The worktree checkout gets no `.claude/` at all. The project **must** add a `.worktreeinclude` listing `.claude/` (plus any `.env`/platform dirs) or every worktree session loses the kit's hooks, skills, and specs. See `client-mode.md`.

**Caveat — `WorktreeCreate` hooks disable `.worktreeinclude`.** A `WorktreeCreate` hook (used for non-git VCS) replaces the default git worktree logic entirely; when one is configured, `.worktreeinclude` is not processed and the hook must copy local files itself. The kit ships no `WorktreeCreate` hook, so `.worktreeinclude` is the supported propagation path.

### Native cleanup

On clean exit (no uncommitted changes, no untracked files, no new commits) Claude removes the worktree and its branch automatically — this is the fix for the lingering-worktree problem the kit's manual CLI caused (a `claude-kit-sam` worktree once lived ~2 weeks because nothing cleaned it up). Named sessions prompt instead of auto-removing. Worktrees with changes prompt keep-or-remove. Subagent and background-session worktrees are swept once older than `cleanupPeriodDays`; `--worktree` sessions are never swept and must be removed with `git worktree remove`. While an agent runs, Claude `git worktree lock`s its worktree so concurrent cleanup can't remove it.

### Dependency setup

The native flag has no install step. Re-initialize the dev environment in each new worktree as the project requires (install deps, set up virtualenvs). For the kit-as-project there is nothing to install — the scripts run on Node built-ins.

## The Backstop Layers

Native per-session worktrees prevent collisions *when the operator uses them*. They are opt-in: someone can still run plain `claude` twice in one checkout. Layers 2 through 4 are the cheap backstops for that case. They are independent of how worktrees are made and survive the CLI's retirement unchanged, except that their escape-hatch text now points at `claude -w`.

### Layer 2: Concurrent-session detection and gate

Each session writes a marker `.claude/sessions/<session-id>.json` at SessionStart with `{ session_id, pid, cwd, started_at }`. The `concurrent-session-warning` hook reads all markers, prunes stale ones by PID gone or older than 24h, and warns if another live marker shares the current cwd.

Stale-marker prune uses `ps -p <pid> -o command=` to verify the PID is still a claude process. Catches PID reuse where an unrelated process inherited the PID after the original session exited.

Markers are cleaned on Stop via `session-marker-cleanup.cjs`. Best-effort. Stale-prune is the durable cleanup path.

Silence with `CLAUDE_KIT_NO_CONCURRENCY_WARN=1`.

**Enforcement (#630).** Detection alone is advisory: it fires only at SessionStart and only in the second-started session, so the first session is blind and collisions that develop mid-session are never caught. `concurrent-session-gate.cjs`, a PreToolUse Bash gating hook, closes both gaps. It reuses `evaluate()` and runs on every git-mutating command: `git checkout/switch/commit/merge/rebase/reset/cherry-pick/revert/pull/push/stash`, `git branch -d/-D/-m/-M`, and `gh pr create/merge/close/ready/edit`. When another live session shares the cwd it blocks with exit 2, names the other session(s), and points to `claude -w <branch>`. Deploy collisions stay with Layer 3. Its override is the dedicated `ALLOW_CONCURRENT_GIT=1`, NOT the banner's `CLAUDE_KIT_NO_CONCURRENCY_WARN`: silencing an informational banner must not also disable a protective block.

**Why this survives native worktrees.** The gate keys on shared cwd. Two `claude -w` sessions, two Conductor tasks, or two desktop-app sessions each have a *distinct* cwd, so the gate never fires for them. It fires only when two sessions genuinely share one working tree — the exact footgun the opt-in native tooling doesn't cover. Cost is a PID-liveness check on git-mutating commands only (gate) and once at SessionStart (warning). A cheap, correctly-scoped guard against silent corruption keeps earning its place even though native isolation makes it fire rarely.

### Layer 3: Deploy guard

PreToolUse Bash hook `block-dirty-deploy.cjs` refuses unsafe deploy commands — `vercel deploy`, `vercel --prod`, `vercel --production`, `vercel` (bare), `netlify deploy`, `firebase deploy`, `wrangler deploy`, `wrangler publish` — under two rules.

**Rule 1 — dispatch workers never deploy (#472).** If the session's cwd is a `.claude/worktrees/dispatch-*` worktree, the deploy is refused outright. Deploy is the orchestrator's job, run from the main checkout after merge; a worker deploy ships throwaway worktree state to production. Hard block, no override — a worker is non-interactive and cannot meaningfully confirm.

**Rule 2 — no dirty-tree deploy (#451).** Otherwise, the deploy is refused when the working tree has uncommitted files this session did not edit. The "did not edit" check compares `git status --porcelain` paths against `file_change` events in the session's tracking log; files in the dirty set but not the edit log are foreign. Override: prefix with `ALLOW_DIRTY_DEPLOY=1` or set the env var, documented in the refusal message. The refusal also suggests deploying from a clean worktree via `claude -w deploy`.

The `vercel` bare pattern explicitly excludes subcommands that don't deploy: `env`, `login`, `link`, `switch`, `inspect`, `logs`, `projects`, `teams`, `whoami`, `--version`, `--help`.

### Layer 4: Branch-shift commit guard

At SessionStart, `session-init.cjs` records `session_branch_baseline` with the current branch. The `enforce-skills` hook checks at every `git commit` via SKILL path that the current branch matches the baseline. If it differs AND this session did not run `git checkout` or `git switch` to reach the new branch, refuse.

Override: add `BRANCH_VERIFIED=1` to the commit env. The user confirms the branch change is intentional.

The session's `git checkout` history is detected via tracking events whose Bash commands match `git\s+(?:checkout|switch)(?:\s+-[bc])?\s+<branch>`.

### Layer 5: Deploy worktree currency (#722)

Layers 2 through 4 protect against two interactive sessions sharing one tree. This layer protects a different surface: a long-lived deploy worktree that a scheduled runtime runs from. Conductor and `claude -w` isolate authoring, and merges land on `origin/<deployBranch>` from worktrees that never touch the deploy checkout. So the deploy worktree drifts behind origin and accumulates edits that block even a fast-forward, and the runtime runs stale code with no signal. Parallel sessions make this worse, not better: more merges to origin advance it faster while the deploy tree sits still. A headless `claude -p` runtime fires no interactive hook, so Layers 2 through 4 never see it.

Two parts: a discipline and a guard.

**The discipline — deploy from a dedicated, clean checkout.** The runtime runs from a checkout that is never hand-edited and never a sync target, only ever fast-forwarded to the tracked remote ref. The primary checkout already holds `main`, and git refuses to check out one branch in two worktrees (#726), so `git worktree add <path> main` fails. Two working recipes:

```bash
# Recipe A — worktree on its own branch, shares .git (lighter):
git worktree add -b deploy ../<project>-deploy origin/main
# runner: cd ../<project>-deploy && node .claude/scripts/deploy-guard.cjs --branch deploy --remote-ref origin/main -- ./run.sh

# Recipe B — separate clone, fully independent main (zero guard config):
git clone <repo-url> ../<project>-deploy
# runner: cd ../<project>-deploy && node .claude/scripts/deploy-guard.cjs --branch main -- ./run.sh
```

Recipe A keeps one `.git` and tracks `origin/main` from a local `deploy` branch; `--remote-ref` decouples the local branch the tree sits on from the origin ref it tracks for currency. Recipe B is a second clone with its own `main`, so the default `--branch main` works unchanged. Never run dev work, `/sync-stack`, or kit-sync in the deploy checkout. Dev work happens in Conductor or `claude -w` worktrees, so the deploy tree stays clean by construction. This closes the root cause where the deploy checkout doubles as the hand-edited primary tree and a stray edit blocks the fast-forward.

**The guard — `.claude/scripts/deploy-guard.cjs`.** The runner calls it before the real command. It fetches the tracked remote ref, then:

- clean + current → proceed
- clean + behind only → fast-forward to the remote ref, then proceed
- dirty, diverged, ahead, wrong-branch, or detached → refuse loudly, exit 1
- fetch failed → refuse (currency cannot be verified)

The stale command never fires on a refusal. Two forms: check-only (`deploy-guard.cjs --branch main && ./run.sh`) and gate-then-exec (`deploy-guard.cjs --branch main -- ./run.sh`, which closes the check-to-run gap). Flags: `--branch` (the local branch the tree sits on, default main), `--remote-ref` (the origin ref tracked for currency, default origin/<branch>, decoupled per #726), `--cwd`, `--notify` (best-effort osascript alert on refusal), `--fetch-timeout`.

Pull-based by necessity: merges land on origin in the cloud and nothing local is notified, so the runtime pulls currency before acting. A push-based "update the deploy tree at merge time" cannot work — there is no local event when a remote PR merges. The guarantee boundary is git only: the guard makes the checkout current but does not rebuild the environment. If a merge changed dependencies, the runner re-syncs (`uv sync`, `npm ci`) after the guard passes.

**The warning — `deploy-drift-warning.cjs` (SessionStart).** Local-only, never fetches, so it adds no per-session network cost. It activates only when HEAD is on the deploy branch and warns when the tree is dirty or behind the already-fetched origin ref. This is interactive discoverability for whoever opens the deploy worktree; it cannot block because SessionStart is context-only, which is exactly why the guard is the runtime guarantee and this is the secondary signal. Local branch defaults to main, override with `CLAUDE_KIT_DEPLOY_BRANCH`; the tracked ref defaults to origin/<branch>, override with `CLAUDE_KIT_DEPLOY_REMOTE_REF`. Silence with `CLAUDE_KIT_NO_DEPLOY_DRIFT_WARN=1`.

The shared classification core is `.claude/hooks/lib/deploy-currency.cjs`: `classify` is a pure function of git facts, `gitFacts` and `fetchDeploy` are the IO edge. Both the guard and the warning consume it, so they never drift.

### Layer 6: Kit-file currency under Conductor (#736)

Layer 5 keeps a deploy worktree current against its own `origin`. This layer keeps a *downstream project's kit-owned files* current against the *kit*. Same worktree-read-model bites; different source.

**The mechanism mismatch.** `sync-kit.sh` propagates by writing kit-owned files into a downstream's working tree and stopping. It never commits or pushes. In a personal-mode downstream, `.claude/` is tracked, and every Conductor session is a fresh `git worktree` that reads those files from committed `main`. So a working-tree-only write lands where no session ever reads. The drift is silent and continuous: every fresh session runs whatever kit tooling `main` last committed, while a sync's new files sit uncommitted on a canonical clone nobody opens interactively. Observed in cosmo on 2026-06-17 — `main` 15 commits behind plus 3 kit files modified-but-uncommitted, so sessions ran the pre-#730 verify gate with no signal.

Client-mode downstreams are not affected the same way: `.claude/` is gitignored there and reaches worktrees via `.worktreeinclude` / Conductor files-to-copy, not a commit. See `client-mode.md`.

**The propagation model — downstream commits its own sync.** The kit is the source of truth; re-sync regenerates a downstream's copies anytime, so nothing is lost by a downstream lagging until it syncs itself. The supported path is `/kit-sync` run *inside the project's own session*: it resolves the kit source, checks the kit is on a clean current `main` without mutating it, runs `sync-kit.sh` against the current repo, then hands the commit to the normal `/commit` flow. The sync lands on `main` through the gated workflow, where fresh worktrees then read it. The rejected alternative is an upstream push or PR from the kit session into each foreign working tree: committing kit files into a repo from outside its own session is the cross-repo path that gets sloppy and was ruled out (Luis, 2026-06-17).

**The write-side signal — `sync-kit.sh` reports propagation state.** After writing to each target, `report_propagation_state` reads local git facts (no fetch) and, when the target is a git repo that is dirty in kit-owned paths or behind `origin/main` or just received changes, prints a loud notice that the files are in the working tree only and must be committed in the project's own session. It never auto-commits or refuses — that would fight the source-of-truth model and the accepted "leave downstreams dirty, commit per-project" workflow. It only makes the working-tree-only nature impossible to miss.

**The read-side signal — `kit-drift-warning.cjs` (SessionStart).** Sibling to `deploy-drift-warning`, local-only, never fetches. It fires in any downstream (any repo carrying `.claude/.kit-manifest`, which excludes the kit source itself) and warns on two signals:

- **UNCOMMITTED** — kit-owned files from the manifest are modified-but-uncommitted in this checkout. A sync wrote them; nobody committed; worktrees won't see them. Pure-local, needs no kit. Catches the canonical-clone case directly.
- **BEHIND** — the downstream's on-disk kit files differ from the kit source (changed, added, or removed upstream). In a clean worktree, on-disk equals committed, so this is exactly what a fresh worktree off `main` would read. Needs the kit source located via `CLAUDE_KIT_SOURCE` or the conventional `~/Repositories/Personal/claude-kit`. When the source can't be found, only UNCOMMITTED fires.

Both signals point at `/kit-sync` then `/commit`. The BEHIND count compares against whatever the kit source checkout currently holds, so keep it on a current `main` for an accurate count; the kit source carries its own Layer 5 deploy-drift warning. Silence with `CLAUDE_KIT_NO_KIT_DRIFT_WARN=1`.

To discover files the kit ships that a downstream's manifest predates (added upstream), the hook needs the kit-owned path layout. That layout is a single source of truth, `kit-paths.conf` at the kit repo root, read by both `sync-kit.sh` (`load_kit_paths`) and the hook (`loadKitPaths`), so propagator and detector can never disagree about what is kit-owned (#737). The hook degrades gracefully if the file is absent: the changed and removed signals are manifest-driven and still fire, only added-upstream detection goes quiet.

**Automating currency at workspace creation — `.conductor/settings.toml` (#745).** The signals above make drift discoverable and `/kit-sync` fixes it, but currency can also be made automatic at the one moment a workspace is born. Conductor creates each workspace as a worktree and fetches `origin` first, so a new workspace already starts from the latest `origin/main` of *its own repo* — the gap is only getting the current *kit* into it. `scripts.setup` in `.conductor/settings.toml` runs at workspace creation (with `CONDUCTOR_ROOT_PATH`, `CONDUCTOR_WORKSPACE_PATH`, `CONDUCTOR_IS_LOCAL` in scope), which is exactly where that belongs. The recipe is mode-specific, for diff-noise reasons, not safety:

- **The kit repo itself.** New kit workspaces are already current (they branch from the kit's `origin/main`). The setup script only keeps the long-lived root checkout current, because that root is the `/kit-sync` source and the BEHIND-count reference:

  ```toml
  [scripts]
  setup = "git -C \"$CONDUCTOR_ROOT_PATH\" fetch --prune origin && git -C \"$CONDUCTOR_ROOT_PATH\" pull --ff-only || true"
  ```

- **Client-mode downstream** (`.claude/` gitignored). The branch carries no `.claude/`, so the workspace must have the kit synced in at setup. This is the clean auto-current case: gitignored means no diff noise, and `sync-kit.sh` carries the protections. Run it from the kit source into the new workspace:

  ```toml
  [scripts]
  setup = "[ \"$CONDUCTOR_IS_LOCAL\" = \"1\" ] && \"${CLAUDE_KIT_SOURCE:-$HOME/Repositories/Personal/claude-kit}/sync-kit.sh\" \"$CONDUCTOR_WORKSPACE_PATH\" || true"
  ```

  Keep the kit source on a current `main` so the synced files are current (its own Layer 5 deploy-drift warning covers that). Pairs with the `.worktreeinclude` / files-to-copy of `.claude/` from `client-mode.md`.

- **Personal-mode downstream** (`.claude/` tracked). Do NOT auto-sync into the workspace: it would write kit-file changes into the feature branch's working tree and mix them into every PR diff. Keep the kit on `main` via committed `/kit-sync` per update (the model above); new workspaces inherit it from `origin/main`. The setup script only ff-pulls the root, as for the kit repo.

**Hard safety rule for any setup-script sync.** It MUST go through `sync-kit.sh`, never a raw `cp -r .claude/`. `sync-kit.sh` is surgical: PROTECTED_PATTERNS (`*.local.json`, `*.env*`, `*.key`/`*.keys`, `*.pem`, `*.credentials*`, `mcp-*`) are never synced or deleted (`sync-kit.sh:64`), deletion is gated on the previous `.kit-manifest` so project-created files are never removed (`sync-kit.sh:657`), and custom hooks/skills/specs sitting alongside kit ones are preserved. A raw copy throws all of that away and would clobber `settings.local.json`, project specs, and secrets. Routing through `sync-kit.sh` is what makes auto-sync safe to run on every workspace creation.

## Module Boundaries

- `.claude/hooks/context/concurrent-session-warning.cjs`. SessionStart observability hook.
- `.claude/hooks/context/session-marker-cleanup.cjs`. Stop observability hook.
- `.claude/hooks/safety/block-dirty-deploy.cjs`. PreToolUse Bash gating hook.
- `.claude/hooks/safety/concurrent-session-gate.cjs`. PreToolUse Bash gating hook. Enforces Layer 2 by reusing `evaluate()` on every git-mutating command. git + gh pr only; deploys are Layer 3.
- `.claude/hooks/safety/enforce-skills.cjs`. Extended with branch-shift check. Gating.
- `.claude/hooks/lib/deploy-currency.cjs`. Layer 5 shared core. Pure `classify` plus the `gitFacts`/`fetchDeploy` IO edge. No process exit, no printing.
- `.claude/scripts/deploy-guard.cjs`. Layer 5 CLI. Fetches, fast-forwards a clean behind tree, refuses anything unsafe, optionally execs the wrapped command. Runner-invoked, not a hook.
- `.claude/hooks/context/deploy-drift-warning.cjs`. Layer 5 SessionStart observability hook. Local-only drift warning on the deploy branch.
- `.claude/hooks/context/kit-drift-warning.cjs`. Layer 6 SessionStart observability hook. Local-only drift warning in a downstream whose kit-owned files lag the kit or sit uncommitted. Self-contained pure `evaluate` plus `warningText`; reuses `deploy-currency.dirtyFiles` for the git edge.
- `sync-kit.sh` (`report_propagation_state`). Layer 6 write-side signal. After writing each target, prints a loud working-tree-only notice when the target is a git repo that is dirty in kit paths, behind origin, or just changed. Never commits or refuses.
- `.claude/commands/project-management/kit-sync.md`. Layer 6 supported path. The downstream-side `/kit-sync` command: resolve the kit source, verify it is clean and current without mutating it, apply it to this repo, hand the commit to `/commit`.

Worktree creation itself is native Claude Code (`claude -w`) or Conductor — no kit module owns it for interactive sessions.

## Invariants

- Native worktrees live at `.claude/worktrees/<name>/` on branch `worktree-<name>`; dispatch worktrees at `.claude/worktrees/dispatch-<id>/`. Both share the `.claude/worktrees/` parent so `.gitignore` excludes the whole tree with one entry.
- Markers live at `.claude/sessions/<session-id>.json`. Directory is gitignored.
- Session edit log lives at `~/.claude/projects/{workspace-key}/tracking/{session-id}.jsonl`. The dirty-deploy guard reads it. Does not write.
- Override env vars are explicit and documented in refusal messages: `CLAUDE_KIT_NO_CONCURRENCY_WARN` for the Layer 2 banner, `ALLOW_CONCURRENT_GIT` for the Layer 2 git gate, `ALLOW_DIRTY_DEPLOY`, and `BRANCH_VERIFIED`. The banner and git-gate overrides are deliberately separate. Silencing the informational banner must not disable the protective block.
- Layer 5 env vars: `CLAUDE_KIT_DEPLOY_BRANCH` overrides the warning's local deploy branch (default main); `CLAUDE_KIT_DEPLOY_REMOTE_REF` overrides the tracked ref (default origin/<branch>); `CLAUDE_KIT_NO_DEPLOY_DRIFT_WARN` silences the warning. The guard takes these as the `--branch` and `--remote-ref` flags, not env vars, because a runner passes them explicitly.
- Layer 6 env vars: `CLAUDE_KIT_SOURCE` overrides the kit source location the drift warning and `/kit-sync` compare against (default `~/Repositories/Personal/claude-kit`); `CLAUDE_KIT_NO_KIT_DRIFT_WARN` silences the warning. The kit-drift warning fires only in a downstream (a repo with `.claude/.kit-manifest`), so it never fires in the kit source.
- `sync-kit.sh` never commits or pushes; it only writes a downstream's working tree and reports propagation state. The commit is always the downstream's own session via `/kit-sync` then `/commit`. The kit is the source of truth and re-sync regenerates downstream copies, so a lagging downstream loses nothing.
- The deploy checkout is never hand-edited and never a sync target. It is only ever fast-forwarded to its tracked remote ref. The local branch the deploy tree sits on is decoupled from that ref (#726): the primary holds `main`, so the deploy worktree uses its own branch (e.g. `deploy`) tracking `origin/main`, or a separate clone on its own `main`. The guard enforces cleanliness by refusing a dirty or diverged tree; the discipline keeps it from happening.

## Carrying Context Into Worktrees

`.worktreeinclude` at the project root (`.gitignore` syntax) is the native mechanism for copying gitignored files into each new worktree. Only files that match a pattern *and* are gitignored are copied. Personal-mode repos with a tracked `.claude/` need it only for `.env`/platform dirs; client-mode repos with a gitignored `.claude/` must list `.claude/` there. A `WorktreeCreate` hook disables `.worktreeinclude` processing, so the kit ships none.

## Relationship to Dispatch

Both this spec and `dispatch.md` cover the same primitive, `git worktree`, in two modes:

- **Dispatch:** autonomous workers, often plan-only, ephemeral. Dispatch runs `git worktree add` itself (not the native flag) because it needs a post-creation insertion point to propagate untracked context before spawning the worker (#463). Its primitives `propagateUntrackedContext`, `readDispatchConfig`, `resolveBaseRef`, and `KIT_DEFAULT_CONTEXT_*` live in `hooks/lib/dispatch.cjs`.
- **Sessions:** interactive users, durable until exit, native `claude -w`/Conductor lifecycle with automatic cleanup. No kit code path; context comes from `.worktreeinclude`.

The retired `worktree.cjs` once imported dispatch's primitives to mirror dispatch isolation for interactive sessions. Native worktrees made that CLI redundant; dispatch keeps the primitives for its own worktree path.

## Failure Modes

- **PID lookup fails on non-POSIX.** The current `isClaudeProcess` uses POSIX-portable `ps -p <pid> -o command=`, which works on both macOS and Linux. Untested on Windows. The kit assumes a POSIX environment.

- **Marker write fails silently.** All `try { fs.writeFileSync } catch {}`. A failed marker write means the next session won't see this one. Acceptable: detection is a discoverability layer, not a correctness gate.

- **Override env vars leak in shell history.** `ALLOW_DIRTY_DEPLOY=1 vercel deploy` leaves the override in history. Acceptable: the override is a deliberate user action.

- **`claude -w` with `-p` is not auto-cleaned.** Non-interactive `claude -p --worktree` has no exit prompt, so its worktree is not removed automatically. Remove with `git worktree remove`. (This is why dispatch manages its own worktree lifecycle rather than relying on native cleanup.)

- **Forgetting to isolate.** Native worktrees are opt-in; a plain `claude` started twice in one checkout still collides. Layer 2 is the backstop for exactly this.

## Testing

`.claude/hooks/context/concurrent-session-warning.test.cjs` covers marker pruning, evaluation, warning text.
`.claude/hooks/safety/block-dirty-deploy.test.cjs` covers deploy pattern matching, dispatch-worker detection, foreign-file detection.
`.claude/hooks/safety/concurrent-session-gate.test.cjs` covers git-mutating command matching, the dedicated `ALLOW_CONCURRENT_GIT` override, and the no-markers allow path.
`.claude/hooks/safety/enforce-skills.branch.test.cjs` covers the branch-shift override and no-baseline pass-through.
`.claude/hooks/lib/deploy-currency.test.cjs` covers the `classify` matrix (clean, behind, ahead, diverged, dirty, detached, wrong-branch, no-origin-ref) and real-git `gitFacts`/`fetchDeploy`.
`.claude/scripts/deploy-guard.test.cjs` covers argument parsing, the decision logic, and end-to-end CLI runs: clean-current runs, behind fast-forwards then runs, dirty refuses without running, wrong-branch refuses.
`.claude/hooks/context/deploy-drift-warning.test.cjs` covers warning text, the deploy-branch activation gate, and the silence/no-framework paths.
`.claude/hooks/context/kit-drift-warning.test.cjs` covers the UNCOMMITTED and BEHIND signals (changed, added, removed upstream), the manifest-scoped dirty filter, the no-kit-source fallback, the not-a-downstream and silence/no-framework paths, and `resolveKitSource` rejecting a downstream.

```bash
node .claude/hooks/context/concurrent-session-warning.test.cjs
node .claude/hooks/safety/block-dirty-deploy.test.cjs
node .claude/hooks/safety/concurrent-session-gate.test.cjs
node .claude/hooks/safety/enforce-skills.branch.test.cjs
node .claude/hooks/lib/deploy-currency.test.cjs
node .claude/scripts/deploy-guard.test.cjs
node .claude/hooks/context/deploy-drift-warning.test.cjs
node .claude/hooks/context/kit-drift-warning.test.cjs

# Live native-worktree smoke test:
claude -w test-451            # creates .claude/worktrees/test-451/ on branch worktree-test-451, starts a session
# exit cleanly -> worktree and branch auto-removed
git worktree list             # confirm it's gone
```

## See Also

- `dispatch.md`. Autonomous worker isolation with the same primitive, kit-managed lifecycle.
- `client-mode.md`. Why client-mode repos must list `.claude/` in `.worktreeinclude`.
- `block-dangerous.md`. Sibling safety hook pattern.
- `tracking-persistence.md`. JSONL event log the dirty-deploy guard reads.
- `sensitive-file-protection.md`. Adjacent safety regime.
- Native worktrees: https://code.claude.com/docs/en/worktrees
