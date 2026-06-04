#!/usr/bin/env node

/**
 * Concurrent Session Warning Hook
 *
 * Event: SessionStart
 * Purpose: Warn when another Claude Code session is already alive in the
 *   same checkout. Two sessions sharing one working tree silently corrupt
 *   each other: branch switches, file races, dirty-tree deploys. The fix
 *   is to use .claude/scripts/worktree.cjs create. This warning makes the
 *   problem discoverable.
 *
 * Reads from .claude/sessions/*.json markers, one per live session. Each
 * session writes its marker via session-init.cjs at SessionStart and
 * removes it via Stop hook. Stale markers are pruned by PID liveness
 * check on next SessionStart.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SESSIONS_DIR_REL = '.claude/sessions';
const STALE_MS = 24 * 60 * 60 * 1000;

function pidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function isClaudeProcess(pid) {
  if (!pidAlive(pid)) return false;
  try {
    const r = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    if (r.status !== 0) return false;
    return /claude/i.test(r.stdout);
  } catch { return false; }
}

function readMarkers(sessionsDir) {
  if (!fs.existsSync(sessionsDir)) return [];
  const out = [];
  for (const name of fs.readdirSync(sessionsDir)) {
    if (!name.endsWith('.json')) continue;
    const full = path.join(sessionsDir, name);
    try {
      const data = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (data && typeof data === 'object') {
        out.push({ file: full, data });
      }
    } catch {}
  }
  return out;
}

function pruneStale(markers) {
  const live = [];
  const now = Date.now();
  for (const m of markers) {
    const startedAt = Date.parse(m.data.started_at || '');
    const tooOld = Number.isFinite(startedAt) && (now - startedAt) > STALE_MS;
    const dead = !isClaudeProcess(m.data.pid);
    if (tooOld || dead) {
      try { fs.unlinkSync(m.file); } catch {}
      continue;
    }
    live.push(m);
  }
  return live;
}

function evaluate(projectRoot, currentSessionId) {
  const sessionsDir = path.join(projectRoot, SESSIONS_DIR_REL);
  const all = readMarkers(sessionsDir);
  const live = pruneStale(all);
  const cwd = process.cwd();
  const others = live.filter(m =>
    m.data.cwd === cwd &&
    m.data.session_id !== currentSessionId
  );
  return { others, sessionsDir };
}

function warningText(others, projectRoot) {
  const lines = [
    '',
    '========================================',
    'ANOTHER CLAUDE CODE SESSION IS ACTIVE HERE',
    '========================================',
    '',
    `${others.length} other session(s) in this checkout:`,
    ''
  ];
  for (const m of others) {
    const age = Date.parse(m.data.started_at);
    const ageMin = Number.isFinite(age) ? Math.round((Date.now() - age) / 60000) : '?';
    lines.push(`  pid ${m.data.pid}, started ${ageMin} min ago, session ${m.data.session_id.slice(0, 8)}`);
  }
  lines.push('');
  lines.push('RISK: shared working tree means branch switches, file races,');
  lines.push('and uncommitted-file deploys can hit silently.');
  lines.push('');
  lines.push('FIX: run this session in an isolated worktree.');
  lines.push('');
  lines.push('  node .claude/scripts/worktree.cjs create <branch>');
  lines.push('  cd <printed-path>');
  lines.push('  claude');
  lines.push('');
  lines.push('Override: set CLAUDE_KIT_NO_CONCURRENCY_WARN=1 to silence.');
  lines.push('========================================');
  lines.push('');
  return lines.join('\n');
}

function run(data) {
  if (process.env.CLAUDE_KIT_NO_CONCURRENCY_WARN === '1') return { state: 'silenced' };
  const projectRoot = process.cwd();
  if (!fs.existsSync(path.join(projectRoot, '.claude'))) return { state: 'not-framework' };
  const currentSessionId = (data && data.session_id) || '';
  const { others } = evaluate(projectRoot, currentSessionId);
  if (others.length > 0) {
    process.stdout.write(warningText(others, projectRoot));
    return { state: 'concurrent', count: others.length };
  }
  return { state: 'clear' };
}

if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook(run, { mode: 'observability' });
}

module.exports = {
  run,
  evaluate,
  warningText,
  pruneStale,
  readMarkers,
  isClaudeProcess,
  pidAlive,
  SESSIONS_DIR_REL,
  STALE_MS,
};
