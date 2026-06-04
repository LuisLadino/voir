---
name: spec-format
description: >
  How to write spec files. Required reading before creating or editing any file
  in .claude/specs/. Defines the frontmatter format that enables enforcement.
applies_to:
  - ".claude/specs/**/*.md"
  - ".claude/specs/**/*.yaml"
category: meta
---

# Spec File Format

Specs are reference documents that Claude must read before taking certain actions. The enforce-specs hook uses frontmatter to route file edits to the correct spec.

## Frontmatter Schema

```yaml
---
name: spec-name
description: >
  What this spec covers. One or two sentences explaining the content and
  when Claude should read this.
applies_to:
  - "pattern1"
  - "pattern2"
category: coding | config | architecture | design | documentation | claude-code | meta
source: optional-url-or-reference
---
```

**Required fields:**
- **name** — Unique identifier for this spec
- **description** — What the spec covers, when to read it
- **applies_to** — File glob patterns this spec governs
- **category** — Which specs directory this belongs in

**Optional fields:**
- **excludes** — Glob patterns to exclude from `applies_to` matches
- **triggers** — Keywords that auto-load this spec when mentioned in a prompt
- **source** — Where patterns came from (docs URL, etc.)
- **version** — Library version these patterns apply to
- **related** — Other specs that should be read together
- **conformance_rules** — Mechanizable rules checked against changed lines before they reach the remote: the staged diff at commit, the pending-push commits at push. See [Conformance Rules](#conformance-rules).

### triggers Field

The `triggers` field enables automatic spec loading. When a user's prompt contains any trigger keyword, the spec is loaded into context without requiring a manual read.

```yaml
triggers: [commit, git, branch, push, merge]
```

The `spec-triggers.cjs` module scans all specs for this field dynamically — no hardcoded paths.

## applies_to Patterns

The `applies_to` field uses glob patterns to match files. When Claude tries to edit a file matching any pattern, the spec must be read first.

### Examples

```yaml
# Matches all JavaScript files
applies_to:
  - "**/*.js"
  - "**/*.cjs"
  - "**/*.mjs"

# Matches hook files specifically
applies_to:
  - ".claude/hooks/**/*.cjs"

# Matches multiple specific directories
applies_to:
  - "src/components/**/*.tsx"
  - "src/pages/**/*.tsx"

# Matches by naming convention
applies_to:
  - "**/*.test.ts"
  - "**/*.spec.ts"
```

### Excludes

Use `excludes` when `applies_to` is broad but specific subdirectories have their own specs:

```yaml
# project-structure applies to all markdown, except directories
# with their own component specs
applies_to:
  - "**/*.md"
excludes:
  - "projects/**"
  - "foundations/**"
  - "personal/**"
```

A file matching both `applies_to` and `excludes` is excluded — the spec is NOT enforced.

### Pattern Syntax

- **`*`** — Any single path segment
- **`**`** — Any number of path segments
- **`*.ext`** — Any file with extension
- **`dir/**`** — Anything under directory

## Categories

Specs are organized by category into subdirectories:

- **coding** (`specs/coding/`) — Language/library patterns (React, TypeScript)
- **config** (`specs/config/`) — Git, testing, deployment, environment
- **architecture** (`specs/architecture/`) — File structure, project organization
- **design** (`specs/design/`) — Design tokens, styling conventions
- **documentation** (`specs/documentation/`) — Code comments, docstrings
- **claude-code** (`specs/claude-code/`) — Claude Code internals (this framework)
- **kit** (`specs/kit/`) — Kit operational patterns, formatting, anti-patterns
- **lenses** (`specs/lenses/`) — Lens augmentation system registry and contracts
- **meta** (`specs/`) — Specs about specs (this file)

## Example Spec File

```markdown
---
name: react-specs
description: >
  React component patterns and conventions. Required reading before creating
  or modifying React components (.tsx files in src/components/).
applies_to:
  - "src/components/**/*.tsx"
  - "src/pages/**/*.tsx"
  - "**/*.jsx"
category: coding
source: https://react.dev
version: "18"
---

# React Specs

Patterns for React components in this project.

## Component Structure

All components use function syntax with TypeScript:

\`\`\`tsx
interface Props {
  title: string;
  onClick?: () => void;
}

export function Button({ title, onClick }: Props) {
  return <button onClick={onClick}>{title}</button>;
}
\`\`\`

## Anti-Patterns

- Never use `any` type
- Never mutate state directly
- Never call hooks inside conditions
```

## Conformance Rules

Optional `conformance_rules` declare mechanizable checks the kit runs against changed code before it lands. The hook scans added lines, applies each rule's regex, and blocks the operation when a match lands on a file the rule covers.

Use this for the rules a regex can decide on its own: spacing tokens off the documented scale, raw hex colors where tokens are required, banned class names. Judgment-based rules stay in prose: "this naming is wrong here", "this responsibility belongs in another layer". The `/commit` and `/review` skills walk the diff against spec prose alongside the hook.

### Where the gate runs

Two gates share one hook, `check-spec-conformance.cjs`. Both scan only added lines.

- **commit** — `Bash(*git commit*)` scans the staged diff.
- **push** — `Bash(*git push*)` and `Bash(*gh pr create*)` scan the ref the command pushes, diffed three-dot from its base. The source ref comes from the command's refspecs and defaults to HEAD, so `git push origin feature` scans `feature` even from another checked-out branch. Each ref's base is its own upstream, else the same-named `origin/<ref>`, else the remote default branch `origin/HEAD`. When none resolves, that ref fails open.

The push gate catches violations the commit gate never saw: commits made outside Claude Code's Bash tool, `--no-verify` bypasses of git's own hooks, and manual edits after a gated commit. Force-push does not bypass it. The ref's content is still scanned, and overwriting remote history is auditable through the remote reflog. Pushes that carry no incoming file content are skipped: ref deletions, `--dry-run`, and tag-only pushes.

### Schema

```yaml
conformance_rules:
  - name: rule-id
    pattern: 'regex'
    message: |
      What the violation is and how to fix it. Shown in the block message.
    applies_to:
      - "pattern1"
    excludes:
      - "pattern2"
```

**Required per rule:**
- **name** — short identifier shown in the violation report
- **pattern** — JavaScript regex source (no surrounding slashes, no flags)
- **message** — explanation + fix; included verbatim in the block output

**Optional per rule:**
- **applies_to** — narrows the rule below the spec's own `applies_to`. Defaults to the spec's `applies_to` when omitted.
- **excludes** — paths the rule never fires on. Stacked on top of the spec's `excludes`.

### Authoring rules

- Run the regex against representative added lines before merging. The hook fails open on a regex compile error, but a false-positive rule that blocks every commit is worse than no rule.
- Keep one rule per documented standard. Bundling several into one regex makes the violation message generic.
- The block message must name a fix, not just the violation. "Use `gap-4` (16px) from the documented spacing scale" beats "off-scale gap".
- When a rule belongs to a single file extension, set per-rule `applies_to` to scope it. Example: raw hex literals only matter in component files, not token CSS.

### Failure modes

A rule with a missing field, a malformed regex, or a non-map entry is silent-skipped with a stderr warning. The gate never blocks because a rule was authored wrong, only because a rule fired.

## How Enforcement Works

1. Claude attempts Edit/Write on a file
2. enforce-specs.cjs runs as PreToolUse hook
3. Hook reads all spec frontmatter to find matching `applies_to` patterns
4. If match found, checks if spec was read anywhere this session
5. If not read, DENY with instruction to read spec first
6. If read, ALLOW the edit

## Adding a New Spec

1. Create file in appropriate `specs/{category}/` directory
2. Add frontmatter with name, description, applies_to, category
3. Write the spec content
4. Done — enforce-specs scans spec files directly, no registration needed

## Spec Content Structure

After the frontmatter, follow self-documentation rules. Use this general structure:

```markdown
# Spec Title

Brief overview of what this spec covers.

## Patterns

### Pattern Name
Explanation with code example.

\`\`\`language
code example
\`\`\`

## Anti-Patterns

- What NOT to do — why
- Another anti-pattern — why
```
