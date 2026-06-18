---
name: block-dangerous
description: >
  Why block-dangerous exists, what it blocks, and how it maps to OWASP
  Tool Misuse with FM2 subset qualifiers. Required reading before editing
  block-dangerous.cjs or its pattern config.
applies_to:
  - ".claude/hooks/safety/block-dangerous.cjs"
  - ".claude/hooks/config/security-patterns.json"
triggers: [block-dangerous, dangerous-commands]
category: kit
related: [owasp-mapping, sensitive-file-protection]
---

# block-dangerous

PreToolUse hook on Bash. Blocks dangerous commands before they execute. Reads patterns from `.claude/hooks/config/security-patterns.json` `dangerous_commands` section.

## What It Blocks

Patterns are regex with optional flags. Each entry has a reason printed when blocked. Current patterns:

- `rm -rf /` and `rm -rf ~`. Root and home directory deletion
- `rm -rf *` and `rm -rf .`. Recursive delete of all files or hidden files in cwd
- `git push --force` to `main` or `master` without `--force-with-lease`
- `git reset --hard origin/main` and `origin/master`
- `git clean -fd`. Untracked file deletion
- `DROP DATABASE`
- `DROP TABLE` without `IF EXISTS`
- `TRUNCATE TABLE`
- `cat .env`, `cat *.pem`, `cat *.key`, `cat *.secret`. Credential file read. Common safe extensions like `.example`, `.sample`, `.template`, `.bak`, `.md` are exempted
- `echo $...KEY`, `echo $...SECRET`, `echo $...PASSWORD`, `echo $...TOKEN`. Env var exposure via echo
- Fork bomb `:(){ :|: & };:`
- `mkfs.*`. Filesystem format
- `dd if=... of=/dev/...`. Direct device write

Heredoc bodies are stripped before pattern checking so embedded examples in commit messages or PR bodies do not trigger false positives.

## How It Runs

`PreToolUse` hook on Bash, registered in `~/.claude/settings.json`. Exits `2` with `[BLOCKED] <reason>` on stderr when a pattern matches. Exits `0` otherwise.

If `security-patterns.json` is missing or malformed, the hook fails open and returns `0` with no log. The fail-open default is intentional: a broken config should not break the session. Detection happens through `~/.claude/projects/<workspace-key>/hook-errors.log` parse errors.

## OWASP Coverage

- **Risk:** OWASP Tool Misuse, Top 10 #2.
- **Hook:** `.claude/hooks/safety/block-dangerous.cjs`.
- **Covers (subset):**
  - `rm -rf` patterns against root, home, cwd wildcard, and hidden-file wildcard
  - `git push --force` to protected branches
  - `git reset --hard` to remote `main` or `master`
  - `git clean -fd`
  - destructive SQL: `DROP DATABASE`, `DROP TABLE` without `IF EXISTS`, `TRUNCATE TABLE`
  - credential file reads via `cat` against `.env`, `.pem`, `.key`, `.secret`
  - credential exposure via `echo $...KEY|SECRET|PASSWORD|TOKEN`
  - fork bomb
  - filesystem format via `mkfs.*`
  - direct device write via `dd if=... of=/dev/...`
- **Does NOT cover:**
  - chained-tool exploitation. A sequence of safe-individually-but-destructive-together tool calls
  - argument manipulation attacks. `rm` reached indirectly via `find -exec`, `xargs`, or other indirection
  - prompt-injection-driven tool misuse. The agent reasoning layer issues a benign-shaped command after being misled
  - command substitution `$(...)` or backticks that construct a destructive command at runtime. The static pattern matcher does not see the result
  - non-Bash tool surfaces: Write, Edit, MCP tool calls. Those are governed by other gates
- **Gap routing:**
  - chained-tool and argument-manipulation exploitation: Tier 2 trigger to Microsoft Agent Governance Toolkit per #308 V3 reversal condition. Fires when first non-Anthropic role-agent enters /research phase, OR when chained-tool exploitation surfaces in production
  - prompt-injection-driven misuse: Tier 2 trigger to Lunar.dev MCPX per #308 V2. Gateway-layer policy is the right surface
  - non-Bash surfaces: governed by `block-sensitive-bash-writes`, `enforce-specs`, `enforce-voice`, and Claude Code's built-in Write/Edit gate

## Adding a Pattern

1. Add an entry to `dangerous_commands[]` in `.claude/hooks/config/security-patterns.json` with `pattern`, a string regex, `flags`, optional, and `reason`, a string printed on block.
2. If the new pattern represents a new OWASP risk subset, update the `Covers (subset)` list above.
3. If the new pattern relaxes an existing OWASP gap, update `Does NOT cover` accordingly.
4. If the gap-routing claim changes, update `Gap routing` to match.

The hook reads the JSON at runtime. No code change is required to add a pattern.

## Failure Modes

- **False positive on heredoc body.** Pattern matches against text inside a heredoc that is documentation rather than execution. Mitigated by `stripHeredocs()` in `block-dangerous.cjs`. If a pattern still triggers on documented text, refine the regex with negative lookbehinds or restrict the flags. Do not skip the heredoc strip.
- **Pattern config missing or malformed.** Hook fails open. The session continues unprotected. The fail-open default is deliberate: a broken config should not break the session. Surface via `hook-errors.log`.
- **Bypass via subshell substitution.** `$(echo rm -rf /)` constructs the command at runtime. The static pattern matcher does not see the result. Documented under `Does NOT cover` and routed to Tier 2.

## Related

- `.claude/specs/kit/owasp-mapping.md` — methodology spec, FM2 subset-qualifier discipline
- `.claude/specs/kit/sensitive-file-protection.md` — companion gate for sensitive-file Bash writes
- `cosmo:docs/research/product-sdk/agent-governance-runtime-security-2026-04.md` — verdict V3 source (relocated to the cosmo repo 2026-06-06)
- #308 V3 — first integration use case for this OWASP mapping methodology
