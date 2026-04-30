---
name: client-mode
description: >
  How the kit handles client repos. Prevents .claude/ files and AI-attribution from entering client-owned codebases. Loaded when working in a project with .claude/kit-mode.yaml set to mode: client.
applies_to: []
category: kit
---

# Client Mode

How the kit protects client repos from Claude-tool leakage.

## First Check Before Editing in a Client Repo

Before writing anything that needs to commit, verify whether the repo is in client mode and how the exclusion works.

```bash
# Is this client mode?
cat .claude/kit-mode.yaml          # → mode: client

# Is .claude/ excluded from commits?
cat .git/info/exclude | grep .claude
git check-ignore -v .claude/anything
```

If `.claude/kit-mode.yaml` reads `mode: client`, then `.claude/` is excluded from commits via `.git/info/exclude`. That file is local-only and never committed, by design. The exclusion is invisible to anyone who only checks `.gitignore`.

What this means for any session writing under `.claude/` in a client repo: the file will not commit. It does not reach collaborators. On the next clone, it is gone.

Anything that must reach the team belongs in the normal project tree per that project conventions. Not in `.claude/`. This includes design specs, project briefs, architecture notes, and shared documentation.

The kit injects a SessionStart warning in client-mode repos via `.claude/hooks/context/client-mode-warning.cjs`. If that warning fires, do not write to `.claude/` for anything the team needs to see.

## What Client Mode Does

When a project is in `CLIENT_PROJECTS` in `sync-kit.sh`, syncing that project:

- Adds `.claude/` to `.git/info/exclude`. Local-only ignore, never committed.
- Writes `.claude/kit-mode.yaml` with `mode: client`. In-project marker for hooks and skills.
- Installs a `commit-msg` hook. When `core.hooksPath` is set globally, installs to that path. Otherwise installs per-repo at `.git/hooks/commit-msg`.

The `commit-msg` hook scans commit messages for AI-attribution patterns and blocks on match. The `/commit` skill scans PR bodies before `gh pr create`.

The hook pins the scanner path to the kit's absolute location at install time. This prevents a malicious cloned repo from supplying its own scanner at `.claude/hooks/safety/scan-attribution.cjs` and achieving code execution via `git commit`. The hook executes a scanner from the kit, never from the repo being committed into.

Hooks carry a `# claude-kit:commit-msg:vN` version marker on the second line. On re-sync, sync-kit overwrites hooks carrying this marker to upgrade them, and preserves hooks without the marker as user-custom.

## What Client Mode Prevents

- `Co-Authored-By: Claude` or `Co-Authored-By: Anthropic` trailers in commit messages
- `Generated with Claude` and `Built with Claude Code` phrases in commit messages or PR bodies
- `🤖 Generated with` attribution markers
- `.claude/` directory appearing in the client repo's tracked files

## Declaring a Client Project

Add the absolute path to both arrays in `sync-kit.sh`:

```bash
DOWNSTREAM=(
  "$HOME/Repositories/Work/web-next"
)

CLIENT_PROJECTS=(
  "$HOME/Repositories/Work/web-next"
)
```

`DOWNSTREAM` controls which projects sync. `CLIENT_PROJECTS` applies client-mode setup to projects that sync. Both entries are required.

## Non-Negotiable Rules

NEVER commit `.claude/` contents in a client project. The `.git/info/exclude` entry is the guardrail. If it is missing, `git status` surfaces `.claude/` as untracked.

NEVER add `.claude/` to the client repo's `.gitignore`. That file is committed. The pattern would leak the existence of Claude tooling to collaborators. Use `.git/info/exclude` only.

NEVER add AI-attribution to commits or PRs in a client repo. The commit-msg hook catches messages. The `/commit` skill scans PR bodies. Neither covers attribution inside code comments. Watch for that manually.

## Why the Global Hook Is Safe in Non-Client Repos

The commit-msg hook reads `.claude/kit-mode.yaml` at commit time. Non-client repos have no such file, so the hook exits 0 without scanning. Personal and kit-owned repos are unaffected even though the hook runs in every repo.

## Out of Scope

- Scanning staged diff content for attribution. Comments in source code can still leak.
- Voice enforcement per project. Voice context is orthogonal.
- Retrofit path for repos that already committed `.claude/`. Those require manual cleanup before client mode becomes effective.

## Moving to a New Machine

The commit-msg hook is installed to either the global `core.hooksPath` directory or the client repo's `.git/hooks/` directory. Neither location is inside the kit repo or the client repo, so neither propagates via `git clone`.

On a new machine:

1. Restore personal git config first, including `core.hooksPath` if you want the single-install-covers-all-repos behavior.
2. Clone the kit and downstream projects.
3. Run `./sync-kit.sh` for each client project. Sync-kit detects `core.hooksPath` at run time and installs the hook to the correct location.

If step 1 happens after step 3, the per-repo hooks get orphaned because git consults the global path only. Fix by re-running sync-kit for each client project.

The kit does not manage `~/.git-hooks/` existence or `core.hooksPath` configuration. Those are user-level state tracked via personal dotfiles.

## Failure Modes to Watch For

**Custom commit-msg hook already installed.** `setup_client_hook` will not overwrite. It warns and skips. Check with `ls -la $(git config --global core.hooksPath 2>/dev/null || echo .git/hooks)/commit-msg` before debugging why attribution leaked.

**Scanner missing on disk.** If `.claude/` is excluded but the files have not been synced, the hook's scanner path does not exist. The hook exits 0 silently. Run `./sync-kit.sh <project>` to reinstall files.

**`core.hooksPath` changed after install.** If the global hooks path is repointed, the old commit-msg hook is no longer consulted. Re-run sync to install to the new path.

**Marker manually edited with wrong case.** The mode check is case-sensitive. `MODE: CLIENT` or `Mode: Client` will not activate client mode. Sync-kit always writes lowercase. If the marker is hand-edited, keep it lowercase or re-run sync to regenerate.
