---
description: Wire project together, verify setup, generate project specs. Handles the HOW after /init-project defines the WHAT.
---

# /sync-stack

**Wire your project together and generate specs for HOW to build it.**

/init-project defines WHAT you're building. /sync-stack handles HOW:
- Installs dependencies and wires configs together
- Verifies everything is connected properly
- Generates coding specs from official docs
- Creates a system map showing how pieces connect

## Usage

```
/sync-stack                      # Full setup (install, wire, verify, generate specs)
/sync-stack prisma               # Add a specific dependency and update specs
/sync-stack --verify             # Just verify setup, don't regenerate specs
/sync-stack --custom api-conventions   # Add custom project-specific spec
```

## Core Principle

**Produce the documentation a new developer needs to work in THIS project without breaking it** — held to the universal engineering principles every project inherits (`kit/engineering-principles.md`). The high-value docs are the ones a competent dev cannot get from a library's official docs: this codebase's architecture, conventions, and load-bearing invariants.

Rank generated output by value:

1. **Project reality (HIGH).** Architecture, conventions, and the load-bearing invariants — the unwritten rules a new dev breaks on day one. Captured by **interview** via `capture-invariants`, not by scanning transitional code. Emitted as specs plus `conformance_rules` for the mechanizable subset.
2. **Non-obvious cross-tech constraints (MEDIUM).** Gotchas that live in no single library's docs — an Astro+React hydration trap, a Prisma+serverless connection limit. Keep these.
3. **Generic library patterns (LOW).** The dev already knows React, FastAPI, Tailwind. Do not dump these; defer to the engineering principles and the project's own conventions.

The test for any generated content: **would a competent developer already know this, or discover it by reading the code?** If yes, it does not belong here. Capture what they cannot discover independently — the project's decisions, not the framework's API.

## What This Does

### 1. Project Setup
- Detects package manager (npm, yarn, pnpm, bun)
- Installs dependencies if lock file missing
- Creates config files that reference each other correctly

### 2. Wiring Verification
- Checks configs are connected (tsconfig paths, tailwind content, vite plugins)
- Validates peer dependencies are satisfied
- Ensures build pipeline will work

### 3. Spec Generation
Generates the project-reality docs a new dev needs, ranked by value (see Core Principle). The HIGH-value layer — architecture, conventions, invariants — is captured by **interview** via `capture-invariants`, not scraped from official docs. Library research is a stack-specific add, scoped to non-obvious cross-tech constraints only.

| Category | What it contains | Source |
|----------|------------------|--------|
| `coding/` | This project's conventions + load-bearing invariants | Interview (`capture-invariants`); not generic library patterns |
| `architecture/` | Component invariants + system map (change-impact) | Interview + structure scan |
| `config/` | Git, testing, deployment, env — the project's actual setup | Detected from project files, or skipped |
| `design/` | Implementation patterns for the design system | Project's design decisions |
| `documentation/` | Docstring/comment conventions this project follows | Project conventions |

### 4. Wiring Diagram
Generates `.claude/specs/architecture/system-map.yaml` showing:
- Dependencies and their relationships
- Config file connections
- Build pipeline flow

## STEP 0: Resolve Project Specs Root

Before reading or writing any project spec, resolve where project specs live. Kit-owned specs always stay under `.claude/specs/`; curated project specs go to `project_specs_root`.

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

Every `.claude/specs/{coding,config,architecture,design,components,documentation}/` write path in the steps below resolves to `$PROJECT_SPECS_ROOT/...`. Stack-config stays at `.claude/specs/stack-config.yaml`, and every `file:` entry it generates is project-root-relative.

**Legacy-layout hint.** If `PROJECT_SPECS_ROOT` is not `.claude/specs` but project specs are still found under `.claude/specs/{architecture,design,config,coding,components}/`, print:

```
Detected legacy spec layout. Run '/sync-stack --migrate-specs' to opt into the tracked location.
```

Do not auto-migrate. The no-flag run only hints; `--migrate-specs` is the explicit opt-in.

## STEP 1: Read Existing Specs

First, read all existing spec files to understand current configuration.

```bash
# Find all spec files
find .claude/specs -name "*.md" -o -name "*.yaml" 2>/dev/null
```

**Read each file found.** This gives you:
- Current stack configuration (stack-config.yaml)
- Existing coding patterns (coding/*.md)
- Config settings (config/*.md)
- Any custom specs (architecture/, design/, documentation/, custom/)

**Note what exists** so you can update rather than overwrite, and preserve user customizations.

## STEP 2: Check Design System (UI Projects)

**Before generating specs, verify design decisions are established for UI projects.**

Determine if project has UI:
- Solution type is website, web app, mobile app, or desktop app
- Has component files (.tsx, .vue, .svelte, etc.)
- Has styling config (tailwind.config.*, styles/, css files)

If UI project, check for design system:

```bash
# Check for design system spec
ls .claude/specs/design/design-system.md 2>/dev/null
```

**If design system doesn't exist:**

```
DESIGN SYSTEM REQUIRED

This project has a UI but no design system is defined.

Design decisions (colors, typography, component patterns) must be established
before generating technical specs. Otherwise, specs can't enforce visual consistency.

Options:
1. Run /init-project to define design system now
2. Create .claude/specs/design/design-system.md manually
3. Skip design specs (not recommended for production UI)

How do you want to proceed?
```

**WAIT FOR USER RESPONSE** before continuing.

If user chooses option 1, run /init-project's design section only, then continue.

## STEP 2b: Check Design Direction (UI Projects)

**After the design-system check, verify project design direction is captured.**

`design-system.md` covers tokens and structural decisions, owned by `/init-project`. `direction.md` captures feel, brand voice, references, anti-references, and motion posture, owned by `/design shape`. Both are expected on UI projects. `/design polish` treats `direction.md` as hard rules during pre-ship review.

Use the same UI detection as Step 2.

```bash
ls .claude/specs/design/direction.md 2>/dev/null
```

**If `direction.md` doesn't exist:**

```
DESIGN DIRECTION REQUIRED

This project has a UI but no direction.md.

design-system.md handles tokens and structural decisions via /init-project.
direction.md handles feel, references, anti-references, and motion posture
via /design shape. Both should exist for UI projects.

Without direction.md, /design polish falls back to craft floor only and
cannot enforce project-specific visual rules.

Options:
1. Run /design shape to establish direction now
2. Create .claude/specs/design/direction.md manually. See
   .claude/skills/design/references/project-spec-format.md
3. Skip. Not recommended for production UI.

How do you want to proceed?
```

**WAIT FOR USER RESPONSE** before continuing.

If user chooses option 1, invoke `/design shape` and wait for completion, then continue.

## STEP 3: Project Setup (New Projects)

**If this is a new project without dependencies installed, set it up.**

### Check if setup needed

```bash
# Check for lock files
ls package-lock.json yarn.lock pnpm-lock.yaml bun.lockb 2>/dev/null
```

**If no lock file exists but package.json exists:**

```
PROJECT NOT INSTALLED

Dependencies are defined but not installed. This project needs setup.

Detected package manager: [npm/yarn/pnpm/bun based on config or preference]

Install dependencies and wire configs? (yes/no)
```

**WAIT FOR USER RESPONSE**

### If user confirms, run setup:

1. Install dependencies:
```bash
[npm install / yarn / pnpm install / bun install]
```

2. Check for missing peer dependencies and install if needed

3. Verify lock file was created

**If lock file exists:** Skip to Step 4.

## STEP 4: Detect Stack

Check for config files to detect the tech stack:

| File | Detects |
|------|---------|
| package.json | Node.js + dependencies (React, Vue, Svelte, etc.) |
| tsconfig.json | TypeScript |
| next.config.* | Next.js |
| nuxt.config.* | Nuxt |
| svelte.config.* | SvelteKit |
| astro.config.* | Astro |
| vite.config.* | Vite (check plugins for framework) |
| tailwind.config.* | Tailwind CSS |
| vitest.config.* / jest.config.* | Testing framework |
| .eslintrc.* / eslint.config.* | ESLint |
| .prettierrc.* | Prettier |
| prisma/schema.prisma | Prisma |
| drizzle.config.* | Drizzle |
| pyproject.toml / requirements.txt | Python |
| Cargo.toml | Rust |
| go.mod | Go |
| Gemfile | Ruby |

**If argument provided** (e.g., `/sync-stack prisma`): Skip detection, focus on that dependency.

**If no code exists:** Ask what they're building, suggest a stack.

**Show detected stack and ask to confirm:**

```
DETECTED STACK

Framework: Next.js 14
Language: TypeScript
Styling: Tailwind CSS
Testing: Vitest
Package Manager: pnpm

Dependencies to generate specs for:
- next
- typescript
- tailwind
- vitest

Confirm? (yes / modify)
```

**WAIT FOR USER RESPONSE**

## STEP 5: Research Each Technology

For each confirmed technology, research how it actually works — not just the API, but runtime behavior, integration patterns, and common problems.

### Why research is critical

Claude's training data goes stale. Technologies update constantly. What you "know" about Astro, Motion, or Tailwind may be outdated. The point of this step is to **learn the current state** before building anything.

### Research approach: multiple sources

Use ALL available sources. No single source has complete knowledge.

**1. Context7** — Start here for API reference and official patterns.
```
Use context7 to fetch documentation for [technology].
Look for: project structure, naming conventions, common patterns, anti-patterns.
```
Context7 is good for: what functions exist, how to call them, official best practices.
Context7 is weak on: runtime behavior, cross-technology interactions, version-specific gotchas.

**2. Web search** — Use for operational knowledge that docs don't cover.
```
Search for:
- "[technology A] + [technology B] integration" (how technologies work together)
- "[technology] common problems [current year]" (what breaks in practice)
- "[technology] SSR hydration issues" (runtime behavior gotchas)
- "[technology] migration guide [version]" (what changed between versions)
- "[tech A] with [tech B] example" (real-world integration patterns)
```
Web search is good for: community-discovered gotchas, real integration examples, version-specific behavior, "I tried X and it broke because Y."
Prioritize: official docs, GitHub issues/discussions, well-known dev blogs. Deprioritize: outdated tutorials, AI-generated content, posts without dates.

**3. WebFetch on official docs** — For specific pages that context7 doesn't index well.
- Framework integration guides (e.g., Astro's React integration page)
- Migration/upgrade guides (what changed between versions)
- Advanced topics pages (SSR, hydration, performance)

### If all sources fail for a technology

```
RESEARCH INCOMPLETE

Could not find sufficient information for [technology]:
- context7: [result]
- Web search: [result]
- Official docs: [result]

Options:
1. Retry with different search terms
2. Skip this technology for now
3. Generate spec with what we have (will be marked as incomplete)
```

**WAIT FOR USER RESPONSE** before proceeding.

### What to research per technology

Don't just look up "how to use [technology]." Research these specific angles:

- **Current version behavior:** What version is in package.json? What changed in recent versions?
- **Runtime lifecycle:** What happens at build time vs server time vs client time?
- **Integration with other stack technologies:** How does this technology interact with the other technologies in this project's stack?
- **Known issues:** What are the common "why isn't this working" problems?
- **Anti-patterns with explanations:** Not just "don't do X" but "don't do X because Y happens at runtime"

### Extract from research (the non-obvious only)

The dev already knows the framework's API. Extract only what they cannot get from official docs or by reading the code — the operational knowledge that lives in GitHub issues and dev blogs, not the API reference.

**Runtime behavior and cross-tech gotchas (the high-value extraction):**
- **Lifecycle:** initialization to interactive (e.g., Astro: SSR renders HTML → CSS applies → scripts load → framework hydrates).
- **SSR/SSG behavior:** what HTML the browser receives before JS executes; what inline styles or attributes appear during server render.
- **Side effects:** what the technology does that the API doesn't reveal (e.g., Motion's `initial` prop renders as inline CSS during SSR, making content invisible before JS loads).
- **Conditional behavior:** when it behaves differently (e.g., `client:visible` uses IntersectionObserver — the element must be in the viewport, not just the DOM).
- **Version-specific changes:** what changed in the version this project pins.

**Do not extract generic API patterns** — component/function signatures, import style, "how to call X." The dev knows these; the engineering principles and the project's own invariants (STEP 9) govern how code is written here. Library file/folder conventions are likewise derivable by reading the code.

## STEP 5b: Cross-Technology Interaction Constraints

**After researching each technology individually, analyze how they interact.**

Individual technology docs describe how THEIR technology works. They don't describe what happens when their technology meets another. This step catches constraints that only emerge from combinations.

### When to run this step

Run this step when the stack has **2+ technologies that share a runtime concern**:
- SSR framework + client-side library (Astro + React, Next.js + Motion)
- CSS framework + JS framework (Tailwind + React, CSS Modules + Vue)
- Build tool + framework (Vite + Svelte, Webpack + React)
- ORM + API framework (Prisma + Express, Drizzle + tRPC)

Skip this step for stacks where technologies don't interact at runtime (e.g., a Python CLI with just `click` and `requests`).

### How to identify constraints

For each **pair** of technologies in the stack, ask context7 or official docs:

1. **Lifecycle conflicts:** Do both technologies assume control over the same lifecycle phase? (e.g., both try to manage component initialization, both modify the DOM on load)
2. **SSR/hydration interactions:** If one technology server-renders and another expects client-side state, what happens during the gap? What does the user see between SSR output and full hydration?
3. **CSS/visibility interactions:** Does one technology control visibility (CSS `display`, `opacity`) while another depends on visibility to activate? (e.g., IntersectionObserver-based hydration + CSS `display:none` containers)
4. **Execution order dependencies:** Does technology A assume technology B has already run? What happens if B hasn't loaded yet?
5. **Configuration conflicts:** Do both technologies need the same config option set to different values?

### Research approach

Use web search as the primary source here. Cross-technology interactions are rarely in official docs — they live in community knowledge.

```
For each technology pair, search for:
- "[tech A] with [tech B] issues" (what breaks when combined)
- "[tech A] [tech B] integration guide [current year]" (how to wire them correctly)
- "[tech A] [tech B] gotchas" (community-discovered problems)
- GitHub issues in both repos mentioning the other technology
```

Also check:
- Official integration guides (e.g., Astro docs on React, Motion docs on SSR)
- Context7 for any integration-specific documentation
- Stack Overflow questions about the specific combination

### Document as interaction constraints

For each constraint found, document:

```markdown
### [Tech A] + [Tech B]: [Constraint Name]

**What happens:** [Observable behavior when these interact]
**Why:** [The mechanism — what each technology is doing that causes this]
**Prevent by:** [What to do instead]

Example:
- Bad: [code that triggers the problem]
- Good: [code that avoids it]
```

**Example constraints to look for:**

| Stack Combination | Common Constraint |
|---|---|
| Astro + React | `client:visible` uses IntersectionObserver — won't hydrate components inside `display:none` containers (tabs, accordions, modals) |
| Astro + Motion | Motion's `initial` prop renders as inline `style="opacity:0"` during SSR — content invisible until JS hydrates |
| Next.js + Zustand | Server Components can't use client-side stores — state must be passed as props across the boundary |
| Tailwind + dark mode | `darkMode: 'selector'` scopes to a CSS selector, `'class'` requires class on `<html>` — different integration patterns |
| Prisma + serverless | Cold starts load the Prisma Client — connection pooling needed (PgBouncer, Prisma Accelerate) |
| React + CSS transitions | React re-renders can interrupt CSS transitions mid-animation if state changes trigger unmount/remount |

These constraints become the `## Interaction Constraints` section in the generated specs (Step 8b).

## STEP 6: Scan Existing Code

If the project has existing code, scan for patterns to preserve.

### What to scan:

**File structure:**
```bash
find src -type f -name "*.tsx" -o -name "*.ts" | head -20
```

**Component patterns:**
```bash
grep -r "export default function\|export const\|export function" src --include="*.tsx" | head -10
```

**Import style:**
```bash
grep -r "^import" src --include="*.ts" --include="*.tsx" | head -10
```

**Test structure:**
```bash
find . -name "*.test.*" -o -name "*.spec.*" | head -10
```

### Compare with research:
- If existing patterns match best practices: document them as-is
- If existing patterns differ: note the project's convention (consistency > best practice)
- If no existing code: use researched best practices

## STEP 7: Update Config Specs

Config specs document **this project's actual setup** — its commit format, its test commands, its deploy target, its env vars. Not generic best-practice filler from official docs.

### Read existing templates

```bash
ls .claude/specs/config/
```

Read each file: version-control.md, deployment.md, environment.md, testing.md

### For each config spec:
1. Detect what's actually configured in the project (commit history, package scripts, deploy config, env files).
2. **If configured:** document the project's real setup — the actual commands, paths, and conventions in use.
3. **If not configured:** skip the spec. Do not emit a generic placeholder or a "recommended setup" — an empty deploy spec is worse than none; it reads as fact and goes stale. Note the gap in the summary instead.

### Update version-control.md

Detect from project:
```bash
# Check recent commits for format
git log --oneline -10

# Check branch naming
git branch -a | head -10

# Check for hooks
ls .husky 2>/dev/null || ls .git/hooks 2>/dev/null
```

Update the template with:
- Actual commit message format used
- Branch naming convention
- Any pre-commit hooks configured

### Update testing.md

Detect from project:
```bash
# Check package.json for test scripts
grep -A5 '"scripts"' package.json | grep test

# Check test directory structure
find . -name "*.test.*" -o -name "*.spec.*" | head -5

# Check test config
ls vitest.config.* jest.config.* 2>/dev/null
```

**If no testing framework detected:**
```
TESTING NOT CONFIGURED

No test framework detected. Recommendation for this stack:
- [Framework]: Vitest (fast, Vite-native)
- [Components]: @testing-library/react
- [Environment]: jsdom

Add testing? (yes / skip)
```

If yes: install packages, fetch Vitest docs via context7, generate real testing spec.

**If testing framework detected:**
- Fetch docs for detected framework via context7
- Update spec with verified patterns
- Include test file location, commands, coverage setup

### Update deployment.md

Detect from project:
```bash
# Check for deployment configs
ls vercel.json netlify.toml fly.toml render.yaml Dockerfile docker-compose.yml 2>/dev/null
```

**If deployment platform detected:**
- Fetch platform docs (Cloudflare, Vercel, Netlify, etc.) via context7 or WebFetch
- Verify spec matches current platform requirements
- Update with build commands, environment setup, platform-specific patterns

**If no deployment config:**
- Note it's not configured
- Suggest platforms based on stack (Cloudflare for static, Vercel for Next.js, etc.)

### Update environment.md

Detect from project:
```bash
# Check for env examples
cat .env.example 2>/dev/null || cat .env.sample 2>/dev/null
```

Update the template with:
- Required environment variables
- Variable naming conventions

## STEP 8: Generate All Specs

**Generate from Steps 5/5b and 9 — the non-obvious only.** Don't create empty templates, and don't restate the framework's API. A spec earns its place by carrying runtime behavior, interaction constraints, or this project's invariants — what the dev can't get from official docs or by reading the code.

### 8a: Ask which categories to generate

```
SPEC CATEGORIES

Based on your stack, these specs can be generated:

[x] coding/        - React, TypeScript, Vitest patterns
[x] architecture/  - Next.js file structure conventions
[x] design/        - Tailwind design tokens
[ ] documentation/ - No specific conventions detected

Generate all? (yes / customize)
```

### 8b: Generate coding specs (non-obvious behavior only)

A coding spec is worth generating **only** when a technology has non-obvious runtime behavior or cross-tech constraints (from STEP 5/5b). If a technology has none — the dev just uses its documented API — **skip it**. Do not generate a spec that restates the framework's API.

When a spec is warranted, create `[technology]-specs.md` with the non-obvious only:

```markdown
# [Technology] Specs

Source: [official docs URL]

## Runtime Behavior

### Lifecycle
[Initialization to interactive — the execution sequence, not the API.]

### SSR Behavior (if applicable)
[What the server renders; what HTML the browser receives before JS executes.]

### Side Effects
[What this technology does that the API doesn't reveal — inline styles during SSR, DOM mutations, global state.]

## Interaction Constraints

[Constraints from combining this technology with others in the stack. From STEP 5b.]

### [This Tech] + [Other Tech]: [Constraint Name]
**What happens:** [Observable behavior]
**Why:** [Mechanism]
**Prevent by:** [What to do instead]
```

Generic API patterns — component declaration, hook rules, "use proper types" — are out. The dev knows them, and `engineering-principles` plus the project's invariants (STEP 9) govern how code is written here.

### 8c: Generate architecture specs

If framework has file structure conventions, create or update `architecture/project-structure.md` with **actual conventions from docs**:

- If file exists (from /init-project): add framework-specific section
- If file doesn't exist: create it with framework conventions

```markdown
# Project Structure

Source: https://nextjs.org/docs/app/building-your-application/routing

## Directory Layout

```
app/
├── layout.tsx          # Root layout (required)
├── page.tsx            # Home page
├── globals.css         # Global styles
├── api/                # API routes
│   └── route.ts
└── [slug]/             # Dynamic routes
    └── page.tsx
```

## Conventions

### Page files
- `page.tsx` - Publicly accessible page
- `layout.tsx` - Shared UI for segment and children
- `loading.tsx` - Loading UI
- `error.tsx` - Error UI

### Component organization
- Colocate components with their routes when route-specific
- Shared components go in `components/` at project root

## Anti-Patterns

- Don't put API logic in page components - use route handlers
- Don't import server components into client components
```

### 8d: Generate design implementation specs

**The design system (colors, typography, component styles) should already exist from /init-project.**

This step generates technical specs for IMPLEMENTING that design system using the detected styling framework.

Read the existing design system:
```bash
cat .claude/specs/design/design-system.md
```

Then create `design/[framework]-implementation.md` with patterns for applying the design system:

```markdown
# [Styling Framework] Implementation

Source: [framework docs] + .claude/specs/design/design-system.md

## How to Apply Design Tokens

### Colors
[How to reference design system colors in this framework]
- Tailwind: Use custom theme colors defined in tailwind.config
- CSS Modules: Import from design tokens CSS file
- styled-components: Use theme provider values

### Typography
[How to apply typography decisions in this framework]

### Spacing
[How to apply spacing rhythm in this framework]

## Component Patterns

[Framework-specific patterns for implementing the component styles defined in design-system.md]

### Buttons
```[code example showing how to build a button matching design system]```

### Cards
```[code example showing how to build a card matching design system]```

## Anti-Patterns

- [Framework-specific things to avoid]
- Always reference design system tokens, never hardcode values
```

**If design-system.md doesn't exist:** STEP 2 should have caught this. If somehow skipped, prompt user to define design system before generating implementation specs.

### 8e: Generate documentation specs

If language/framework has doc conventions, create `code-comments.md` with **actual conventions**:

```markdown
# Code Comments

Source: https://tsdoc.org/

## When to Comment

- Public API functions - always
- Complex algorithms - explain the why
- Workarounds - link to issue/reason

## Docstring Format

Use TSDoc for TypeScript:

```tsx
/**
 * Fetches user data from the API.
 * @param userId - The unique identifier for the user
 * @returns The user object or null if not found
 * @throws {ApiError} When the API request fails
 */
export async function getUser(userId: string): Promise<User | null> {
```

## Anti-Patterns

- Don't comment obvious code (`// increment i` above `i++`)
- Don't leave TODO comments without issue links
```

### Only create what's needed

- Skip `architecture/` if no framework-specific structure (vanilla JS/TS)
- Skip `design/` if no styling framework (just plain CSS)
- Skip `documentation/` if no specific conventions found in docs
- **Never create empty templates** - only create specs with real content from research

## STEP 9: Generate Component-Scoped Specs

**Detect distinct modules in the project and generate component-level specs for each one.**

Technology specs (Step 8) tell Claude HOW to write code in a language or framework. Component specs tell Claude HOW THIS MODULE works — its architecture, patterns, decisions, and integration points.

### 9a: Detect component boundaries

Scan for top-level directories that represent distinct modules:

```bash
# Check for common component directory patterns
ls -d */ 2>/dev/null | head -20

# Look for distinct source modules
ls -d src/*/ 2>/dev/null | head -20

# Check for monorepo packages
ls -d packages/*/ apps/*/ 2>/dev/null | head -20
```

**Component indicators** — a directory is a component if it has:
- Its own entry point (index.ts, main.ts, app.ts, server.ts)
- A distinct concern (api/, frontend/, workers/, lib/, shared/)
- Its own config files (package.json in monorepos)
- Enough files to represent a module (not just 1-2 utility files)

**Common patterns to detect:**

| Pattern | What to look for |
|---------|-----------------|
| **Backend/Frontend split** | `backend/`, `frontend/`, `client/`, `server/` |
| **API layer** | `api/`, `src/api/`, `routes/`, `src/routes/` |
| **Worker/job services** | `workers/`, `jobs/`, `queues/`, `cron/` |
| **Shared libraries** | `lib/`, `shared/`, `common/`, `packages/shared/` |
| **Monorepo packages** | `packages/*/`, `apps/*/` |
| **Database layer** | `db/`, `prisma/`, `drizzle/`, `migrations/` |
| **Infrastructure** | `infra/`, `deploy/`, `terraform/` |

**If no distinct components found** (flat project structure like a simple Next.js app): skip this step. The technology specs from Step 8 are sufficient.

**If components found, show the user:**

```
COMPONENT BOUNDARIES DETECTED

Your project has distinct modules that benefit from component-scoped specs:

1. backend/     — API server (Express, 47 files)
2. frontend/    — React SPA (92 files)
3. workers/     — Background jobs (12 files)
4. shared/      — Shared types and utilities (8 files)

Generate component specs? (yes / customize / skip)
```

**WAIT FOR USER RESPONSE**

### 9b: Capture each component's invariants (interview, do not scan)

For each component from 9a, invoke `capture-invariants` scoped to that component. It interviews for the load-bearing rules — the decisions a new dev breaks on day one — and emits a spec carrying each rule, its why, a revisit-if clause, and `conformance_rules` for the mechanizable subset.

**Do not scan-and-describe the component's current code.** The current code may already violate the invariant you are capturing; describing it codifies the transitional state, not the decision. That is why `capture-invariants` interviews instead of scanning (see `kit/engineering-principles.md`, "How a project applies these"). Generic framework patterns the dev already knows are out — capture what they cannot discover by reading the code.

Invoke per component:

```
Skill: capture-invariants
args: Capture the load-bearing invariants for the {name} component at {path}.
      Emit a spec under $PROJECT_SPECS_ROOT/components/{name}.md with applies_to
      covering {path}, each invariant's rule + why + revisit-if, and
      conformance_rules for the mechanizable subset.
```

If 9a found no distinct components (flat project), invoke `capture-invariants` once for the project as a whole.

### 9c: What capture-invariants emits

One spec per component (or one project-wide), each invariant carrying two faces:
- **the rule** (the what), plus a **`conformance_rule`** wherever a regex can decide a violation — a banned import, a module-level client, a hardcoded tenant literal;
- **the why plus a revisit-if clause** — mandatory, so a future cleanup does not delete a load-bearing rule it does not understand.

Semantic invariants no regex can decide ("the LLM never computes a number") stay prose, enforced at `/review`. The skill caps to the load-bearing few (~3-5) — a wall of rules gets disabled wholesale the first time it blocks someone under deadline. It does not emit a "patterns" or "directory structure" dump; that is derivable by reading the code.

### 9d: Confirm registration

`capture-invariants` emits each spec with a frontmatter `applies_to`, and `enforce-specs` discovers specs by reading that frontmatter directly — enforcement needs no manual step. Add a `stack-config.yaml` entry only for the operational registry, the human/tooling view of which specs cover which files:

```yaml
specs:
  components:
    - name: backend
      file: components/backend.md
      applies_to:
        - "backend/**/*.ts"
      description: "Backend load-bearing invariants"
```

### 9e: Verify enforcement

After generating, verify enforce-specs will pick them up:

```bash
# Test: does a backend file trigger the backend spec?
echo '{"tool_name":"Edit","tool_input":{"file_path":"backend/src/routes/users.ts"}}' | \
  node .claude/hooks/context/enforce-specs.cjs
```

If enforcement works, Claude will be required to read `components/backend.md` before editing any file in `backend/`.

## STEP 10: Generate System Map

Generate `$PROJECT_SPECS_ROOT/architecture/system-map.yaml` — a structured YAML document that maps how the project's components connect.

### Purpose

The system map is a dependency graph and change impact guide. It tells Claude: "if you change file X, what else is affected?" It gets:
- **Enforced** by enforce-specs (must read before editing project files)
- **Freshness-checked** by context agent at session start
- **Update-flagged** by phase evaluator after commits that change architecture

### What to include

The map is the **non-derivable change intelligence** — the rules a dev cannot recover by grepping imports. Capture:
1. **Load-bearing nodes** — the few files/modules where a change ripples non-obviously, each with its `if_changed` rule. Not every file.
2. **Data flow** — how data moves through the system (routes, state, APIs).
3. **Config connections** — what config files reference each other.
4. **Change rules** — "if you change X, also update Y."

Do **not** emit an exhaustive per-file `imports`/`used_by` graph. That is derivable — Claude greps imports at edit time — and it is the bulk of the bloat. The map's value is the `if_changed`/`change_rules` intelligence no grep produces.

### How to scan

Scan to find the load-bearing nodes and cross-cutting flows, not to enumerate every import:

```bash
# Entry points and likely hubs (high fan-in/fan-out)
find . -path ./node_modules -prune -o \( -name "index.*" -o -name "main.*" -o -name "app.*" \) -print | head -20

# Config cross-references
grep -rl "tsconfig\|tailwind\|postcss\|vite\|pyproject\|Cargo" *.config.* *.json *.toml 2>/dev/null

# Data sources / routes / API surfaces
find . -path "*/api/*" -o -path "*/routes/*" 2>/dev/null | head -10
```

### Generate the YAML

```yaml
# System Map — [project name]
# Change-impact guide: the non-derivable rules — if you change X, what else.
# Read this before editing project files.
#
# Generated by /sync-stack
# Last verified: [date]

components:
  # Only the load-bearing nodes — where a change ripples non-obviously.
  # No imports/used_by: that is derivable by grepping at edit time.
  src/lib/api.ts:
    purpose: API client; the single boundary to the external API
    if_changed:
      - Update API types if the response shape changes
      - Check every hook that calls these functions

data_flow:
  # How data moves through the app
  - "User action → src/hooks/useData.ts → src/lib/api.ts → external API"
  - "API response → state store → component re-render"

config_connections:
  tsconfig.json:
    referenced_by: [vite.config.ts]
    paths_must_match: src/ directory structure
  tailwind.config.ts:
    content_must_include: ["src/**/*.tsx"]
    referenced_by: [postcss.config.js]

change_rules:
  - trigger: "Adding a new page/route"
    do:
      - Add to navigation component
      - Update sitemap if it exists
      - Add route test

  - trigger: "Changing API response shape"
    do:
      - Update TypeScript types
      - Update all consumers of that endpoint
      - Update tests
```

### Adapt to project type

The example above is for a web app. Adapt the structure to match the actual project:

| Project Type | Key Components | Key Connections |
|-------------|----------------|-----------------|
| Web app | Pages, components, API routes, state | Route → component → API → data |
| CLI tool | Commands, modules, config | Command → handler → output |
| Library | Public API, internal modules | Export → consumer → types |
| API server | Routes, middleware, models | Request → middleware → handler → DB |
| Static site | Pages, layouts, content | Content → template → output |

### Add to stack-config.yaml

Add the system map spec with applies_to patterns covering the project's source files:

```yaml
architecture:
  - name: system-map
    file: architecture/system-map.yaml
    applies_to:
      - "src/**/*.ts"
      - "src/**/*.tsx"
    description: "How project components connect — dependency graph and change impact guide"
```

## STEP 11: Generate CI Workflow

**Generate GitHub Actions CI workflow based on detected stack.**

### Check if CI exists

```bash
ls .github/workflows/ci.yml 2>/dev/null
```

If exists, ask: "CI workflow exists. Regenerate based on current stack? (yes/skip)"

### Generate based on stack

Create `.github/workflows/ci.yml` with checks appropriate for the detected stack:

**Node.js projects (React, Next.js, Astro, Docusaurus, etc.):**

```yaml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: '[npm/yarn/pnpm]'
      - run: [npm ci / yarn / pnpm install]
      - run: npm run build
      - run: npm run lint --if-present
      - run: npm test --if-present
```

**Python projects:**

```yaml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install -r requirements.txt
      - run: ruff check . --if-present
      - run: pytest --if-present
```

**Config/docs projects (no build):**

```yaml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Validate YAML
        run: |
          python3 -c "import yaml; [yaml.safe_load(open(f)) for f in __import__('glob').glob('**/*.yaml', recursive=True)]"
      - name: Validate JSON
        run: |
          python3 -c "import json; [json.load(open(f)) for f in __import__('glob').glob('**/*.json', recursive=True)]"
```

### Adapt to detected stack

Use the stack detected in Step 4 to:
1. Choose the right base template
2. Set correct package manager (npm/yarn/pnpm/bun)
3. Include test command if testing framework detected
4. Include lint command if linter detected
5. Include build command if framework has one

### Enable auto-merge support

Add to the workflow:

```yaml
permissions:
  contents: write
  pull-requests: write
```

This allows the commit skill's `gh pr merge --auto` to work.

## STEP 12: Verify Wiring

**Check that all configs are actually connected properly.**

### 12a: TypeScript paths

```bash
# Check tsconfig paths exist
cat tsconfig.json | jq '.compilerOptions.paths'
# Verify those paths resolve to actual directories
```

### 12b: Tailwind content

```bash
# Check tailwind content array
cat tailwind.config.* | grep -A5 "content"
# Verify patterns match actual file locations
```

### 12c: Build script

```bash
# Try a build
npm run build 2>&1 | head -20
```

### 12d: Peer dependencies

```bash
# Check for peer dep warnings
npm ls 2>&1 | grep -i "peer"
```

### Report issues

If any verification fails:

```
WIRING ISSUES DETECTED

1. [Issue description]
   - Expected: [what should be]
   - Found: [what is]
   - Fix: [how to fix]

2. [Next issue...]

Fix these issues? (yes/no)
```

**WAIT FOR USER RESPONSE** before making fixes.

## STEP 13: Create or Update stack-config.yaml

Create `.claude/specs/stack-config.yaml` if it doesn't exist, or update the existing one with:

1. **Stack details** - framework, language, styling, testing, package_manager
2. **Specs list** - each spec needs: name, file, applies_to patterns, description

The `applies_to` patterns tell enforce-specs.cjs which files require reading this spec before editing.

Example update:

```yaml
stack:
  framework: "Next.js"
  framework_version: "14"
  language: "TypeScript"
  styling: "Tailwind CSS"
  testing: "Vitest"
  package_manager: "pnpm"

specs:
  coding:
    - name: nextjs-specs
      file: coding/nextjs-specs.md
      applies_to:
        - "app/**/*.tsx"
        - "pages/**/*.tsx"
      description: "Next.js patterns and conventions"

    - name: typescript-specs
      file: coding/typescript-specs.md
      applies_to:
        - "**/*.ts"
        - "**/*.tsx"
      description: "TypeScript patterns"

    - name: tailwind-specs
      file: coding/tailwind-specs.md
      applies_to:
        - "**/*.tsx"
        - "**/*.jsx"
        - "tailwind.config.*"
      description: "Tailwind CSS patterns"

    - name: vitest-specs
      file: coding/vitest-specs.md
      applies_to:
        - "**/*.test.ts"
        - "**/*.spec.ts"
      description: "Testing patterns"

  architecture:
    - name: project-structure
      file: architecture/project-structure.md
      applies_to: []
      description: "File structure conventions"

  design:
    - name: design-system
      file: design/design-system.md
      applies_to: []
      description: "Design tokens and styles"

  config:
    - name: version-control
      file: config/version-control.md
      applies_to: []
      description: "Git conventions"
```

**applies_to patterns:**
- Use glob patterns that match files this spec governs
- `**/*.tsx` matches all .tsx files
- `app/**/*.tsx` matches .tsx files under app/
- Empty array `[]` means spec is loaded but not enforced on specific files

Only include categories that have specs. Don't add empty categories.

## STEP 14: Summary

Show what was created/updated:

```
SYNC COMPLETE

Stack: Next.js 14 + TypeScript + Tailwind + Vitest
Package manager: pnpm
Lock file: pnpm-lock.yaml ✓

Setup:
- Dependencies installed (147 packages)
- No peer dependency issues

Wiring verification:
- TypeScript paths ✓
- Tailwind content ✓
- Build script ✓
- All configs connected properly

Specs generated (project reality first):
- components/app.md, components/api.md — load-bearing invariants per module (interview-captured)
- config/version-control.md, config/testing.md — the project's actual setup (deployment/environment skipped: not configured)
- coding/nextjs-specs.md — non-obvious runtime only (SSR/hydration); most technologies need no spec and are skipped
- architecture/system-map.yaml — change-impact rules (if_changed / change_rules)

CI/CD:
- .github/workflows/ci.yml (build, lint, test)
- Auto-merge enabled via commit skill

Updated: stack-config.yaml

Next steps:
- Review CI workflow in .github/workflows/ci.yml
- Review specs in .claude/specs/
- Run /build to implement with these specs enforced
```

### Save state for pivot detection

After successful sync, save a hash of key files for detecting future changes:

```bash
# Create .claude/specs/.sync-state.json
{
  "lastSync": "2024-01-15T10:30:00Z",
  "hashes": {
    "package.json": "[md5 hash]",
    "package-lock.json": "[md5 hash]",
    "tsconfig.json": "[md5 hash]",
    "tailwind.config.ts": "[md5 hash]"
  }
}
```

This allows future `/sync-stack` runs to detect what changed and prompt for updates.

## Error Handling

### context7 fails (network error, timeout)
STOP. Notify user. Do not proceed with web search. Ask user how to proceed.

### context7 has no docs for [tech]
Use WebFetch on official docs site only (with user approval). Note source in spec file.

### Can't detect stack
Ask user directly: "What framework/language are you using?"

### Conflicting patterns in existing code
Note the inconsistency. Ask user which pattern to standardize on.

### Spec already exists
Ask: "Update existing [tech]-specs.md? (yes/skip)"

## Adding a Single Dependency

When run as `/sync-stack [dependency]`:

1. Skip full stack detection
2. Research just that dependency
3. Check for existing patterns using it
4. Generate/update the coding spec for that dependency
5. If the dependency has architecture implications (e.g., Prisma schema location), update architecture specs too
6. Add to stack-config.yaml specs list

**Note:** Single dependency mode focuses on coding specs. Run full `/sync-stack` to regenerate architecture/design/documentation specs.

## Migrating Specs to a Tracked Location

When run as `/sync-stack --migrate-specs`, this mode moves a project from the legacy spec layout (everything under `.claude/specs/`) to the new layout where curated project specs live under `<project_specs_root>/` and only kit-owned specs stay under `.claude/specs/`.

Use this mode when:
- You're in client mode and want curated specs to commit to the project repo.
- You want project specs to travel with code commits in any mode.
- You're recovering a project where `.claude/specs/` was lost.

### Step 1: Detect Current Layout

```bash
ls .claude/specs/architecture/ .claude/specs/design/ .claude/specs/config/ \
   .claude/specs/coding/ .claude/specs/components/ 2>/dev/null
```

If none of these exist, there's nothing to migrate. Stop and inform the user.

### Step 2: Confirm Target Root

Resolve `PROJECT_SPECS_ROOT` with the same logic as STEP 0. Then show the user:

```
MIGRATION PLAN

Source: .claude/specs/{architecture, design, config, coding, components}/
Target: <project_specs_root>/...

Files to move (using git mv to preserve history):
[enumerate every file under the legacy subtrees]

Files that STAY at .claude/specs/:
- kit/*
- lenses/*
- claude-code/*
- design/craft.md
- stack-config.yaml

Stack-config.yaml file: paths will be rewritten to project-root-relative.

A README.md will be created at <project_specs_root>/ explaining the convention.

Proceed? (yes / customize root / cancel)
```

WAIT FOR USER RESPONSE.

### Step 3: Execute Migration

For each file in the legacy subtrees:

```bash
mkdir -p "$PROJECT_SPECS_ROOT/<subdir>"
git mv ".claude/specs/<subdir>/<file>" "$PROJECT_SPECS_ROOT/<subdir>/<file>"
```

`git mv` preserves history. If the project is in client mode and `.claude/` is in `.git/info/exclude`, `git mv` reports "did not match any files" because the original files were never tracked. Fall back to plain `mv`:

```bash
mv ".claude/specs/<subdir>/<file>" "$PROJECT_SPECS_ROOT/<subdir>/<file>"
```

This is the expected path for client-mode migrations: the originals were never tracked, so there's no history to preserve.

After moves, rewrite `stack-config.yaml`: every `file:` entry that pointed at a moved file gets prefixed with `$PROJECT_SPECS_ROOT/`. Use a YAML-aware rewrite (Node or python3), not sed, to avoid mangling the file.

```
# Before: file: architecture/decisions.md
# After:  file: docs/specs/architecture/decisions.md
```

### Step 4: Write Config and README

Write `.claude/specs.yaml` with the chosen `project_specs_root`. Write the README at the target root if it doesn't exist (same content as init-project STEP 5.0).

### Step 5: Verify

```bash
# All moved files exist at the new path; no stale .claude/specs/<moved-subdir>/ remain.
echo '{"tool_input":{"file_path":"src/example.ts"}}' | \
  node .claude/hooks/context/enforce-specs.cjs
# Should list specs from BOTH .claude/specs/ and project_specs_root/
```

Report:

```
MIGRATION COMPLETE

Moved N files from .claude/specs/ to <project_specs_root>/.
Updated stack-config.yaml with N rewritten paths.
Wrote .claude/specs.yaml and <project_specs_root>/README.md.

Next steps in CLIENT-MODE projects:
- Run `git status` — moved files now appear as new tracked files in the project repo.
- Commit them with the next related code change.

Next steps in PERSONAL projects:
- Nothing extra. The new layout is already live.
```

Migration is idempotent: a second run detects no legacy subtrees and reports "nothing to migrate."

## Adding Custom Project Specs

When run as `/sync-stack --custom [name]`:

Use this for internal project rules NOT covered by library documentation:
- Internal API conventions
- Company naming standards
- Security requirements
- Accessibility standards
- Business logic rules
- Any project-specific patterns

**Don't use for:** generic library patterns (React, Prisma, Tailwind) — the dev knows those, and the engineering principles govern code style. The main `/sync-stack` flow captures project reality via the invariant interview (STEP 9).

### Step 1: Spec Type

Ask the user which type:

1. **coding** - Internal coding standards (`.claude/specs/coding/`)
2. **architecture** - System design rules (`.claude/specs/architecture/`)
3. **design** - Design rules (`.claude/specs/design/`)
4. **config** - Operational rules (`.claude/specs/config/`)

### Step 2: Confirm

Show: type, name, file path. Ask for confirmation.

### Step 3: Create File

Create the spec file with template:

```markdown
# [Spec Name]

## Overview

[What this spec covers]

## Patterns

### [Pattern Name]
[Description with code example]

## Anti-Patterns

- [What NOT to do] - [Why]
```

### Step 4: Update stack-config.yaml

Add the spec to the appropriate category with its applies_to patterns:

```yaml
specs:
  coding:
    - name: api-conventions
      file: coding/api-conventions.md
      applies_to:
        - "src/api/**/*.ts"
        - "src/routes/**/*.ts"
      description: "Internal API conventions"
```

Ask the user what file patterns this spec should govern. These patterns determine when Claude must read this spec before editing.

### Step 5: Generate Content (Optional)

Ask if they want help filling in the spec:

1. **Research** - Research general best practices to scaffold
2. **Manual** - Keep template for manual editing

Research sources for custom specs:
- REST/GraphQL API design guidelines
- OWASP security best practices
- WCAG accessibility standards
- Language-agnostic patterns

### Step 6: Done

Confirm the spec was created. Suggest reviewing and customizing.

## How Specs Are Used

After running `/sync-stack`:

**For /build:**
1. Claude loads `stack-config.yaml`
2. Reads all spec files listed under `specs:`
3. Specs are now in context for the work

**For enforcement (automatic):**
1. Claude attempts to edit a file
2. `enforce-specs.cjs` reads `stack-config.yaml`
3. Checks if file matches any spec's `applies_to` patterns
4. If match found, blocks edit until that spec is read
5. After reading spec, edits are allowed for that prompt

**Your specs become the rules.** The `applies_to` patterns determine which files require which specs.
