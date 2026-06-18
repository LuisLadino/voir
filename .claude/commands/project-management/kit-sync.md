---
description: Pull the latest kit into THIS project from its own session, then commit so the files land on main where Conductor worktrees read them. The supported downstream-side sync path.
---

# /kit-sync

**Bring this project's kit-owned files up to date with the kit, from this project's own session.**

`sync-kit.sh` run from the kit repo only writes a downstream's working tree. It never commits. Conductor sessions are git worktrees that read kit-owned `.claude/` files from committed `main`, so a working-tree-only sync never reaches them and the project silently runs stale kit tooling. #736 is the bug. The fix is to apply and commit the kit from inside this project's session, so the new files land on `main`.

Run this from the project that needs the kit, never from the kit repo. Under Conductor, run it in that project's workspace.

## What it does not do

- It does not run in the kit source repo. That repo IS the kit and has no `.kit-manifest`. Refuse there with a clear message.
- It does not modify the kit source's working tree or history.
- It does not auto-commit. You review the diff and run `/commit`, so the voice gate, attribution scan, and PR flow all apply.

## Steps

1. **Confirm this is a downstream.** Require `.claude/.kit-manifest` at the repo root. If it is absent, this is the kit source or an uninitialized project. Stop and say which.

2. **Resolve the kit source.** Use `$CLAUDE_KIT_SOURCE` if set, else `~/Repositories/Personal/claude-kit`. Confirm it has `.claude/CLAUDE.md` and no `.kit-manifest`, which marks a real kit source rather than another downstream. If it can't be found, stop and tell the user to set `CLAUDE_KIT_SOURCE` to their kit checkout.

3. **Check the kit source is current and clean. Do not mutate it.** Read-only:
   ```bash
   git -C "$KIT" rev-parse --abbrev-ref HEAD          # expect main
   git -C "$KIT" status --porcelain                   # expect empty
   git -C "$KIT" fetch --quiet origin main && \
     git -C "$KIT" rev-list --count main..origin/main # expect 0
   ```
   A kit source on a feature branch, dirty, or behind `origin/main` would propagate stale or in-progress files. Warn loudly and ask before continuing, so the user can pull the kit first. Never run `git pull` or `git checkout` against the kit from here. That is the kit repo's own session's job.

4. **Apply the kit to this repo.**
   ```bash
   "$KIT/sync-kit.sh" "$(git rev-parse --show-toplevel)"
   ```
   For a client-mode project, where `.claude/kit-mode.yaml` says `mode: client`, the kit's own client handling applies. `.claude/` stays gitignored and reaches worktrees via `.worktreeinclude` or Conductor files-to-copy, not a commit. There is nothing to commit. Stop after the sync and say so.

5. **Show what changed.** Surface the sync's `+added / ~updated / -deleted` summary and `git status` for the kit-owned paths, so the user sees exactly what moved.

6. **Commit via the normal flow.** Hand off to `/commit`. The kit-sync lands on `main` through the gated workflow. Once merged, fresh Conductor worktrees read the current kit.

## Why this shape

The kit is the source of truth. Re-sync regenerates downstream copies anytime, so nothing is lost by a downstream lagging until it syncs itself. Committing the sync from each project's own session keeps kit history and project history clean and separate. Pushing kit files into a foreign working tree from the kit session, then committing them cross-repo, is the failure mode this avoids. The rationale and read-model live in `.claude/specs/kit/session-isolation.md` Layer 6.
