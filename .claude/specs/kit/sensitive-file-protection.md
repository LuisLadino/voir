---
name: sensitive-file-protection
description: >
  Protected paths that require human review before modification, and how the
  kit enforces that requirement across Write, Edit, and Bash tool paths.
  Required reading before editing the sensitive-file Bash gate or its tests.
applies_to:
  - ".claude/hooks/safety/block-sensitive-bash-writes.cjs"
  - ".claude/hooks/safety/block-sensitive-bash-writes.test.cjs"
category: kit
related: [dispatch, hooks]
---

# Sensitive File Protection

Some paths control Claude's behavior. Unreviewed changes to them can register hooks, disable safeguards, or rewrite logic across every project. These paths get a hard gate: humans approve them through the Write or Edit tool. Nothing else is allowed to write them.

## Protected Paths

- `.claude/hooks/**/*.{cjs,js,sh,mjs}` — hook scripts that execute in the Claude Code lifecycle
- `.claude/settings.json` and `.claude/settings.local.json` — project-scope hook registration
- `~/.claude/settings.json` and `~/.claude/settings.local.json` — user-scope hook registration
- `/Users/<name>/.claude/settings[.local].json` — same as above, absolute form

The kit does not protect `.claude/specs/**`, `.claude/skills/**`, `.claude/agents/**`, `.claude/commands/**`, or `.claude/docs/**` at the Bash gate. Those are already gated by the Write/Edit enforce-specs hook through required spec reads. The sensitive-file gate here is stricter because the protected files bypass all other kit enforcement when they run.

**Note on Claude Code's built-in gate.** Separate from the kit's Bash gate, Claude Code itself refuses Write/Edit on a broader set of `.claude/` paths in non-interactive sessions. Per the #274 audit (2026-04-24) and the #374 extension (2026-04-27), CC's built-in gate covers `.claude/hooks/**`, `.claude/skills/**`, `.claude/specs/**`, `.claude/docs/**`, `.claude/commands/**`, `.claude/agents/**`, and `.claude/research/**`. Dispatched workers (`claude -p`) cannot answer the approval prompt, so the edit fails. Use `--plan-only` for any dispatch whose Definition of Done requires editing files under `.claude/` (see `dispatch.md` Plan-Only Mode section). The dispatch tooling auto-applies `--plan-only` per-target when the issue body references one of these subtrees; opt out per-invocation via `--no-auto-plan-only`. The two gates are independent: the kit's Bash gate plugs the heredoc/redirect bypass on hooks and settings; CC's built-in gate is the broader human-approval requirement on Write/Edit. Both fire; both have their reasons.

## Why the Gate Exists

Claude Code has a built-in sensitive-file protection on the Write and Edit tools. Editing a path in that set triggers a human approval prompt. Non-interactive sessions (`claude -p` workers) cannot answer that prompt, so the edit fails. That is the correct behavior.

The gap: Bash has no equivalent protection. A worker can bypass the Write/Edit gate by using a Bash heredoc redirect, `node -e fs.writeFileSync`, `tee`, `cp`, `mv`, or any other Bash write operator that targets the same path. Same content, same file, no approval. The gate was advisory at the tool layer, not a real control.

Live example: a dispatch worker in PR #181 hit the Write gate on `~/.claude/settings.json`, routed around it with `cat <<EOF > ~/.claude/settings.json`, and self-flagged the bypass in `decisions_needing_review`. A second worker on #183 hit the same wall on `.claude/hooks/*.cjs` and used `node -e fs.writeFileSync`. Both tracked as #184.

## Enforcement

`.claude/hooks/safety/block-sensitive-bash-writes.cjs` runs as a PreToolUse hook on Bash (registered in `~/.claude/settings.json`). It strips heredoc bodies, tokenizes the command with quote awareness, and resolves write destinations per command shape. If any destination matches a protected path, the hook exits 2 with a message naming the pattern and target. Quoted strings are treated as literal data, so a path inside `--body`, `--message`, a heredoc body, or any other quoted argument is never treated as a write destination on its own.

Covered bypass patterns:
- `>` and `>>` redirect to a protected path
- `tee` writing to a protected path
- `cp`, `mv`, `install`, `rsync` with a protected destination
- `node -e` or `node --eval` invoking `.writeFile`, `.writeFileSync`, `.appendFile`, or `.appendFileSync` on a protected path
- `python -c` invoking `open(protected_path, 'w')`

Heredoc content is irrelevant. The redirect target is what matters, and a heredoc redirecting to a protected path matches the redirect pattern.

## Worker Behavior

When this hook blocks a dispatch worker, the worker should stop trying to edit the protected file and surface the intended change under `decisions_needing_review` in its final result. The orchestrator then makes the edit through Write or Edit with human approval.

Workers that treat the block as a puzzle to route around defeat the gate's purpose. The block message says this explicitly.

## Adding a Protected Path

Edit these places in lockstep:
1. Extend the `SENSITIVE_PATH_TOKEN_RE` in `.claude/hooks/safety/block-sensitive-bash-writes.cjs` so the new path matches as a standalone token value
2. Add a `B*` test case in `.claude/hooks/safety/block-sensitive-bash-writes.test.cjs` covering at least one bypass shape (redirect, cp/mv dest, sed -i target, node -e write) for the new path
3. Add a matching `P*` test case proving that READ-only access (cat, grep, source-position cp/mv) still passes for the new path
4. Update the `Protected Paths` section above

## Known Limitations

- The tokenizer treats `$(...)` and backticks as opaque token content. A write destination computed by command substitution such as `cp /tmp/x $(echo .claude/hooks/foo.cjs)` is not resolved and would not be checked. Workers don't use this pattern in practice; an obfuscated bypass attempt remains in scope for follow-up.
- Process substitution `>(...)` is not parsed; a `tee >(cat > .claude/hooks/foo.cjs)` redirect target inside the substitution is not seen.
- Variable expansion is not resolved. A path written as `$HOME/.claude/settings.json` does not match the protected-path pattern, which expects `~/.claude/...` or `/Users/<name>/.claude/...`. Same for `$HOME/.claude/hooks/foo.cjs` and any other env-var-prefixed path.
- The hook only runs when the Bash matcher registration is active in `~/.claude/settings.json`. A user who removes the matcher loses the protection.
- `sync-kit.sh` copies files into downstream `.claude/hooks/` directories using absolute paths that would match the protection if the command ran under this hook. The hook only fires on Claude's Bash tool invocations, so `sync-kit.sh` running in the user's own shell is unaffected.
