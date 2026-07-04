---
description: Define product requirements before execution. Creates project-brief, architecture decisions, a design system for UI projects, objective + skill map, and project-specific skill stubs. For complex projects needing upfront planning.
---

# /init-project

**Define WHAT you're building before you build it.**

This command establishes the product vision, architecture decisions, and design system. Run `/sync-stack` after to handle the technical setup (HOW).


## What This Creates

```
.claude/specs/
├── project-brief.md              # What you're building and why
├── architecture/
│   ├── decisions.md              # Key technical choices (ADRs)
│   └── project-structure.md      # Where files go
└── design/
    └── design-system.md          # Visual decisions (UI projects only)

.claude/skills/{name}/SKILL.md    # Inert stubs for project-specific skills
.claude/research/skill-trigger-evals/{name}.md  # Matching golden eval stubs
CLAUDE.md                         # Root file: objective + skill map section
```

Also creates `README.md` if it doesn't exist.


## STEP 1: Product Definition

### 1.1 Problem Statement

Ask and document:
- What problem are you solving?
- Who experiences this problem?
- What happens if it's not solved?

### 1.2 Target Users

- General public
- Specific professional group (which?)
- Internal tool (for whom?)
- Developers (library/API consumers)

### 1.3 Solution Type

- Website / web app
- Mobile app
- Desktop app
- CLI tool
- API / backend service
- Library / SDK

### 1.4 Core User Journey

What's the ONE main thing users will do? Describe the happy path:
1. User arrives/opens...
2. User does...
3. User achieves...

### 1.5 Success Criteria

How will you know it's working?
- Metrics (if applicable)
- User outcomes
- Technical requirements (performance, scale)

### 1.6 Project Name


## STEP 2: Architecture Decisions

**Document key technical choices upfront.** These become the source of truth.

### 2.1 Tech Stack Direction

Ask about preferences or constraints:
- Language preference? (TypeScript, Python, Go, etc.)
- Framework preference? (React, Vue, Astro, etc.)
- Any required integrations? (specific APIs, databases, services)
- Deployment target? (Vercel, AWS, self-hosted, etc.)

**Don't finalize exact versions yet** - /sync-stack handles that. Just capture intent.

### 2.2 Architecture Pattern

Based on solution type, propose and confirm:
- **Web app**: SSR, SSG, SPA, or hybrid?
- **API**: REST, GraphQL, or RPC?
- **CLI**: Single command or subcommands?
- **Library**: Sync, async, or both?

### 2.3 Key Decisions

For each significant choice, document:

```markdown
## Decision: [Title]

**Context:** Why this decision matters
**Options considered:**
1. [Option] — [brief rationale]
2. [Option] — [brief rationale]
**Decision:** What we chose
**Rationale:** Why this option
**Consequences:** What this locks in. What becomes hard to change.
```

Common decisions to capture:
- State management approach
- Authentication strategy
- Data fetching pattern
- Error handling strategy
- Testing approach


## STEP 3: Quality Approach

Choose one:

1. **Speed First** - MVP, prototype. Basic testing, manual QA.
2. **Balanced** - Production app. Good test coverage, WCAG AA, CI/CD.
3. **Quality First** - Enterprise/regulated. High coverage, WCAG AAA, security audits.


## STEP 4: Design System (Required for UI Projects)

**If solution type is Website/Web App, Mobile App, or Desktop App, design system must be defined before building.**

### Visual Direction

What's the primary feel?
1. Professional & Corporate
2. Creative & Vibrant
3. Minimal & Modern
4. Warm & Friendly
5. Technical
6. Other (describe)

### Color Palette

Ask for or propose based on visual direction:
- **Primary** - Main brand/action color
- **Secondary** - Supporting color
- **Accent** - Highlights, calls to action
- **Neutrals** - Background, text, borders (typically a gray scale)
- **Semantic** - Success, warning, error states

### Typography

- **Headings** - Font family, weights
- **Body** - Font family, base size
- **Code/Mono** - If applicable

### Component Patterns

Establish baseline decisions:
- **Buttons** - Rounded, square, pill? Solid, outline, ghost?
- **Cards** - Border, shadow, padding rhythm?
- **Spacing** - Tight, comfortable, spacious?
- **Borders** - Sharp, slightly rounded, very rounded?

### Motion (if applicable)

- Transitions: subtle, moderate, expressive?
- Page transitions: none, fade, slide?


## Design System Output

Generate `.claude/specs/design/design-system.md`. The frontmatter is required: enforce-specs uses it to auto-load this file whenever a UI file is edited, and that is the mechanism by which project design decisions take precedence over the generic craft floor in `.claude/specs/design/craft.md`.

```markdown
---
name: design-system
description: >
  Project-specific design decisions. Colors, typography, spacing, motion,
  component conventions. Required reading before creating or editing UI
  files. Wins over generic craft specs where rules conflict.
applies_to:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/*.vue"
  - "**/*.svelte"
  - "**/*.astro"
  - "**/*.mdx"
  - "**/*.html"
  - "**/*.htm"
  - "**/*.hbs"
  - "**/*.handlebars"
  - "**/*.ejs"
  - "**/*.pug"
  - "**/*.njk"
  - "**/*.liquid"
  - "**/*.erb"
  - "**/*.twig"
  - "**/*.cshtml"
  - "**/*.razor"
  - "**/*.vbhtml"
  - "**/*.aspx"
  - "**/*.ascx"
  - "**/*.xaml"
  - "**/*.storyboard"
  - "**/*.xib"
  - "**/res/layout/**/*.xml"
  - "**/*.css"
  - "**/*.scss"
  - "**/*.sass"
  - "**/*.less"
  - "**/*.styl"
  - "**/*.stylus"
  - "**/*.pcss"
  - "**/*.postcss"
  - "**/scripts/**/*.ts"
  - "**/scripts/**/*.tsx"
  - "**/scripts/**/*.js"
  - "**/scripts/**/*.jsx"
  - "**/scripts/**/*.mts"
  - "**/scripts/**/*.cts"
  - "**/animations/**/*.ts"
  - "**/animations/**/*.tsx"
  - "**/animations/**/*.js"
  - "**/animations/**/*.jsx"
  - "**/motion/**/*.ts"
  - "**/motion/**/*.tsx"
  - "**/motion/**/*.js"
  - "**/motion/**/*.jsx"
  - "**/effects/**/*.ts"
  - "**/effects/**/*.tsx"
  - "**/effects/**/*.js"
  - "**/effects/**/*.jsx"
  - "**/hooks/use*.ts"
  - "**/hooks/use*.tsx"
excludes:
  - "node_modules/**"
  - ".next/**"
  - ".nuxt/**"
  - ".svelte-kit/**"
  - ".output/**"
  - ".angular/**"
  - "dist/**"
  - "build/**"
  - "out/**"
  - "target/**"
  - "coverage/**"
  - "**/vendor/**"
  - "**/*.min.css"
  - "**/*.min.js"
  - "**/*.bundle.css"
  - ".claude/**"
category: design
---

# Design System

## Visual Direction
[Selected feel + any additional context]

## Colors

### Brand
- Primary: [hex] - [usage]
- Secondary: [hex] - [usage]
- Accent: [hex] - [usage]

### Neutrals
- Background: [hex]
- Surface: [hex]
- Border: [hex]
- Text: [hex]
- Text Muted: [hex]

### Semantic
- Success: [hex]
- Warning: [hex]
- Error: [hex]

## Typography

### Fonts
- Headings: [font family]
- Body: [font family]
- Mono: [font family]

### Scale
- Use [tight/default/relaxed] line heights
- Base size: [px/rem]

## Components

### Buttons
[Describe button style: rounded corners, padding, hover states]

### Cards
[Describe card style: borders, shadows, padding]

### Spacing
[Describe spacing rhythm: tight/comfortable/spacious, base unit]

### Borders
[Describe border style: radius values, border widths]

## Motion

[Describe transition approach]
```

Add the design spec to stack-config.yaml (created in Step 6.5 below):

```yaml
  design:
    - name: design-system
      file: design/design-system.md
      applies_to:
        - "**/*.tsx"
        - "**/*.jsx"
        - "**/*.vue"
        - "**/*.svelte"
        - "**/*.astro"
        - "**/*.mdx"
        - "**/*.html"
        - "**/*.htm"
        - "**/*.hbs"
        - "**/*.handlebars"
        - "**/*.ejs"
        - "**/*.pug"
        - "**/*.njk"
        - "**/*.liquid"
        - "**/*.erb"
        - "**/*.twig"
        - "**/*.cshtml"
        - "**/*.razor"
        - "**/*.vbhtml"
        - "**/*.aspx"
        - "**/*.ascx"
        - "**/*.xaml"
        - "**/*.storyboard"
        - "**/*.xib"
        - "**/res/layout/**/*.xml"
        - "**/*.css"
        - "**/*.scss"
        - "**/*.sass"
        - "**/*.less"
        - "**/*.styl"
        - "**/*.stylus"
        - "**/*.pcss"
        - "**/*.postcss"
        - "**/scripts/**/*.ts"
        - "**/scripts/**/*.tsx"
        - "**/scripts/**/*.js"
        - "**/scripts/**/*.jsx"
        - "**/scripts/**/*.mts"
        - "**/scripts/**/*.cts"
        - "**/animations/**/*.ts"
        - "**/animations/**/*.tsx"
        - "**/animations/**/*.js"
        - "**/animations/**/*.jsx"
        - "**/motion/**/*.ts"
        - "**/motion/**/*.tsx"
        - "**/motion/**/*.js"
        - "**/motion/**/*.jsx"
        - "**/effects/**/*.ts"
        - "**/effects/**/*.tsx"
        - "**/effects/**/*.js"
        - "**/effects/**/*.jsx"
        - "**/hooks/use*.ts"
        - "**/hooks/use*.tsx"
      description: "Visual decisions (wins over craft floor)"
```


## Project Structure Templates

Based on **Question 3** (solution type), generate `.claude/specs/architecture/project-structure.md` with:

### Website / Web App

```markdown
# Project Structure

## Directory Layout

src/
├── components/     # Reusable UI components
├── pages/          # Page components / routes
├── hooks/          # Custom React/Vue hooks
├── lib/            # Utilities and helpers
├── types/          # TypeScript types
└── styles/         # Global styles

public/             # Static assets
tests/              # Test files

## File Placement

- Shared components: src/components/
- Page-specific components: colocate with page
- API calls: src/lib/api/
- Types: colocate or src/types/ for shared

## Naming

- Components: PascalCase (Button.tsx)
- Utilities: camelCase (formatDate.ts)
- Directories: lowercase-hyphenated
```

### CLI Tool

```markdown
# Project Structure

## Directory Layout

src/
├── commands/       # CLI command handlers
├── lib/            # Core logic (no CLI dependencies)
├── utils/          # Helper functions
└── types/          # TypeScript types

bin/                # Entry point scripts
tests/              # Test files

## File Placement

- One file per command in src/commands/
- Business logic in src/lib/ (testable without CLI)
- Keep commands thin: parse args, call lib, format output

## Naming

- Commands: lowercase (init.ts, build.ts)
- Libs: camelCase (configLoader.ts)
```

### API / Backend Service

```markdown
# Project Structure

## Directory Layout

src/
├── routes/         # Route handlers
├── services/       # Business logic
├── models/         # Data models / schemas
├── middleware/     # Request middleware
├── lib/            # Shared utilities
└── types/          # TypeScript types

tests/              # Test files
scripts/            # Database migrations, seeds

## File Placement

- Route handlers: src/routes/
- Business logic: src/services/ (not in routes)
- Database queries: src/models/ or src/services/
- Validation: src/middleware/ or colocate with routes

## Naming

- Routes: resource-based (users.ts, orders.ts)
- Services: domain-based (authService.ts)
```

### Library

```markdown
# Project Structure

## Directory Layout

src/
├── index.ts        # Public API exports
├── core/           # Core functionality
├── utils/          # Internal helpers
└── types/          # TypeScript types

tests/              # Test files
docs/               # Documentation
examples/           # Usage examples

## File Placement

- Public API: export from src/index.ts only
- Internal code: never import from outside src/
- Keep public surface small

## Naming

- Exports: camelCase for functions, PascalCase for classes/types
- Internal: prefix with underscore if needed
```

### Mobile App / Desktop App

```markdown
# Project Structure

## Directory Layout

src/
├── screens/        # Screen components
├── components/     # Reusable UI components
├── navigation/     # Navigation config
├── services/       # API and business logic
├── hooks/          # Custom hooks
├── lib/            # Utilities
├── types/          # TypeScript types
└── assets/         # Images, fonts

tests/              # Test files

## File Placement

- Screen-specific components: colocate with screen
- Shared components: src/components/
- Navigation: src/navigation/
- State management: src/services/ or src/store/

## Naming

- Screens: PascalCase + Screen suffix (HomeScreen.tsx)
- Components: PascalCase (Button.tsx)
```


## STEP 5: Project Objective and Skill Map

**Declare what this project produces and which skills it needs, per the #179 project-skill-system framework.** Generic kit skills cover generic work. Project-specific skills cover project-specific work. This step names the objective, decomposes the recurring work, and identifies which work types earn their own skills. Steps 6.6 and 6.7 write the results.

### 5.1 Project Objective

One sentence, verb-first. What does this project produce?

- Good: "Produce attack-pattern analyses and vulnerability reports for AI-safety engagements."
- Good: "Redesign ignitegaming.com for conversion and mobile UX."
- Weak: "A red-teaming project." That names a topic, not an output.

### 5.2 Tenancy Check (framework Step 0)

Ask: does this project serve one tenant or many?

- **Single-tenant** — one client, one product, sole maintainer. Skip to 5.3. This is the common case.
- **Multi-tenant** — N clients, venues, or workspaces, each with its own config. Run Workflow Discovery first: map the shared workflow before decomposing work types, because per-tenant variation changes which work needs skills. Record N and the shared-vs-per-tenant split. Per the framework, per-tenant primitives are conditional on N: documented at N=1, load-bearing at N≥2, mandatory automation at N≥5.

### 5.3 Recurring Work Types

What does success look like day to day? List the recurring work. A red-team project: research attack patterns, draft attack prompts, run a harness, write vulnerability reports, maintain payload libraries. A web redesign: capture brand voice, set design direction, migrate content, decide Payload-or-not.

### 5.4 Which Work Types Need Skills

Triage each work type:

- **Covered by generic kit skills** — research, define, ideate, build, test, review, commit, plan, handoff. No new skill. Most workflow work lands here.
- **Needs a project-specific skill** — the work is domain-specific and recurs. It earns a skill.
- **Needs a spec or hook instead** — the work is a rule to enforce, not a workflow to run. Note it for `/sync-stack --custom`.

### 5.5 Group Into the Skill Map

Group the project-specific skills into single-purpose plugins, 2-8 components each. A plugin is a **purpose grouping, not a directory**: the skills live flat in `.claude/skills/{name}/SKILL.md`, where Claude Code discovers them, and the grouping is documented in CLAUDE.md. Name each plugin, its one-sentence purpose, and its components.

This skill map is written into CLAUDE.md in Step 6.6 and scaffolded into `.claude/skills/` in Step 6.7.


## STEP 6: Generate Outputs

### 6.0 Resolve Project Specs Root

Before writing any project spec, resolve where project specs live for this project. Kit-owned specs always stay under `.claude/specs/`; curated project specs go to `project_specs_root`.

```bash
# Read .claude/specs.yaml if it exists
PROJECT_SPECS_ROOT=$(grep -E '^project_specs_root:' .claude/specs.yaml 2>/dev/null | sed -E 's/^project_specs_root:[[:space:]]*"?([^"]+)"?[[:space:]]*$/\1/')

# If unset, pick default based on mode
if [ -z "$PROJECT_SPECS_ROOT" ]; then
  if grep -q '^mode: client' .claude/kit-mode.yaml 2>/dev/null; then
    PROJECT_SPECS_ROOT="docs/specs"
  else
    PROJECT_SPECS_ROOT=".claude/specs"
  fi
fi
```

In **client mode**, also write the config file so future runs are deterministic:

```bash
if grep -q '^mode: client' .claude/kit-mode.yaml 2>/dev/null && [ ! -f .claude/specs.yaml ]; then
  cat > .claude/specs.yaml <<EOF
# Claude Kit Spec Locations
#
# project_specs_root: where curated project specs live (committed to the project repo).
# Kit-owned specs always live under .claude/specs/ regardless of this setting.
# See .claude/specs/kit/client-mode.md for the rationale.

project_specs_root: docs/specs
EOF
fi
```

Then create the README in the target root:

```bash
mkdir -p "$PROJECT_SPECS_ROOT"
if [ ! -f "$PROJECT_SPECS_ROOT/README.md" ]; then
  cat > "$PROJECT_SPECS_ROOT/README.md" <<'EOF'
# Project Specs

This directory contains curated specifications for this project: architecture
decisions, design system, structural conventions, and component patterns.

These files are read by Claude Code agents before editing related code (via the
enforce-specs hook). Keep them up to date when you change code they describe.

The kit's own infrastructure (hooks, skills, commands, agents, kit-owned specs)
lives under `.claude/`. That directory is excluded from this repo's commits.

Layout:
- architecture/  — ADRs, project structure, system map
- design/        — Design system, design direction
- config/        — Git, testing, deployment, environment
- coding/        — Generated stack-specific patterns
- components/    — Component-scoped specs
- project-brief.md — What this project is and why

This file and its siblings are part of the project, not Claude tooling. Edit
them like normal documentation.
EOF
fi
```

Every `.claude/specs/...` write path in 6.1-6.4 below is relative to `$PROJECT_SPECS_ROOT/`. Stack-config itself (6.5) stays at `.claude/specs/stack-config.yaml`, and the `file:` paths it generates are project-root-relative (`docs/specs/architecture/decisions.md`, not `architecture/decisions.md`).

### 6.1 Project Brief

Generate `$PROJECT_SPECS_ROOT/project-brief.md`:

```markdown
# [Project Name]

## Problem
[From 1.1]

## Users
[From 1.2]

## Solution
[Solution type + core journey from 1.3-1.4]

## Success Criteria
[From 1.5]

## Quality Approach
[From Step 3]
```

### 6.2 Architecture Decisions

Generate `$PROJECT_SPECS_ROOT/architecture/decisions.md`:

```markdown
# Architecture Decisions

## Tech Stack Direction
- Language: [preference]
- Framework: [preference]
- Deployment: [target]

## Architecture Pattern
[From 2.2]

## Key Decisions

### Decision 1: [Title]
**Context:** ...
**Options considered:**
1. [Option] — [brief rationale]
2. [Option] — [brief rationale]
**Decision:** ...
**Rationale:** ...
**Consequences:** What this locks in. What becomes hard to change.

[Continue for each decision from 2.3]
```

### 6.3 Project Structure

Generate `$PROJECT_SPECS_ROOT/architecture/project-structure.md` based on solution type (use templates below).

### 6.4 Design System (UI projects)

Generate `$PROJECT_SPECS_ROOT/design/design-system.md` (see Step 4 output format).

### 6.5 Create or update stack-config.yaml

If `.claude/specs/stack-config.yaml` doesn't exist yet, create it. If it exists, add the new specs.

```yaml
# Stack Configuration
# Created by /init-project, updated by /sync-stack

name: "[project-name]"
description: "[from project brief]"

# Tech stack — filled in by /sync-stack after detection
stack: {}

# Specs registered so far
specs:
  architecture:
    - name: decisions
      file: architecture/decisions.md
      applies_to: []
      description: "Key technical choices (ADRs)"

    - name: project-structure
      file: architecture/project-structure.md
      applies_to: []
      description: "Where files go"

  # Only if UI project:
  design:
    - name: design-system
      file: design/design-system.md
      applies_to:
        - "**/*.tsx"
        - "**/*.jsx"
        - "**/*.vue"
        - "**/*.svelte"
        - "**/*.astro"
        - "**/*.mdx"
        - "**/*.html"
        - "**/*.htm"
        - "**/*.hbs"
        - "**/*.handlebars"
        - "**/*.ejs"
        - "**/*.pug"
        - "**/*.njk"
        - "**/*.liquid"
        - "**/*.erb"
        - "**/*.twig"
        - "**/*.cshtml"
        - "**/*.razor"
        - "**/*.vbhtml"
        - "**/*.aspx"
        - "**/*.ascx"
        - "**/*.xaml"
        - "**/*.storyboard"
        - "**/*.xib"
        - "**/res/layout/**/*.xml"
        - "**/*.css"
        - "**/*.scss"
        - "**/*.sass"
        - "**/*.less"
        - "**/*.styl"
        - "**/*.stylus"
        - "**/*.pcss"
        - "**/*.postcss"
        - "**/scripts/**/*.ts"
        - "**/scripts/**/*.tsx"
        - "**/scripts/**/*.js"
        - "**/scripts/**/*.jsx"
        - "**/scripts/**/*.mts"
        - "**/scripts/**/*.cts"
        - "**/animations/**/*.ts"
        - "**/animations/**/*.tsx"
        - "**/animations/**/*.js"
        - "**/animations/**/*.jsx"
        - "**/motion/**/*.ts"
        - "**/motion/**/*.tsx"
        - "**/motion/**/*.js"
        - "**/motion/**/*.jsx"
        - "**/effects/**/*.ts"
        - "**/effects/**/*.tsx"
        - "**/effects/**/*.js"
        - "**/effects/**/*.jsx"
        - "**/hooks/use*.ts"
        - "**/hooks/use*.tsx"
      description: "Visual decisions (wins over craft floor)"
```

This gives `/sync-stack` a foundation to build on. It will add `stack:` details, `coding:` specs, `config:` specs, and `applies_to` patterns.

### 6.6 Write the Objective and Skill Map

Write the objective from 5.1 and the skill map from 5.5 into the project's **root `CLAUDE.md`**, not `.claude/CLAUDE.md`. The root file is project-owned and survives `sync-kit`. `.claude/CLAUDE.md` is the kit-synced template and gets overwritten on every sync, so a skill map written there is lost. Create root `CLAUDE.md` if it doesn't exist.

Use the format documented in the "Project Objective and Skill Map" section of `.claude/CLAUDE.md`:

```markdown
## Project Objective and Skill Map

### Objective

[One verb-first sentence from 5.1.]

### Skill map

[For multi-tenant projects, note N and the shared-vs-per-tenant split from 5.2 first.]

- `plugin-name`. One-sentence purpose. Components: skill-a, skill-b, hook-c.
- `another-plugin`. One-sentence purpose. Components: skill-d, spec-e.
```

List only project-specific plugins from 5.5. Generic kit skills are already documented in `.claude/CLAUDE.md`. Don't restate them.

### 6.7 Scaffold Project-Specific Skill Stubs

For each project-specific skill from 5.4, scaffold a stub at `.claude/skills/{skill-name}/SKILL.md`. That path is where Claude Code discovers project skills, alongside synced kit skills. Project-custom skills are absent from `.kit-manifest`, so `sync-kit` never touches them.

A stub is inert until it clears the skill-authorship gate in `.claude/specs/kit/skills.md`. Ship it with `disable-model-invocation: true` so its placeholder description stays out of the routing budget, plus a checklist the user works through.

Stub template:

````markdown
---
name: {skill-name}
description: TODO — write a ≤200-byte description per .claude/specs/kit/skills.md, then remove disable-model-invocation. Action cue. Triggers: "phrase", "phrase". Outcome line.
disable-model-invocation: true
---

# {Skill Title}

> STUB scaffolded by /init-project for the `{plugin-name}` plugin. Not live yet.

**Purpose:** {one sentence from 5.5}

## Before this skill goes live (skills.md gate)

- [ ] Write the role and task instructions below.
- [ ] Write a ≤200-byte, three-part description: action cue, 3-6 trigger phrases, outcome line.
- [ ] Confirm no trigger-phrase overlap with existing skills. Document the overlap analysis.
- [ ] Add a golden eval at `.claude/research/skill-trigger-evals/{skill-name}.md`: 3-5 should-fire, 3-5 should-not-fire.
- [ ] Remove `disable-model-invocation: true`.
- [ ] Walk the eval set in a clean session. Every should-fire fires, no should-not-fire fires.

## Instructions

TODO — what this skill does, step by step.
````

Scaffold the matching golden eval stub at `.claude/research/skill-trigger-evals/{skill-name}.md`:

````markdown
# {skill-name} trigger eval

## Should fire
- TODO

## Should not fire
- TODO

## Owns triggers
- TODO
````

Tell the user which stubs were created and that each must clear the skills.md gate before it fires.


## After This

Run `/sync-stack` to:
1. Install dependencies based on your tech direction
2. Wire configs together properly
3. Generate coding specs from official docs
4. Create system map showing how everything connects

Then flesh out each skill stub from 6.7. Each one is inert until it clears the gate in `.claude/specs/kit/skills.md`: a ≤200-byte description, a golden eval, and the `disable-model-invocation` flag removed.
