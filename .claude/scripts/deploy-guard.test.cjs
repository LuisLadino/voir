#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { parseArgs, decide, refusalText } = require('./deploy-guard.cjs');
const GUARD = path.join(__dirname, 'deploy-guard.cjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.stack}`); }
}

// --- pure argument + decision logic ---

test('parseArgs defaults', () => {
  const o = parseArgs([]);
  assert.strictEqual(o.branch, 'main');
  assert.strictEqual(o.notify, false);
  assert.deepStrictEqual(o.command, []);
});

test('parseArgs reads branch, notify, and command after --', () => {
  const o = parseArgs(['--branch', 'production', '--notify', '--', './run.sh', '-x']);
  assert.strictEqual(o.branch, 'production');
  assert.strictEqual(o.notify, true);
  assert.deepStrictEqual(o.command, ['./run.sh', '-x']);
});

test('parseArgs throws on unknown flag', () => {
  assert.throws(() => parseArgs(['--bogus']));
});

test('decide maps verdict to action', () => {
  assert.strictEqual(decide({ runnable: true, fastForwardable: false }), 'run');
  assert.strictEqual(decide({ runnable: false, fastForwardable: true }), 'fast-forward');
  assert.strictEqual(decide({ runnable: false, fastForwardable: false }), 'refuse');
});

test('refusalText lists reasons and says it did not run', () => {
  const t = refusalText(['working tree has 3 uncommitted/untracked file(s)'], { branch: 'main', cwd: '/x' });
  assert.ok(t.includes('REFUSING'));
  assert.ok(t.includes('3 uncommitted/untracked'));
  assert.ok(t.includes('did NOT run'));
});

// --- end-to-end CLI against real temp repos ---

function run(cwd, ...args) {
  const r = spawnSync(args[0], args.slice(1), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) throw new Error(`${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function withGitRepo(fn) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dg-test-')));
  const origin = path.join(base, 'origin.git');
  const work = path.join(base, 'work');
  fs.mkdirSync(work, { recursive: true });
  try {
    run(base, 'git', 'init', '--bare', origin);
    run(work, 'git', 'init');
    run(work, 'git', 'config', 'user.email', 't@t.t');
    run(work, 'git', 'config', 'user.name', 'T');
    run(work, 'git', 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(work, 'README.md'), 'hi\n');
    run(work, 'git', 'add', '.');
    run(work, 'git', 'commit', '-m', 'init');
    run(work, 'git', 'branch', '-M', 'main');
    run(work, 'git', 'remote', 'add', 'origin', origin);
    run(work, 'git', 'push', '-u', 'origin', 'main');
    run(work, 'git', 'fetch', 'origin', 'main');
    fn(work, origin, base);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

function advanceOrigin(base, origin) {
  const other = path.join(base, 'other');
  run(base, 'git', 'clone', origin, other);
  run(other, 'git', 'config', 'user.email', 't@t.t');
  run(other, 'git', 'config', 'user.name', 'T');
  run(other, 'git', 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(other, 'new.txt'), 'more\n');
  run(other, 'git', 'add', '.');
  run(other, 'git', 'commit', '-m', 'advance');
  run(other, 'git', 'push', 'origin', 'main');
}

function guard(work, extraArgs) {
  return spawnSync('node', [GUARD, '--cwd', work, ...extraArgs], { encoding: 'utf8' });
}

const PRINT = ['node', '-e', 'process.stdout.write("RAN")'];

test('clean + current runs the wrapped command', () => {
  withGitRepo(work => {
    const r = guard(work, ['--branch', 'main', '--', ...PRINT]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('RAN'));
  });
});

test('clean + behind fast-forwards then runs', () => {
  withGitRepo((work, origin, base) => {
    advanceOrigin(base, origin);
    const r = guard(work, ['--branch', 'main', '--', ...PRINT]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('RAN'));
    const ab = run(work, 'git', 'rev-list', '--left-right', '--count', 'origin/main...HEAD').trim();
    assert.strictEqual(ab, '0\t0', 'expected tree fast-forwarded to current');
  });
});

test('dirty tree refuses and does NOT run the command', () => {
  withGitRepo(work => {
    fs.writeFileSync(path.join(work, 'scratch.txt'), 'wip\n');
    const r = guard(work, ['--branch', 'main', '--', ...PRINT]);
    assert.strictEqual(r.status, 1);
    assert.ok(!r.stdout.includes('RAN'), 'command must not run on refusal');
    assert.ok(r.stderr.includes('REFUSING'));
    assert.ok(r.stderr.includes('uncommitted/untracked'));
  });
});

test('check-only (no command) exits 0 when current', () => {
  withGitRepo(work => {
    const r = guard(work, ['--branch', 'main']);
    assert.strictEqual(r.status, 0, r.stderr);
  });
});

test('wrong branch refuses', () => {
  withGitRepo(work => {
    run(work, 'git', 'checkout', '-b', 'feature-x');
    const r = guard(work, ['--branch', 'main', '--', ...PRINT]);
    assert.strictEqual(r.status, 1);
    assert.ok(!r.stdout.includes('RAN'));
    assert.ok(r.stderr.includes('expected deploy branch main'));
  });
});

test('parseArgs throws on a flag missing its value', () => {
  assert.throws(() => parseArgs(['--branch']));
  assert.throws(() => parseArgs(['--cwd']));
});

test('parseArgs throws on an unsafe branch name', () => {
  assert.throws(() => parseArgs(['--branch', '-x']));
  assert.throws(() => parseArgs(['--branch', '--upload-pack=touch x']));
});

test('fetch failure refuses without running (currency unverifiable)', () => {
  withGitRepo(work => {
    run(work, 'git', 'remote', 'set-url', 'origin', '/nonexistent/repo.git');
    const r = guard(work, ['--branch', 'main', '--', ...PRINT]);
    assert.strictEqual(r.status, 1);
    assert.ok(!r.stdout.includes('RAN'));
    assert.ok(r.stderr.includes('could not fetch'));
  });
});

test('diverged tree refuses and does NOT run', () => {
  withGitRepo((work, origin, base) => {
    advanceOrigin(base, origin);
    fs.writeFileSync(path.join(work, 'local.txt'), 'x\n');
    run(work, 'git', 'add', '.');
    run(work, 'git', 'commit', '-m', 'local');
    const r = guard(work, ['--branch', 'main', '--', ...PRINT]);
    assert.strictEqual(r.status, 1);
    assert.ok(!r.stdout.includes('RAN'));
    assert.ok(r.stderr.includes('diverged'));
  });
});

test('parseArgs defaults remote-ref to origin/<branch> and accepts an explicit one', () => {
  assert.strictEqual(parseArgs([]).remoteRef, 'origin/main');
  assert.strictEqual(parseArgs(['--branch', 'deploy']).remoteRef, 'origin/deploy');
  assert.strictEqual(parseArgs(['--branch', 'deploy', '--remote-ref', 'origin/main']).remoteRef, 'origin/main');
  assert.throws(() => parseArgs(['--remote-ref', 'origin/--upload-pack=x']));
  assert.throws(() => parseArgs(['--remote-ref']));
});

test('#726: deploy branch tracking origin/main fast-forwards then runs via --remote-ref', () => {
  withGitRepo((work, origin, base) => {
    run(work, 'git', 'checkout', '-b', 'deploy', '--track', 'origin/main');
    advanceOrigin(base, origin);
    const r = guard(work, ['--branch', 'deploy', '--remote-ref', 'origin/main', '--', ...PRINT]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('RAN'));
    const ab = run(work, 'git', 'rev-list', '--left-right', '--count', 'origin/main...HEAD').trim();
    assert.strictEqual(ab, '0\t0', 'expected deploy branch fast-forwarded to origin/main');
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
