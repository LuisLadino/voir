---
name: voice-context
description: >
  How per-project voice routing works. Required reading before editing
  enforce-voice.cjs, voice-identity.cjs, voice-registry.cjs, or
  .claude/voice.yaml. Covers registry schema, channel coverage, signal
  precedence, registration, bootstrap, and failure modes.
applies_to:
  - ".claude/hooks/lib/voice-registry.cjs"
  - ".claude/hooks/context/enforce-voice.cjs"
  - ".claude/hooks/context/voice-identity.cjs"
  - ".claude/voice.yaml"
category: kit
related: [self-documentation, injection-precision, tracking-persistence]
---

# Voice Context Routing

## The Model

Voice is a property of the destination of the content, not the author. Every repo may host multiple voices. The repo-level flag is not the unit of routing. The act of writing is.

Three voice categories:
- `luis` is the default. Covers personal content, commits, PRs, issue bodies, portfolio, bios.
- `client:NAME` covers brand copy per paid client project.
- `none` means skip enforcement. Covers adversarial prompt drafting, CTF challenges, intentional non-Luis-voice drafts.

## Two Enforcement Planes

Voice enforcement splits by channel, with opposite defaults that match each channel's dominant use.

**Plane 1.** File content on disk via Write or Edit, plus clipboard content via Bash pbcopy. Implemented in `enforce-voice.cjs`.

- Write and Edit default to SKIP. Enforcement fires only when the target path matches a `paths:` entry in `voice.yaml`. Unmatched writes pass silently regardless of extension or project tree. Rationale: file writes are overwhelmingly internal state such as specs, memory, research notes, logs. External drafts that need voice-checking are opt-in via path declaration.
- Bash pbcopy defaults to ENFORCE. The channel is inherently external: content piped to the clipboard is assumed for an external reader unless routed to `none` or overridden with `VOICE=none`. Rationale: pbcopy is the dominant external channel for drafts that leave the session.

The Bash content-file redirect channel was removed in #743. Redirects to `.md`/`.mdx`/`.txt` are overwhelmingly internal (notes, logs, generated docs), the default-enforce taxed routine authoring, and the regex was quote-naive. File content that needs voice-checking is opt-in via Write/Edit `paths:`; pbcopy stays the external edge.

**Plane 2.** Outbound tool calls with inline content arguments such as send_email, post_to_instagram, send_sms. Not yet shipped in the kit because the kit has no external-send tools wired today. Architectural shape decided per #305 V1 (Hybrid Option C: SDK PreToolUse hook primary (kit registers its own; product registers its own) plus minimal Python-decorator helper for non-MCP boundary cases — see `cosmo:docs/research/product-sdk/voice-plane-2-landscape-2026-04.md`). Implementation extends `enforce-voice.cjs` with an `external_tools:` registry — PreToolUse matchers on declared MCP tool patterns, inspecting `tool_input` content fields with the same hash-verified retry model as pbcopy. First retrofit target is Gmail MCP send (`mcp__gmail__send`) per #305 V1 first-validation use case, filed independently of Sam's pilot timeline. Reversal: switches to Approach E (gateway pattern via Cloudflare Enterprise MCP / Strata / Gravitee) at LLC multi-venue scale (5+ venues per #300 V2 ops crossover) AND when the hook plus helper proves insufficient at scale. Issue origin: #240 folded into #268 during 2026-04-24 cleanup, then promoted to per-dimension under #305 per #296 restructure.

## Registry Schema

Per-project file at `.claude/voice.yaml`. Project-owned. `sync-kit.sh` creates a template if missing and never overwrites.

```yaml
default: luis

voices:
  luis:
    rules: |
      No em dashes. Use periods or colons.
      # rest of Luis voice rules
  "client:ignite":
    rules: |
      Ignite brand voice rules.
  none:
    rules: null

paths:
  - match: "content/brand/**"
    voice: "client:ignite"
  - match: "prompts/**"
    voice: none
```

Fields:
- `default` names the fallback voice when no other signal fires.
- `voices.NAME.rules` is the text injected into the hook reminder. `null` means skip enforcement for this voice.
- `paths[]` maps glob patterns to voice names. First-match-wins, top to bottom. Patterns match project-relative paths.

## Signal Precedence

Three sources, highest to lowest:
1. `VOICE=NAME` env-var prefix in the Bash command. Example: `VOICE="client:ignite" echo ... | pbcopy`. Bash channel only.
2. Path-pattern match from `paths[]`. Applies to Write and Edit.
3. Registry `default`. Bash channel only. Write and Edit do not fall through to `default` under the Plane 1 scope inversion.

If no signal matches and the registry is missing or invalid, the Bash channel falls back to a hardcoded Luis voice. Fresh projects stay safe on pbcopy. Write and Edit in a fresh project with no path rules pass silently.

## Channels Covered

The `enforce-voice` hook fires on `PreToolUse` with matchers `Bash`, `Write`, and `Edit`.

- `Bash` fires when the command pipes to `pbcopy`, or runs `pbcopy` as a leading command reading a file. Default-enforce with Luis fallback. No other Bash command is gated.
- `Write` and `Edit` fire only when the target path matches a `paths[]` entry in `voice.yaml`. Default-skip. Rule patterns work on any extension: a `brand/**/*.tsx` rule blocks Write to tsx files that match.

The `voice-identity.cjs` module fires on `UserPromptSubmit` and injects the active voice's rules as a reminder when the prompt matches content-writing patterns. Both hooks read the same registry, so rule text lives in one place.

## Registration

The hook is registered at **user scope** in `~/.claude/settings.json`, not per-project. Two entries:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "if": "Bash(*pbcopy*)", "command": "cd $(git rev-parse --show-toplevel 2>/dev/null || pwd) && { [ ! -f .claude/hooks/context/enforce-voice.cjs ] && exit 0; node .claude/hooks/context/enforce-voice.cjs; }" }
        ]
      },
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "cd $(git rev-parse --show-toplevel 2>/dev/null || pwd) && { [ ! -f .claude/hooks/context/enforce-voice.cjs ] && exit 0; node .claude/hooks/context/enforce-voice.cjs; }" }
        ]
      }
    ]
  }
}
```

**The Bash entry carries a per-hook `if: Bash(*pbcopy*)` filter (#751).** enforce-voice shares the broad `Bash` matcher block with the other Bash gates, so it narrows at the hook level the way `enforce-skills`, `check-spec-conformance`, and `enforce-plan` do, not by changing the block matcher. The glob is a coarse pre-filter; `detectsPbcopySink` still does the precise re-check, per `injection-precision.md`. Coverage is unchanged: every command the hook acts on contains the literal `pbcopy` token, so it always matches the filter. The node process no longer spawns on the common non-pbcopy Bash call. The filter became safe only after #743 removed the redirect channel, which had needed the broad matcher to see arbitrary redirect commands.

**The guard checks the hook file, not the hooks directory.** Projects that synced the kit pre-voice-registry have the directory but not this hook. File-level existence check avoids crashing on partial sync.

## Manual Bootstrap (without sync-kit.sh)

When a project picks up the kit via `git pull` rather than `sync-kit.sh`, the registry file is not created. To bootstrap manually:

1. Create `.claude/voice.yaml` in the project root.
2. Copy the template above.
3. Adjust `default`, `voices`, and `paths` as needed.

Until the file exists, Write and Edit pass silently under default-skip. The Bash channel falls back to a hardcoded Luis voice for pbcopy. Safe default.

## Hash-Verified Retry

Block events record the content hash via `appendTrackingEvent` as `voice_blocked`. A retry presenting the same hash is blocked again. This preserves the #67 bypass fix. Prepending `VOICE_CHECKED=1` without revising content still fails.

For `Write` and `Edit`, the retry signal is a different content hash. No explicit marker required. For `Bash`, the retry signal is `VOICE_CHECKED=1` combined with a different command hash.

### State scoping

The `lastVoiceBlockedHash` is a single value per prompt or session scope. It is not keyed per voice. In `Bash`, switching voices via `VOICE=NAME` produces a different command hash because the full command changes. In `Write`/`Edit`, switching voices without revising content keeps the hash the same and blocks again under the new voice rules. Use revision OR an explicit `none` routing to pass.

## Adding a New Voice

1. Edit `.claude/voice.yaml` in the target project.
2. Add the voice under `voices:`. Quote names containing `:` (e.g. `"client:ignite"`).
3. Add path rules under `paths[]` if routing by destination.
4. Verify with a `Write` or `pbcopy` that matches the rule.

## Adding a Client Project

1. Add the project path to `DOWNSTREAM` and `CLIENT_PROJECTS` arrays in `sync-kit.sh`.
2. Run `./sync-kit.sh`. This installs `.claude/`, writes `.claude/kit-mode.yaml` with `mode: client`, writes a template `.claude/voice.yaml` with Luis default, and installs the commit-msg attribution scanner.
3. Edit `.claude/voice.yaml` in the client repo. Add the client voice and brand-copy path rules.
4. Verify: a `Write` to the brand path routes to the client voice, an unrelated `Write` routes to Luis.

## Parser Scope

`voice.yaml` is parsed by `.claude/hooks/lib/yaml-mini.cjs`, a hand-rolled zero-dependency parser. The parser accepts the YAML subset that voice.yaml actually uses. Authoring voice.yaml outside this subset will fail parse and the hook will fall back to the hardcoded Luis voice.

Supported:
- Top-level map with string keys, plain or quoted
- String scalar values, plain, single-quoted, or double-quoted
- `null` literal and `~` alias
- Block scalars with `|`, literal, newline-preserving, clip chomping
- Nested maps, any depth
- Sequences of maps for `paths:`
- Comments with `#` on their own line or after whitespace on an unquoted line

Not supported:
- Flow style `{k: v}` or `[a, b]`. Use block style.
- Folded block scalars `>` and chomping modifiers `|-`, `|+`, `>-`, `>+`
- Anchors `&`, `*` and tags `!!type`
- Numeric or boolean auto-conversion. Every non-null scalar returns as a string.
- Explicit indent indicators

The parser is intentionally small. Every feature outside this list requires a design decision, not just an addition.

## Failure Modes to Watch For

**Invalid YAML in `voice.yaml`.** The hook logs to `hook-errors.log` and falls back to hardcoded Luis voice. Fix the YAML.

**Flow style in `voice.yaml`.** `yaml-mini` rejects `{k: v}` and `[a, b]`. Rewrite to block style. Before: `voices:\n  luis: { rules: "L" }`. After: `voices:\n  luis:\n    rules: "L"`.

**Path rule references an undefined voice.** Validation rejects the registry. Hook falls back. Check that every `paths[].voice` names a key under `voices`.

**Voice name contains `:` but is unquoted in YAML.** YAML parses the mapping incorrectly. Always quote client-voice names with double quotes.

**Content unchanged between block and retry.** Intended behavior. Revise the content or switch voices explicitly with a path rule or `VOICE=NAME` prefix.

**Partial sync: hook present, registry module absent.** The hook fails open via a defensive `require`. The tool call proceeds without voice enforcement until the next sync completes.

## Invariants

- Hash-retry verification from #67 stays intact. `enforce-voice.cjs` hashes the command or content and compares against the last `voice_blocked` event.
- Injection modules under `.claude/hooks/context/**/*.cjs` use hand-written anchored regex or `escapeRegex`. See `injection-precision.md`.
- Registry reader resolution order: `CLAUDE_PROJECT_DIR` env var, then walk up from the TARGET file path when provided, then walk up from `cwd`, then fall back. The target-path walk is what makes cross-repo writes load the target repo's `voice.yaml` instead of the orchestrator repo's. See `resolveProjectRoot(hintPath)` in `project-root.cjs` (voice-registry re-exports a `symlinkGuard: false` binding). Subagents reach the registry through this file walk, not session state.
- Hot path short-circuits: on Write and Edit, if no `paths:` rules exist, the hook exits without parsing YAML. The cheap `registryHasPathRules` check runs before `loadRegistry`.
- Auto-memory tree skip: paths under `~/.claude/projects/**/memory/**`, Claude's own internal state resolved from `PROJECTS_DIR` in `session-utils.cjs`, are skipped unconditionally before any voice resolution runs. These are structurally out-of-tree relative to any project root and cannot be matched by any `voice.yaml` `paths:` rule. Skip is prefix-guarded with `path.resolve` to prevent traversal tricks. Implemented at the top of `handleFileWrite` in `enforce-voice.cjs`. The pbcopy channel has no file target, so it does not need the skip.
- Pbcopy sink detection strips quotes (#640) and heredoc bodies (#754): the clipboard channel fires only when `pbcopy` is a real command sink, not when the literal token appears inside an argument or a heredoc body. `detectsPbcopySink` runs `stripHeredocs` (preserve-operator mode) then `stripQuotedRegions` with `preserveSubstitutions` so a command substitution inside quotes survives, both shared from `command-position.cjs` (#769, #851), before testing, so a grep alternation (`grep 'a\|pbcopy'`), an `echo`/`sed` body, a `gh issue create --body` that shows `| pbcopy` as an example, or a `gh pr create` body assembled from a `cat <<EOF ... EOF` heredoc documenting the gate's own examples no longer blocks. A bare pipe cannot live inside quotes, but a command substitution can — `echo "$(make-draft | pbcopy)"` runs the sink — so the quote strip keeps substitutions while blanking the surrounding literal, and a heredoc body is data; stripping never drops a real sink (#851). The heredoc strip keeps the operator line, so `cat <<EOF | pbcopy` still fires, and it runs first because a quoted delimiter (`<<'EOF'`) would otherwise be consumed by the quote strip and the body never matched. Backslash-escaped pipes (`grep a\|pbcopy`, unquoted BRE alternation) are excluded by requiring the pipe's preceding character to be neither `|` nor `\`. Both strips are heuristics, not a shell parser. Both strippers are the single shared implementation in `command-position.cjs` used by every Bash gate (#769); the residual heredoc/quote heuristic gaps are documented in injection-precision.md.
