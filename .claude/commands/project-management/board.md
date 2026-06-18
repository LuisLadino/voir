---
description: Provision and operate the project's parallel-agent board. Bare /board recommends which lane to open next; /board provision sets it up; /board sync reconciles; /board <lane> drives a lane.
---

# Board

The coordination surface for parallel agents. Read `.claude/specs/kit/board-coordination.md` first — it defines the model this command operates: lanes are `workstream/*` labels (the source of truth), the GitHub Projects board is a derived mirror, and the collision rule is one-workspace-per-lane.

You own every GitHub Projects-API call here. The hooks never touch the Projects API; this command does.

## Pick the mode

- No argument → **Directive** (the default, recommendation-first).
- `provision` → **Provision** (first-time setup).
- `sync` → **Sync** (reconcile labels into the board, report lane-less issues).
- A workstream slug, e.g. `workflow` → **Drive a lane**.

If `.claude/board.yaml` is absent and the mode is anything but `provision`, stop and tell the operator to run `/board provision` first.

## Directive

The most-used mode. You read the live board and tell the operator what to open next. Recommendation first, raw data second.

```bash
node .claude/hooks/lib/board.cjs directive
```

This emits JSON: `recommended` (the lane to open), `parallelSafe` (lanes safe to run simultaneously), `lanes` (full per-lane breakdown, ranked), `unlaned` (the triage inbox). It reads `gh issue list`, so it is always current.

Narrate it like this, leading with the call:

```
Open a workspace for **<recommended.name>** — <launchable> launchable, top is #<n> (<title>, <priority>).
Safe to run alongside: <other parallel-safe lane names>.
Hold: <lanes whose top issue is blocked, with the blocker>.
```

Then, only if useful, the per-lane breakdown (lane, launchable, blocked, top issue) and the lane-less count. Cross-reference `board.yaml` `chokepoints:` — if two recommended-parallel lanes both have a top issue likely to touch a chokepoint, say so and suggest serializing those two.

The operator's next move is to open a Conductor workspace (⌘⇧N) and tell you the lane. You drive it. You recommend; they act and may override.

## Provision

First-time setup. Requires the `project` token scope: check `gh auth status`; if it lacks `project`, instruct `gh auth refresh -s project` and stop.

**1. Derive the lanes from architecture.** Read the project's root `CLAUDE.md` Objective and Skill Map. Propose 4 to 8 workstreams cut at the architecture altitude (pillars, not features — see the spec). For each: a slug, a display name, and 4 to 8 classifier keywords. Show the operator the proposed lanes and confirm before creating anything. This is the one judgment step; you propose, they confirm.

**2. Create the labels.** For each workstream, and for the standard axes if missing:

```bash
gh label create "workstream/<slug>" --description "<name>" --color 1D76DB --force
# ensure stage + priority labels exist (skip any that already do):
gh label create "status/ready" --color 0052CC --force
gh label create "status/blocked" --color D93F0B --force
gh label create "priority/high" --color B60205 --force
```

**3. Create the board and capture its ids.**

```bash
gh project create --owner "@me" --title "<Project name>" --format json
# → record number and id
```

**4. Create the single-select fields, then read back the option ids.**

```bash
gh project field-create <num> --owner "@me" --name "Workstream" --data-type SINGLE_SELECT \
  --single-select-options "<Name1>,<Name2>,..."
gh project field-create <num> --owner "@me" --name "Stage" --data-type SINGLE_SELECT \
  --single-select-options "Backlog,Ready,In Progress,Blocked,Done"
gh project field-create <num> --owner "@me" --name "Priority" --data-type SINGLE_SELECT \
  --single-select-options "High,Medium,Low"
gh project field-list <num> --owner "@me" --format json   # → field ids + option ids
```

**5. Link the board to the repo.**

```bash
gh project link <num> --owner "@me" --repo "<owner>/<repo>"
```

**6. Write `.claude/board.yaml`** with the project number and id, the `fields` block (field ids + option-name→id maps), the `workstreams` (slug, name, keywords), and a `chokepoints` list of files many lanes touch. Schema is in the spec.

**7. Lane, stamp, add, and mirror every open issue.** For each open issue:
- Lane it: run `node .claude/hooks/lib/board.cjs classify <n>`. If confident, use that slug. If not, classify it yourself from the issue's content with judgment. Apply `gh issue edit <n> --add-label "workstream/<slug>"`, and add `status/*` + `priority/*` if missing.
- Add it to the board: `gh project item-add <num> --owner "@me" --url <issue-url>`.
- Mirror labels into the board fields so the columns are clean. Get item ids with `gh project item-list <num> --owner "@me" --format json` (maps `.content.number` → `.id`), then per item:

```bash
gh project item-edit --id <item-id> --project-id <project-id> \
  --field-id <workstream-field-id> --single-select-option-id <option-id>
# repeat for Stage and Priority
```

**8. Emit the UI-only click-path.** The API cannot create views or workflows. Print these steps for the operator to do once in the board UI:
- **Views** (filter bar, then "Save changes to view"): a **Board** view grouped by `Stage`; a **By workstream** view grouped by `Workstream`; a **Launchable** view filtered `field:Priority=High` and `field:Stage=Ready,Backlog`.
- **Workflows** (Project → Settings → Workflows): enable **Auto-add** for the repo so nothing escapes the board, and **Item closed → set Status: Done** plus **auto-archive** of closed items.

Then run **Sync** once to confirm everything reconciles, and finish with a **Directive**.

## Sync

Reconcile the board to the labels (labels are truth) and surface the triage inbox.

```bash
node .claude/hooks/lib/board.cjs unlaned     # issues with no workstream/* label
node .claude/hooks/lib/board.cjs config      # field ids for the mirror
```

For each lane-less issue, lane it (heuristic suggestion, else your judgment) with `gh issue edit`. Then add any open issue missing from the board (`gh project item-add`) and re-mirror each issue's `workstream`/`status`/`priority` labels into its board fields via `gh project item-edit`. Report what changed and what still needs a human decision.

## Drive a lane

When the operator says to take a lane, load its worklist.

```bash
node .claude/hooks/lib/board.cjs lane <slug>
```

This emits the lane's issues already ordered (launchable first, then priority, then number). Narrate:
- **Work first:** the top launchable issue. Hand it to the workflow — start `/research` on it.
- **Dispatchable now:** any other issues in this lane you can see are file-disjoint from the top one. Same-lane issues usually share files, so default to serial; only dispatch the genuinely independent ones.
- **Blocked:** what is waiting and on what.

Stay in the lane. If work surfaces that belongs to a different component, that is a different lane: file a new issue (routed per `.claude/CLAUDE.md`) with its `workstream/<slug>` label rather than scope-creeping the current one.
