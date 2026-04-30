#!/usr/bin/env node
// Tests for stdin-hook.cjs.
// Spawns child processes that use runStdinHook so we observe real exit codes,
// stderr, and side effects on the tracking event log.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const assert = require('assert');

const HELPER = path.resolve(__dirname, 'stdin-hook.cjs');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

function makeFixtureHook(dir, filename, body) {
  const full = path.join(dir, filename);
  fs.writeFileSync(full, body);
  return full;
}

function runHook(hookPath, stdin, env = {}) {
  return spawnSync('node', [hookPath], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 5000,
  });
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stdin-hook-'));
}

console.log('\nrunStdinHook: gating + handler throws');

test('gating handler throw produces non-zero exit and stderr', () => {
  const tmp = mkTmp();
  const hook = makeFixtureHook(tmp, 'gate.cjs', `
    const { runStdinHook } = require('${HELPER}');
    function handle(data) { throw new Error('boom in gate'); }
    runStdinHook(handle, { mode: 'gating', name: 'test-gate' });
  `);
  const res = runHook(hook, '{"tool_name":"Bash"}');
  assert.notStrictEqual(res.status, 0, 'expected non-zero exit');
  assert.ok(/boom in gate/.test(res.stderr), `expected stderr to contain error: ${res.stderr}`);
});

console.log('\nrunStdinHook: observability + handler throws');

test('observability handler throw exits 0 and writes tracking event', () => {
  const tmp = mkTmp();
  const trackingHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tracking-home-'));
  const hook = makeFixtureHook(tmp, 'obs.cjs', `
    const { runStdinHook } = require('${HELPER}');
    function handle(data) { throw new TypeError('boom in obs'); }
    runStdinHook(handle, { mode: 'observability', name: 'test-obs' });
  `);
  const sessionId = 'abc123def456';
  const res = runHook(hook, JSON.stringify({ session_id: sessionId, tool_name: 'Bash' }), {
    HOME: trackingHome,
  });
  assert.strictEqual(res.status, 0, `expected exit 0, got ${res.status}, stderr=${res.stderr}`);
  const projectsRoot = path.join(trackingHome, '.claude', 'projects');
  const logs = [];
  if (fs.existsSync(projectsRoot)) {
    for (const workspace of fs.readdirSync(projectsRoot)) {
      const trackingDir = path.join(projectsRoot, workspace, 'tracking');
      if (!fs.existsSync(trackingDir)) continue;
      for (const f of fs.readdirSync(trackingDir)) {
        if (f.endsWith('.jsonl')) logs.push(path.join(trackingDir, f));
      }
    }
  }
  assert.ok(logs.length > 0, `expected at least one tracking JSONL under ${projectsRoot}`);
  const combined = logs.map(f => fs.readFileSync(f, 'utf8')).join('\n');
  assert.ok(/hook_handler_error/.test(combined), 'expected hook_handler_error event in tracking log');
  assert.ok(/test-obs/.test(combined), 'expected hook name in tracking log');
});

console.log('\nrunStdinHook: malformed JSON');

test('malformed JSON in gating mode exits 0 silently', () => {
  const tmp = mkTmp();
  const hook = makeFixtureHook(tmp, 'gate.cjs', `
    const { runStdinHook } = require('${HELPER}');
    function handle(data) { throw new Error('should not reach'); }
    runStdinHook(handle, { mode: 'gating', name: 'test-gate' });
  `);
  const res = runHook(hook, 'not json {{{');
  assert.strictEqual(res.status, 0, `expected exit 0 on bad JSON, got ${res.status}`);
});

test('malformed JSON in observability mode exits 0 silently', () => {
  const tmp = mkTmp();
  const hook = makeFixtureHook(tmp, 'obs.cjs', `
    const { runStdinHook } = require('${HELPER}');
    function handle(data) { throw new Error('should not reach'); }
    runStdinHook(handle, { mode: 'observability', name: 'test-obs' });
  `);
  const res = runHook(hook, 'not json {{{');
  assert.strictEqual(res.status, 0, `expected exit 0 on bad JSON, got ${res.status}`);
});

console.log('\nrunStdinHook: parseJson: false');

test('parseJson: false calls handler with null and exits 0', () => {
  const tmp = mkTmp();
  const markerFile = path.join(tmp, 'marker');
  const hook = makeFixtureHook(tmp, 'noparse.cjs', `
    const fs = require('fs');
    const { runStdinHook } = require('${HELPER}');
    function handle(data) {
      fs.writeFileSync(${JSON.stringify(markerFile)}, data === null ? 'null' : JSON.stringify(data));
    }
    runStdinHook(handle, { mode: 'observability', parseJson: false, name: 'noparse' });
  `);
  const res = runHook(hook, 'anything that is not json');
  assert.strictEqual(res.status, 0);
  assert.strictEqual(fs.readFileSync(markerFile, 'utf8'), 'null');
});

console.log('\nrunStdinHook: validation');

test('invalid mode throws synchronously at setup', () => {
  const tmp = mkTmp();
  const hook = makeFixtureHook(tmp, 'bad.cjs', `
    const { runStdinHook } = require('${HELPER}');
    runStdinHook(() => {}, { mode: 'loose' });
  `);
  const res = runHook(hook, '{}');
  assert.notStrictEqual(res.status, 0);
  assert.ok(/mode must be/.test(res.stderr));
});

test('missing handler throws synchronously', () => {
  const tmp = mkTmp();
  const hook = makeFixtureHook(tmp, 'bad.cjs', `
    const { runStdinHook } = require('${HELPER}');
    runStdinHook(null, { mode: 'gating' });
  `);
  const res = runHook(hook, '{}');
  assert.notStrictEqual(res.status, 0);
  assert.ok(/handler must be a function/.test(res.stderr));
});

test('missing options throws synchronously', () => {
  const tmp = mkTmp();
  const hook = makeFixtureHook(tmp, 'bad.cjs', `
    const { runStdinHook } = require('${HELPER}');
    runStdinHook(() => {});
  `);
  const res = runHook(hook, '{}');
  assert.notStrictEqual(res.status, 0);
  assert.ok(/options object is required/.test(res.stderr));
});

console.log('\nrunStdinHook: success path');

test('gating handler success exits 0', () => {
  const tmp = mkTmp();
  const hook = makeFixtureHook(tmp, 'ok.cjs', `
    const { runStdinHook } = require('${HELPER}');
    function handle(data) { /* no-op */ }
    runStdinHook(handle, { mode: 'gating', name: 'ok-gate' });
  `);
  const res = runHook(hook, '{"tool_name":"Bash"}');
  assert.strictEqual(res.status, 0);
});

test('observability handler success exits 0', () => {
  const tmp = mkTmp();
  const hook = makeFixtureHook(tmp, 'ok.cjs', `
    const { runStdinHook } = require('${HELPER}');
    function handle(data) { /* no-op */ }
    runStdinHook(handle, { mode: 'observability', name: 'ok-obs' });
  `);
  const res = runHook(hook, '{"tool_name":"Bash"}');
  assert.strictEqual(res.status, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
process.exit(0);
