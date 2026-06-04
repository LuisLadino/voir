#!/usr/bin/env node

/**
 * Skill runtime state manager.
 *
 * Provisions/reads the per-skill working-memory tree under
 *   <projectRoot>/.claude/skill-runtime/<scope>/<key>/<skill>/
 *     fs/<root_hint>/   working memory
 *     plans/plan.jsonl  append-only TodoWrite snapshots
 *     summaries/<id>.txt + index.jsonl  archived large outputs
 *
 * scope 'session' keys by sanitized session id (swept at 7 days).
 * scope 'thread'  keys by sanitized git branch (persists across sessions).
 *
 * plans + summary index are append-only JSONL: fs.appendFileSync is atomic for
 * sub-PIPE_BUF writes on POSIX, the guarantee dispatch-registry and
 * session-utils rely on (#596). No read-modify-write of a shared file.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_REL = path.join('.claude', 'skill-runtime');
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function sanitize(s) {
  return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown';
}

function currentBranch(projectRoot) {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch { return 'nobranch'; }
}

function scopeKey(scope, projectRoot, sessionId) {
  if (scope === 'thread') return path.join('thread', sanitize(currentBranch(projectRoot)));
  return path.join('session', sanitize(sessionId));
}

function skillBase(projectRoot, scope, sessionId, skillName) {
  return path.join(projectRoot, ROOT_REL, scopeKey(scope, projectRoot, sessionId), sanitize(skillName));
}

function ensureSkillDirs(projectRoot, scope, sessionId, skillName, opts = {}) {
  const base = skillBase(projectRoot, scope, sessionId, skillName);
  fs.mkdirSync(path.join(base, 'plans'), { recursive: true });
  fs.mkdirSync(path.join(base, 'summaries'), { recursive: true });
  fs.mkdirSync(path.join(base, 'fs', opts.root_hint || 'scratch'), { recursive: true });
  return base;
}

function fsRoot(projectRoot, scope, sessionId, skillName, rootHint = 'scratch') {
  return path.join(skillBase(projectRoot, scope, sessionId, skillName), 'fs', rootHint);
}

function appendPlanEntry(projectRoot, scope, sessionId, skillName, entry) {
  const base = skillBase(projectRoot, scope, sessionId, skillName);
  fs.mkdirSync(path.join(base, 'plans'), { recursive: true });
  const line = '\n' + JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n';
  fs.appendFileSync(path.join(base, 'plans', 'plan.jsonl'), line);
}

function readLatestPlan(projectRoot, scope, sessionId, skillName) {
  const file = path.join(skillBase(projectRoot, scope, sessionId, skillName), 'plans', 'plan.jsonl');
  let content;
  try { content = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch {}
  }
  return null;
}

function archiveOutput(projectRoot, scope, sessionId, skillName, id, content) {
  const base = skillBase(projectRoot, scope, sessionId, skillName);
  fs.mkdirSync(path.join(base, 'summaries'), { recursive: true });
  const safeId = sanitize(id);
  const target = path.join(base, 'summaries', `${safeId}.txt`);
  fs.writeFileSync(target, content);
  const idx = '\n' + JSON.stringify({
    timestamp: new Date().toISOString(), id: safeId, bytes: Buffer.byteLength(content)
  }) + '\n';
  fs.appendFileSync(path.join(base, 'summaries', 'index.jsonl'), idx);
  return target;
}

function sweepOldSessions(projectRoot) {
  const root = path.join(projectRoot, ROOT_REL, 'session');
  let entries;
  try { entries = fs.readdirSync(root); } catch { return 0; }
  const now = Date.now();
  let removed = 0;
  for (const name of entries) {
    const dir = path.join(root, name);
    let stat;
    try { stat = fs.statSync(dir); } catch { continue; }
    if (now - stat.mtimeMs > MAX_AGE_MS) {
      try { fs.rmSync(dir, { recursive: true, force: true }); removed++; } catch {}
    }
  }
  return removed;
}

module.exports = {
  ROOT_REL, MAX_AGE_MS, sanitize, currentBranch, scopeKey, skillBase,
  ensureSkillDirs, fsRoot, appendPlanEntry, readLatestPlan, archiveOutput, sweepOldSessions
};
