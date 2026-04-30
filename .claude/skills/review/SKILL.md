---
name: review
description: >
  Pre-commit code review using parallel agents. Use when: the user says
  "review this", "review the changes", "check the code", "code review",
  "review before commit", or when work is done and needs quality verification
  before committing. Focused on the diff, not the whole codebase.
  For full codebase audits, use /audit instead.
allowed-tools: Read, Bash, Grep, Glob, Agent
---

# Review

You're reviewing code changes before they get committed. This is a focused, diff-based review — not a full codebase audit.

**This skill spawns parallel review agents. Each agent focuses on one quality dimension. You synthesize their findings.**

## Step 1: Get the Diff

```bash
# What's staged?
git diff --staged --stat

# What's unstaged?
git diff --stat

# Full diff content
git diff --staged
git diff
```

If nothing is staged or changed, say so and stop.

**Assess scope:** Count files changed and lines modified. This determines how many agents to spawn.

## Step 2: Load Project Context

```bash
# Read stack config for tech context
cat .claude/specs/stack-config.yaml 2>/dev/null

# Read component specs for changed areas
ls .claude/specs/components/ 2>/dev/null
```

Read any component specs that apply to the files being changed.

## Step 2.5: Detect UI Files in Diff

Scan the changed files for UI content. If any file in the diff matches one of these patterns, the diff contains visual work and needs a Design Polish agent alongside the standard reviewers.

UI file patterns (matches `.claude/specs/design/craft.md` applies_to):
- Component frameworks: `*.tsx`, `*.jsx`, `*.vue`, `*.svelte`, `*.astro`, `*.mdx`
- HTML and templates: `*.html`, `*.htm`, `*.hbs`, `*.handlebars`, `*.ejs`, `*.pug`, `*.njk`, `*.liquid`, `*.erb`, `*.twig`
- Microsoft/.NET UI: `*.cshtml`, `*.razor`, `*.vbhtml`, `*.aspx`, `*.ascx`, `*.xaml`
- Mobile UI markup: `*.storyboard`, `*.xib`, `res/layout/*.xml`
- CSS variants: `*.css`, `*.scss`, `*.sass`, `*.less`, `*.styl`, `*.stylus`, `*.pcss`, `*.postcss`
- Visual scripts: files under `scripts/`, `animations/`, `motion/`, `effects/`, or `hooks/use*` with `.ts`/`.tsx`/`.js`/`.jsx` extension

Quick bash check:
```bash
git diff --name-only \
  | grep -E '\.(tsx|jsx|vue|svelte|astro|mdx|html|htm|hbs|handlebars|ejs|pug|njk|liquid|erb|twig|cshtml|razor|vbhtml|aspx|ascx|xaml|storyboard|xib|css|scss|sass|less|styl|stylus|pcss|postcss)$|/(scripts|animations|motion|effects)/.*\.(ts|tsx|js|jsx)$|/hooks/use.*\.(ts|tsx)$' \
  | grep -vE '^(\.claude/|node_modules/|\.next/|\.nuxt/|\.svelte-kit/|\.output/|\.angular/|dist/|build/|out/|target/|coverage/)|/vendor/|\.min\.(css|js)$|\.bundle\.css$' \
  | head -1
```

The second `grep -v` mirrors `craft.md`'s `excludes` list. Without it, kit files under `.claude/` would trigger Design Polish even though the craft spec disclaims them at `applies_to:` line 78. If a new excludes pattern lands in `craft.md`, add it here in lockstep. A future cleanup could read `excludes` directly from `craft.md` at runtime; for now keep them aligned by hand.

If the check returns anything, include the Design Polish agent in Step 3's parallel spawn.

## Step 3: Spawn Review Agents

Spawn agents **in parallel** (single message, multiple Agent tool calls).

**Scale to scope:**
- Small diff (1-3 files, < 100 lines): 2 agents (security + patterns)
- Medium diff (4-10 files, 100-500 lines): 3 agents (security + performance + patterns)
- Large diff (10+ files, 500+ lines): 4 agents (security + performance + patterns + architecture)

**Plus: Design Polish agent when Step 2.5 detected UI files.** Added on top of whatever scope-scaled set is already spawning. Spawn it in the same parallel batch.

### Agent: Security Reviewer

```
Review this diff for security issues. Focus ONLY on production-risk findings.

[paste the diff]

Check for:
- Input validation gaps (user input reaching DB queries, file paths, commands)
- Authentication/authorization holes
- Secrets or credentials in code
- Injection vulnerabilities (SQL, XSS, command injection)
- Unsafe deserialization or file operations
- Exposed error details that leak internals

SKIP: theoretical concerns, best-practice suggestions, style issues.

Every finding MUST pass the "so what?" test — could this actually cause harm in production?

Report format:
SEVERITY: critical/high/medium
FILE: path:line
ISSUE: what's wrong
FIX: how to fix it
```

### Agent: Performance Reviewer

```
Review this diff for performance issues. Focus ONLY on measurable impact.

[paste the diff]

Check for:
- N+1 queries or unnecessary DB calls
- Blocking operations in async contexts
- Memory leaks (unclosed resources, growing collections)
- Unnecessary re-renders or re-computations
- Missing pagination on unbounded queries
- Large synchronous operations that should be async

SKIP: micro-optimizations (< 10% impact), theoretical bottlenecks, premature optimization.

Every finding MUST have measurable impact. "This could be slow" is not enough — explain WHY and WHEN.

Report format:
IMPACT: high/medium
FILE: path:line
ISSUE: what's wrong
FIX: how to fix it
```

### Agent: Patterns Reviewer

```
Review this diff against project conventions. Focus on consistency and correctness.

[paste the diff]

[include relevant spec content or spec file paths]

Check for:
- Violations of project specs (naming, structure, patterns)
- Error handling gaps (missing try/catch, unhandled promise rejections)
- Type safety issues (any types, missing null checks)
- Dead code or unused imports introduced
- Test coverage gaps for new logic
- Documentation gaps for public APIs

SKIP:
- style preferences not in specs, minor formatting, comments on obvious code
- rules from `.claude/specs/design/craft.md` — the Design Polish agent covers visual/craft concerns (correctness, anti-slop, color, typography, layout, motion) when UI files are in the diff. Duplicating these findings across both reviewers forces the orchestrator to dedup by file:line and makes reviewers look like they hallucinate duplicates. Leave craft.md to Design Polish.

Report format:
FILE: path:line
ISSUE: what's wrong
SPEC: which spec it violates (if applicable)
FIX: how to fix it
```

### Agent: Architecture Reviewer (large diffs only)

```
Review this diff for architectural concerns. Focus on design decisions.

[paste the diff]

Check for:
- New dependencies that should be evaluated
- Module boundary violations (importing from internals of another module)
- Circular dependencies introduced
- Responsibilities in the wrong layer (business logic in routes, UI logic in models)
- Changes that should have updated the system map

SKIP: philosophical disagreements, alternative approaches that aren't better.

Report format:
FILE: path:line
CONCERN: what's wrong
IMPACT: what breaks or degrades if this ships
FIX: how to fix it
```

### Agent: Design Polish Reviewer (when UI files detected in Step 2.5)

```
Review this diff for visual and craft quality. This is /design polish mode running as a review agent.

[paste the diff]

Read before starting:
- .claude/specs/design/craft.md — craft floor (correctness, anti-slop, color, typography, layout, motion)
- .claude/specs/design/direction.md — project design direction (if it exists; treat every rule there as hard)
- .claude/specs/design/design-system.md — project design system (if it exists; treat as authoritative)

Check against:
- correctness rules in craft.md (a11y, prefers-reduced-motion, hover gating, hardware-accelerated properties, focus states, WCAG contrast, semantic HTML) — always blocking
- anti-slop patterns (side-stripe borders, gradient text, glassmorphism everywhere, 3-column card rows, hero metric template, emoji as icons, default shadcn) — always check
- color / typography / layout / motion rules — apply when the diff touches that domain
- project direction or design-system — wins over craft floor where rules conflict

SKIP: style preferences not in the specs or direction, micro-optimizations, theoretical concerns, anything that doesn't actually ship with the diff.

Every finding MUST pass the "so what?" test — does this degrade the user-visible experience or violate a hard rule?

Report format (same shape as other reviewers for unified table merging):
SEVERITY: high or medium, using this mapping:

- `high` — any correctness violation or project-spec violation:
  - accessibility (a11y): missing ARIA, non-semantic HTML where semantic is expected, missing focus states, WCAG contrast failures
  - motion safety: missing `prefers-reduced-motion` guard, scroll-triggered animation that moves content for users who haven't opted in
  - performance correctness: `transition: all`, animating non-composited properties (top/left vs transform), layout thrash patterns
  - touch/hover gating: hover-only affordance on touch devices, missing `@media (hover: hover)` guard
  - direction.md or design-system.md rule violation (project specs always beat craft floor)

- `medium` — craft-floor suggestions where correctness is not at stake:
  - color: pure black / pure white where off-shade is specified, hardcoded hex instead of token
  - typography: line-height, line-length, tracking outside the craft-floor ranges
  - layout craft: asymmetry, density, grid-system consistency that doesn't affect usability
  - motion craft: duration/easing choices within the "reasonable" band
  - anti-slop patterns that don't block accessibility: 3-column card rows, hero metric template, emoji as icons

A color-ban finding is medium unless the ban exists because of contrast (then high). A motion finding is medium unless it violates reduced-motion (then high). Err toward medium when in doubt — Step 4 will re-sort after dedup.

Within `medium`, order findings by user-visible impact so the top of the list is what a user would actually notice. Split into two tiers and list UX-blocking craft first:

- `medium (UX-blocking craft)` — the defect shows up at runtime:
  - unresponsive or fixed-column grids that break on narrow viewports: `1fr 1fr 1fr` where `auto-fit minmax` was needed, hardcoded widths past the breakpoint
  - motion asymmetry the eye catches: drawer enters but has no exit path, mismatched enter/exit durations
  - line-length past 80ch, leading so tight it fatigues reading, density that forces extra scroll or obscures hierarchy
  - container-query gaps where a component reads wrong inside a narrow parent

- `medium (craft refinement)` — spec-compliance with no runtime difference:
  - sRGB hex where OKLCH is specified, untinted neutrals, token-naming drift
  - easing curve inside the reasonable band but not the project's custom curve
  - anti-slop structural choices that don't affect usability: 3-column card rows, hero metric template, emoji-as-icon where an SVG would ship identically

List UX-blocking craft before refinement. Findings within each tier can stay in file order. Step 5 caps the list if medium is long; ranking here is what makes the cap meaningful.

FILE: path:line
ISSUE: what's wrong visually
FIX: how to fix it, with specific before/after when useful
```

## Step 4: Synthesize

Wait for all agents to complete. Then:

1. **Deduplicate** — remove findings that overlap across agents. Specifically:
   - Group findings by `file:line`. If two or more reviewers flagged the same location, keep the most specific description (longer, more concrete, names the rule) and attribute in the output as `[category A + B]`.
   - If the Patterns Reviewer and the Design Polish Reviewer both report against `craft.md` rules on the same file:line, collapse to one finding and attribute to Design Polish (it owns craft). This is a safety net — the Patterns Reviewer prompt now instructs it to skip craft.md, but dedup here protects against prompt drift.
2. **Filter** — drop anything that doesn't pass the "so what?" test
3. **Sort** — critical/high first, then medium. Inside medium, preserve the Design Polish agent's impact order (UX-blocking craft before refinement). Do not re-sort medium findings alphabetically or by file.
4. **Count** — tally findings by category, and within medium split the count into `UX-blocking` vs `refinement` when the Design Polish agent ran

## Step 5: Report

Merge findings from every agent (including Design Polish if spawned) into a single unified table. Design findings use the same severity language so they sort and scan alongside the others.

```
REVIEW COMPLETE

Scope: [X files, Y lines changed]
Reviewers: [security, performance, patterns, architecture, design]

Findings: [N total] — [critical: X, high: X, medium: X]

---

CRITICAL/HIGH:
1. [FILE:LINE] [category] — [issue]
   Fix: [recommendation]

2. ...

MEDIUM:
1. ...

---

CLEAN AREAS:
- [category]: No issues found

VERDICT: [PASS — safe to commit / ISSUES — fix critical/high before committing]
```

The `[category]` tag distinguishes which agent found each issue — `security`, `performance`, `patterns`, `architecture`, or `design`. Only list reviewers that actually ran in the `Reviewers:` line — design appears when Step 2.5 detected UI files.

**Medium cap.** When the medium count is 10 or more, show only the top 5 in full FILE/ISSUE/FIX form. Collapse the remaining medium findings to one line each under a `MEDIUM (abbreviated)` subheader: `- FILE:LINE [category] — ISSUE`. The top 5 come from the Design Polish agent's impact order (UX-blocking craft first, then refinement) merged with any medium findings from other agents at the same tier. The cap keeps the top of the report actionable without dropping the long tail.

## Moving On

If PASS: Proceed to `/commit`.

If ISSUES:
- Fix critical and high findings
- Run `/review` again after fixes to verify
- Medium findings can be addressed in follow-up commits

## Notes

- This reviews the DIFF, not the whole codebase. For full audits, use `/audit`.
- Each agent runs in a fresh context with project awareness (via subagent-context hook).
- Agents are told to skip noise. If a finding is theoretical or style-only, it shouldn't appear.
- The "so what?" test: every finding must answer "what happens in production if this ships?"
