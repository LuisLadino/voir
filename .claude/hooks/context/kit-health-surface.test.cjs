#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  handleHook,
  isKitSource,
  readCache,
  surfaceText,
  spawnRefresh,
  shouldRefresh,
  ageLabel,
} = require('./kit-health-surface.cjs');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-07-04T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

const cases = [];
const add = (name, run) => cases.push({ name, run });

// temp dirs to clean up
const tmpDirs = [];
function mkdir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'khs-test-'));
  tmpDirs.push(d);
  return d;
}

// ── isKitSource ──────────────────────────────────────────────────────────────
add('isKitSource: true when both root markers exist', () => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, 'settings.template.json'), '{}');
  fs.writeFileSync(path.join(d, 'setup-kit.sh'), '');
  return isKitSource(d) === true;
});

add('isKitSource: false when setup-kit.sh missing', () => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, 'settings.template.json'), '{}');
  return isKitSource(d) === false;
});

add('isKitSource: false in an empty dir', () => isKitSource(mkdir()) === false);

// ── readCache ────────────────────────────────────────────────────────────────
add('readCache: parses a valid cache file', () => {
  const d = mkdir();
  const p = path.join(d, 'c.json');
  fs.writeFileSync(p, JSON.stringify({ overall: 'green', digest: null }));
  const c = readCache(p);
  return c && c.overall === 'green';
});

add('readCache: null on missing/garbage file', () => {
  const d = mkdir();
  const missing = readCache(path.join(d, 'nope.json'));
  const garbage = path.join(d, 'g.json');
  fs.writeFileSync(garbage, 'not json{');
  return missing === null && readCache(garbage) === null;
});

// ── surfaceText ──────────────────────────────────────────────────────────────
add('surfaceText: cold start (no cache) => first-run note', () => {
  const t = surfaceText(null, NOW);
  return typeof t === 'string' && t.includes('first run');
});

add('surfaceText: green cache (digest null) => silent', () =>
  surfaceText({ generatedAt: iso(NOW - HOUR), digest: null }, NOW) === null);

add('surfaceText: fresh digest surfaces verbatim (no age prefix)', () => {
  const digest = '🔴 flagged X';
  return surfaceText({ generatedAt: iso(NOW - 2 * HOUR), digest }, NOW) === digest;
});

add('surfaceText: cache older than annotate window gets an age prefix', () => {
  const digest = '🟡 flagged Y';
  const t = surfaceText({ generatedAt: iso(NOW - 15 * HOUR), digest }, NOW);
  return typeof t === 'string' && t.startsWith('As of ') && t.includes(digest);
});

add('surfaceText: too-stale cache (>14d) => silent', () =>
  surfaceText({ generatedAt: iso(NOW - 20 * DAY), digest: '🔴 old' }, NOW) === null);

add('surfaceText: unparseable generatedAt treated as too stale => silent', () =>
  surfaceText({ generatedAt: 'garbage', digest: '🔴 x' }, NOW) === null);

// ── ageLabel ─────────────────────────────────────────────────────────────────
add('ageLabel: sub-2-day ages read in hours, older in days', () =>
  ageLabel(3 * HOUR) === '3h ago' && ageLabel(3 * DAY) === '3d ago');

// ── spawnRefresh ─────────────────────────────────────────────────────────────
add('spawnRefresh: no-op when the script is absent', () => {
  const d = mkdir(); // no scripts/kit-health.cjs
  let called = 0;
  spawnRefresh(d, path.join(d, 'c.json'), { spawn: () => { called++; return { unref() {} }; } });
  return called === 0;
});

add('spawnRefresh: spawns detached when the script exists', () => {
  const d = mkdir();
  fs.mkdirSync(path.join(d, 'scripts'));
  fs.writeFileSync(path.join(d, 'scripts', 'kit-health.cjs'), '// stub');
  let args = null;
  let opts = null;
  let unreffed = false;
  spawnRefresh(d, '/tmp/c.json', {
    spawn: (_exec, a, o) => {
      args = a;
      opts = o;
      return { unref() { unreffed = true; } };
    },
  });
  return (
    args &&
    args.includes('--write-cache') &&
    args.includes('/tmp/c.json') &&
    opts.detached === true &&
    opts.stdio === 'ignore' &&
    unreffed === true
  );
});

// ── handleHook ───────────────────────────────────────────────────────────────
function kitRoot() {
  const d = mkdir();
  fs.writeFileSync(path.join(d, 'settings.template.json'), '{}');
  fs.writeFileSync(path.join(d, 'setup-kit.sh'), '');
  return d;
}

add('handleHook: no-op outside the kit source repo (no spawn, no output)', () => {
  let spawned = 0;
  let logged = '';
  const orig = console.log;
  console.log = (s) => { logged += s; };
  const res = handleHook(null, { root: mkdir(), now: NOW, spawnRefresh: () => { spawned++; } });
  console.log = orig;
  return res.state === 'not-kit-source' && spawned === 0 && logged === '';
});

add('handleHook: silenced by CLAUDE_KIT_NO_HEALTH_SURFACE', () => {
  process.env.CLAUDE_KIT_NO_HEALTH_SURFACE = '1';
  const res = handleHook(null, { root: kitRoot(), now: NOW, spawnRefresh: () => {} });
  delete process.env.CLAUDE_KIT_NO_HEALTH_SURFACE;
  return res.state === 'silenced';
});

add('handleHook: suppressed during a skill-gate walk', () => {
  process.env.CLAUDE_SKILL_GATE_WALK = '1';
  const res = handleHook(null, { root: kitRoot(), now: NOW, spawnRefresh: () => {} });
  delete process.env.CLAUDE_SKILL_GATE_WALK;
  return res.state === 'walk';
});

add('handleHook: stale cache surfaces the digest and spawns a refresh', () => {
  const d = kitRoot();
  const cachePath = path.join(d, 'cache.json');
  fs.writeFileSync(cachePath, JSON.stringify({ generatedAt: iso(NOW - 2 * HOUR), overall: 'red', digest: '🔴 flagged Z' }));
  let spawned = 0;
  let logged = '';
  const orig = console.log;
  console.log = (s) => { logged += s; };
  const res = handleHook(null, { root: d, cachePath, now: NOW, spawnRefresh: () => { spawned++; } });
  console.log = orig;
  return res.state === 'surfaced' && res.refreshed === true && spawned === 1 && logged.includes('flagged Z');
});

add('handleHook: green stale cache stays silent but still refreshes', () => {
  const d = kitRoot();
  const cachePath = path.join(d, 'cache.json');
  fs.writeFileSync(cachePath, JSON.stringify({ generatedAt: iso(NOW - 2 * HOUR), overall: 'green', digest: null }));
  let spawned = 0;
  let logged = '';
  const orig = console.log;
  console.log = (s) => { logged += s; };
  const res = handleHook(null, { root: d, cachePath, now: NOW, spawnRefresh: () => { spawned++; } });
  console.log = orig;
  return res.state === 'silent' && spawned === 1 && logged === '';
});

add('handleHook: fresh cache surfaces but does NOT re-spawn (age gate)', () => {
  const d = kitRoot();
  const cachePath = path.join(d, 'cache.json');
  fs.writeFileSync(cachePath, JSON.stringify({ generatedAt: iso(NOW - 5 * 60 * 1000), overall: 'red', digest: '🔴 fresh flag' }));
  let spawned = 0;
  let logged = '';
  const orig = console.log;
  console.log = (s) => { logged += s; };
  const res = handleHook(null, { root: d, cachePath, now: NOW, spawnRefresh: () => { spawned++; } });
  console.log = orig;
  return res.state === 'surfaced' && res.refreshed === false && spawned === 0 && logged.includes('fresh flag');
});

// ── shouldRefresh ────────────────────────────────────────────────────────────
add('shouldRefresh: true when no cache, false when fresh, true when stale/garbage', () =>
  shouldRefresh(null, NOW) === true &&
  shouldRefresh({ generatedAt: iso(NOW - 5 * 60 * 1000) }, NOW) === false &&
  shouldRefresh({ generatedAt: iso(NOW - 2 * HOUR) }, NOW) === true &&
  shouldRefresh({ generatedAt: 'garbage' }, NOW) === true);

// ── Runner ───────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];
for (const c of cases) {
  let ok = false;
  let err = null;
  try {
    ok = c.run();
  } catch (e) {
    err = e;
  }
  if (ok) passed++;
  else {
    failed++;
    failures.push({ name: c.name, err });
  }
}

for (const d of tmpDirs) {
  try {
    fs.rmSync(d, { recursive: true, force: true });
  } catch {}
}

if (failed > 0) {
  console.error(`kit-health-surface: ${failed} of ${cases.length} cases FAILED:`);
  for (const f of failures) console.error(`  ✗ ${f.name}${f.err ? ` — ${f.err.message}` : ''}`);
  process.exit(1);
}
console.log(`kit-health-surface: all ${passed} cases passed.`);
process.exit(0);
