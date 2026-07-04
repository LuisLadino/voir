---
name: board-coordination
description: >
  How the kit coordinates parallel agents through a board: lanes as issue labels, the board as a derived view, the collision rule, and the one-workspace-per-lane operating model. Required reading before editing the board.cjs lib, the board-sweep or classify-on-create hooks, the /board command, or .claude/board.yaml.
applies_to:
  - ".claude/hooks/lib/board.cjs"
  - ".claude/hooks/lifecycle/board-sweep.cjs"
  - ".claude/hooks/lifecycle/classify-on-create.cjs"
  - ".claude/commands/**/board.md"
  - ".claude/board.yaml"
category: kit
related: [dispatch, session-isolation, hooks]
---

# Board Coordination

How the kit turns a project's open issues into a coordination surface for parallel agents: which issues are safe to run concurrently, what is launchable, and which lane a workspace should take. The see→decide→act loop turned on the project itself.

## The Job

A solo operator running parallel agents through Conductor workspaces and dispatch workers needs three things the kit did not provide.

- **Don't collide.** Two agents editing overlapping files in parallel cause merge conflicts or silent clobbers. The board makes file-overlap legible.
- **Stay organized without effort.** Every issue lands on a lane automatically, so the surface never rots and parallel sessions can't pile up untagged work.
- **See the whole field.** One board where launchable, in-flight, and safe-to-parallelize are visible at a glance.

## Core Decision: Labels Are the Source of Truth

The lane lives as a label on the issue, not in the Projects board.

- `workstream/<slug>` is the lane, the file-overlap proxy.
- `status/<stage>` is the workflow stage: `backlog`, `ready`, `in-progress`, `blocked`, `deferred`. A closed issue is Done by being closed, so there is no `status/done`.
- `priority/<level>` is `high`, `medium`, or `low`.

The GitHub Projects v2 board is a derived visual mirror of those labels. This is deliberate. The kit's own principle is that GitHub issues are the system of record. A board-as-store would be a second store to reconcile, which is why hand-rolled boards rot, and why GitHub's built-in closed→Done silently drifts: that workflow only touches the built-in `Status` field, never a custom one. With labels as truth:

- The board can never drift from the issues. It is derived.
- closed→Done is free. Closed issues simply leave the open-issue query.
- The coordination directive reads `gh issue list`, always current, never the Projects API, so it works even before a board is provisioned.

The directive and collision logic never read the board's fields. Board-field staleness affects only the visual, never coordination correctness.

## The Lane Is the Issue Boundary Is the File Boundary

Lanes make an existing rule operational, not a new concept bolted on. `.claude/CLAUDE.md` under "When to create a new issue vs continue the current one" says: create a new issue when the work is a different component or domain. That rule already partitions work by component. The `workstream/<slug>` lane IS that partition, named and made visible.

Four boundaries collapse into one.

- **Component/domain** — was the "new issue?" test in CLAUDE.md; now the lane.
- **Lane / Workstream** — did not exist; now the issue's `workstream/*` label.
- **File-overlap** — was a hoped-for correlation; now enforced by cutting lanes at architecture altitude.
- **Issue boundary** — was a prose rule nothing checked; now the lane the agent is in.

The consequence for parallel agents: an agent working a lane knows its blast radius is that lane's component. When it discovers work in another component, that is by definition CLAUDE.md's "different component or domain", so it files a new issue in that issue's lane rather than scope-creeping the current edit. The lane boundary becomes the issue-creation boundary, so discovered work lands pre-classified instead of escaping untagged.

## Workstreams Are Cut at Architecture Altitude

A lane survives only when cut at the architecture altitude, not the feature altitude. A feature lane like "board provisioning" dies when the feature ships. A pillar like "Workflow" never does. Workstreams are derived from the project's CLAUDE.md Objective and Skill Map, the settled architecture, so new work flows into the same lanes as the project evolves and only the contents rotate. This is also why same-lane issues tend to touch the same files: a lane is a cohesive slice of the architecture.

The lane set is project-specific and lives in `.claude/board.yaml`. The kit ships no project's lanes. `/board provision` derives them from that project's CLAUDE.md.

## The Collision Rule

- **Different workstream means safe to run in parallel.** Different architecture slices imply disjoint files.
- **Same workstream means run serially.** Same slice implies shared files. Within a lane, dispatch in parallel only the sub-issues you can see are genuinely file-disjoint; otherwise work them in sequence.
- **Chokepoint exceptions serialize even across lanes.** Some files are touched by many lanes, for example `settings.template.json`, `.claude/.kit-manifest`, `package.json`, or a hot runtime file. Two issues that both touch a chokepoint collide regardless of lane. Chokepoints are listed in `board.yaml` under `chokepoints:` and surfaced as prose by `/board`. They cannot be computed from labels.

Workstream is a proxy for file-overlap, not a guarantee. Precise file-claim detection is a separate, harder capability that is out of scope here.

## Deferred vs Blocked

Both `blocked` and `deferred` take an issue off the launchable surface, but they mean different things and must not be conflated.

- **`blocked`** — waiting on a named dependency. The issue *would* be worked now if the dependency cleared. The wait is external to the operator's choice: another issue, an upstream decision, an unavailable resource.
- **`deferred`** — a deliberate operator set-aside. Nothing is blocking it; the operator chose "not now." Defer-by-choice is a normal action: an issue that is real and unblocked but not what the operator wants any workspace to pick up yet.

Both are excluded from `launchable` and `parallelSafe`. The distinction is load-bearing: `blocked`'s count answers "what is waiting on a dependency," and polluting it with deliberate set-asides degrades that signal. Before `deferred` existed, the only levers to take an unblocked issue off the recommendation surface were misusing `status/blocked`, demoting `priority` (which corrupts the priority axis — a low-priority issue is still a launchable candidate when `status/ready`), or closing the issue. `deferred` is the clean lever.

`deferred` is excluded **unconditionally** — even a `priority/high` deferred issue is not launchable. That is the point: priority no longer re-surfaces it. To bring a deferred issue back, the operator un-defers it by setting its stage back to `ready` or `backlog`. Deferred issues stay visible in the per-lane breakdown (the lane's `deferred` count) and in the board's Deferred column; they leave the *recommendation*, not the board.

## The Operating Model: One Workspace Per Lane

The collision rule is enforced at the level the operator acts.

- **One Conductor workspace equals one lane.** The operator opens a workspace, `/board` recommends a lane, the agent drives that lane's issues top-to-bottom.
- **Parallelism is across lanes, not within one.** Workspaces opened in parallel take different lanes, so they are file-disjoint and don't collide.
- **Fork or archive continues the lane.** Lane state lives on the issues, so any workspace entering a lane re-derives the same worklist from `gh issue list --label workstream/<slug>` regardless of fork or archive history. This is the payoff of labels-as-truth: lane continuity survives session boundaries with no session-held state.

Division of labor: the kit defines lanes from architecture, classifies issues automatically, and recommends what to open next. The operator's only required action is opening the workspace, the one thing the tool needs a human for since there is no API to create a Conductor workspace, plus the veto.

## Three-Layer Classification

Judgment lives where a model is. Determinism lives where one is not.

1. **`/plan` skill, primary.** At issue-birth the agent sets `workstream/<slug>` with full context, as part of the existing issue-creation discipline.
2. **`classify-on-create` hook, deterministic safety net.** PostToolUse on `gh issue create`. When a new issue lands with no `workstream/*` label, a keyword heuristic applies one if confident; ambiguous issues are left. Labels only, fail-open. Handles issues created outside `/plan` such as a raw `gh issue create` or a dispatch worker.
3. **`board-sweep` hook, catch-all.** SessionStart. Surfaces every remaining lane-less open issue, with a deterministic suggestion where confident, so the operator or `/board` lanes it. The "no lane" set is a triage inbox, and the sweep drains it into view. The sweep classifies on issue title only, where the create-hook uses title plus body: a bulk title-only pass avoids an extra `gh issue view` per issue at session start, and the operator confirms the lane anyway.

All three fail open. Classification or board calls failing must never block issue creation or session start.

## What the API Can and Cannot Do

Verified against the GitHub Projects v2 GraphQL API and the `gh project` CLI.

| Capability | Scriptable |
|---|---|
| Create board, create custom fields with single-select options | yes |
| Link board to repo, add issues as items, set field values | yes |
| Views: Board, By-workstream, Launchable layouts and filters | no, UI-only |
| Workflows: Auto-add, Closed→Done, auto-archive | no, UI-only |

`/board provision` does everything in the scriptable rows via `gh`, then emits the exact one-time click-path for the UI-only rows. The kit's three-layer classification replaces GitHub's auto-add because it classifies rather than dumping to Triage. The saved views and the auto-archive workflow stay a documented manual setup.

## board.yaml

Project-owned and survives sync. Written by `/board provision`, read by the lib and hooks. When absent, the hooks no-op and the board features are off.

```yaml
# .claude/board.yaml
project:
  number: 13              # gh project number
  id: PVT_xxx             # node id for GraphQL field-value mutations
  owner: LuisLadino
  scope: user             # user | org
repo: LuisLadino/claude-kit
fields:                   # provisioned single-select ids + option maps,
                          # read only by /board to mirror labels into columns
  workstream: { id: PVTSSF_xxx, options: { workflow: "opt", context: "opt" } }
  stage:      { id: PVTSSF_yyy, options: { Backlog: "opt", Ready: "opt" } }
  priority:   { id: PVTSSF_zzz, options: { High: "opt", Medium: "opt", Low: "opt" } }
workstreams:              # the lanes, derived from CLAUDE.md skill-map
  - slug: workflow
    tag: 1                 # the concise address the operator types: /board 1
    name: "Workflow"
    keywords: [skill, hook, dispatch, phase, verify, workflow]
  - slug: context
    tag: 6
    name: "Context & observability"
    keywords: [context, session, tracking, lens, observability]
chokepoints:              # files many lanes touch, serialize even cross-lane
  - settings.template.json
  - .claude/.kit-manifest
  - package.json
```

`workstreams[].keywords` drives the deterministic classifier. `fields` is read only by `/board` for the visual mirror; the lib and hooks ignore it and stay label-only.

`workstreams[].tag` is the lane's concise numeric address — what the operator types to drive a lane (`/board 4`), identical in form across every project so the muscle memory transfers. `board.cjs lane <token>` resolves a numeric tag, an exact slug, or an exact display name to the lane's slug; an unknown token returns the available lanes so the command shows a menu instead of failing silently. The tag is explicit and stable in `board.yaml`, never positional — reordering lanes can't silently mispoint a tag. The descriptive `name` stays as the board-column label; the tag is only the address.

## Module Boundaries

- `.claude/hooks/lib/board.cjs`. Shared core and CLI. Pure label parsing, classification, and directive selectors, with injectable IO for `gh` and file reads. The CLI subcommands `config`, `workstreams`, `classify`, `unlaned`, `lane`, and `directive` emit JSON that `/board` narrates. No Projects-API calls.
- `.claude/hooks/lifecycle/classify-on-create.cjs`. PostToolUse observability hook. Label only.
- `.claude/hooks/lifecycle/board-sweep.cjs`. SessionStart observability hook. Read only.
- `.claude/commands/project-management/board.md`. The LLM-driven command. Owns all Projects-API interaction: provision, mirror, reconcile, and the recommendation-first directive.

## Invariants

- The lane is a `workstream/<slug>` label on the issue. The board mirrors it; the board is never the source of truth.
- The directive and collision logic read labels via `gh issue list`, never the Projects API.
- Hooks touch labels only. Projects-API calls live solely in the `/board` command.
- All classification and board paths fail open. They never block issue creation or session start.
- Lanes are derived from the project's own CLAUDE.md skill-map. The kit bakes in no project's lane names.
- `CLAUDE_KIT_NO_BOARD_SWEEP=1` mutes the session-start sweep.

## Testing

```bash
node .claude/hooks/lib/board.test.cjs
node .claude/hooks/lifecycle/classify-on-create.test.cjs
node .claude/hooks/lifecycle/board-sweep.test.cjs
```

## See Also

- `dispatch.md`. Autonomous worker execution. The board says what is safe to dispatch in parallel; dispatch runs it.
- `session-isolation.md`. Worktree isolation for parallel sessions, the mechanism beneath one-workspace-per-lane.
