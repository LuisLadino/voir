---
name: design
description: >
  Design UI with craft. Use when the user mentions design, UI, UX, look and
  feel, polish, typography, color, motion, layout, spacing, hierarchy, or
  says "make it better", "this feels off", pre-ship visual review, before
  committing visual changes. Also use when the user describes a visual bug
  in engineering terms: "fix the animation", "doesn't align", "layout is
  off", "positioning wrong", "broken hero", "scroll is jumpy", "element
  doesn't render right". Two modes: 'shape' sets direction before code,
  'polish' runs a quality pass before review.
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---

# Design

Design is a cross-phase concern. Use this skill during `/ideate` or `/build` to set direction, and during `/review` to run a pre-ship quality pass.

This skill does not replace a project's design system. The project wins. This skill provides a craft floor the project can build on.

The craft rules themselves live as a single spec at `.claude/specs/design/craft.md` and auto-load via the enforce-specs hook whenever UI files are edited. You do not need to invoke this skill to get the rules; they appear on their own. Invoke this skill when you want its workflows: shape to set direction, polish to review a diff.

## When to invoke

- Setting visual direction for a new feature or project
- Reviewing UI changes before commit
- Fixing motion, typography, color, or layout that feels off
- Catching anti-slop patterns before they ship

## When NOT to invoke

This skill assumes the project has UI code. If the project is a CLI tool, data pipeline, library, or anything without visual surface, this skill does not apply.

Before running either mode, check for UI signals:
- Web: `package.json` with `react`, `vue`, `svelte`, `next`, `nuxt`, `astro`, `angular`, `solid`, or CSS/styling deps
- Microsoft/.NET: `*.csproj`, `*.sln`, `*.cshtml`, `*.razor`, `*.xaml`
- Mobile: `ios/` or `android/` directories, `*.storyboard`, `*.xib`
- Template engines: `*.hbs`, `*.ejs`, `*.pug`, `*.liquid`, `*.erb`, `*.twig`
- Source files: `*.tsx`, `*.jsx`, `*.vue`, `*.svelte`, `*.astro`, `*.mdx`, CSS variants

If none present, say "this project has no UI surface, design skill does not apply" and stop.

## Modes

Call with `shape` or `polish` as the argument. If the user did not specify, ask which mode fits.

- `shape` before writing code. Interviews the user, writes the project design direction.
- `polish` before committing code. Reviews the diff against project direction and craft floor.

---

## Mode: shape

The goal is a design direction document the project and every future skill can read.

### Step 1: Check for existing direction and active init

Read `.claude/specs/design/direction.md`. If it exists and has the required sections, confirm with the user whether to update or leave as is.

If `/init-project` is currently active, or its outputs exist at `.claude/specs/design-system.md` or `.claude/docs/design-system.md`, do not run shape competitively. `/init-project` owns the design-system document. Read it, and write `direction.md` as a complement that captures feel, references, and anti-references the design-system document does not specify. Do not duplicate tokens or structural decisions already in design-system.md.

### Step 2: Explore the project

Before asking anything, look for what you can infer:
- `README.md` for purpose and audience
- `package.json` for stack and existing design libraries
- Existing components, tokens, CSS variables, tailwind config
- Brand assets: logos, favicons, color values

Note what you learned and what remains unclear.

### Step 3: Interview

Ask only what you could not infer. Keep questions short. One at a time if the user prefers.

**Users and purpose**
- Who uses this, and in what context?
- What job are they trying to get done?
- What should the interface feel like? Name 3 concrete words for the brand voice. Not "modern" or "elegant". Words like "warm and mechanical and opinionated", "calm and clinical and careful", "fast and dense and unimpressed".

**References**
- Any sites or apps that capture the right feel? What specifically about them?
- Anti-references. What should this explicitly not look like?

**Constraints**
- Theme derived from context. When and where do users use this? A hospital portal on a phone at 2am wants light. A trading terminal during fast sessions wants dark. Do not default to either.
- Accessibility requirements. WCAG level. Known user needs. Reduced motion.
- Fonts, colors, or patterns that are locked by brand.

### Step 4: Write `.claude/specs/design/direction.md`

Use the format in `references/project-spec-format.md`. Include frontmatter with `applies_to` covering web source files so the enforce-specs hook picks it up automatically. This spec is the single source of truth for project design direction. Do not duplicate its content into CLAUDE.md, the enforce-specs hook already loads it when UI files are edited.

Confirm with the user before writing.

---

## Mode: polish

The goal is a Before/After review that splits blocking project violations from suggested craft defaults.

### Step 1: Read project direction

Read `.claude/specs/design/direction.md`. Treat every rule there as hard. If the spec is missing, offer to run `shape` first.

### Step 2: Read the diff

```bash
git diff --stat
git diff
```

Identify the files and components that changed. Focus the review on them.

### Step 3: Load craft spec as needed

The craft spec auto-loads via enforce-specs when UI files are edited, so in most review contexts it is already in your context. If it is not, read it at:

`.claude/specs/design/craft.md`

One file with six sections: Correctness, Anti-slop, Color, Typography, Layout, Motion. Navigate to the sections relevant to the diff. Correctness and Anti-slop apply to every review. The other four apply when the diff touches that domain.

### Step 4: Output

Always a single markdown table, grouped by severity. No list format.

| Severity | File:Line | Before | After | Why |
| --- | --- | --- | --- | --- |
| Blocking | `src/ui/Card.tsx:42` | `transition: all 300ms` | `transition: transform 200ms ease-out` | Project spec: specify exact properties |
| Blocking | `src/theme.css:8` | `color: #fff` | `color: oklch(0.99 0.002 240)` | Correctness: pure white never appears in nature |
| Suggested | `src/ui/Button.tsx:15` | no `:active` state | `transform: scale(0.97)` on `:active` | Craft floor: buttons should feel responsive |

**Severity rules:**
- **Blocking**: violates project direction spec OR `.claude/specs/design/craft/correctness.md` rules like `prefers-reduced-motion`, hardware-accelerated properties, touch-device hover gating, WCAG contrast, semantic HTML. Must be fixed before ship.
- **Suggested**: craft floor from the other design specs. Apply where project spec is silent. User decides.

If there are no issues, say so plainly. Do not invent problems.

---

## Relationship to other skills and commands

- `/init-project` → owns `design-system.md`. Shape mode defers here; craft specs still auto-load when UI files are edited.
- `/sync-stack` → prompts for `/design shape` when `direction.md` is missing on UI projects (sync-stack.md Step 2b).
- `/ideate` → calls `/design shape` when direction is not set and init is not active (ideate precondition).
- `/build` → craft specs auto-load via enforce-specs when UI files are edited
- `/review` → call `design polish` as the visual quality pass
- `/commit` → commit after polish is clean

This skill does not block commits on its own. `verify-before-stop` and the other hooks handle gating. Polish is a quality step, not a gate.

## Sources

Craft floor rules under `.claude/specs/design/craft/` are adapted from:
- Emil Kowalski, `github.com/emilkowalski/skill`
- Paul Bakaus, `github.com/pbakaus/impeccable`
- Leon, `github.com/Leonxlnx/taste-skill`

Rewritten to match Luis's voice and stay stack-agnostic. The original skills are linked here for deeper material when a project needs it.
