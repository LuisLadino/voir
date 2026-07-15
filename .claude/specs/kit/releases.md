---
name: releases
description: >
  How a project cuts a release with the changelog-fragment machinery: what a
  fragment is, where pending changes live between releases, when to cut, and the
  step-by-step cut procedure. This is the canonical, project-agnostic procedure
  every kit-synced project inherits — the release-cadence prompt and the
  assembler point here, so it must reach downstreams (the kit's own repo-root
  CONTRIBUTING.md does not sync). Required reading before editing
  release-cadence.cjs, changelog-assemble.cjs, or release-cadence-surface.cjs.
  Covers the fragment model, the six-subsection fragment format, the cadence
  trigger, the cut steps, and which steps are the project's own call.
applies_to:
  - ".claude/hooks/lib/release-cadence.cjs"
  - ".claude/hooks/lib/changelog-assemble.cjs"
  - ".claude/hooks/lifecycle/release-cadence-surface.cjs"
triggers: [release, changelog, version, cut a release, unreleased]
category: kit
---

# Releases

How this project turns a running list of changes into a dated, readable
`CHANGELOG.md`. Project-agnostic: every kit-synced project inherits this
procedure. Steps that are the project's own call are marked as such.

## The fragment model

`/commit` never edits `CHANGELOG.md`. Parallel PRs that all append to
`CHANGELOG.md [Unreleased]` conflict on GitHub, which ignores the `merge=union`
`.gitattributes` driver server-side. Instead each PR writes a **fragment** — a
new file `changelog.d/<branch-slug>.md`. One file per branch means two open PRs
never touch the same file, so parallel PRs never conflict on the changelog.

Between releases, pending unreleased changes live in `changelog.d/`, not in
`CHANGELOG.md [Unreleased]`. A release cut folds every fragment into
`[Unreleased]` and deletes the fragments. This mirrors towncrier / Changesets.

## Fragment format

A fragment is a Keep-a-Changelog-shaped body: any of the six KaC subsections,
each with top-level `- ` bullets (indented sub-bullets allowed for detail).

```markdown
### Fixed

- **Short headline (#123).** One or two sentences on what changed and why.
```

The six subsections, in canonical order: `### Added`, `### Changed`,
`### Deprecated`, `### Removed`, `### Fixed`, `### Security`. Bullets under any
other heading are not recognized — the assembler leaves such a fragment in place
and warns rather than folding it, so nothing is silently lost. `/commit` writes
fragments automatically (commit skill Step 3c-frag); write one by hand the same
way when committing outside the skill.

## When to cut a release

`[Unreleased]` (fragments included) grows on every commit and must be closed
into a dated version periodically, or it becomes an unreadable dump. Cut a
release when the entry count crosses the cadence threshold (default 30), or when
a batch of related work reaches a natural milestone. There is no fixed calendar —
the trigger is readability.

The crossing is surfaced, never blocking: a SessionStart advisory
(`release-cadence-surface`) reminds each session while over threshold, and
`/commit` flags it at the crossing moment. Silence the session reminder with
`CLAUDE_NO_RELEASE_CADENCE_WARN=1`; override the threshold with
`CLAUDE_RELEASE_CADENCE_THRESHOLD`.

## How to cut a release

1. **Assemble the fragments.** Run `node .claude/hooks/lib/changelog-assemble.cjs`.
   It folds every `changelog.d/*.md` fragment into `CHANGELOG.md [Unreleased]`
   under the matching subsection, in canonical order, and deletes the fragments.
   Preview first without writing: add `--draft`. If `CHANGELOG.md` is missing or
   has no `## [Unreleased]` header, it aborts without deleting anything — fix
   that, then re-run. Review the assembled `[Unreleased]` before continuing.
2. **Choose a version identifier.** _Project's call._ Semver
   (`MAJOR.MINOR.PATCH`) and a calendar scheme (`2026.07`) both work; pick what
   the project already uses.
3. **Close `[Unreleased]`.** Rename `## [Unreleased]` to
   `## [<version>] - YYYY-MM-DD` (the cut date), then add a fresh empty
   `## [Unreleased]` skeleton above it with the six empty `###` subsections.
4. **Add compare links** at the bottom if the project uses them. _Project's
   call._ `[Unreleased]` pointing at `<version>...HEAD`, and `[<version>]`
   pointing at `<previous>...<version>`.
5. **Bump the version manifest** (e.g. `package.json`) to match, if the project
   has one. _Project's call._
6. **Tag after merge.** _Project's call._ If the project tags releases, tag the
   merge commit once the PR lands so the compare links resolve.

Steps 1 and 3 are the mechanism and are the same everywhere. Steps 2, 4, 5, and
6 depend on how the project versions and distributes; a project that ships by
file-sync rather than a pinned package may skip compare links or tags.
