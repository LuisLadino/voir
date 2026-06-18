---
name: verify
description: >
  Drain the verification queue. Triggers: "verify the queue", "drain the queue", "verify these issues", "close verified issues". Claude closes what it can verify; only items needing a human stay open.
argument-hint: [issue-numbers...]
allowed-tools: Bash, Read
---

# Verify

You are draining the verification queue. The queue lives in GitHub: any issue whose merged PR used `Addresses #X` and is still open is awaiting a verification call.

The default is **verify and close**. For every issue you can actually check, you read its Definition of Done, compare it against the merged diff and CI, and if it holds you write the evidence to the issue and close it. You do this yourself, in the same pass, without waiting for Luis.

An issue stays open for exactly two reasons, and both get a written comment so nothing ever lingers without context:

1. **Verification gap** — a DoD item is not met, the diff introduces a regression, or CI is red. You document the specific gap and file a follow-up if it is separable scope.
2. **Human-only verification** — confirming the fix needs something only a human can do. You document exactly what is needed and surface it to Luis.

The second bucket is narrow on purpose. It is the only thing that routes to Luis, and it exists for fixes a human genuinely must close, not as a default holding pen.

=== CRITICAL: THE RULE THIS SKILL ENFORCES ===

If you can verify it, you close it. "Can verify" means you can confirm the DoD by reading the diff, running a test, executing a script, or inspecting state you have access to. When that is true, closing is your job, not Luis's.

You route an issue to Luis ONLY when verification is outside your reach:

- It needs access, credentials, or a permission grant you do not have.
- It needs a subjective human judgment: a design sign-off, an aesthetic call, a product or positioning decision.
- It needs observing real-world or external behavior you cannot execute or inspect: a live phone line, a deployed UI a person must use, state in another repo or system you cannot read from here.

Telling Luis to "sign off" on something he cannot verify any better than you can is the exact failure this skill exists to prevent. If you are about to ask for approval on a fix you already confirmed works, stop and close it.

Every issue you touch gets a comment: closed with evidence, or open with the gap or the human action needed. An issue must NEVER sit in the queue silent.

## Step 1: Build the Queue

If `$ARGUMENTS` lists specific issue numbers, treat those as the target set. Otherwise, run `find-stale-addresses` with `--all-ages`:

```bash
node .claude/skills/verify/find-stale-addresses.cjs --all-ages --json
```

The output is an array of `{pr: {number, title, url, mergedAt, ageDays}, issue: {number, title, url}}`. An issue can appear multiple times if multiple PRs reference it.

Build the analysis set:
- Group rows by `issue.number`. Each unique issue becomes one row.
- For each issue, collect every PR that referenced it. Preserve all PR numbers, mergedAt timestamps, and titles.
- If `$ARGUMENTS` was provided, filter to those issue numbers. Warn on any that aren't in the queue: "#N not in verify queue (already closed, or no merged Addresses PR)."

If the queue is empty, say "Verification queue is empty. Nothing to drain." and stop.

If the queue exceeds 25 issues, say "Queue has N issues. Slice with /verify <numbers> or run in passes — analyzing all in one shot will be slow." and stop. Luis can re-invoke with a slice.

## Step 2: Verify Each Issue

For each unique issue, gather evidence:

```bash
gh issue view <issue_number> --json title,body,labels,createdAt

gh pr view <pr_number> --json title,body,mergedAt,statusCheckRollup,files

gh pr diff <pr_number>
```

Optionally check `.claude/dispatch/<session-id>.result.json` for a worker summary if the PR was dispatched. Absence is fine.

Derive the disposition. The decision tree:

1. **Read the Definition of Done.** If the body has a `## Definition of Done` section, use it verbatim. Otherwise extract the implicit DoD from `## Problem` / `## Why It Matters` / `## Proposed Solution`.

2. **Compare the shipped diff against every DoD item.** For each item, ask: does the diff contain code, doc, or config that demonstrably satisfies it? Cite file paths. "The PR title looks fine" is not verification. Read the diff. Where a test or script proves the behavior, run it.

3. **Check CI.** A failed required check is a gap regardless of diff content. CI still in progress means verification is not done. Re-check before disposing; do not close on a pending run.

4. **Assign a disposition:**
   - `close` — every DoD item is verifiably satisfied in the diff, CI is green, no regression you can spot. You can confirm this yourself.
   - `gap` — at least one DoD item is unmet, the diff regresses something a careful reader would catch, or CI failed. The work is not done.
   - `needs-human` — verifying the DoD requires access, subjective judgment, or external observation you cannot perform, per THE RULE above. This is not "I'm unsure." An ambiguity you can resolve by reading more is yours to resolve.

5. **Write a one-sentence rationale.** Cite the DoD item satisfied for `close`, the specific gap for `gap`, or the exact human action required for `needs-human`. No vague "looks good."

When you are unsure between `close` and `gap`, investigate further. Read more of the diff, run the test, check the linked code. Resolve the ambiguity yourself. Escalate to `needs-human` only when the ambiguity is genuinely one a human must settle.

## Step 3: Act

Work the dispositions in this pass. You do not stop to ask permission before acting. Verification is the authorization.

### close

```bash
gh api repos/{owner}/{repo}/issues/<issue_number>/comments -f body="## Verified

Fix shipped in #<pr_numbers>, merged <merged_dates>. Verified during /verify pass on $(date -u +%Y-%m-%d).

<one line naming the DoD item(s) confirmed and where in the diff>

Closing per CLAUDE.md verify-before-close rule. Was awaiting verification, not awaiting work."

gh issue close <issue_number> --reason completed
```

Use `gh api` for the comment to bypass enforce-plan. When an issue has multiple PRs, list all PR numbers and merged dates. Print `✓ Closed #N`.

### gap

Document the gap on the issue. If the gap is separable scope, file a follow-up first and reference it.

```bash
gh api repos/{owner}/{repo}/issues \
  -f title="follow-up: <short gap description>" \
  -f body="## Problem

<the specific gap>

## Context

PR #<pr_number> (<pr_title>) shipped to address #<issue_number> but did not fully resolve it. Verification on $(date -u +%Y-%m-%d) flagged the gap.

Original issue: #<issue_number>
Shipping PR: #<pr_number>" \
  -F "labels[]=type/bug" \
  -F "labels[]=priority/medium" \
  -F "labels[]=status/backlog"

gh api repos/{owner}/{repo}/issues/<issue_number>/comments -f body="## Verification: gap

PR #<pr_number> shipped but did not fully resolve this: <the gap>. Captured the remaining gap as #<new_issue_number>, or noted it belongs to this issue. Leaving open until it closes."
```

Print `✗ #N stays open — gap documented`, appending `→ #M` if a follow-up was filed.

### needs-human

Document exactly what human verification is needed and why you cannot do it.

```bash
gh api repos/{owner}/{repo}/issues/<issue_number>/comments -f body="## Verification: needs you

The fix in #<pr_number> looks shipped, but confirming the DoD needs something I cannot do from here: <the specific access, judgment, or external observation required, and why it is human-only>.

What I checked: <what you could verify of the diff and CI>.
What you need to confirm: <the one concrete thing>.

Leaving open until you verify."
```

Print `⏸ #N needs you — <one line on what is required>`.

## Step 4: Report

After every issue is handled, print a summary table, one row per issue:

```markdown
## Verify pass: N issues

| #  | Issue | PR(s) | Disposition | What happened |
|----|-------|-------|-------------|---------------|
| #224 | _Design Polish missing "use client"_ | #282 | closed | DoD met: hook adds .tsx detection at agent.cjs:142, test at agent.test.cjs:88, CI green |
| #252 | _mem0+Letta substrate_ | #258 #264 | gap → #266 | DoD "migrate OMEGA memories" unmet; no diff touches the migration path |
| #381 | _telephony setup_ | #390 | needs you | Confirming the live phone line connects needs a human call I cannot place |
```

Then:

```
Verify pass complete.
- Closed: <count> — #A #B (evidence on each issue)
- Gap, stays open: <count> — #C (→ #D)
- Needs you: <count> — #E: <what you must verify>

Reopen any close you disagree with; the evidence comment is on the issue.
```

If there were zero needs-you items, say so plainly. That is the healthy default, not something to apologize for.

## Cross-Repo Verification

This skill operates on the current repo only. To verify another repo's queue, `cd` to that repo first and run `/verify` there. Cross-repo flag is intentionally not supported. An issue whose remaining work lives in another repo is a `gap` here: document the cross-repo dependency and leave it open.

## When Luis Stops Mid-Pass

Luis can stop at any point. Don't push back. Print what's been handled and what remains. The queue persists in GitHub state, so picking up next session is automatic.

## Critical Rules Recap

- DEFAULT to verify-and-close. If you can confirm the DoD, close it. Don't wait for approval. Verification is the authorization.
- ALWAYS write a comment on every issue you touch: evidence on `close`, the gap on `gap`, the human action on `needs-human`. NEVER leave an issue silent.
- ROUTE to Luis ONLY for access, subjective judgment, or external observation you cannot perform. An "I'm unsure" you can resolve by reading more is not a route. Resolve it.
- NEVER close when a DoD item is unmet, a regression is visible, or CI is red. That is a `gap`. Document it.
- NEVER classify "PR title looks fine" as verification. Read the diff.
- Luis can reopen any close. The evidence comment makes every close auditable.

Complete the user's request by building the queue, verifying each issue against its DoD, closing what you can confirm with evidence, documenting every gap and human-only item on its issue, and reporting what you did.
