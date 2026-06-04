#!/usr/bin/env node

/**
 * Concurrent Session Git Gate
 *
 * Event: PreToolUse (Bash)
 * Purpose: Enforce Layer 2 of session-isolation. concurrent-session-warning.cjs
 *   only WARNS, only at SessionStart, and only in the second-started session.
 *   This gate BLOCKS: it re-checks on every git-mutating Bash command, catching
 *   the first session (blind at startup) and collisions that develop later.
 *
 * Detection reuses evaluate() — PID-liveness, no heartbeat, no markers written.
 * Deploy collisions stay with block-dirty-deploy.cjs (Layer 3), so this covers
 * git + gh pr only.
 *
 * Override: ALLOW_CONCURRENT_GIT=1 — a dedicated switch, distinct from the Layer
 * 2 banner's CLAUDE_KIT_NO_CONCURRENCY_WARN. Silencing an informational banner
 * must not also disable a protective block, so the two have separate opt-outs.
 *
 * Spec: .claude/specs/kit/session-isolation.md (Layer 2)
 */

const { evaluate } = require('../context/concurrent-session-warning.cjs');
const { atCommandPosition } = require('../lib/command-position.cjs');

// Each core must sit at a command position so `git push` gates while
// `echo "git push"` (the phrase inside an argument) does not. Anchoring lives
// in command-position.cjs and is shared with the matcher-gated gates (#642).
const GIT_MUTATING_CORES = [
  String.raw`git\s+(?:-\S+\s+)*(?:checkout|switch|commit|merge|rebase|reset|cherry-pick|revert|pull|push|stash)\b`,
  String.raw`git\s+(?:-\S+\s+)*branch\s+(?:-\S+\s+)*-[dDmM]\b`,
  String.raw`gh\s+pr\s+(?:create|merge|close|ready|edit)\b`,
];

function isGitMutating(command) {
  return GIT_MUTATING_CORES.some((core) => atCommandPosition(command, core));
}

function buildMessage(others, cwd) {
  const lines = others.map((m) => {
    const age = Date.parse(m.data.started_at);
    const ageMin = Number.isFinite(age) ? Math.round((Date.now() - age) / 60000) : '?';
    return `  pid ${m.data.pid}, started ${ageMin} min ago, session ${String(m.data.session_id).slice(0, 8)}`;
  });
  return [
    '',
    '========================================',
    'BLOCKED: git command in a shared checkout',
    '========================================',
    '',
    `${others.length} other live Claude Code session(s) in this working tree:`,
    `  ${cwd}`,
    ...lines,
    '',
    'Running this would corrupt the other session(s): branch switches, commits,',
    'and PRs collide across sessions sharing one git index (see #451).',
    '',
    'FIX: isolate this session in its own worktree, then retry:',
    '',
    '  node .claude/scripts/worktree.cjs create <branch>',
    '  cd <printed-path>',
    '',
    'Override (only if you are sure): ALLOW_CONCURRENT_GIT=1',
    '========================================',
    '',
  ].join('\n');
}

// Pure decision, unit-testable without the ps-backed evaluate().
function decide(command, others, env) {
  if (!isGitMutating(command)) return { block: false };
  if (env.ALLOW_CONCURRENT_GIT === '1') return { block: false };
  if (!others || others.length === 0) return { block: false };
  return { block: true };
}

function handleHook(data) {
  const command = data && data.tool_input && data.tool_input.command;
  // Cheap pre-filter before the ps spawn: only consult evaluate() for candidates.
  if (!isGitMutating(command) || process.env.ALLOW_CONCURRENT_GIT === '1') {
    process.exit(0);
  }
  const { others } = evaluate(process.cwd(), (data && data.session_id) || '');
  if (!decide(command, others, process.env).block) process.exit(0);
  console.error(buildMessage(others, process.cwd()));
  process.exit(2);
}

if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook(handleHook, { mode: 'gating' });
}

module.exports = { isGitMutating, decide, buildMessage, GIT_MUTATING_CORES };
