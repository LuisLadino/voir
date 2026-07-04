---
name: handoff
description: >
  Route a session boundary; handoff is the heaviest path, not the default. Triggers: "handoff", "end session", "save context", "wrapping up", "switching context". Writes the cross-lane summary.
allowed-tools: Read, Write, Bash
---

# Handoff

You are at a session boundary. Before writing anything, decide whether a handoff is even the right tool. In the Conductor + board era most continuity is carried elsewhere, and a handoff is the heaviest of the three paths.

## Step 0: Route — is a handoff the right tool?

Continuity has three paths. Pick one.

- **Continue (merge-bar button).** The next unit is a tight follow-up in the *same lane* that benefits from this exact chat. Use Continue: it starts a new branch off fresh `main` and carries the whole conversation forward. No handoff needed, the chat IS the context. See `session-isolation.md` post-merge discipline.
- **The issue + `/board <tag>`.** The next unit is a clean break whose context lives in the GitHub issue: research, decisions, alternatives, DoD. Make sure the issue captures the WHY, then archive. A fresh workspace re-derives the lane worklist from `gh issue list --label workstream/<slug>`. No handoff needed, the issue IS the context. See `board-coordination.md`.
- **Handoff (this skill).** The state worth keeping belongs to *neither a single chat nor a single issue*: cross-lane project state, end-of-day consolidation across the lanes you touched, or memory that is not issue-shaped, such as a dead-end approach, a correction, or a durable preference. This is the residual gap the other two paths do not fill. Continue below.

If the situation is single-lane and Continue or the issue already covers it, say so and stop. Do not write a redundant handoff.

## Step 1: Consolidate memory

Run memory consolidation first, so the memory directory is clean before this session's state is added. Invoke the dream skill:

```
Skill(skill: "dream")
```

Wait for it to complete, then continue.

## Step 2: Resolve the memory path (worktree-safe)

The memory directory is keyed to the **main repository root**, not the current working tree. Conductor, `claude -w`, and dispatch all run in git *worktrees*, where `git rev-parse --show-toplevel` returns the worktree path, a key no other session reads. Native memory injection reads the main-repo key, so the handoff must write there too.

```bash
# Anchor on the shared git common-dir (the main repo's .git), never the worktree.
MAIN_ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)")
WORKSPACE_KEY=$(printf '%s' "$MAIN_ROOT" | sed 's|/|-|g')
MEMORY_DIR="$HOME/.claude/projects/$WORKSPACE_KEY/memory"
mkdir -p "$MEMORY_DIR"
echo "$MEMORY_DIR"
```

In a normal, non-worktree checkout `--git-common-dir` is the local `.git`, so `MAIN_ROOT` is the repo root. The derivation is correct in both cases.

## Step 3: Write the handoff as project memory

Use the Write tool to create or overwrite the handoff file.

**File:** `$MEMORY_DIR/project_handoff.md`

```markdown
---
name: session-handoff
description: Handoff context from {date} session — {brief description}
type: project
---

# Session Handoff - {Brief Title}

**Created:** {YYYY-MM-DD}
**Reason:** {Why handing off — end of day, cross-lane context switch}

## Project State Across Lanes

{The picture no single issue shows: which lanes are hot, what is blocked on what, how the pieces relate. 2-5 bullets. For per-issue status, point at the issue, do not restate it.}

## Findings Not Captured in an Issue

{Dead-end approaches, corrections, durable mental models built this session that are not issue-shaped. If a finding belongs to one issue, put it on that issue instead and skip it here.}

## Needs a Fresh Session to Verify

{Things that can only be checked by restarting. Anything you could not verify in this session.}

## Related

{Commits, issues, PRs, lanes, files worth a pointer.}
```

## Step 4: Update MEMORY.md

Add or update the handoff entry in `$MEMORY_DIR/MEMORY.md`:

```markdown
- [Session handoff](project_handoff.md) — {brief description of what was done}
```

## Step 5: Confirm

Tell the user what was captured, and which lanes the handoff spans.

## Guidelines

- **Route first.** Most session-ends are single-lane and do not need a handoff. Continue carries the chat; the issue carries the WHY. Reach for the handoff only for the cross-lane / non-issue-shaped residue.
- **Do not duplicate the issue.** Per-task status, next steps, and the design-thinking WHY live on the GitHub issue. The handoff carries what spans lanes or has no issue home.
- **Keep it short.** The next session needs orientation, not documentation.
- **Overwrite is OK.** Each handoff replaces the previous.
- **Use the memory frontmatter.** The `description` field helps future sessions decide if this memory is relevant.
