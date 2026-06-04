#!/usr/bin/env node

/**
 * Dispatch registry — append-only JSONL event log of dispatch workers.
 *
 * Replaces the read-modify-write active.json. Two orchestrator sessions running
 * /dispatch in parallel raced the JSON file and corrupted the registry,
 * orphaning live workers from --list/--kill/--synthesize. Append-only JSONL
 * plus a reducer removes the race: fs.appendFileSync with O_APPEND is atomic for
 * sub-PIPE_BUF writes on local disk. See specs/kit/tracking-persistence.md.
 *
 * File layout under <projectRoot>/.claude/dispatch/:
 *   active.jsonl              append-only worker event log (source of truth)
 *   active.jsonl.tmp          compaction scratch, renamed over active.jsonl
 *   active.jsonl.compacting   compaction mutex
 *   active.json.migrated      renamed legacy registry after one-time migration
 *
 * Event types (one JSON object per line; timestamp + type + sessionId required):
 *   worker_spawned    { sessionId, pid, target, model, repo, cwd, worktreePath, branch, startedAt, outputFile }
 *   worker_killed     { sessionId, pid, killedAt }
 *   worker_completed  { sessionId, completedAt }     // reached a synthesized terminal result
 *   worker_orphaned   { sessionId, orphanedAt, reason }
 *
 * worker_killed / worker_completed / worker_orphaned are terminal: the reducer
 * drops a worker from the active set on the first terminal event for its
 * sessionId. Later terminals are recorded in history but never resurrect or
 * re-terminate. worker_completed means "reached a synthesized terminal result",
 * not "succeeded" — a blocked-but-synthesized worker terminates the same way.
 *
 * readActiveWorkers reduces the log to { workers: [...] } — the exact shape the
 * old readActive returned, carrying every field the old record had
 * (worktreePath and branch included; cleanupOrphanWorktrees keys off them).
 *
 * Malformed lines from a partial write on crash are skipped. Each append is
 * wrapped in leading + trailing newlines so a torn prior write cannot merge
 * into the next good line. Mirrors session-utils.cjs appendTrackingEvent.
 */

const fs = require('fs');
const path = require('path');

const DISPATCH_DIR_REL = path.join('.claude', 'dispatch');
const ACTIVE_JSONL = 'active.jsonl';
const ACTIVE_TMP = 'active.jsonl.tmp';
const COMPACT_LOCK = 'active.jsonl.compacting';
const LEGACY_ACTIVE_JSON = 'active.json';
const MIGRATED_LEGACY = 'active.json.migrated';

const TERMINAL_TYPES = new Set(['worker_killed', 'worker_completed', 'worker_orphaned']);
const COMPACT_LOCK_STALE_MS = 30 * 1000;
const TERMINATED_RETENTION_MS = 24 * 60 * 60 * 1000;

const WORKER_FIELDS = [
  'sessionId', 'pid', 'target', 'model', 'repo', 'cwd',
  'worktreePath', 'branch', 'startedAt', 'outputFile'
];
const NULLABLE_FIELDS = new Set(['repo', 'cwd', 'worktreePath', 'branch']);

function dispatchDir(projectRoot) {
  return path.join(projectRoot, DISPATCH_DIR_REL);
}
function activeJsonlPath(projectRoot) {
  return path.join(dispatchDir(projectRoot), ACTIVE_JSONL);
}
function legacyJsonPath(projectRoot) {
  return path.join(dispatchDir(projectRoot), LEGACY_ACTIVE_JSON);
}
function ensureDir(projectRoot) {
  fs.mkdirSync(dispatchDir(projectRoot), { recursive: true });
}

function appendWorkerEvent(projectRoot, event) {
  if (!event || typeof event !== 'object' || !event.type) {
    throw new Error('appendWorkerEvent: event must be an object with a `type` field');
  }
  if (!event.sessionId || typeof event.sessionId !== 'string') {
    throw new Error('appendWorkerEvent: event.sessionId is required');
  }
  const payload = { timestamp: event.timestamp || new Date().toISOString(), ...event };
  const line = '\n' + JSON.stringify(payload) + '\n';
  const filePath = activeJsonlPath(projectRoot);
  try {
    fs.appendFileSync(filePath, line);
  } catch (err) {
    if (err.code === 'ENOENT') {
      ensureDir(projectRoot);
      fs.appendFileSync(filePath, line);
    } else {
      throw err;
    }
  }
}

function readEvents(projectRoot) {
  maybeMigrateLegacy(projectRoot);
  let content;
  try {
    content = fs.readFileSync(activeJsonlPath(projectRoot), 'utf8');
  } catch {
    return [];
  }
  const events = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { events.push(JSON.parse(trimmed)); } catch {}
  }
  return events;
}

function workerFromSpawn(spawn) {
  const w = {};
  for (const f of WORKER_FIELDS) {
    if (NULLABLE_FIELDS.has(f)) w[f] = spawn[f] != null ? spawn[f] : null;
    else w[f] = spawn[f];
  }
  if (!w.startedAt) w.startedAt = spawn.timestamp;
  return w;
}

function spawnedEventFromWorker(w) {
  const ev = { timestamp: w.startedAt || new Date().toISOString(), type: 'worker_spawned' };
  for (const f of WORKER_FIELDS) {
    if (NULLABLE_FIELDS.has(f)) ev[f] = w[f] != null ? w[f] : null;
    else ev[f] = w[f];
  }
  return ev;
}

function reduceWorkers(events) {
  const bySession = new Map();
  for (const ev of events) {
    if (!ev || !ev.sessionId || !ev.type) continue;
    const sid = ev.sessionId;
    if (ev.type === 'worker_spawned') {
      if (!bySession.has(sid)) bySession.set(sid, { spawn: ev, terminal: null });
      continue;
    }
    if (TERMINAL_TYPES.has(ev.type)) {
      const entry = bySession.get(sid);
      if (entry && !entry.terminal) entry.terminal = ev;
    }
  }
  const active = [];
  const terminated = [];
  for (const entry of bySession.values()) {
    if (!entry.spawn) continue;
    const record = workerFromSpawn(entry.spawn);
    if (entry.terminal) terminated.push({ ...record, terminal: entry.terminal });
    else active.push(record);
  }
  return { active, terminated };
}

function readActiveWorkers(projectRoot) {
  return { workers: reduceWorkers(readEvents(projectRoot)).active };
}

function resetAndSeed(projectRoot, workers) {
  ensureDir(projectRoot);
  const lines = [];
  for (const w of workers || []) {
    if (!w || !w.sessionId) continue;
    lines.push(JSON.stringify(spawnedEventFromWorker(w)));
  }
  fs.writeFileSync(activeJsonlPath(projectRoot), lines.length ? lines.join('\n') + '\n' : '');
}

function maybeMigrateLegacy(projectRoot) {
  const jsonlPath = activeJsonlPath(projectRoot);
  const legacyPath = legacyJsonPath(projectRoot);
  if (fs.existsSync(jsonlPath)) return false;
  if (!fs.existsSync(legacyPath)) return false;

  ensureDir(projectRoot);
  let parsed = null;
  try { parsed = JSON.parse(fs.readFileSync(legacyPath, 'utf8')); } catch {}

  const lines = [];
  if (parsed && Array.isArray(parsed.workers)) {
    for (const w of parsed.workers) {
      if (!w || typeof w.sessionId !== 'string') continue;
      lines.push(JSON.stringify(spawnedEventFromWorker(w)));
    }
  }
  fs.writeFileSync(jsonlPath, lines.length ? lines.join('\n') + '\n' : '');

  try {
    fs.renameSync(legacyPath, path.join(dispatchDir(projectRoot), MIGRATED_LEGACY));
  } catch {
    try { fs.unlinkSync(legacyPath); } catch {}
  }
  return true;
}

function compactRegistry(projectRoot, options = {}) {
  const nowMs = typeof options.nowMs === 'number' ? options.nowMs : Date.now();
  const retentionMs = typeof options.retentionMs === 'number'
    ? options.retentionMs : TERMINATED_RETENTION_MS;
  const jsonlPath = activeJsonlPath(projectRoot);
  if (!fs.existsSync(jsonlPath)) return { compacted: false, reason: 'no-log' };

  const lockPath = path.join(dispatchDir(projectRoot), COMPACT_LOCK);
  let lockFd;
  try {
    lockFd = fs.openSync(lockPath, 'wx');
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    let stale = false;
    try { stale = nowMs - fs.statSync(lockPath).mtimeMs > COMPACT_LOCK_STALE_MS; } catch {}
    if (!stale) return { compacted: false, reason: 'locked' };
    try { fs.unlinkSync(lockPath); } catch {}
    try { lockFd = fs.openSync(lockPath, 'wx'); }
    catch { return { compacted: false, reason: 'locked' }; }
  }

  try {
    const { active, terminated } = reduceWorkers(readEvents(projectRoot));
    const keepTerminated = terminated.filter(t => {
      const ts = t.terminal && t.terminal.timestamp ? Date.parse(t.terminal.timestamp) : NaN;
      if (!Number.isFinite(ts)) return true;
      return nowMs - ts < retentionMs;
    });

    const out = [];
    for (const w of active) out.push(spawnedEventFromWorker(w));
    for (const t of keepTerminated) {
      out.push(spawnedEventFromWorker(t));
      out.push(t.terminal);
    }

    const tmpPath = path.join(dispatchDir(projectRoot), ACTIVE_TMP);
    fs.writeFileSync(tmpPath, out.length ? out.map(e => JSON.stringify(e)).join('\n') + '\n' : '');
    fs.renameSync(tmpPath, jsonlPath);
    return {
      compacted: true,
      activeCount: active.length,
      terminatedKept: keepTerminated.length,
      terminatedDropped: terminated.length - keepTerminated.length
    };
  } finally {
    try { fs.closeSync(lockFd); } catch {}
    try { fs.unlinkSync(lockPath); } catch {}
  }
}

module.exports = {
  appendWorkerEvent,
  readEvents,
  reduceWorkers,
  readActiveWorkers,
  resetAndSeed,
  maybeMigrateLegacy,
  compactRegistry,
  dispatchDir,
  activeJsonlPath,
  legacyJsonPath,
  TERMINAL_TYPES,
  WORKER_FIELDS,
  ACTIVE_JSONL,
  ACTIVE_TMP,
  COMPACT_LOCK,
  LEGACY_ACTIVE_JSON,
  MIGRATED_LEGACY,
  TERMINATED_RETENTION_MS,
  COMPACT_LOCK_STALE_MS
};
