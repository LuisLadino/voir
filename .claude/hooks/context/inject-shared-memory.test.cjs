#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, 'inject-shared-memory.cjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.stack}`); }
}

function withTempDir(fn) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'inject-shared-')));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function runHook(env = {}) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: '',
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { exitCode: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

console.log('inject-shared-memory');

test('injects shared memories when the dir has them', () => {
  withTempDir(dir => {
    fs.writeFileSync(path.join(dir, 'feedback_take_reins.md'), 'Decide and drive.');
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), '# index (must not inject)');
    const r = runHook({ CLAUDE_SHARED_MEMORY_DIR: dir });
    assert.strictEqual(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes('[SHARED MEMORY]'), `expected injection, got: ${r.stdout}`);
    assert.ok(r.stdout.includes('Decide and drive.'), 'includes memory body');
    assert.ok(!r.stdout.includes('index (must not inject)'), 'excludes MEMORY.md index');
  });
});

test('silent when the shared dir is empty', () => {
  withTempDir(dir => {
    const r = runHook({ CLAUDE_SHARED_MEMORY_DIR: dir });
    assert.strictEqual(r.exitCode, 0);
    assert.strictEqual(r.stdout.trim(), '', `expected silence, got: ${r.stdout}`);
  });
});

test('silent when the shared dir does not exist', () => {
  const r = runHook({ CLAUDE_SHARED_MEMORY_DIR: '/no/such/shared/dir' });
  assert.strictEqual(r.exitCode, 0);
  assert.strictEqual(r.stdout.trim(), '');
});

test('CLAUDE_NO_SHARED_MEMORY=1 silences even with memories present', () => {
  withTempDir(dir => {
    fs.writeFileSync(path.join(dir, 'feedback_x.md'), 'x');
    const r = runHook({ CLAUDE_SHARED_MEMORY_DIR: dir, CLAUDE_NO_SHARED_MEMORY: '1' });
    assert.strictEqual(r.exitCode, 0);
    assert.strictEqual(r.stdout.trim(), '', `expected silence, got: ${r.stdout}`);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
