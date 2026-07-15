---
name: injection-precision
description: >
  Convention for kit pattern-match gates. UserPromptSubmit context-injection
  triggers use word-boundary regex compiled through escapeRegex; matcher-gated
  PreToolUse Bash gates anchor at a command position via atCommandPosition.
  Prevents metacharacter bugs and substring false positives across the kit.
applies_to:
  - ".claude/hooks/context/**/*.cjs"
  - ".claude/hooks/safety/enforce-skills.cjs"
  - ".claude/hooks/safety/enforce-plan.cjs"
  - ".claude/hooks/safety/check-spec-conformance.cjs"
  - ".claude/hooks/safety/check-yaml-validity.cjs"
  - ".claude/hooks/safety/concurrent-session-gate.cjs"
  - ".claude/hooks/safety/block-dangerous.cjs"
  - ".claude/hooks/safety/block-sensitive-bash-writes.cjs"
  - ".claude/hooks/lib/command-position.cjs"
category: kit
---

# Injection Precision

## Rule

Every pattern match against a user prompt MUST use a word-boundary regex compiled through `escapeRegex` from `.claude/hooks/lib/regex.cjs`. No raw substring includes. No `new RegExp(userInput)` without escaping first.

```js
const { escapeRegex } = require('../lib/regex.cjs');

const re = new RegExp(`\\b${escapeRegex(trigger)}\\b`, 'i');
if (re.test(prompt)) { /* fire */ }
```

## Why

Unescaped triggers produce three failure modes:
- Triggers with `.`, `?`, `+`, `*`, `(`, `)` match unintended input or fail to compile.
- Substring matching fires on incidental occurrences inside longer words.
- Over-firing accumulates and trains Claude to treat directives as noise.

The lens-router #123 and #133 and spec-triggers #130 both hit this. The shared `escapeRegex` closes the pattern. This spec documents it so future modules don't drift.

## Rule: Bash command gates anchor at a command position

A matcher-gated PreToolUse Bash hook, the kind registered with `if: "Bash(*git commit*)"`, MUST NOT enforce on a raw substring match. The settings matcher is a coarse glob that fires whenever the phrase appears anywhere in the command, including inside a quoted argument, a heredoc, or a `node -e` script. Treat it as a cheap pre-filter and re-check, inside the hook, that the phrase sits at a command position before acting. Use the shared helper:

```js
const { atCommandPosition } = require('../lib/command-position.cjs');

// `git commit` only when it actually runs, not buried in a quoted argument
if (atCommandPosition(command, String.raw`git\s+commit\b`, 'i')) { /* gate */ }
```

A command position is start-of-string, immediately after a shell separator such as a newline or `;` `&` `|`, or inside a `$(...)` or backtick command substitution, optionally preceded by `VAR=val` prefixes. A bare `(` is not a boundary, so `echo "(git commit)"` does not fire while `x=$(git commit)` does.

For a hard-blocking gate, prefer this over broadening the matcher. A missed exotic form is a false negative the operator can override; a substring false positive blocks unrelated work and trains the operator to bypass the gate. First derived inline in `concurrent-session-gate.cjs` (#630), extracted to `command-position.cjs` and shared across the gates (#642).

`atCommandPosition` neutralizes the two contexts where a `\n`/`;`/`&`/`|` is data, not a real boundary, before testing (#764): it strips heredoc bodies (keeping the operator line, so `cat <<EOF | git commit` still matches) and blanks quoted literal text. The quote strip preserves any `$(...)`/backtick command substitution inside the quotes — those are real command positions even inside double quotes, so `x="$(git commit)"` must still match; removing the whole region would be a false negative on a hard-block gate. Both are heuristics: a phrase inside a single-quoted `$(...)` lookalike still matches (single quotes do not execute substitutions, but the strip treats both quote types alike), and unbalanced quotes fall through to the raw test. The shared strippers (`stripHeredocs`, `stripQuotedRegions`) are exported from `command-position.cjs` and used by every Bash gate rather than copied; see "Shared lexical strippers" below.

## Shared lexical strippers

`command-position.cjs` is the single home for the two strippers that neutralize Bash data regions before a pattern match:

- `stripHeredocs(cmd, { mode })` — `mode: 'preserve-operator'` (default) keeps the operator line so a same-line redirect or pipe still matches; `mode: 'placeholder'` replaces the whole `<<DELIM ... DELIM` span with an inert token. One canonical regex handles `<<`/`<<-`, matching-quoted delimiters, same-line `EOF)` command-substitution closes, and `\w+` delimiters.
- `stripQuotedRegions(cmd, { preserveSubstitutions })` — `false` (default) removes quoted regions outright; `true` keeps any `$(...)`/backtick substitution inside the region so a hard-block gate never false-negatives on `"$(git commit)"`.

A new Bash gate that needs to ignore heredoc bodies or quoted text MUST import these, not re-derive them. Re-deriving the heredoc parse is how five copies drifted before #769. Two deliberate exceptions, documented in place: `stripCommandContent` (session-utils.cjs) layers content-flag truncation on top of `stripHeredocs`; `stripQuotes` (check-spec-conformance.cjs) is a token-level dequote of a single already-split refspec, not a region stripper.

## Modules that must comply

- `.claude/hooks/context/lens-router.cjs`
- `.claude/hooks/context/spec-triggers.cjs`
- `.claude/hooks/context/capture.cjs` uses hand-written anchored regex, compliant
- `.claude/hooks/context/reasoning-checkpoints.cjs` uses hand-written anchored regex, compliant
- `.claude/hooks/context/voice-identity.cjs` uses hand-written anchored regex, compliant
- Any future UserPromptSubmit injection module.

## How to verify

Grep for `new RegExp` under `.claude/hooks/context/` and confirm each call uses `escapeRegex` on a variable-source trigger, or is a hand-written literal with word-boundary anchors.

```bash
grep -rn "new RegExp" .claude/hooks/context/
```
