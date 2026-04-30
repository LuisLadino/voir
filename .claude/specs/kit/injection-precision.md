---
name: injection-precision
description: >
  Convention for UserPromptSubmit context-injection modules: all pattern-match
  triggers use word-boundary regex compiled through escapeRegex. Prevents
  metacharacter bugs and reduces substring false positives across the kit.
applies_to:
  - ".claude/hooks/context/**/*.cjs"
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
