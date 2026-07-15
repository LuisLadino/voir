#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, 'release-cadence-surface.cjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.stack}`); }
}

function withTempProject(fn) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'release-surface-')));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function changelogWith(entryCount) {
  const entries = Array.from({ length: entryCount }, (_, i) => `- **Entry ${i + 1} (#${i + 1}).** Body.`).join('\n');
  return `# Changelog\n\n## [Unreleased]\n\n### Added\n\n${entries}\n\n## [1.0.0] - 2026-01-01\n\n- **old released entry**\n`;
}

function runHook(dir, env = {}) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: '',
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { exitCode: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

console.log('release-cadence-surface');

test('surfaces [RELEASE] when [Unreleased] is at/over the default threshold', () => {
  withTempProject(dir => {
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), changelogWith(31));
    const r = runHook(dir);
    assert.strictEqual(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes('[RELEASE]'), `expected [RELEASE], got: ${r.stdout}`);
    assert.ok(r.stdout.includes('31'), 'names the count');
    assert.ok(r.stdout.includes('.claude/specs/kit/releases.md'), 'points at the synced releases spec (#924)');
  });
});

test('silent when below the default threshold', () => {
  withTempProject(dir => {
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), changelogWith(7));
    const r = runHook(dir);
    assert.strictEqual(r.exitCode, 0);
    assert.strictEqual(r.stdout.trim(), '', `expected silence, got: ${r.stdout}`);
  });
});

test('silent when there is no CHANGELOG.md', () => {
  withTempProject(dir => {
    const r = runHook(dir);
    assert.strictEqual(r.exitCode, 0);
    assert.strictEqual(r.stdout.trim(), '');
  });
});

test('CLAUDE_NO_RELEASE_CADENCE_WARN=1 silences even when over threshold', () => {
  withTempProject(dir => {
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), changelogWith(31));
    const r = runHook(dir, { CLAUDE_NO_RELEASE_CADENCE_WARN: '1' });
    assert.strictEqual(r.exitCode, 0);
    assert.strictEqual(r.stdout.trim(), '', `expected silence, got: ${r.stdout}`);
  });
});

test('honors CLAUDE_RELEASE_CADENCE_THRESHOLD override', () => {
  withTempProject(dir => {
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), changelogWith(4));
    // Below default 30 → silent, but a threshold of 3 makes 4 entries surface.
    assert.strictEqual(runHook(dir).stdout.trim(), '', 'silent at default threshold');
    const r = runHook(dir, { CLAUDE_RELEASE_CADENCE_THRESHOLD: '3' });
    assert.ok(r.stdout.includes('[RELEASE]'), `expected surface at threshold 3, got: ${r.stdout}`);
    assert.ok(r.stdout.includes('threshold 3'), 'reflects the overridden threshold');
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
