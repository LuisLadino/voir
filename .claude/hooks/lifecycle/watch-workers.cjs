#!/usr/bin/env node

// @kit-internal — spawned via Monitor by /dispatch skill, not a Claude Code lifecycle hook

/**
 * watch-workers.cjs — Monitor-compatible event streamer for dispatch workers.
 *
 * Spawned by the /dispatch skill via the Monitor tool, persistent:
 *
 *   Monitor({
 *     description: "Dispatch worker events",
 *     persistent: true,
 *     command: "node .claude/hooks/lifecycle/watch-workers.cjs"
 *   })
 *
 * Polls .claude/dispatch/*.jsonl for new files, tails each, filters for key
 * events, and streams the actionable ones (done, PR URL, plus idle/crashed
 * lifecycle lines) prefixed with the worker's session id. Per-tool tool_use
 * and tool_error events are parsed for the idle marker but NOT streamed by
 * default — at 3-5 parallel workers they flood the Monitor output-rate cap and
 * auto-stop the watcher (#634). Set DISPATCH_VERBOSE=1 to stream every event.
 * Monitor surfaces each streamed line as a notification. Also fires desktop
 * banners on three lifecycle events via osascript: done, idle>5m, crashed.
 *
 * Rewritten from watch-workers.sh (#560). All decision logic is pure and
 * exported; the I/O — gh, osascript, fs reads, tail child process — is
 * isolated to the orchestrator at the bottom. See watch-workers.test.cjs.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, execFileSync } = require('child_process');

const registry = require('../lib/dispatch-registry.cjs');

const IDLE_THRESHOLD_SECS = 300;
const POLL_INTERVAL_MS = 2000;
const LIFECYCLE_CHECK_EVERY_TICKS = 15;
const TITLE_CAP = 50;
const DISPATCH_WAIT_BUDGET_SECS = 30;

// ─────────────────────────── Pure decision logic ───────────────────────────
// Side-effect-free and unit-tested. The orchestrator below calls into these.

// Find a worker entry by exact session-id or short prefix. The watcher knows
// the full sid (the .jsonl filename); prefix-match is a tolerant fallback.
function findWorker(entries, sid) {
  if (!Array.isArray(entries) || !sid) return null;
  return entries.find(e => e && e.sessionId === sid)
      || entries.find(e => e && typeof e.sessionId === 'string' && e.sessionId.startsWith(sid))
      || null;
}

// Build the human-readable label for notifications. Four-way fallback so a
// partial active.json or gh failure still yields something useful (#449):
//   <repo>#<num> (<title>)        — issue target with title
//   <repo>#<num>                  — issue target, title fetch failed
//   <repo>/adhoc: <task>          — adhoc target
//   <8-char-sid>                  — bare fallback
function buildWorkerLabel({ worker, title, sid, cap = TITLE_CAP }) {
  const truncate = (s) => (s && s.length > cap ? s.slice(0, cap - 3) + '...' : (s || ''));
  if (!worker) return sid ? sid.slice(0, 8) : '';

  const repoShort = (() => {
    if (worker.repo) return worker.repo.split('/').pop();
    if (worker.cwd)  return path.basename(worker.cwd);
    return '?';
  })();

  const ttype = worker.target && worker.target.type;
  const val   = worker.target && worker.target.value;

  if (ttype === 'issue' && val) {
    const base = `${repoShort}#${val}`;
    const t = truncate(title);
    return t ? `${base} (${t})` : base;
  }
  if (ttype === 'adhoc' && val) {
    return `${repoShort}/adhoc: ${truncate(val)}`;
  }
  return sid ? sid.slice(0, 8) : repoShort;
}

// Parse one .jsonl line into the structured event watch-workers surfaces.
// Returns null for lines that aren't recognized. Replaces the awk filter
// in the bash version. Match order preserves the bash output ordering.
//
// Each branch starts with a cheap substring check (indexOf) before running
// the regex. With 5 parallel workers streaming --verbose, the hot path is
// dominated by assistant-message lines that match none of the four cases;
// the substring gate drops them before regex compilation/backtracking.
function parseEventLine(line) {
  if (typeof line !== 'string' || !line) return null;

  if (line.indexOf('"type":"tool_use"') !== -1) {
    const m = line.match(/"type":"tool_use","id":"[^"]*","name":"([^"]+)"/);
    if (m) return { kind: 'tool_use', name: m[1] };
  }

  if (line.indexOf('"type":"result"') !== -1) {
    const m = line.match(/"type":"result","subtype":"([^"]+)"/);
    if (m) {
      const c = line.match(/"total_cost_usd":([0-9.]+)/);
      return { kind: 'result', subtype: m[1], cost: c ? c[1] : '?' };
    }
  }

  if (line.indexOf('"is_error":true') !== -1) {
    return { kind: 'tool_error' };
  }

  if (line.indexOf('github.com/') !== -1) {
    const m = line.match(/github\.com\/[^/]+\/[^/]+\/pull\/[0-9]+/);
    if (m) return { kind: 'pr_url', url: m[0] };
  }

  return null;
}

// Format the stdout line for a parsed event. `sid` is the short prefix
// in the streaming path; lifecycle output uses the full label instead.
function formatEventLine(sid, ev) {
  if (!ev) return null;
  switch (ev.kind) {
    case 'tool_use':   return `[${sid}] tool_use:${ev.name}`;
    case 'tool_error': return `[${sid}] tool error`;
    case 'pr_url':     return `[${sid}] PR: ${ev.url}`;
    case 'result':     return `[${sid}] done status=${ev.subtype} cost=$${ev.cost}`;
    default:           return null;
  }
}

// Decide whether a parsed tail event should reach the Monitor stdout stream.
// The Monitor tool auto-stops a watcher that exceeds its output-rate cap, so
// high-volume per-tool events must not stream: at 3-5 parallel workers the
// tool_use/tool_error rate alone floods it, and under plan-only mode every
// sensitive-file write the built-in gate refuses adds a tool_error (#634).
// Only terminal/actionable events stream by default — `result` (the done line)
// and `pr_url`. The idle/crashed lifecycle lines stream from lifecycleScan, not
// here, so they are unaffected. DISPATCH_VERBOSE=1 restores full per-event
// streaming for debugging. tool_use is still parsed and handled internally
// (idle marker); this gate only controls what reaches stdout.
function shouldStreamEvent(kind, verbose) {
  if (verbose) return true;
  return kind === 'result' || kind === 'pr_url';
}

// Has the .jsonl file ever contained a `result` event? Decision input for
// the done branch of the lifecycle scan. Mirrors bash has_result_event.
function hasResultEvent(text) {
  return typeof text === 'string' && /"type":"result"/.test(text);
}

// Last `subtype` value in any `result` event. Used in the done notification.
function lastResultSubtype(text) {
  if (typeof text !== 'string') return '';
  const matches = text.match(/"type":"result","subtype":"[^"]+"/g);
  if (!matches || matches.length === 0) return '';
  const m = matches[matches.length - 1].match(/"subtype":"([^"]+)"/);
  return m ? m[1] : '';
}

// Last `tool_use.name` value seen. Used in the idle notification body.
function lastToolName(text) {
  if (typeof text !== 'string') return '';
  const matches = text.match(/"type":"tool_use"[^}]*"name":"[^"]+"/g);
  if (!matches || matches.length === 0) return '';
  const m = matches[matches.length - 1].match(/"name":"([^"]+)"/);
  return m ? m[1] : '';
}

// Prior-session guard. A .jsonl already past IDLE_THRESHOLD_SECS at the
// moment the watcher first observes it must NOT trigger idle/crashed
// notifications — it's leftover output from a previous session that
// pruneActive hasn't reached yet. (#483)
function shouldStampSkipOnDiscovery({ mtimeSecs, nowSecs, threshold = IDLE_THRESHOLD_SECS }) {
  if (!mtimeSecs || mtimeSecs <= 0) return false;
  return (nowSecs - mtimeSecs) >= threshold;
}

// Per-tick lifecycle decision for one tracked file. Pure: given the file's
// observed state plus the worker's marker set, name the next action. The
// orchestrator below holds the markers and reads I/O; this function is
// stateless across calls.
//
// Actions:
//   done    — result event seen, not yet notified
//   idle    — mtime > threshold, no result, not skipped, not yet notified
//   crashed — pid dead, no result, not skipped, not yet notified
//   none    — nothing fires this tick
function classifyLifecycle({
  hasResult,
  doneAlready,
  idleAlready,
  crashedAlready,
  skipIdle,
  skipCrashed,
  ageSecs,
  pid,
  pidAlive,
  threshold = IDLE_THRESHOLD_SECS
}) {
  if (hasResult) {
    return doneAlready ? { action: 'none' } : { action: 'done' };
  }
  if (ageSecs >= threshold && !idleAlready && !skipIdle) {
    return { action: 'idle' };
  }
  if (pid && !pidAlive && !crashedAlready && !skipCrashed) {
    return { action: 'crashed' };
  }
  return { action: 'none' };
}

// Build the notification body for a lifecycle event.
function formatLifecycleNotification({ action, label, subtype, tool, pid }) {
  switch (action) {
    case 'done':    return `${label}: done ${subtype || 'unknown'}`;
    case 'idle':    return `${label}: idle>5m on ${tool || '(no tool yet)'}`;
    case 'crashed': return `${label}: crashed${pid ? ` (pid ${pid} gone)` : ''}`;
    default:        return '';
  }
}

// Build the Monitor stream line for a lifecycle event. `done` returns null —
// the live tail's result-event line already announced it.
function formatLifecycleStreamLine({ action, label, tool }) {
  switch (action) {
    case 'idle':    return `[${label}] idle>5m on ${tool || '(no tool yet)'}`;
    case 'crashed': return `[${label}] crashed`;
    default:        return null;
  }
}

// Build the gh argv for the issue-title lookup. Repo-scoped when known.
// Returns null if value or repo would fail validation, which short-circuits
// the gh call. value must be all-digits, repo must match `owner/name`. The
// gate blocks flag injection at the trust boundary where attacker-influenced
// strings from active.json could otherwise reach gh as `-R victim/repo`.
function ghIssueViewArgs({ value, repo }) {
  const v = value == null ? '' : String(value);
  if (!/^[0-9]+$/.test(v)) return null;
  const args = ['issue', 'view', v];
  if (repo) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
    args.push('--repo', repo);
  }
  args.push('--json', 'title', '--jq', '.title');
  return args;
}

// ──────────────────────── Orchestrator (I/O, side effects) ─────────────────

// dispatchDir is <projectRoot>/.claude/dispatch; the registry reduces the
// append-only active.jsonl from the project root. Derive it back so the watcher
// reads the same source of truth as dispatch.cjs.
function readActive(dispatchDir) {
  try {
    const projectRoot = path.dirname(path.dirname(dispatchDir));
    return registry.readActiveWorkers(projectRoot).workers;
  } catch {
    return [];
  }
}

function workerPid(entries, sid) {
  const w = findWorker(entries, sid);
  return (w && typeof w.pid === 'number') ? w.pid : null;
}

function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function gh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function osaNotify(msg) {
  if (process.env.DISPATCH_NO_NOTIFY === '1') return;
  const escaped = String(msg).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `display notification "${escaped}" with title "Claude Code Dispatch"`;
  try {
    const child = spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* swallow — a missed notification must never break the watcher */
  }
}

function fileMtimeSecs(file) {
  try { return Math.floor(fs.statSync(file).mtimeMs / 1000); }
  catch { return 0; }
}

function readJsonl(file) {
  try { return fs.readFileSync(file, 'utf8'); }
  catch { return ''; }
}

// Resolve a worker's display label, calling gh at most once per worker.
function makeLabelResolver() {
  const cache = new Map();
  return function resolveLabel(sid, dispatchDir) {
    if (cache.has(sid)) return cache.get(sid);
    const entries = readActive(dispatchDir);
    const worker = findWorker(entries, sid);
    let title = '';
    if (worker && worker.target && worker.target.type === 'issue' && worker.target.value) {
      const args = ghIssueViewArgs({ value: worker.target.value, repo: worker.repo || '' });
      if (args) title = gh(args);
    }
    const label = buildWorkerLabel({ worker, title, sid });
    cache.set(sid, label);
    return label;
  };
}

function tailFile(file, onEvent) {
  // `tail -F -n 0` matches the bash version: follow rotated files, start
  // from end. Failure to spawn or read is silenced — a missed event must
  // never crash the watcher.
  const child = spawn('tail', ['-F', '-n', '0', file], { stdio: ['ignore', 'pipe', 'ignore'] });
  child.on('error', () => {});
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    try {
      const ev = parseEventLine(line);
      if (ev) onEvent(ev);
    } catch { /* never propagate */ }
  });
  rl.on('error', () => {});
  return child;
}

function findSessionId(filePath) {
  const base = path.basename(filePath);
  return base.endsWith('.jsonl') ? base.slice(0, -'.jsonl'.length) : base;
}

async function main() {
  const root = (() => {
    try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(); }
    catch { return process.cwd(); }
  })();
  const dispatchDir = path.join(root, '.claude', 'dispatch');

  let waited = 0;
  while (!fs.existsSync(dispatchDir) && waited < DISPATCH_WAIT_BUDGET_SECS) {
    await new Promise(r => setTimeout(r, 1000));
    waited += 1;
  }
  if (!fs.existsSync(dispatchDir)) {
    console.log('[dispatch] no dispatch dir — no workers fired');
    return;
  }

  const tracked = new Map();   // sid -> { file, child }
  const markers = new Map();   // sid -> { done, idle, crashed, skipIdle, skipCrashed }
  const labelOf = makeLabelResolver();
  const verbose = process.env.DISPATCH_VERBOSE === '1';

  const shutdown = () => {
    for (const v of tracked.values()) {
      try { v.child.kill('SIGTERM'); } catch { /* ignore */ }
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  function markersFor(sid) {
    if (!markers.has(sid)) markers.set(sid, {});
    return markers.get(sid);
  }

  function emitStream(s) {
    if (!s) return;
    process.stdout.write(s + '\n');
  }

  function trackNewFile(file) {
    const sid = findSessionId(file);
    if (tracked.has(sid)) return;
    const sidShort = sid.slice(0, 8);

    const mtimeSecs = fileMtimeSecs(file);
    const nowSecs = Math.floor(Date.now() / 1000);
    if (shouldStampSkipOnDiscovery({ mtimeSecs, nowSecs })) {
      const m = markersFor(sid);
      m.skipIdle = true;
      m.skipCrashed = true;
    }

    const child = tailFile(file, (ev) => {
      if (ev.kind === 'tool_use') {
        const m = markersFor(sid);
        m.idle = false;
      }
      if (shouldStreamEvent(ev.kind, verbose)) {
        emitStream(formatEventLine(sidShort, ev));
      }
    });
    tracked.set(sid, { file, child });
  }

  function lifecycleScan() {
    for (const [sid, { file }] of tracked) {
      if (!fs.existsSync(file)) continue;
      const text = readJsonl(file);
      const hasResult = hasResultEvent(text);
      const nowSecs = Math.floor(Date.now() / 1000);
      const mtimeSecs = fileMtimeSecs(file);
      const ageSecs = nowSecs - (mtimeSecs || nowSecs);
      const m = markersFor(sid);

      const pid = workerPid(readActive(dispatchDir), sid);
      const alive = pidAlive(pid);

      const decision = classifyLifecycle({
        hasResult,
        doneAlready: !!m.done,
        idleAlready: !!m.idle,
        crashedAlready: !!m.crashed,
        skipIdle: !!m.skipIdle,
        skipCrashed: !!m.skipCrashed,
        ageSecs,
        pid,
        pidAlive: alive
      });

      if (decision.action === 'none') continue;

      const label = labelOf(sid, dispatchDir);

      if (decision.action === 'done') {
        const subtype = lastResultSubtype(text) || 'unknown';
        m.done = true;
        m.idle = false;
        m.crashed = false;
        osaNotify(formatLifecycleNotification({ action: 'done', label, subtype }));
        continue;
      }

      if (decision.action === 'idle') {
        const tool = lastToolName(text);
        m.idle = true;
        emitStream(formatLifecycleStreamLine({ action: 'idle', label, tool }));
        osaNotify(formatLifecycleNotification({ action: 'idle', label, tool }));
        continue;
      }

      if (decision.action === 'crashed') {
        m.crashed = true;
        emitStream(formatLifecycleStreamLine({ action: 'crashed', label }));
        osaNotify(formatLifecycleNotification({ action: 'crashed', label, pid }));
      }
    }
  }

  let tickCounter = 0;
  while (true) {
    let files = [];
    try {
      files = fs.readdirSync(dispatchDir)
        .filter(n => n.endsWith('.jsonl')
          && n !== registry.ACTIVE_JSONL
          && n !== registry.ACTIVE_TMP)
        .map(n => path.join(dispatchDir, n));
    } catch { /* dir may briefly vanish; tolerate */ }

    for (const f of files) trackNewFile(f);

    tickCounter += 1;
    if (tickCounter >= LIFECYCLE_CHECK_EVERY_TICKS) {
      tickCounter = 0;
      lifecycleScan();
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[dispatch] watcher error:', err && err.message ? err.message : err);
    process.exit(1);
  });
} else {
  module.exports = {
    findWorker,
    buildWorkerLabel,
    parseEventLine,
    formatEventLine,
    shouldStreamEvent,
    hasResultEvent,
    lastResultSubtype,
    lastToolName,
    shouldStampSkipOnDiscovery,
    classifyLifecycle,
    formatLifecycleNotification,
    formatLifecycleStreamLine,
    ghIssueViewArgs,
  };
}
