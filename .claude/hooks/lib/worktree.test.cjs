'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const wt = require('./worktree.cjs');

const CREATED = [];
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-'));
  CREATED.push(d);
  return d;
}
process.on('exit', () => {
  for (const d of CREATED) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

// A recording runner. `result` maps an arg-substring to a {status,stdout,stderr};
// anything unmatched returns status 0. Records every call as a joined arg string.
function mockRun(result = {}) {
  const calls = [];
  const run = (cmd, args, opts = {}) => {
    calls.push({ joined: args.join(' '), cwd: opts.cwd });
    for (const key of Object.keys(result)) {
      if (args.join(' ').includes(key)) return result[key];
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  run.calls = calls;
  return run;
}
const did = (run, needle) => run.calls.some(c => c.joined.includes(needle));

// ---- makeRunner ----

test('makeRunner: normalizes a spawnSync-shaped result, null status → 1', () => {
  const run = wt.makeRunner((cmd, args) => ({ status: null, stdout: 'o', stderr: 'e' }));
  assert.deepStrictEqual(run('git', ['x']), { status: 1, stdout: 'o', stderr: 'e' });
});

test('makeRunner: passes status/stdout/stderr through and defaults missing strings', () => {
  const run = wt.makeRunner(() => ({ status: 0 }));
  assert.deepStrictEqual(run('git', ['x']), { status: 0, stdout: '', stderr: '' });
});

test('makeRunner: forwards cmd, args, and merges encoding into opts', () => {
  let seen;
  const run = wt.makeRunner((cmd, args, opts) => { seen = { cmd, args, opts }; return { status: 0 }; });
  run('git', ['worktree', 'prune'], { cwd: '/r' });
  assert.strictEqual(seen.cmd, 'git');
  assert.deepStrictEqual(seen.args, ['worktree', 'prune']);
  assert.strictEqual(seen.opts.cwd, '/r');
  assert.strictEqual(seen.opts.encoding, 'utf8');
});

// ---- add ----

test('add: reset=false uses -b (create, fail if exists), repo as cwd, creates parent', () => {
  const repo = tmp();
  const run = mockRun();
  const wtPath = path.join(repo, '.claude', 'worktrees', 'dispatch-aaa');
  const r = wt.add({ repo, path: wtPath, branch: 'dispatch-aaa', base: 'origin/HEAD', run });
  assert.strictEqual(r.status, 0);
  assert.ok(did(run, `worktree add -b dispatch-aaa ${wtPath} origin/HEAD`));
  assert.strictEqual(run.calls[0].cwd, repo);
  assert.ok(fs.existsSync(path.dirname(wtPath)), 'parent dir created');
});

test('add: reset=true uses -B (create or reset)', () => {
  const repo = tmp();
  const run = mockRun();
  const wtPath = path.join(repo, '.claude', 'worktrees', 'kit-fleet-fleet');
  wt.add({ repo, path: wtPath, branch: 'kit-sync/fleet', base: 'origin/main', reset: true, run });
  assert.ok(did(run, `worktree add -B kit-sync/fleet ${wtPath} origin/main`));
});

test('add: returns the runner failure result verbatim (never throws)', () => {
  const repo = tmp();
  const run = mockRun({ 'worktree add': { status: 128, stdout: '', stderr: 'already exists' } });
  const r = wt.add({ repo, path: path.join(repo, 'w'), branch: 'b', base: 'x', run });
  assert.strictEqual(r.status, 128);
  assert.strictEqual(r.stderr, 'already exists');
});

// ---- safeRemove ----

test('safeRemove: a live pid is skipped, no git runs', () => {
  const run = mockRun();
  const res = wt.safeRemove({ repo: '/r', path: '/r/wt', branch: 'b', pidGuard: { pid: 42, isAlive: () => true }, run });
  assert.deepStrictEqual(res, { removed: false, skipped: true });
  assert.strictEqual(run.calls.length, 0);
});

test('safeRemove: dead pid reaps — remove --force then branch -D, removed:true', () => {
  const repo = tmp();
  const wtPath = path.join(repo, 'wt');
  fs.mkdirSync(wtPath, { recursive: true });
  const run = mockRun();
  const res = wt.safeRemove({ repo, path: wtPath, branch: 'dispatch-dead', pidGuard: { pid: 42, isAlive: () => false }, run });
  assert.strictEqual(res.removed, true);
  assert.ok(did(run, `worktree remove ${wtPath} --force`));
  assert.ok(did(run, 'branch -D dispatch-dead'));
});

test('safeRemove: no pidGuard never consults liveness; reaps an existing worktree', () => {
  const repo = tmp();
  const wtPath = path.join(repo, 'wt');
  fs.mkdirSync(wtPath, { recursive: true });
  const run = mockRun();
  const res = wt.safeRemove({ repo, path: wtPath, branch: 'b', run });
  assert.strictEqual(res.removed, true);
  assert.ok(did(run, `worktree remove ${wtPath} --force`));
});

test('safeRemove: requireExists (default) skips remove when the dir is gone', () => {
  const run = mockRun();
  const res = wt.safeRemove({ repo: '/r', path: '/r/gone', branch: 'b', run });
  assert.deepStrictEqual(res, { removed: false, skipped: false, missing: true });
  assert.strictEqual(run.calls.length, 0, 'no git runs when the worktree is already gone');
});

test('safeRemove: requireExists=false attempts remove and prunes even when the dir is gone', () => {
  const run = mockRun();
  const res = wt.safeRemove({ repo: '/r', path: '/r/gone', prune: true, requireExists: false, run });
  assert.ok(did(run, 'worktree remove /r/gone --force'), 'remove attempted unconditionally');
  assert.ok(did(run, 'worktree prune'), 'prune runs to clear a stale registration');
  assert.strictEqual(res.removed, true);
});

test('safeRemove: a failed remove returns a reason and skips branch -D', () => {
  const repo = tmp();
  const wtPath = path.join(repo, 'wt');
  fs.mkdirSync(wtPath, { recursive: true });
  const run = mockRun({ 'worktree remove': { status: 1, stdout: '', stderr: 'contains modified files' } });
  const res = wt.safeRemove({ repo, path: wtPath, branch: 'b', run });
  assert.strictEqual(res.removed, false);
  assert.match(res.reason, /contains modified files/);
  assert.ok(!did(run, 'branch -D'), 'never deletes the branch of a worktree we failed to remove');
});

test('safeRemove: prune=false (dispatch default) issues no prune', () => {
  const repo = tmp();
  const wtPath = path.join(repo, 'wt');
  fs.mkdirSync(wtPath, { recursive: true });
  const run = mockRun();
  wt.safeRemove({ repo, path: wtPath, branch: 'b', run });
  assert.ok(!did(run, 'worktree prune'), 'dispatch teardown must not add a prune call');
});

// ---- prune ----

test('prune: runs git worktree prune in the repo', () => {
  const run = mockRun();
  wt.prune({ repo: '/r', run });
  assert.ok(did(run, 'worktree prune'));
  assert.strictEqual(run.calls[0].cwd, '/r');
});

test('prune: best-effort — a throwing runner never propagates', () => {
  const run = () => { throw new Error('boom'); };
  assert.doesNotThrow(() => wt.prune({ repo: '/r', run }));
});
