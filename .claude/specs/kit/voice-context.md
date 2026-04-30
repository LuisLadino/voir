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

**Plane 1.** File content on disk via Write or Edit, plus clipboard content via Bash pbcopy or content-file redirect. Implemented in `enforce-voice.cjs`.

- Write and Edit default to SKIP. Enforcement fires only when the target path matches a `paths:` entry in `voice.yaml`. Unmatched writes pass silently regardless of extension or project tree. Rationale: file writes are overwhelmingly internal state such as specs, memory, research notes, logs. External drafts that need voice-checking are opt-in via path declaration.
- Bash pbcopy and content-file redirects default to ENFORCE. The channel is inherently external: content destined for the clipboard or a content file is assumed for an external reader unless routed to `none` or overridden with `VOICE=none`. Rationale: pbcopy is the dominant external channel for drafts that leave the session.

**Plane 2.** Outbound tool calls with inline content arguments such as send_email, post_to_instagram, send_sms. Not implemented in the kit because the kit has no external-send tools in use. Specified separately under issue #240 for thread 2 product implementation. Architectural pattern when built: PreToolUse matchers on a declared `external_tools:` list, inspecting `tool_input` content fields with the same hash-verified retry model as pbcopy.

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
2. Path-pattern match from `paths[]`. Applies to Write, Edit, and Bash redirects to content files.
3. Registry `default`. Bash channel only. Write and Edit do not fall through to `default` under the Plane 1 scope inversion.

If no signal matches and the registry is missing or invalid, the Bash channel falls back to a hardcoded Luis voice. Fresh projects stay safe on pbcopy. Write and Edit in a fresh project with no path rules pass silently.

## Channels Covered

The `enforce-voice` hook fires on `PreToolUse` with matchers `Bash`, `Write`, and `Edit`.

- `Bash` fires when the command contains `| pbcopy` or a redirect to `.md`, `.mdx`, or `.txt`. Default-enforce with Luis fallback.
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
          { "type": "command", "command": "cd $(git rev-parse --show-toplevel 2>/dev/null || pwd) && { [ ! -f .claude/hooks/context/enforce-voice.cjs ] && exit 0; node .claude/hooks/context/enforce-voice.cjs; }" }
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

**Do not add an `if: "Bash(*pbcopy*)"` filter.** The hook's internal regex handles both `pbcopy` and `.md`/`.mdx`/`.txt` redirects. A matcher-level filter on `pbcopy` would hide the redirect channel from the hook.

**The guard checks the hook file, not the hooks directory.** Projects that synced the kit pre-voice-registry have the directory but not this hook. File-level existence check avoids crashing on partial sync.

## Manual Bootstrap (without sync-kit.sh)

When a project picks up the kit via `git pull` rather than `sync-kit.sh`, the registry file is not created. To bootstrap manually:

1. Create `.claude/voice.yaml` in the project root.
2. Copy the template above.
3. Adjust `default`, `voices`, and `paths` as needed.

Until the file exists, Write and Edit pass silently under default-skip. The Bash channel falls back to a hardcoded Luis voice for pbcopy and content-file redirects. Safe default.

## Claude-Consumed Paths in Bash Redirects

Under Plane 1, Write and Edit already default to skip, so no path is "enforced by default." The Bash channel is different: pbcopy and content-file redirects default-enforce. For Bash redirects, writes under `.claude/` and `.github/` skip voice enforcement, along with the root `CLAUDE.md`. These are instructions and templates Claude reads for itself, not external content. An explicit `paths[]` rule wins over this skip.

## Hash-Verified Retry

Block events record the content hash via `appendTrackingEvent` as `voice_blocked`. A retry presenting the same hash is blocked again. This preserves the #67 bypass fix. Prepending `VOICE_CHECKED=1` without revising content still fails.

For `Write` and `Edit`, the retry signal is a different content hash. No explicit marker required. For `Bash`, the retry signal is `VOICE_CHECKED=1` combined with a different command hash.

### State scoping

The `lastVoiceBlockedHash` is a single value per prompt or session scope. It is not keyed per voice. Switching voices between attempts, via `VOICE=NAME` or a path rule change, produces a different command hash in `Bash` because the full command changes. In `Write`/`Edit`, switching voices without revising content keeps the hash the same and blocks again under the new voice rules. Use revision OR an explicit `none` routing to pass.

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

**False-positive block on self-consumed file.** The hook skips `.claude/**` and `.github/**` by default. When a new self-consumed prefix gets added, update `VOICE_SKIP_PATH_PREFIXES` in `enforce-voice.cjs`.

**Bash redirect regex matches inside quotes.** A command like `echo "rm > file.md"` triggers the hook. The regex is single-pass, not shell-parse aware. Use `VOICE=none` to override when needed.

**Content unchanged between block and retry.** Intended behavior. Revise the content or switch voices explicitly with a path rule or `VOICE=NAME` prefix.

**Partial sync: hook present, registry module absent.** The hook fails open via a defensive `require`. The tool call proceeds without voice enforcement until the next sync completes.

## Invariants

- Hash-retry verification from #67 stays intact. `enforce-voice.cjs` hashes the command or content and compares against the last `voice_blocked` event.
- Injection modules under `.claude/hooks/context/**/*.cjs` use hand-written anchored regex or `escapeRegex`. See `injection-precision.md`.
- Registry reader resolution order: `CLAUDE_PROJECT_DIR` env var, then walk up from the TARGET file path when provided, then walk up from `cwd`, then fall back. The target-path walk is what makes cross-repo writes load the target repo's `voice.yaml` instead of the orchestrator repo's. See `resolveProjectRoot(hintPath)` in `voice-registry.cjs`. Subagents reach the registry through this file walk, not session state.
- Hot path short-circuits: on Write and Edit, if no `paths:` rules exist, the hook exits without parsing YAML. The cheap `registryHasPathRules` check runs before `loadRegistry`. The Bash channel uses the same check when redirecting into `.claude/` or `.github/` without an explicit env override.
- Auto-memory tree skip: paths under `~/.claude/projects/**/memory/**` (Claude's own internal state, resolved from `PROJECTS_DIR` in `session-utils.cjs`) are skipped unconditionally before any voice resolution runs. These are structurally out-of-tree relative to any project root and cannot be matched by any `voice.yaml` `paths:` rule. Skip is prefix-guarded with `path.resolve` to prevent traversal tricks. Implemented at the top of both `handleFileWrite` and `handleBash` in `enforce-voice.cjs`.
