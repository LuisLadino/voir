---
name: commit
description: >
  Commit, push, and open a PR. Triggers: "commit", "let's commit", "save this", "checkpoint", "done", "ready to merge". Full flow: stages, commits, pushes, opens PR on the issue.
allowed-tools: Read, Bash, Edit
---

# Commit

You're finishing work. This skill does the full flow:

```
Commit → Push → Create PR → Enable Auto-merge
```

GitHub merges automatically after CI checks pass.

## What to Do

### 1. Check What Changed

```bash
git status
git diff --staged
git diff
```

If nothing to commit, say so and stop.

### 2. Load Commit Format

Read `.claude/specs/config/version-control.md` if it exists.

If not found, use conventional commits: `type(scope): description`

Types: feat, fix, refactor, test, docs, chore

### 3. Documentation Check (MANDATORY — do not skip)

Before committing, verify documentation reflects the changes.

**Step 3a: Determine what changed.**

Two routers decide what to check. The change-type router (below) covers CHANGELOG and README. The declared-path router (Step 3a-cov) covers operating docs that declared the code they document.

From the diff, classify the change:
- Feature or fix → CHANGELOG.md MUST have an entry
- Structural change (new dirs, renamed modules) → README.md likely needs updating
- API/interface change → component specs may be stale
- New component/module → component spec may be needed (see /sync-stack Step 9)

**Step 3a-cov: Operating-doc coverage (declared-path router).**

Operating docs — runbooks, setup, config reference, deploy, schema — declare the code they document with `covers:` frontmatter. When the diff touches a declared path, that doc may be stale. Find the affected docs:

```bash
node .claude/hooks/lib/doc-coverage.cjs
```

It prints each doc whose `covers:` globs intersect the current changes. MUST read every doc it lists and update whatever the change staled — the exact commands, endpoints, flags, or schema fields. If a new high-coupling component (runtime, connector, deploy, schema, CLI) has no covering doc at all, create one via /build — born-annotated with `covers:` per the Authoring section of `.claude/specs/kit/doc-coverage.md` — or file a tracked issue; do not leave it uncovered silently. The convention and which docs warrant `covers:` are in that same spec.

**Step 3b: Read and check each file.**

MUST read each file that exists. Do not assume "still accurate" without reading.

```bash
# Check if these exist and read them
cat CHANGELOG.md 2>/dev/null | head -30
cat README.md 2>/dev/null | head -40
ls .claude/specs/components/ 2>/dev/null
```

**Step 3c: Update what's stale.**

Document current state only. NEVER describe what changed — only what IS.

**Do not update:** `~/.claude/CLAUDE.md` as part of commits. That file is user-scope personal instructions, not a doc that tracks code changes. Project-level and kit-synced CLAUDE.md can be updated when the change warrants.

**Step 3d: If a file should exist but doesn't** (e.g., no CHANGELOG.md in a project with features), create it.

**Step 3e: Report.** You MUST output a documentation check report before proceeding to Step 4:

```
DOCUMENTATION CHECK:
- CHANGELOG.md: [added entry / still accurate / created / N/A]
- README.md: [updated / still accurate / N/A]
- Component specs: [updated X / still accurate / N/A]
- Operating docs (covers:): [verified X / updated X / none matched]
```

### 3.5. Spec Conformance Pass (MANDATORY — do not skip)

The `check-spec-conformance` hook will fire on commit and catch the mechanizable rules. This step covers the rest: the judgment-based rules in the spec prose that no regex can decide.

**Principle: editing a `className`, a token, a value, or any line puts EVERY token on that line in scope for spec conformance, not just the part you intended to change.** "I only changed the column count" is not a defense. Drift inherited from adjacent existing code is still drift.

For each spec whose `applies_to` matches a file in this diff:

1. Re-read the spec's documented rules. The `enforce-specs` hook required the read at edit time; this step is the apply pass.
2. Walk the staged diff for that file. For every added or modified line, check every token on the line against the spec rules.
3. If the spec documents a standard and the line carries a value not on that standard — even one inherited unchanged from the surrounding code — call it out and fix it before staging.

If the conformance hook blocks the commit, fix the reported violations and re-stage. Do not retry with `--no-verify`. Do not amend the rule to silence the report unless the documented standard has actually shifted. If it has, update the spec prose alongside the rule in the same commit.

### 3.6. Release Cadence Check (non-blocking)

CHANGELOG `[Unreleased]` grows on every commit and must be cut into a dated version once it crosses the threshold (CONTRIBUTING.md "Releases"). After the documentation check, run the shared counter:

```bash
node .claude/hooks/lib/release-cadence.cjs
```

If the output begins with `[RELEASE]`, `[Unreleased]` has crossed the threshold — surface that line to the user and point at CONTRIBUTING.md "Releases" for the cut steps. This is advisory: NEVER block, delay, or amend the commit for it. Otherwise the output reports below-threshold; continue.

### 4. Stage and Commit

```bash
git add path/to/files
SKILL_ACTIVE=1 DOCS_CHECKED=1 git commit -m "type(scope): description"
```

Prefer specific files over `git add -A`.

**Note:** `SKILL_ACTIVE=1 DOCS_CHECKED=1` bypasses the enforce-skills hook. BOTH markers are required — the hook verifies you completed Step 3 (documentation check) before allowing the commit. Only use within this skill after completing Step 3.

If the hook also reports `[BRANCH SHIFTED]`, the session's branch changed between SessionStart and now. This usually means another concurrent session in the same checkout ran `git checkout`. Verify the current branch is the intended one. If yes, add `BRANCH_VERIFIED=1` to the commit:

`SKILL_ACTIVE=1 DOCS_CHECKED=1 BRANCH_VERIFIED=1 git commit -m "..."`

If the branch is wrong, run `git checkout <starting-branch>` first, or start an isolated session with `claude -w <branch>`.

### 5. Push

```bash
git push -u origin $(git branch --show-current)
```

### 6. Update Related Issues

If this work relates to a GitHub issue, comment on the issue with what was done.

Use `gh api` to avoid enforce-skills hook blocking:

```bash
gh api repos/{owner}/{repo}/issues/{number}/comments -f body="comment text"
```

**What to include:**
- What this commit accomplished toward the issue
- Discoveries or decisions made during the work
- What still needs doing or testing

This is how issues capture the design thinking journey. The commit message says WHAT changed. The issue comment says WHY and what we learned.

### 7. Create PR with Auto-merge

Extract issue number from branch name if present:

```bash
git branch --show-current | grep -oE '[0-9]+' | head -1
```

**Client-mode PR body scan.** If the project has `.claude/kit-mode.yaml` with `mode: client`, scan the PR body before creating the PR. The commit-msg hook covers commit messages, not PR bodies.

Compose the PR body into a shell variable first, then scan it, then pass it to `gh pr create`. The variable is required — scanning `gh pr create --body "string"` directly is not possible without capturing it.

```bash
PR_BODY=$(cat <<'EOF'
## Summary
- What changed
- Why it changed

Addresses #X

## Test Plan
- How to verify
- [ ] Tested locally
EOF
)

if [ -f .claude/kit-mode.yaml ] && grep -q "^mode: client" .claude/kit-mode.yaml; then
  printf '%s' "$PR_BODY" | node .claude/hooks/safety/scan-attribution.cjs --stdin || {
    echo "PR body contains AI attribution. Revise PR_BODY and retry."
    exit 1
  }
fi

gh pr create --title "title" --body "$PR_BODY"
```

If the scan fails, edit the `PR_BODY` heredoc content to remove attribution, then re-run the scan and create steps.

**PR body format:**
```markdown
## Summary
- What changed
- Why it changed

Addresses #X

## Test Plan
- How to verify
- [ ] Tested locally
- [ ] Verified fix works
```

**Issue linking (commit ≠ close):**

- **`Closes #X`** — fix is tested and verified working. Issue can close on merge.
- **`Addresses #X`** — code is written but not yet verified. Issue stays open.
- **`Related to #X`** — partial progress. More work needed.

**Default to `Addresses`** - issues close when fixes are VERIFIED, not when code merges. Only use `Closes` when you've actually tested the fix works.

### 8. Enable Auto-merge

**First, detect a linked worktree.** Conductor and `claude -w` sessions run in a linked git worktree while the base branch stays checked out in the canonical clone. `--delete-branch` makes `gh` switch the local checkout to the base after merge, and git refuses to check out a branch held by another worktree, so the merge errors with `'main' is already used by worktree`. Decide the branch-cleanup path up front and reuse it below:

```bash
BRANCH=$(git branch --show-current)
# A linked worktree's git dir contains a `gitdir` file; the primary checkout's does not.
if [ -f "$(git rev-parse --absolute-git-dir)/gitdir" ]; then WORKTREE=1; else WORKTREE=0; fi
```

In a worktree, NEVER pass `--delete-branch`. Delete the branch server-side after the merge lands instead. Outside one, `--delete-branch` is safe:

```bash
if [ "$WORKTREE" = 1 ]; then
  gh pr merge --auto --squash
else
  gh pr merge --auto --squash --delete-branch
fi
```

This queues the PR to merge automatically after CI checks pass. In a worktree, clean the branch once Step 9's watcher confirms the merge, or rely on the repo's "Automatically delete head branches" setting:

```bash
gh api -X DELETE "repos/{owner}/{repo}/git/refs/heads/$BRANCH"   # worktree only, after merge confirmed
```

**Fallback when auto-merge is unavailable.** If the command fails with `Auto merge is not allowed for this repository`, the repo has the "Allow auto-merge" setting off. This is expected on repos that have not enabled it — not a flow error. Two paths:

- Preferred, one-time: enable it on the repo, then re-run the command above.
  ```bash
  gh repo edit --enable-auto-merge
  ```
- Per-PR fallback: wait for CI, then merge directly. The same worktree rule applies:
  ```bash
  gh pr checks --watch
  if [ "$WORKTREE" = 1 ]; then
    gh pr merge --squash && gh api -X DELETE "repos/{owner}/{repo}/git/refs/heads/$BRANCH"
  else
    gh pr merge --squash --delete-branch
  fi
  ```

Either way, continue to step 9.

### 9. Watch CI and Deploy

After enabling auto-merge, spawn a background watcher. It notifies you when the ship settles — success or failure — without you having to check manually. This closes the gap where CI failures and broken deploys pass silently.

Extract the PR number and spawn the watcher via the `Monitor` tool:

```
PR=$(gh pr view --json number --jq .number)
```

```
Monitor({
  description: "Watching PR #${PR} CI + deploy",
  persistent: true,
  command: "node .claude/hooks/lifecycle/watch-ship.cjs ${PR}"
})
```

The watcher emits exactly one line on completion:

- `✓ PR #N merged + deploy reachable` — happy path, session stays quiet until then
- `✓ PR #N merged (no deploy check configured)` — projects without a deploy target
- `✗ PR #N — CI failed or merge blocked` — action needed, check `gh pr view N`
- `✗ PR #N merged but deploy unreachable` — revert or investigate

The `deploy reachable` line confirms HTTP 2xx from the URL, not that the merged commit is the live build. On projects where merge does not auto-deploy, run the deploy step before treating this signal as confirmation of the merged code.

You don't wait for it. Continue with other work. The Monitor runs in the background for the rest of the session.

**Session-length limitation.** If you close the session before CI finishes, the Monitor dies with it. The `check-recent-ships.cjs` SessionStart hook catches this on the next session by scanning merged PRs from the last 24h.

### 10. Done

Show the PR URL. The Monitor continues in the background and will notify you when the ship settles.

### 11. After the merge: Continue or Archive, never keep working

A Conductor or `claude -w` workspace maps to one branch and one PR, and must never outlive its merge. Continuing to commit in a merged workspace leaves its branch behind `main` while other workspaces merge ahead, and the drift accumulates. When the merge lands, surface the two correct exits to the operator:

- **Continue** — continue on a *new* branch off freshly-fetched `main`, carrying the same chat. Use for a tight follow-up where the conversation context is worth keeping; the base is current and the merged work is behind you.
- **Archive** — the unit is done; the workspace leaves the active list, restorable from History with its chat intact. The next unit opens a fresh workspace whose context comes from the GitHub issue and `/board <tag>`.

Never keep working in the merged workspace. See `.claude/specs/kit/session-isolation.md` "The post-merge discipline" for the full rationale.

## Deploy Configuration (optional)

To enable the post-merge health check, add a `deploy:` block to the project's `.claude/specs/stack-config.yaml`:

```yaml
deploy:
  url: "https://your-site.com"
```

When configured, the watcher curls this URL after merge and reports if the response isn't HTTP 2xx. Without it, the watcher skips the deploy check and only reports the merge outcome.

## Notes

- Each commit should be a logical unit
- Multiple commits get squashed on merge
- Branch auto-deletes after merge
- Requires: repo has branch protection rules allowing auto-merge
- The Monitor watcher runs `node .claude/hooks/lifecycle/watch-ship.cjs <PR>` — script is kit-synced
