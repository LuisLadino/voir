#!/usr/bin/env node

/**
 * Kit Health Surface Hook
 *
 * Event: SessionStart
 * Purpose: In the kit source repo ONLY, surface a one-line cross-project
 *   kit-health digest — silent when everything is green — and spawn a background
 *   refresh for next time. This is the forcing function for #887: /analyze was
 *   never run (0 of 3012 tracked skill invocations) because it waited on someone
 *   to remember. Now the health signal greets you when you open the kit repo and
 *   shuts up when there is nothing to say.
 *
 * Fires ONLY in the kit source repo, detected by settings.template.json +
 *   setup-kit.sh at the root — the same signal kit-settings-drift-warning uses.
 *   Downstreams receive the synced hook file but neither root marker, so it
 *   no-ops there. scripts/kit-health.cjs is not synced, so it only exists here.
 *
 * Fast by construction: a full scan is ~1.6s and grows, too slow to block
 *   SessionStart. So the hook reads a pre-computed cache (instant), surfaces its
 *   baked-in digest, and spawns `kit-health --write-cache` detached to refresh
 *   for the next session — the same async pattern as spawn-context-agent. The
 *   digest is therefore as-of-last-visit; the age is shown when it is not fresh.
 *
 * Advisory only — SessionStart is context-only and cannot block. Observability
 *   mode: any throw is logged and fails open. Silence with
 *   CLAUDE_KIT_NO_HEALTH_SURFACE=1.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_PATH = path.join(os.homedir(), '.claude', 'kit-health-cache.json');
const STALE_CACHE_DAYS = 14; // a digest older than this is too stale to assert
const AGE_ANNOTATE_HOURS = 12; // annotate freshness once the cache is older than this
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // re-scan at most hourly, not on every session start

// True only in the kit source repo: it ships settings.template.json + setup-kit.sh
// at the root. Downstreams receive neither, so this hook is silent everywhere else.
function isKitSource(root) {
  return (
    fs.existsSync(path.join(root, 'settings.template.json')) &&
    fs.existsSync(path.join(root, 'setup-kit.sh'))
  );
}

function readCache(cachePath) {
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch {
    return null;
  }
}

function ageLabel(ms) {
  const hours = ms / (60 * 60 * 1000);
  if (hours < 48) return `${Math.max(1, Math.round(hours))}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// The line to inject, or null to stay silent. Silent on: green health, a
// too-stale cache, or a cache with no digest. On a cold start (no cache) a
// one-time note explains the first background compute.
function surfaceText(cache, now) {
  if (!cache) {
    return 'Kit health: first run — computing in the background, will surface next session.';
  }
  if (!cache.digest) return null; // green: nothing to say
  const generatedMs = Date.parse(cache.generatedAt || '');
  const ageMs = Number.isNaN(generatedMs) ? Infinity : now - generatedMs;
  if (ageMs > STALE_CACHE_DAYS * DAY_MS) return null; // too old to trust; refresh will repopulate
  if (ageMs > AGE_ANNOTATE_HOURS * 60 * 60 * 1000) {
    return `As of ${ageLabel(ageMs)} — ${cache.digest}`;
  }
  return cache.digest;
}

// A refresh is due when there is no cache or the cached digest has aged past the
// interval. Gating on this stops every kit-repo session start from spawning a
// full ~1.6s scan — and stops N near-simultaneous cold starts from each spawning
// one — turning "scan on every start" into "scan when the cache is stale".
function shouldRefresh(cache, now) {
  if (!cache) return true;
  const generatedMs = Date.parse(cache.generatedAt || '');
  if (Number.isNaN(generatedMs)) return true;
  return now - generatedMs >= REFRESH_INTERVAL_MS;
}

function spawnRefresh(root, cachePath, deps = {}) {
  try {
    const script = path.join(root, 'scripts', 'kit-health.cjs');
    if (!fs.existsSync(script)) return;
    const child = (deps.spawn || spawn)(process.execPath, [script, '--write-cache', cachePath], {
      cwd: root,
      detached: true,
      stdio: 'ignore',
    });
    // A detached child with no 'error' listener throws on an async spawn failure
    // (ENOENT/EAGAIN) — attach a no-op, matching watch-workers.cjs.
    if (child && typeof child.on === 'function') child.on('error', () => {});
    if (child && typeof child.unref === 'function') child.unref();
  } catch {
    // Refresh is best-effort; a failure just means the digest ages until next time.
  }
}

function handleHook(_data, deps = {}) {
  if (process.env.CLAUDE_KIT_NO_HEALTH_SURFACE === '1') return { state: 'silenced' };
  // A skill-gate trigger walk drives one-shot `claude -p` turns; injected context
  // would pollute the measurement, so suppress during a walk (matches other
  // SessionStart context hooks).
  if (process.env.CLAUDE_SKILL_GATE_WALK) return { state: 'walk' };

  const root = deps.root || process.cwd();
  if (!isKitSource(root)) return { state: 'not-kit-source' };

  const cachePath = deps.cachePath || CACHE_PATH;
  const now = deps.now || Date.now();
  const cache = (deps.readCache || readCache)(cachePath);

  const line = surfaceText(cache, now);
  if (line) console.log(line);

  const refreshed = shouldRefresh(cache, now);
  if (refreshed) (deps.spawnRefresh || spawnRefresh)(root, cachePath, deps);
  return { state: line ? 'surfaced' : 'silent', refreshed };
}

if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook((data) => handleHook(data), { mode: 'observability', parseJson: false });
}

module.exports = { handleHook, isKitSource, readCache, surfaceText, spawnRefresh, shouldRefresh, ageLabel };
