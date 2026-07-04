---
name: doc-coverage
description: >
  The doc-coverage convention. How operating docs declare the code they document via `covers:` frontmatter, which docs are worth annotating, and how /commit and /sync-stack consume it.
applies_to: []
category: kit
---

# Documentation Coverage

Operating docs go stale when the code they document changes. The kit guards that with one convention: a doc declares the code paths it documents, and the workflow flags the doc when those paths change. This spec defines the convention. `/commit` uses it to catch staleness; `/sync-stack` uses it to find gaps.

This is **doc coverage** — prose docs documenting code. It is not the `documentation/` spec category, which is docstring and comment conventions.

## The `covers:` convention

An operating doc declares the code-path globs it documents in frontmatter:

```yaml
---
covers:
  - "runtime/**"
  - "scripts/morning-brief.*"
---
```

`covers:` is a list of globs, the same syntax a spec's `applies_to:` uses, matched by `matchGlob` in `lib/spec-discovery.cjs`. A doc with no `covers:` is invisible to the coverage tooling. Coverage is opt-in: an un-annotated runbook is not guarded, exactly as a spec without `applies_to` is not enforced.

## `covers:` is not `applies_to:`

They sit at opposite ends of the edit lifecycle. Never share the key.

- `applies_to:` on a spec is a pre-edit gate. `enforce-specs` blocks the edit until the spec is read.
- `covers:` on a doc is a post-edit staleness check. `/commit` prompts to re-verify the doc after the code it covers changed.

`enforce-specs` only scans files under the spec roots, so a `covers:` doc in `docs/` is never mistaken for an enforced spec today. A distinct key keeps it that way even if a project later sets `project_specs_root: docs/`, where a shared key would silently turn every annotated runbook into an edit-blocker.

## Which docs to annotate

Annotate a doc when its factual claims break when code changes. These are the high-coupling categories:

- **Runbooks and operating docs** — commands, endpoints, live-ops steps
- **Setup, install, onboarding** — dependencies, env vars, build steps
- **Configuration reference** — config keys, defaults, flags
- **API, CLI, interface reference** — signatures, routes, flag names
- **Data schema, contracts, migrations** — field names, types, shapes
- **Architecture and system map** — current module layout, data flow
- **Deployment, infra, environment** — hosts, secrets, pipeline steps
- **In-doc code examples** — snippets that must compile against the current API

In Diátaxis terms these are the how-to and reference docs, the fact-bearing quadrants.

## Which docs NOT to annotate

Do NOT annotate docs that change on intent, not on code. Annotating them fires the check on every code touch and erodes trust in it.

- Tutorials — conceptual, slow-moving
- Explanation, rationale, ADRs — frozen "why"
- Roadmap, vision, positioning
- Contributing, process, governance
- Glossary, terminology

The test: does the doc state a command, signature, path, or config value that code can falsify? Annotate it. Does it only explain why? Leave it un-annotated.

## Authoring: born docs annotated

When you create an operating doc in a guard-table category, declare its `covers:` at creation. Do not leave annotation for later. A doc born without `covers:` is invisible to the Guard from its first commit, and `/sync-stack` re-flags it as un-annotated on every run until someone adds the frontmatter by hand. Born-annotation is the step that makes Create feed Guard, closing the lifecycle loop instead of leaking the new doc back into Detect.

```yaml
---
covers:
  - "runtime/**"
---
# Runtime runbook
```

Declare the paths the doc actually documents, narrow over broad. A runbook for one service covers that service's globs, not the whole repo. The two create-prompts route here: `/commit` Step 3 when a high-coupling area has no covering doc, and `/sync-stack` STEP 10b when it reports a gap.

## Where operating docs may live

An operating doc is scanned in two places: the central doc folders `docs/` and `.claude/docs/`, and **co-located with the code it documents**. A service's operating doc lives as `services/<name>/README.md`, beside the service. Co-location is good practice; the tooling scans for it so a co-located README is guarded the same as a doc in `docs/`. The scanned roots are resolved from project structure by `lib/doc-coverage-structure.cjs`: the central folders plus the project's high-coupling code areas that exist. No per-project config is needed for the common case.

Multi-app projects name their deploy configs. One Fly app uses `fly.toml`, another `fly.runtime.toml`. The deploy guard table globs `fly*.toml`, so each named config is detected as its own deploy area a doc can cover. A doc covering only `fly.runtime.toml` satisfies that app's deploy area independent of the others.

## How the tooling consumes this

The pure matcher lives in `lib/doc-coverage.cjs`. It scans doc roots for `covers:` frontmatter and returns docs whose globs intersect a set of changed paths. The structural layer `lib/doc-coverage-structure.cjs` is the single source of truth both consumers share for the guard table and the scanned roots, so the Guard and the Detect never look at different sets.

- **`/commit`, the Guard.** Step 3 runs two routers. By change-type: feat/fix updates CHANGELOG, structural updates README. By declared path: `covers:` frontmatter across the project's docs, and when the staged diff intersects a declared glob, verify that doc by name.
- **`/sync-stack`, the Detect.** Reports high-coupling code areas with no covering doc, and docs missing `covers:`, so `/commit` can guard them.
