#!/usr/bin/env node

/**
 * Shared utilities for session tracking hooks.
 *
 * Persistence lives at ~/.claude/projects/{workspace-key}/
 *   tracking/{session-id}.jsonl  — append-only event log (one JSON per line)
 *   tracking/.active-session     — session id cache
 *   hook-errors.log              — error log
 *
 * Tracking is an append-only JSONL event log. Writers call appendTrackingEvent.
 * Readers call readTrackingEvents (raw) or readTrackingState (reconstructed).
 *
 * This shape solves the multi-writer race: fs.appendFileSync is atomic for
 * small (<PIPE_BUF) writes on POSIX, so parallel PostToolUse hooks can log
 * events without corrupting each other's data or losing updates.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const skillTelemetry = require('./skill-telemetry.cjs');
const { stripHeredocs } = require('./command-position.cjs');

const HOME = process.env.HOME || process.env.USERPROFILE;
// CLAUDE_PROJECTS_DIR mirrors the read-side seam in collect-analyze-data.cjs:
// the test runner points it at a temp dir so suite runs never write into the
// real ~/.claude/projects (#889).
const PROJECTS_DIR =
  process.env.CLAUDE_PROJECTS_DIR || path.join(HOME, '.claude/projects');

// getWorkspaceKey is called 2-3 times per hook process (via getTrackingDir in
// both getSessionId and appendTrackingEvent). Memoize per input so we only
// fork `git rev-parse` once per hook invocation.
const _workspaceKeyCache = new Map();

function getWorkspaceKey(workspacePath) {
  const input = workspacePath || process.cwd();
  if (_workspaceKeyCache.has(input)) return _workspaceKeyCache.get(input);

  let root = input;
  try {
    root = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: root
    }).trim();
  } catch (e) {}
  const key = '-' + root.replace(/\//g, '-').slice(1);
  _workspaceKeyCache.set(input, key);
  return key;
}

function getProjectDir(workspacePath) {
  const key = getWorkspaceKey(workspacePath);
  return path.join(PROJECTS_DIR, key);
}

function getTrackingDir(workspacePath) {
  return path.join(getProjectDir(workspacePath), 'tracking');
}

function generateSessionId() {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  return `${timestamp}-${random}`;
}

// Sanitize any value used as a filename to prevent path traversal if a
// session id ever contains `..`, `/`, or other separators.
function sanitizeSessionId(sessionId) {
  return String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getSessionId(claudeSessionId) {
  if (claudeSessionId) return sanitizeSessionId(claudeSessionId);

  const trackingDir = getTrackingDir();
  if (!fs.existsSync(trackingDir)) fs.mkdirSync(trackingDir, { recursive: true });

  const activeSessionFile = path.join(trackingDir, '.active-session');
  if (fs.existsSync(activeSessionFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(activeSessionFile, 'utf8'));
      if (Date.now() - data.createdAt < 300000) {
        return sanitizeSessionId(data.sessionId);
      }
    } catch (e) {}
  }

  const sessionId = generateSessionId();
  fs.writeFileSync(activeSessionFile, JSON.stringify({ sessionId, createdAt: Date.now() }));
  return sessionId;
}

function getSessionTrackingPath(sessionId, workspacePath) {
  return path.join(getTrackingDir(workspacePath), `${sessionId}.jsonl`);
}

/**
 * Append one event to the session log. Atomic on POSIX for small writes.
 * Event must be JSON-serializable. `timestamp` is added automatically if
 * not provided. `type` is required so readers can reconstruct state.
 */
function appendTrackingEvent(sessionId, event, workspacePath) {
  if (!event || typeof event !== 'object' || !event.type) {
    throw new Error('appendTrackingEvent: event must be an object with a `type` field');
  }
  const trackingPath = getSessionTrackingPath(sessionId, workspacePath);
  const payload = { timestamp: event.timestamp || new Date().toISOString(), ...event };
  // Wrap with leading + trailing `\n` (2 extra bytes per event) so a partial
  // tail from a crashed write can't merge with this event's JSON. Readers
  // split on newlines and skip empty lines, so the extra bytes are harmless.
  const line = '\n' + JSON.stringify(payload) + '\n';

  try {
    fs.appendFileSync(trackingPath, line);
  } catch (err) {
    if (err.code === 'ENOENT') {
      fs.mkdirSync(path.dirname(trackingPath), { recursive: true });
      fs.appendFileSync(trackingPath, line);
    } else {
      throw err;
    }
  }
}

/**
 * Read raw events from the session log. Malformed lines are skipped so a
 * partial write from a crashed hook doesn't break the whole read.
 */
function readTrackingEvents(sessionId, workspacePath) {
  const trackingPath = getSessionTrackingPath(sessionId, workspacePath);
  let content;
  try {
    content = fs.readFileSync(trackingPath, 'utf8');
  } catch {
    return [];
  }

  const events = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed line; partial writes from crashes land here.
    }
  }
  return events;
}

/**
 * Rebuild the legacy tracking-state shape from the event log.
 * Keeps callers that read `state.tools[]`, `state.commands[]`, etc. working.
 */
function readTrackingState(sessionId, workspacePath) {
  const events = readTrackingEvents(sessionId, workspacePath);
  const state = {
    sessionId,
    sessionStart: null,
    workspace: null,
    filesModified: [],
    filesCreated: [],
    operations: [],
    commands: [],
    tools: [],
    failures: [],
    subagents: [],
    injections: [],
    skillInvocations: [],
    phaseMenuEmitted: [],
    lastActivity: null
  };

  for (const ev of events) {
    if (ev.timestamp) state.lastActivity = ev.timestamp;
    const { type, ...payload } = ev;
    switch (type) {
      case 'session_init':
        state.sessionStart = ev.timestamp;
        state.workspace = payload.workspace;
        break;
      case 'tool':
        state.tools.push(payload);
        break;
      case 'command':
        state.commands.push(payload);
        break;
      case 'file_change': {
        const { op, file } = payload;
        if (op === 'create' && !state.filesCreated.includes(file)) {
          state.filesCreated.push(file);
        } else if (op === 'modify' && !state.filesModified.includes(file)) {
          state.filesModified.push(file);
        }
        state.operations.push(payload);
        break;
      }
      case 'failure':
        state.failures.push(payload);
        break;
      case 'subagent_start':
        state.subagents.push({ ...payload, startedAt: ev.timestamp });
        break;
      case 'subagent_stop': {
        const match = state.subagents.find(s => s.id === payload.id);
        if (match) {
          match.stoppedAt = ev.timestamp;
          if (match.startedAt) {
            match.durationSeconds = Math.floor(
              (new Date(ev.timestamp) - new Date(match.startedAt)) / 1000
            );
          }
        } else {
          state.subagents.push({ ...payload, stoppedAt: ev.timestamp });
        }
        break;
      }
      case 'injection':
        state.injections.push(payload);
        break;
      case 'skill_invocation':
        state.skillInvocations.push({ ...payload, timestamp: ev.timestamp });
        break;
      case 'phase_menu_emitted':
        state.phaseMenuEmitted.push({ ...payload, timestamp: ev.timestamp });
        break;
    }
  }
  return state;
}

/**
 * Prompt-scoped variant of readTrackingState. Same observability shape, but
 * only events after the most recent `prompt_start` contribute. State is
 * reset at every prompt_start event. When no prompt_start has been written,
 * returns empty collections. The caller treats empty collections as
 * "nothing to check" because Stop-time observability is a nudge, not a gate.
 *
 * Used by verify-before-stop's skill-completion check so skill invocations
 * from prior turns do not re-trigger at every subsequent Stop event.
 * See #231. Tracking is append-only and persists through context
 * compaction, so without scoping, every Skill invocation ever made in the
 * session re-appears at every Stop.
 */
function readPromptScopedTrackingState(sessionId, workspacePath) {
  const events = readTrackingEvents(sessionId, workspacePath);
  const state = {
    sessionId,
    sessionStart: null,
    workspace: null,
    filesModified: [],
    filesCreated: [],
    operations: [],
    commands: [],
    tools: [],
    failures: [],
    subagents: [],
    injections: [],
    skillInvocations: [],
    phaseMenuEmitted: [],
    lastActivity: null,
    promptStart: null
  };

  let inScope = false;
  for (const ev of events) {
    if (ev.type === 'prompt_start') {
      state.filesModified = [];
      state.filesCreated = [];
      state.operations = [];
      state.commands = [];
      state.tools = [];
      state.failures = [];
      state.subagents = [];
      state.injections = [];
      state.skillInvocations = [];
      state.phaseMenuEmitted = [];
      state.lastActivity = ev.timestamp || null;
      state.promptStart = ev.timestamp || null;
      inScope = true;
      continue;
    }
    if (!inScope) continue;
    if (ev.timestamp) state.lastActivity = ev.timestamp;
    const { type, ...payload } = ev;
    switch (type) {
      case 'session_init':
        state.sessionStart = ev.timestamp;
        state.workspace = payload.workspace;
        break;
      case 'tool':
        state.tools.push(payload);
        break;
      case 'command':
        state.commands.push(payload);
        break;
      case 'file_change': {
        const { op, file } = payload;
        if (op === 'create' && !state.filesCreated.includes(file)) {
          state.filesCreated.push(file);
        } else if (op === 'modify' && !state.filesModified.includes(file)) {
          state.filesModified.push(file);
        }
        state.operations.push(payload);
        break;
      }
      case 'failure':
        state.failures.push(payload);
        break;
      case 'subagent_start':
        state.subagents.push({ ...payload, startedAt: ev.timestamp });
        break;
      case 'subagent_stop': {
        const match = state.subagents.find(s => s.id === payload.id);
        if (match) {
          match.stoppedAt = ev.timestamp;
          if (match.startedAt) {
            match.durationSeconds = Math.floor(
              (new Date(ev.timestamp) - new Date(match.startedAt)) / 1000
            );
          }
        } else {
          state.subagents.push({ ...payload, stoppedAt: ev.timestamp });
        }
        break;
      }
      case 'injection':
        state.injections.push(payload);
        break;
      case 'skill_invocation':
        state.skillInvocations.push({ ...payload, timestamp: ev.timestamp });
        break;
      case 'phase_menu_emitted':
        state.phaseMenuEmitted.push({ ...payload, timestamp: ev.timestamp });
        break;
    }
  }
  return state;
}

/**
 * Per-skill telemetry rollup, scoped to the current prompt. Thin wrapper over
 * the shared windowing core in skill-telemetry.cjs (#614) using its
 * prompt-scoped segmentation policy: state resets at every `prompt_start`, only
 * the most recent prompt's windows are returned, and it fails closed (returns
 * []) when no `prompt_start` has been written. Read-only metric, not a gate.
 *
 * Used by verify-before-stop's skill-completion check so skill invocations from
 * prior turns do not re-trigger at every subsequent Stop event (#231). Tracking
 * is append-only and persists through context compaction, so without scoping,
 * every Skill invocation ever made in the session would re-appear at every Stop.
 */
function readSkillTelemetryState(sessionId, workspacePath) {
  const events = readTrackingEvents(sessionId, workspacePath);
  return skillTelemetry.reduceSkillTelemetry(events, { mode: 'prompt-scoped' });
}

/**
 * Reduce tracking events into the state that per-prompt enforcement hooks
 * need. Scans forward and resets state at every `prompt_start`, so only
 * events from the most recent prompt count. Fail-closed when no
 * `prompt_start` has been written — returns empty enforcement state.
 *
 * Shape:
 *   {
 *     specsRead: string[],            // spec names whose files were read
 *     planSkillRead: boolean,         // plan skill read
 *     lastVoiceBlockedHash: string|null,
 *     promptStart: string|null        // timestamp of most recent prompt_start
 *   }
 */
function readPromptScopedState(sessionId, workspacePath) {
  const events = readTrackingEvents(sessionId, workspacePath);
  const state = {
    specsRead: [],
    planSkillRead: false,
    lastVoiceBlockedHash: null,
    promptStart: null
  };

  let inScope = false;
  for (const ev of events) {
    if (ev.type === 'prompt_start') {
      state.specsRead = [];
      state.planSkillRead = false;
      state.lastVoiceBlockedHash = null;
      state.promptStart = ev.timestamp || null;
      inScope = true;
      continue;
    }
    if (!inScope) continue;
    switch (ev.type) {
      case 'spec_read':
        if (ev.name && !state.specsRead.includes(ev.name)) {
          state.specsRead.push(ev.name);
        }
        break;
      case 'plan_skill_read':
        state.planSkillRead = true;
        break;
      case 'voice_blocked':
        state.lastVoiceBlockedHash = ev.hash || null;
        break;
    }
  }

  return state;
}

/**
 * Session-wide spec-read state. Scans every `spec_read`, `plan_skill_read`,
 * and `voice_blocked` event in the session tracking file, with no
 * `prompt_start` boundary — a spec read at any point in the session counts.
 *
 * This is the reader `enforce-specs.cjs` uses in every context (#459, #452).
 * Spec reads must not be re-required each prompt cycle: context carries
 * across prompts in an interactive session, and `/build` runs one branch per
 * prompt, so a prompt-scoped reader re-required every spec on every branch
 * switch. Dispatch isolation still holds — each worker is a separate session
 * with its own tracking file. Subagents need it for a second reason: they
 * never fire UserPromptSubmit, so no `prompt_start` is ever written and a
 * prompt-scoped reader would fail closed.
 */
function readSessionScopedSpecState(sessionId, workspacePath) {
  const events = readTrackingEvents(sessionId, workspacePath);
  const state = {
    specsRead: [],
    planSkillRead: false,
    lastVoiceBlockedHash: null,
    promptStart: null
  };

  for (const ev of events) {
    switch (ev.type) {
      case 'spec_read':
        if (ev.name && !state.specsRead.includes(ev.name)) {
          state.specsRead.push(ev.name);
        }
        break;
      case 'plan_skill_read':
        state.planSkillRead = true;
        break;
      case 'voice_blocked':
        state.lastVoiceBlockedHash = ev.hash || null;
        break;
    }
  }

  return state;
}

/**
 * Pick the most recent tracking session file (< 1 hour old). Shared by the
 * two getRecent* reducers so the window heuristic lives in one place.
 */
function findRecentSessionId(workspacePath) {
  const trackingDir = getTrackingDir(workspacePath);
  if (!fs.existsSync(trackingDir)) return null;

  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  let best = null;
  for (const file of fs.readdirSync(trackingDir)) {
    if (!file.endsWith('.jsonl')) continue;
    const mtime = fs.statSync(path.join(trackingDir, file)).mtime.getTime();
    if (mtime <= oneHourAgo) continue;
    if (!best || mtime > best.mtime) {
      best = { sessionId: file.replace(/\.jsonl$/, ''), mtime };
    }
  }
  return best ? best.sessionId : null;
}

// Three UserPromptSubmit injection modules (spec-triggers, lens-router via
// lib/phase.cjs, phase-menu) each call one of these getRecent* helpers in the
// same hook process, and each call re-runs findRecentSessionId + reads + JSON-
// parses the entire session JSONL. On 5000+ line sessions that's ~13ms of
// redundant work per prompt. Hook processes are short-lived (one per
// UserPromptSubmit) and all three reads happen before any writes in the same
// process, so a module-local cache keyed by resolved sessionId is safe with
// no TTL and no invalidation. Cache miss path is unchanged.
const _recentSessionIdCache = new Map();
const _trackingStateCache = new Map();
const _promptScopedStateCache = new Map();
const _sessionScopedSpecStateCache = new Map();
const _promptScopedTrackingStateCache = new Map();
const _skillTelemetryStateCache = new Map();

// When a caller passes the active session_id (from the hook payload), use it
// directly. Parallel Claude Code sessions share a tracking directory, and
// findRecentSessionId picks by mtime, which races when a sibling session
// writes a tool event between this session's spec_read and its Edit. See #263.
// Sanitize at the boundary so callers can pass raw payload values.
function _recentSessionIdFor(workspacePath, sessionId) {
  if (sessionId) return sanitizeSessionId(sessionId);
  const key = workspacePath || '';
  if (_recentSessionIdCache.has(key)) return _recentSessionIdCache.get(key);
  const resolved = findRecentSessionId(workspacePath);
  _recentSessionIdCache.set(key, resolved);
  return resolved;
}

/**
 * Resolve the invoking session's prompt-scoped enforcement state. Pass
 * `sessionId` from the hook payload when available; falls back to picking
 * the most recently modified tracking file when absent. See #263.
 */
function getRecentPromptScopedState(workspacePath, sessionId) {
  const sid = _recentSessionIdFor(workspacePath, sessionId);
  if (!sid) return null;
  if (_promptScopedStateCache.has(sid)) return _promptScopedStateCache.get(sid);
  const state = readPromptScopedState(sid, workspacePath);
  _promptScopedStateCache.set(sid, state);
  return state;
}

/**
 * Resolve session-wide spec-read state — the reader `enforce-specs` uses in
 * every context. See `readSessionScopedSpecState` for why.
 */
function getRecentSessionScopedSpecState(workspacePath, sessionId) {
  const sid = _recentSessionIdFor(workspacePath, sessionId);
  if (!sid) return null;
  if (_sessionScopedSpecStateCache.has(sid)) return _sessionScopedSpecStateCache.get(sid);
  const state = readSessionScopedSpecState(sid, workspacePath);
  _sessionScopedSpecStateCache.set(sid, state);
  return state;
}

/**
 * Find the most recent session tracking file and return its reconstructed
 * observability state. Used by Stop hooks that need "current session"
 * context without requiring the session_id to be threaded through.
 */
function getRecentTrackingState(workspacePath, sessionId) {
  const sid = _recentSessionIdFor(workspacePath, sessionId);
  if (!sid) return null;
  if (_trackingStateCache.has(sid)) return _trackingStateCache.get(sid);
  const state = readTrackingState(sid, workspacePath);
  _trackingStateCache.set(sid, state);
  return state;
}

/**
 * Prompt-scoped variant of getRecentTrackingState. Returns null when no
 * session file exists. When a file exists but no prompt_start has been
 * written, returns empty collections. The caller treats that as "no
 * activity in current prompt", which is a safe no-op for Stop-time checks.
 */
function getRecentPromptScopedTrackingState(workspacePath, sessionId) {
  const sid = _recentSessionIdFor(workspacePath, sessionId);
  if (!sid) return null;
  if (_promptScopedTrackingStateCache.has(sid)) {
    return _promptScopedTrackingStateCache.get(sid);
  }
  const state = readPromptScopedTrackingState(sid, workspacePath);
  _promptScopedTrackingStateCache.set(sid, state);
  return state;
}

function getRecentSkillTelemetryState(workspacePath, sessionId) {
  const sid = _recentSessionIdFor(workspacePath, sessionId);
  if (!sid) return null;
  if (_skillTelemetryStateCache.has(sid)) return _skillTelemetryStateCache.get(sid);
  const state = readSkillTelemetryState(sid, workspacePath);
  _skillTelemetryStateCache.set(sid, state);
  return state;
}

// Escape hatch for tests that simulate multiple hook processes in one node
// run. Production hook processes are short-lived and never need this.
function _resetRecentStateCache() {
  _recentSessionIdCache.clear();
  _trackingStateCache.clear();
  _promptScopedStateCache.clear();
  _sessionScopedSpecStateCache.clear();
  _promptScopedTrackingStateCache.clear();
  _skillTelemetryStateCache.clear();
}

function initSession(workspacePath) {
  const sessionId = generateSessionId();
  const trackingDir = getTrackingDir(workspacePath);
  if (!fs.existsSync(trackingDir)) fs.mkdirSync(trackingDir, { recursive: true });

  const activeSessionFile = path.join(trackingDir, '.active-session');
  fs.writeFileSync(activeSessionFile, JSON.stringify({ sessionId, createdAt: Date.now() }));

  appendTrackingEvent(sessionId, {
    type: 'session_init',
    workspace: workspacePath || process.cwd()
  }, workspacePath);

  return sessionId;
}

/**
 * Remove session tracking files older than 7 days. Legacy .json files are
 * swept alongside new .jsonl files.
 */
function cleanupOldSessions(workspacePath) {
  const trackingDir = getTrackingDir(workspacePath);
  if (!fs.existsSync(trackingDir)) return;

  const maxAge = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  for (const file of fs.readdirSync(trackingDir)) {
    if (file === '.active-session') continue;
    if (!file.endsWith('.json') && !file.endsWith('.jsonl')) continue;
    const filePath = path.join(trackingDir, file);
    try {
      const stat = fs.statSync(filePath);
      if (now - stat.mtime.getTime() > maxAge) fs.unlinkSync(filePath);
    } catch (e) {}
  }
}

function getErrorLogPath(workspacePath) {
  return path.join(getProjectDir(workspacePath), 'hook-errors.log');
}

function logError(hook, message, workspacePath) {
  const errorLogPath = getErrorLogPath(workspacePath);
  const entry = `[${new Date().toISOString()}] ${hook}: ${message}\n`;
  try {
    const dir = path.dirname(errorLogPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(errorLogPath, entry);
  } catch (e) {}
}

/**
 * Strip content-bearing arguments and heredocs from a command string.
 * Returns only the command portion for safe pattern matching.
 *
 * Recognized content-bearing flags (space or `=` delimiter):
 *   --body / --comment / --message   (gh issue/pr create, many CLIs)
 *   -m                                (git commit)
 *   -f body= / -F body=               (gh api form fields for free text)
 *   -f message= / -F message=         (gh api)
 */
function stripCommandContent(cmd) {
  // Heredoc stripping is shared from command-position.cjs (#769); the
  // content-flag truncation below is this function's own layer on top.
  let stripped = stripHeredocs(cmd, { mode: 'placeholder' });
  const contentFlagMatch = stripped.match(
    /(?:^|\s)--(body|comment|message)[\s=]|(?:^|\s)-m[\s"']|(?:^|\s)-[fF]\s+(body|message)=/
  );
  if (contentFlagMatch) stripped = stripped.substring(0, contentFlagMatch.index);
  return stripped;
}

module.exports = {
  getWorkspaceKey,
  getProjectDir,
  getTrackingDir,
  getSessionId,
  sanitizeSessionId,
  getSessionTrackingPath,
  appendTrackingEvent,
  readTrackingEvents,
  readTrackingState,
  readPromptScopedState,
  readSessionScopedSpecState,
  readPromptScopedTrackingState,
  readSkillTelemetryState,
  getRecentTrackingState,
  getRecentPromptScopedState,
  getRecentSessionScopedSpecState,
  getRecentPromptScopedTrackingState,
  getRecentSkillTelemetryState,
  _resetRecentStateCache,
  initSession,
  cleanupOldSessions,
  getErrorLogPath,
  logError,
  stripCommandContent,
  PROJECTS_DIR
};
