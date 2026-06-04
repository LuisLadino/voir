---
name: verify
description: >
  Drain the verification queue. Triggers: "verify the queue", "drain the queue", "verify these issues", "close verified issues". Claude analyzes, Luis approves before closing.
argument-hint: [issue-numbers...]
allowed-tools: Bash, Read
---

# Verify

You are draining the verification queue. The queue lives in GitHub: any issue whose merged PR used `Addresses #X` and is still open is awaiting a verification call.

The shape is analysis-first, batched approval. You read every issue's DoD, every merged PR's diff and CI status, and produce a single recommendation table. Luis scans the table and approves in one shot. The action layer (close, follow-up filing) only fires after his approval.

This inverts the QA-contact role from Bugzilla. Luis is still the deciding authority. You do the legwork so the deciding authority's attention budget goes to the cases that actually need a human.

=== CRITICAL: NEVER ACT WITHOUT EXPLICIT APPROVAL ===

You are STRICTLY PROHIBITED from:
- Closing an issue before Luis has approved that specific issue (by `yes`, by listing its number, or by saying `y` during the per-issue walk)
- Filing a follow-up issue without Luis's one-sentence gap description
- Treating a `close` recommendation as authorization to close — recommendation is analysis, action requires approval
- Skipping the recommendation table to act directly
- Categorizing an issue as `close` when the diff doesn't actually verify the DoD (e.g., "the PR title looks fine") — when in doubt, recommend `flag`

Recommendation is automatic. Action is human-approved. This boundary is non-negotiable.

## Step 1: Build the Queue

If `$ARGUMENTS` lists specific issue numbers, treat those as the target set. Otherwise, run `find-stale-addresses` with `--all-ages`:

```bash
node .claude/skills/verify/find-stale-addresses.cjs --all-ages --json
```

The output is an array of `{pr: {number, title, url, mergedAt, ageDays}, issue: {number, title, url}}`. An issue can appear multiple times if multiple PRs reference it.

Build the analysis set:
- Group rows by `issue.number`. Each unique issue becomes one row in the recommendation table.
- For each issue, collect every PR that referenced it (preserve all PR numbers, mergedAt timestamps, and titles).
- If `$ARGUMENTS` was provided, filter to those issue numbers. Warn on any that aren't in the queue: "#N not in verify queue (already closed, or no merged Addresses PR)."

If the queue is empty, say "Verification queue is empty. Nothing to drain." and stop.

If the queue exceeds 25 issues, say "Queue has N issues. Slice with /verify <numbers> or run in passes — analyzing all in one shot will be slow." and stop. Luis can re-invoke with a slice.

## Step 2: Analyze Each Issue

For each unique issue in the analysis set, gather evidence:

```bash
gh issue view <issue_number> --json title,body,labels,createdAt

gh pr view <pr_number> --json title,body,mergedAt,statusCheckRollup,files

gh pr diff <pr_number>
```

Optionally check `.claude/dispatch/<session-id>.result.json` for a worker summary if the PR was dispatched. Absence is fine.

For each issue, derive a recommendation. The decision tree:

1. **Read the issue's Definition of Done.** If the body has a `## Definition of Done` section, use that verbatim. Otherwise extract the implicit DoD from `## Problem` / `## Why It Matters` / `## Proposed Solution`.

2. **Compare the shipped diff against the DoD.** For each DoD item, ask: does the diff contain code, doc, or config that demonstrably addresses this item? Cite file paths.

3. **Check CI status.** If `statusCheckRollup` shows any failed required check, that's a `flag` regardless of diff content. If checks are still in progress, that's also `flag`.

4. **Pick a bucket:**
   - `close` — every DoD item is verifiably addressed in the diff, CI is green, no obvious gap
   - `do-not-close` — at least one DoD item is not addressed in the diff, OR the diff introduces a regression visible to a careful reader, OR CI failed
   - `flag` — DoD is ambiguous, evidence is mixed, you can't tell either way, or CI is in progress

5. **Write a one-sentence rationale.** It must reference either the DoD item satisfied (for `close`), the gap identified (for `do-not-close`), or the ambiguity (for `flag`). No vague "looks good" — name what was checked.

When in doubt between `close` and `flag`, pick `flag`. Recommendation is cheap; mistaken close is expensive.

## Step 3: Present the Recommendation Table

Output a single markdown table. One row per unique issue, sorted with `flag` and `do-not-close` first, then `close` last:

```markdown
## Verify queue: N issues

| #  | Issue | PR(s) | CI | Reco | Why |
|----|-------|-------|----|----|-----|
| 1  | #224 _Design Polish missing "use client"_ | #282 | pass | close | Hook adds Next.js .tsx detection at agent.cjs:142, test added at agent.test.cjs:88 |
| 2  | #252 _mem0+Letta substrate setup_ | #258 #259 #264 | pass | flag | Substrate shipped, but DoD also requires "migrate OMEGA memories" — no migration evidence in any diff |
| 3  | #297 _invented constraints_ | #312 | pass | close | CLAUDE.md gains explicit anti-constraint-invention block; banned-phrases list matches DoD |
```

Truncate issue titles to ~50 chars. Use issue and PR numbers as plain `#N` (the GitHub renderer auto-links them in comments; in chat output the number is enough).

After the table, expand any `flag` or `do-not-close` items with a fuller block:

```markdown
### #252 — flag

**DoD:** install mem0 + Letta + migrate OMEGA memories + wire MCP for role-agent substrate

**What shipped (PRs #258, #259, #264):**
- mem0 wrapper at .claude/hooks/lib/mem0.cjs (2 LOC user_id casing fix)
- Letta Docker image pin in install runbook
- Substrate infrastructure scaffolding

**Gap:** "migrate OMEGA memories" is in the DoD. No diff touches OMEGA-export or mem0-import code paths. Either the migration shipped in another PR, was deferred, or is incomplete. Luis: which is it?
```

End with the approval prompt:

```
Approve all `close` recommendations? [yes / list / individual / no]
- yes      — close every `close` row in one batch
- list     — type the issue numbers to close (e.g., #224 #297)
- individual — walk each `close` row one at a time (current /verify behavior)
- no       — skip the close batch; only walk `flag` and `do-not-close` items
```

Then stop. Wait for Luis's response.

## Step 4: Take Action on the Close Batch

### On `yes`

For each issue in the `close` bucket, in order, execute:

```bash
gh api repos/{owner}/{repo}/issues/<issue_number>/comments -f body="## Verified

Fix shipped in #<pr_numbers>, merged <merged_dates>. Verified during /verify pass on $(date -u +%Y-%m-%d).

Closing per CLAUDE.md verify-before-close rule (was awaiting verification, not awaiting work)."

gh issue close <issue_number> --reason completed
```

Use `gh api` for the comment to bypass enforce-plan. When an issue has multiple PRs, list all PR numbers and merged dates in the comment.

After each close, print `✓ Closed #N`. After the batch, print `Closed N issues.`.

### On `list <numbers>`

Parse the numbers. For any number not in the `close` bucket, warn: "#N is in `flag`/`do-not-close` bucket; closing anyway requires walking it individually." Do NOT close those.

Close each approved-and-in-bucket issue using the same `gh api` + `gh issue close` flow above.

### On `individual`

Walk each `close` row one at a time. For each row, present:

```
#N: <title>
PR(s): #M
CI: <status>
Recommendation: close
Rationale: <one-sentence why>

Diff: <truncated diff, top 3 files, max 50 lines per file>

Verify and close #N? [y / n / skip]
```

On `y`: execute the close flow above.
On `n`: jump to Step 5's do-not-close branch for this issue.
On `skip`: print `→ Skipped #N` and move on.

### On `no`

Print `Close batch skipped. Walking flagged items only.` and proceed to Step 5.

## Step 5: Walk Flagged and Do-Not-Close Items

For each `flag` or `do-not-close` row, present:

```
#N: <title>
PR(s): #M
CI: <status>
Recommendation: <flag|do-not-close>
Rationale: <one-sentence why>

<expanded block from Step 3>

Verify and close #N? [y / n / skip]
```

### On `y`

Same close flow as Step 4. Print `✓ Closed #N (overrode <reco>)`.

### On `n`

Do NOT close. Ask: "What's still broken? One sentence — I'll capture it as a follow-up."

Wait for response. Then file a follow-up via `gh api`:

```bash
gh api repos/{owner}/{repo}/issues \
  -f title="follow-up: <short description from Luis>" \
  -f body="## Problem

<Luis's one-sentence description>

## Context

PR #<pr_number> (<pr_title>) shipped to address #<issue_number> but did not fully resolve it. Verification on $(date -u +%Y-%m-%d) flagged the gap.

Original issue: #<issue_number>
Shipping PR: #<pr_number>" \
  -F "labels[]=type/bug" \
  -F "labels[]=priority/medium" \
  -F "labels[]=status/backlog"
```

Then comment on the original issue:

```bash
gh api repos/{owner}/{repo}/issues/<issue_number>/comments -f body="## Verification: rejected

PR #<pr_number> shipped but did not fully resolve this. Captured the remaining gap as #<new_issue_number>. Leaving this issue open until the gap is closed."
```

Print `✗ #N stays open. Follow-up filed: #M`.

### On `skip`

Print `→ Skipped #N`. Move on.

### On anything else

Treat as a question or correction. Answer or clarify, then re-ask `Verify and close #N? [y / n / skip]`. Don't guess intent.

## Step 6: Final Summary

After every row in the analysis set has been handled, print:

```
Verify pass complete.
- Closed: <count> — #A #B #C
- Stayed open with follow-up: <count> — #D (→ #E), #F (→ #G)
- Skipped: <count> — #H #I

Skipped items will surface again next session via [VERIFY].
```

## When Luis Stops Mid-Pass

Luis can stop at any point. Don't push back. Print what's been handled and what remains. The queue persists in GitHub state — picking up next session is automatic.

## Cross-Repo Verification

This skill operates on the current repo only. To verify another repo's queue, `cd` to that repo first and run `/verify` there. Cross-repo flag is intentionally not supported.

## Critical Rules Recap

- ALWAYS produce the recommendation table before any action
- ALWAYS require explicit approval (`yes` / `list` / per-issue `y`) before closing
- ALWAYS include a one-sentence rationale on every recommendation, citing DoD or diff
- NEVER close on a `close` recommendation alone — recommendation is analysis, not authorization
- NEVER skip the diff in your analysis — "PR title looks fine" is not verification
- NEVER classify as `close` when in doubt — `flag` is the safe default
- NEVER auto-stale-close issues that linger in the queue
- ON ambiguous response, re-ask. Don't guess.

Complete the user's request by analyzing the queue, presenting one recommendation table, accepting Luis's batched approval, and executing approved actions.
