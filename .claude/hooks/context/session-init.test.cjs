'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { checkForChanges } = require('./session-init.cjs');

const CREATED = [];
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sess-init-'));
  CREATED.push(d);
  return d;
}
function write(root, rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}
function md5(content) {
  return crypto.createHash('md5').update(Buffer.from(content)).digest('hex');
}
process.on('exit', () => {
  for (const d of CREATED) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

// #812: a fresh git worktree of an already-synced project has committed
// stack-config.yaml but no gitignored .sync-state.json. The warning must not
// fire there.
test('synced project, fresh worktree (stack-config present, no .sync-state) does NOT warn', () => {
  const d = tmp();
  write(d, 'package.json', '{"name":"x"}');
  write(d, '.claude/specs/stack-config.yaml', 'libraries: []\n');
  // no .sync-state.json — the gitignored marker is absent in a fresh worktree
  const result = checkForChanges(d);
  assert.strictEqual(result.changed, false);
});

// The warning must still fire for a project that genuinely never ran /sync-stack.
test('un-synced project (no stack-config, has manifest) DOES warn', () => {
  const d = tmp();
  write(d, 'package.json', '{"name":"x"}');
  const result = checkForChanges(d);
  assert.strictEqual(result.changed, true);
  assert.match(result.reason, /never been synced/);
});

test('no manifest and no stack-config does not warn (not a stack project)', () => {
  const d = tmp();
  const result = checkForChanges(d);
  assert.strictEqual(result.changed, false);
});

// The committed-evidence gate only governs the never-synced branch; the
// hash-drift check still runs when .sync-state.json exists.
test('sync-state present with matching hash reports no change', () => {
  const d = tmp();
  const pkg = '{"name":"x"}';
  write(d, 'package.json', pkg);
  write(d, '.claude/specs/.sync-state.json', JSON.stringify({
    lastSync: '2026-06-19T00:00:00.000Z',
    hashes: { 'package.json': md5(pkg) }
  }));
  const result = checkForChanges(d);
  assert.strictEqual(result.changed, false);
});

test('sync-state present with stale hash reports the changed file', () => {
  const d = tmp();
  write(d, 'package.json', '{"name":"x","version":"2"}');
  write(d, '.claude/specs/.sync-state.json', JSON.stringify({
    lastSync: '2026-06-19T00:00:00.000Z',
    hashes: { 'package.json': md5('{"name":"x"}') } // hash of the old content
  }));
  const result = checkForChanges(d);
  assert.strictEqual(result.changed, true);
  assert.ok(result.files.includes('package.json'));
});
