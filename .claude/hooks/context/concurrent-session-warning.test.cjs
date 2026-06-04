#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  evaluate,
  warningText,
  pruneStale,
  readMarkers,
} = require('./concurrent-session-warning.cjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.stack}`); }
}

function withTempProject(fn) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'csw-test-')));
  fs.mkdirSync(path.join(dir, '.claude/sessions'), { recursive: true });
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function writeMarker(dir, sessionId, data) {
  const file = path.join(dir, '.claude/sessions', `${sessionId}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

test('returns empty when sessions dir does not exist', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'csw-test-')));
  try {
    const markers = readMarkers(path.join(dir, '.claude/sessions'));
    assert.deepStrictEqual(markers, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pruneStale removes markers with dead PIDs', () => {
  withTempProject(dir => {
    writeMarker(dir, 'abc', { session_id: 'abc', pid: 999999, cwd: dir, started_at: new Date().toISOString() });
    const before = readMarkers(path.join(dir, '.claude/sessions'));
    assert.strictEqual(before.length, 1);
    const after = pruneStale(before);
    assert.strictEqual(after.length, 0);
  });
});

test('warningText includes all other session pids', () => {
  const others = [
    { data: { session_id: 'abc123def456', pid: 1234, started_at: new Date(Date.now() - 60000).toISOString() } },
    { data: { session_id: 'xyz789ghi012', pid: 5678, started_at: new Date(Date.now() - 120000).toISOString() } }
  ];
  const text = warningText(others, '/tmp/repo');
  assert.ok(text.includes('1234'));
  assert.ok(text.includes('5678'));
  assert.ok(text.includes('worktree.cjs'));
});

test('stale markers older than 24h are pruned even if PID is live', () => {
  withTempProject(dir => {
    writeMarker(dir, 'old', {
      session_id: 'old',
      pid: process.pid,
      cwd: dir,
      started_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    });
    const after = pruneStale(readMarkers(path.join(dir, '.claude/sessions')));
    assert.strictEqual(after.length, 0);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
