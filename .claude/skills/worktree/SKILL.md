---
name: worktree
description: >
  Isolate a parallel CC session in a git worktree. Triggers: "new worktree", "isolate this session", "parallel session", "another claude window". Two sessions stop sharing one working tree.
allowed-tools: Bash, Read
---

# Worktree

You're starting a parallel Claude Code session. This skill creates an
isolated git worktree so two sessions can run side-by-side without
sharing one git index or one working tree.

`/dispatch` already does this for autonomous workers. This skill does
the same for interactive sessions.

## When to use this

Use when any of these is true:
- The user wants a second Claude Code window in this repo
- The user is working alongside `/dispatch` workers in the primary tree
- The user wants to work on a different branch without disturbing the
  current branch's state
- The user is about to `vercel deploy` and the tree is dirty from work
  the current session did not do

## What this skill does

Runs `node .claude/scripts/worktree.cjs create <branch>` which:

1. Creates `.claude/worktrees/session-<slug>/` via `git worktree add`
2. Branches from `origin/HEAD` by default. Override with `--from <ref>`.
3. Copies `.claude/` and any `worktree.context_dirs` or `worktree.context_files`
   from `stack-config.yaml`, merged with `dispatch.context_dirs` and
   `dispatch.context_files`.
4. Runs the detected install command: `npm ci`, `pnpm install --frozen-lockfile`,
   `poetry install`. Skip with `--no-install`.
5. Prints the `cd` plus `claude` next-step.

A bare `git worktree add` is not enough. Three things don't carry over,
and this skill handles them differently:
- `.claude/` is client-mode excluded via `.git/info/exclude`. Copied automatically.
- `node_modules` symlink breaks Turbopack. A real install is run.
- `.vercel/` is gitignored, so deploy resolution breaks without it. The kit
  ships no platform-specific defaults per #463, so `.vercel/` propagates only
  when the project declares it under `worktree.context_dirs` or
  `dispatch.context_dirs` in `stack-config.yaml`.

So `.claude/` and dependencies are handled automatically; `.vercel/` and other
platform dirs propagate only when the project opts in via `stack-config.yaml`.

## What to do

### 1. Confirm the branch or issue

Ask if not clear:
- New branch name, for example `feature/new-thing`
- Existing branch. The script handles both.
- Issue number. Use the number as the branch name.

### 2. Run the helper

```bash
node .claude/scripts/worktree.cjs create <branch>
```

Flags:
- `--from <ref>`. Base off a non-default ref.
- `--no-install`. Skip the install step.

### 3. Hand off the next step

The script prints:
```
Next steps:
  cd <worktree-path>
  claude
```

Tell the user to open a new terminal, run those two commands, and
continue work there. The current session stays in the primary checkout.

### 4. List or clean up later

```bash
node .claude/scripts/worktree.cjs list
node .claude/scripts/worktree.cjs remove <name>
```

## Spec

Required reading before editing the script:
`.claude/specs/kit/session-isolation.md`
