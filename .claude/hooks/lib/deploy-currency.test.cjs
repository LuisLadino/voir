#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  classify,
  gitFacts,
  fetchDeploy,
  isSafeBranch,
  isSafeRemoteRef,
  parseRemoteRef,
} = require('./deploy-currency.cjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.stack}`); }
}

// --- pure classify matrix (no git) ---

function facts(over = {}) {
  return {
    isGit: true,
    deployBranch: 'main',
    branch: 'main',
    hasOriginRef: true,
    dirtyFiles: [],
    behind: 0,
    ahead: 0,
    aheadBehindKnown: true,
    ...over,
  };
}

test('not a git repo is not applicable and not runnable', () => {
  const v = classify({ isGit: false, deployBranch: 'main', branch: null, hasOriginRef: false, dirtyFiles: [], behind: 0, ahead: 0 });
  assert.strictEqual(v.applicable, false);
  assert.strictEqual(v.runnable, false);
  assert.strictEqual(v.fastForwardable, false);
  assert.ok(v.reasons.includes('not a git repository'));
});

test('clean and current on deploy branch is runnable', () => {
  const v = classify(facts());
  assert.strictEqual(v.runnable, true);
  assert.strictEqual(v.fastForwardable, false);
  assert.strictEqual(v.current, true);
  assert.deepStrictEqual(v.reasons, []);
});

test('behind only, clean, on branch is fast-forwardable not runnable', () => {
  const v = classify(facts({ behind: 14 }));
  assert.strictEqual(v.fastForwardable, true);
  assert.strictEqual(v.runnable, false);
  assert.ok(v.reasons.some(r => r.includes('behind origin/main by 14')));
});

test('diverged cannot fast-forward', () => {
  const v = classify(facts({ behind: 3, ahead: 2 }));
  assert.strictEqual(v.diverged, true);
  assert.strictEqual(v.fastForwardable, false);
  assert.strictEqual(v.runnable, false);
  assert.ok(v.reasons.some(r => r.includes('diverged')));
});

test('ahead only is surfaced and not runnable', () => {
  const v = classify(facts({ ahead: 2 }));
  assert.strictEqual(v.runnable, false);
  assert.strictEqual(v.fastForwardable, false);
  assert.ok(v.reasons.some(r => r.includes('ahead of origin/main by 2')));
});

test('dirty blocks runnable and fast-forward even when behind', () => {
  const v = classify(facts({ dirtyFiles: ['a.txt', 'b.txt'], behind: 5 }));
  assert.strictEqual(v.dirty, true);
  assert.strictEqual(v.runnable, false);
  assert.strictEqual(v.fastForwardable, false);
  assert.ok(v.reasons.some(r => r.includes('2 uncommitted/untracked')));
  assert.ok(v.reasons.some(r => r.includes('behind origin/main by 5')));
});

test('detached HEAD is reported', () => {
  const v = classify(facts({ branch: null }));
  assert.strictEqual(v.detached, true);
  assert.strictEqual(v.onDeployBranch, false);
  assert.strictEqual(v.runnable, false);
  assert.ok(v.reasons.some(r => r.includes('detached')));
});

test('wrong branch is reported', () => {
  const v = classify(facts({ branch: 'feature-x' }));
  assert.strictEqual(v.onDeployBranch, false);
  assert.strictEqual(v.runnable, false);
  assert.ok(v.reasons.some(r => r.includes('on branch feature-x')));
});

test('missing origin ref requires a fetch', () => {
  const v = classify(facts({ hasOriginRef: false }));
  assert.strictEqual(v.runnable, false);
  assert.strictEqual(v.fastForwardable, false);
  assert.ok(v.reasons.some(r => r.includes('origin/main not found')));
});

test('respects a non-main deploy branch', () => {
  const v = classify(facts({ deployBranch: 'production', branch: 'production' }));
  assert.strictEqual(v.onDeployBranch, true);
  assert.strictEqual(v.runnable, true);
});

test('unverifiable ahead/behind (rev-list failed) is not runnable — fail-safe', () => {
  const v = classify(facts({ aheadBehindKnown: false }));
  assert.strictEqual(v.aheadBehindUnknown, true);
  assert.strictEqual(v.runnable, false);
  assert.strictEqual(v.fastForwardable, false);
  assert.ok(v.reasons.some(r => r.includes('could not compute ahead/behind')));
});

test('isSafeBranch accepts plain refs and rejects option-like or empty names', () => {
  for (const ok of ['main', 'master', 'production', 'release/1.2', 'feature_x', 'v2.0']) {
    assert.strictEqual(isSafeBranch(ok), true, `expected ${ok} safe`);
  }
  for (const bad of ['--upload-pack=touch x', '-x', '', '..', 'a b', 'a;b', '$(x)', null, undefined]) {
    assert.strictEqual(isSafeBranch(bad), false, `expected ${JSON.stringify(bad)} unsafe`);
  }
});

test('fetchDeploy refuses an unsafe or malformed remote ref without invoking git', () => {
  const injected = fetchDeploy('/nonexistent', 'origin/--upload-pack=touch /tmp/pwned');
  assert.strictEqual(injected.ok, false);
  assert.strictEqual(injected.reason, 'unsafe remote ref');
  const noslash = fetchDeploy('/nonexistent', 'main'); // a bare branch is not a remote ref
  assert.strictEqual(noslash.ok, false);
  assert.strictEqual(noslash.reason, 'unsafe remote ref');
});

test('parseRemoteRef splits on the first slash; isSafeRemoteRef validates both parts', () => {
  assert.deepStrictEqual(parseRemoteRef('origin/main'), { remote: 'origin', branch: 'main' });
  assert.deepStrictEqual(parseRemoteRef('origin/release/1.2'), { remote: 'origin', branch: 'release/1.2' });
  assert.strictEqual(parseRemoteRef('main'), null);
  assert.strictEqual(isSafeRemoteRef('origin/main'), true);
  assert.strictEqual(isSafeRemoteRef('origin/release/1.2'), true);
  assert.strictEqual(isSafeRemoteRef('-x/main'), false);
  assert.strictEqual(isSafeRemoteRef('origin/--upload-pack=x'), false);
  assert.strictEqual(isSafeRemoteRef('main'), false);
});

test('#726: a deploy branch tracking a decoupled remote ref is runnable when current', () => {
  // local branch "deploy" (not "main"), tracking origin/main, clean and current
  const v = classify(facts({ deployBranch: 'deploy', branch: 'deploy', remoteRef: 'origin/main' }));
  assert.strictEqual(v.onDeployBranch, true, `reasons: ${v.reasons.join('; ')}`);
  assert.strictEqual(v.runnable, true);
  assert.strictEqual(v.remoteRef, 'origin/main');
});

test('#726: a deploy branch behind its decoupled remote ref is fast-forwardable', () => {
  const v = classify(facts({ deployBranch: 'deploy', branch: 'deploy', remoteRef: 'origin/main', behind: 3 }));
  assert.strictEqual(v.fastForwardable, true);
  assert.ok(v.reasons.some(r => r.includes('behind origin/main by 3')));
});

// --- git IO integration (real temp repo + bare origin) ---

function run(cwd, ...args) {
  const r = spawnSync(args[0], args.slice(1), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) throw new Error(`${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function withGitRepo(fn) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dc-test-')));
  const origin = path.join(base, 'origin.git');
  const work = path.join(base, 'work');
  fs.mkdirSync(work, { recursive: true });
  try {
    run(base, 'git', 'init', '--bare', '-b', 'main', origin);
    run(work, 'git', 'init', '-b', 'main');
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
    fn(work, origin);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

test('gitFacts on a clean current repo classifies runnable', () => {
  withGitRepo(work => {
    const v = classify(gitFacts(work, 'main'));
    assert.strictEqual(v.applicable, true);
    assert.strictEqual(v.branch, 'main');
    assert.strictEqual(v.hasOriginRef, true);
    assert.strictEqual(v.runnable, true, `reasons: ${v.reasons.join('; ')}`);
  });
});

test('gitFacts detects a dirty working tree', () => {
  withGitRepo(work => {
    fs.writeFileSync(path.join(work, 'scratch.txt'), 'wip\n');
    const v = classify(gitFacts(work, 'main'));
    assert.strictEqual(v.dirty, true);
    assert.strictEqual(v.runnable, false);
    assert.ok(v.dirtyFiles.includes('scratch.txt'));
  });
});

test('gitFacts detects behind after origin advances', () => {
  withGitRepo((work, origin) => {
    // Second clone advances origin, then the first repo is behind without a local merge.
    const base = path.dirname(origin);
    const other = path.join(base, 'other');
    run(base, 'git', 'clone', origin, other);
    run(other, 'git', 'config', 'user.email', 't@t.t');
    run(other, 'git', 'config', 'user.name', 'T');
    run(other, 'git', 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(other, 'new.txt'), 'more\n');
    run(other, 'git', 'add', '.');
    run(other, 'git', 'commit', '-m', 'advance');
    run(other, 'git', 'push', 'origin', 'main');

    const before = classify(gitFacts(work, 'main'));
    assert.strictEqual(before.behind, 0, 'no fetch yet, still looks current');

    const f = fetchDeploy(work, 'origin/main');
    assert.strictEqual(f.ok, true, `fetch failed: ${f.reason}`);

    const after = classify(gitFacts(work, 'main'));
    assert.strictEqual(after.behind, 1);
    assert.strictEqual(after.fastForwardable, true);
    assert.strictEqual(after.runnable, false);
  });
});

test('#726 integration: a worktree on a deploy branch tracking origin/main classifies runnable', () => {
  withGitRepo(work => {
    // simulate the #726 topology: move off main onto a `deploy` branch that
    // tracks origin/main, exactly what `git worktree add -b deploy <p> origin/main` yields
    run(work, 'git', 'checkout', '-b', 'deploy', '--track', 'origin/main');
    const v = classify(gitFacts(work, 'deploy', 'origin/main'));
    assert.strictEqual(v.branch, 'deploy');
    assert.strictEqual(v.onDeployBranch, true, `reasons: ${v.reasons.join('; ')}`);
    assert.strictEqual(v.runnable, true);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
