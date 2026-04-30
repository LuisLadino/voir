#!/usr/bin/env node

/**
 * Dispatch Completion Notifier
 *
 * Event: UserPromptSubmit
 * Purpose: Detects workers that have emitted their result event but have not
 *   yet been synthesized by the orchestrator. Injects a notification so the
 *   orchestrator sees the completion and runs `/dispatch --synthesize`.
 *
 * Without this hook, workers finish silently. The orchestrator only discovers
 * completions when the user explicitly asks about them, defeating the purpose
 * of background dispatch. Issue #188.
 *
 * How it detects completion:
 *   A worker's JSONL output contains a `"type":"result"` event once it has
 *   emitted its final structured result. A worker is "unsynthesized" when
 *   that event is present in the JSONL but no cached `<sessionId>.result.json`
 *   exists yet. Synthesize writes the cache; its presence = already reported.
 *
 * Fast path:
 *   If `.claude/dispatch/active.json` has no workers, exit immediately.
 */

const fs = require('fs');
const path = require('path');

function projectRoot() {
  try {
    const { execSync } = require('child_process');
    return execSync('git rev-parse --show-toplevel 2>/dev/null', { encoding: 'utf8' }).trim()
      || process.cwd();
  } catch {
    return process.cwd();
  }
}

function dispatchDir(root) {
  return path.join(root, '.claude', 'dispatch');
}

function readActive(root) {
  const activePath = path.join(dispatchDir(root), 'active.json');
  try {
    const raw = fs.readFileSync(activePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.workers) ? parsed.workers : [];
  } catch {
    return [];
  }
}

function hasResultEvent(outputFile) {
  try {
    const st = fs.statSync(outputFile);
    const size = st.size;
    if (size === 0) return false;
    const start = Math.max(0, size - 65536);
    const length = size - start;
    const fd = fs.openSync(outputFile, 'r');
    try {
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, start);
      return buf.toString('utf8').includes('"type":"result"');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

function alreadySynthesized(root, sessionId) {
  const p = path.join(dispatchDir(root), `${sessionId}.result.json`);
  return fs.existsSync(p);
}

function findUnsynthesized(root) {
  const workers = readActive(root);
  if (workers.length === 0) return [];
  const pending = [];
  for (const w of workers) {
    if (!w.outputFile || !w.sessionId) continue;
    if (alreadySynthesized(root, w.sessionId)) continue;
    if (!hasResultEvent(w.outputFile)) continue;
    pending.push(w);
  }
  return pending;
}

function formatNotification(pending) {
  const count = pending.length;
  const lines = [
    `[DISPATCH COMPLETION] ${count} worker(s) completed and awaiting synthesis.`,
    '',
    'Run `/dispatch --synthesize` now to:',
    '  - Surface each worker\'s PR URL, status, and decisions_needing_review',
    '  - Post a completion comment on the referenced GitHub issue(s)',
    '  - Cache the result so this notification does not repeat',
    '',
    'Completed workers:'
  ];
  for (const w of pending) {
    const label = w.target && w.target.type === 'issue'
      ? `#${w.target.value}`
      : `ad-hoc (${String(w.target && w.target.value || '').slice(0, 40)}...)`;
    lines.push(`  - ${w.sessionId}  ${label}  model=${w.model || 'unknown'}`);
  }
  return lines.join('\n');
}

function handleHook() {
  const root = projectRoot();
  const pending = findUnsynthesized(root);
  if (pending.length === 0) {
    process.exit(0);
  }

  const message = formatNotification(pending);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: message
    }
  }));
  process.exit(0);
}

if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook(handleHook, { mode: 'observability', parseJson: false });
}

module.exports = {
  findUnsynthesized,
  formatNotification,
  hasResultEvent,
  alreadySynthesized,
};
