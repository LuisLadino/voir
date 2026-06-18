#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { run, evaluate, warningText, deployBranchName, remoteRefName } = require('./deploy-drift-warning.cjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.stack}`); }
}

function sh(cwd, ...args) {
  const r = spawnSync(args[0], args.slice(1), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) throw new Error(`${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function withGitRepo(fn) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ddw-test-')));
  const origin = path.join(base, 'origin.git');
  const work = path.join(base, 'work');
  fs.mkdirSync(path.join(work, '.claude'), { recursive: true });
  try {
    sh(base, 'git', 'init', '--bare', origin);
    sh(work, 'git', 'init');
    sh(work, 'git', 'config', 'user.email', 't@t.t');
    sh(work, 'git', 'config', 'user.name', 'T');
    sh(work, 'git', 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(work, 'README.md'), 'hi\n');
    sh(work, 'git', 'add', '.');
    sh(work, 'git', 'commit', '-m', 'init');
    sh(work, 'git', 'branch', '-M', 'main');
    sh(work, 'git', 'remote', 'add', 'origin', origin);
    sh(work, 'git', 'push', '-u', 'origin', 'main');
    sh(work, 'git', 'fetch', 'origin', 'main');
    fn(work, origin, base);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

test('warningText surfaces drift, the guard, and the silence hint', () => {
  const t = warningText({ deployBranch: 'main', dirty: true, dirtyFiles: ['a', 'b'], behind: 3, ahead: 0, diverged: false });
  assert.ok(t.includes('DEPLOY WORKTREE DRIFT'));
  assert.ok(t.includes('2 uncommitted/untracked'));
  assert.ok(t.includes('deploy-guard.cjs'));
  assert.ok(t.includes('CLAUDE_KIT_NO_DEPLOY_DRIFT_WARN=1'));
});

test('evaluate is silent on a clean current deploy branch', () => {
  withGitRepo(work => {
    assert.strictEqual(evaluate(work, 'main'), null);
  });
});

test('evaluate warns on a dirty deploy branch', () => {
  withGitRepo(work => {
    fs.writeFileSync(path.join(work, 'scratch.txt'), 'wip\n');
    const v = evaluate(work, 'main');
    assert.ok(v);
    assert.strictEqual(v.dirty, true);
  });
});

test('evaluate is silent on a feature branch even when dirty', () => {
  withGitRepo(work => {
    sh(work, 'git', 'checkout', '-b', 'feature-x');
    fs.writeFileSync(path.join(work, 'scratch.txt'), 'wip\n');
    assert.strictEqual(evaluate(work, 'main'), null);
  });
});

test('evaluate warns when behind after origin advances', () => {
  withGitRepo((work, origin, base) => {
    const other = path.join(base, 'other');
    sh(base, 'git', 'clone', origin, other);
    sh(other, 'git', 'config', 'user.email', 't@t.t');
    sh(other, 'git', 'config', 'user.name', 'T');
    sh(other, 'git', 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(other, 'new.txt'), 'more\n');
    sh(other, 'git', 'add', '.');
    sh(other, 'git', 'commit', '-m', 'advance');
    sh(other, 'git', 'push', 'origin', 'main');
    sh(work, 'git', 'fetch', 'origin', 'main');
    const v = evaluate(work, 'main');
    assert.ok(v);
    assert.strictEqual(v.behind, 1);
  });
});

test('run is silenced by CLAUDE_KIT_NO_DEPLOY_DRIFT_WARN', () => {
  const prev = process.env.CLAUDE_KIT_NO_DEPLOY_DRIFT_WARN;
  process.env.CLAUDE_KIT_NO_DEPLOY_DRIFT_WARN = '1';
  try {
    assert.strictEqual(run().state, 'silenced');
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_KIT_NO_DEPLOY_DRIFT_WARN;
    else process.env.CLAUDE_KIT_NO_DEPLOY_DRIFT_WARN = prev;
  }
});

test('run is a no-op outside a framework checkout', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ddw-nf-')));
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    assert.strictEqual(run().state, 'not-framework');
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('run reports drift on a dirty deploy worktree', () => {
  withGitRepo(work => {
    fs.writeFileSync(path.join(work, 'scratch.txt'), 'wip\n');
    const cwd = process.cwd();
    const origWrite = process.stdout.write;
    process.stdout.write = () => true; // swallow the injected warning
    try {
      process.chdir(work);
      const r = run();
      assert.strictEqual(r.state, 'drift');
      assert.strictEqual(r.dirty, true);
    } finally {
      process.stdout.write = origWrite;
      process.chdir(cwd);
    }
  });
});

test('deployBranchName uses a safe env override, ignores an unsafe one', () => {
  const prev = process.env.CLAUDE_KIT_DEPLOY_BRANCH;
  try {
    delete process.env.CLAUDE_KIT_DEPLOY_BRANCH;
    assert.strictEqual(deployBranchName(), 'main');
    process.env.CLAUDE_KIT_DEPLOY_BRANCH = 'production';
    assert.strictEqual(deployBranchName(), 'production');
    process.env.CLAUDE_KIT_DEPLOY_BRANCH = '--upload-pack=touch x';
    assert.strictEqual(deployBranchName(), 'main');
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_KIT_DEPLOY_BRANCH;
    else process.env.CLAUDE_KIT_DEPLOY_BRANCH = prev;
  }
});

test('remoteRefName uses a safe env override, else defaults to origin/<branch>', () => {
  const prev = process.env.CLAUDE_KIT_DEPLOY_REMOTE_REF;
  try {
    delete process.env.CLAUDE_KIT_DEPLOY_REMOTE_REF;
    assert.strictEqual(remoteRefName('deploy'), 'origin/deploy');
    process.env.CLAUDE_KIT_DEPLOY_REMOTE_REF = 'origin/main';
    assert.strictEqual(remoteRefName('deploy'), 'origin/main');
    process.env.CLAUDE_KIT_DEPLOY_REMOTE_REF = 'origin/--upload-pack=x';
    assert.strictEqual(remoteRefName('deploy'), 'origin/deploy');
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_KIT_DEPLOY_REMOTE_REF;
    else process.env.CLAUDE_KIT_DEPLOY_REMOTE_REF = prev;
  }
});

test('#726: warningText shows --remote-ref only when the ref is non-default', () => {
  const decoupled = warningText({ deployBranch: 'deploy', remoteRef: 'origin/main', dirty: true, dirtyFiles: ['a'], behind: 0, ahead: 0, diverged: false });
  assert.ok(decoupled.includes('--branch deploy --remote-ref origin/main'));
  const plain = warningText({ deployBranch: 'main', remoteRef: 'origin/main', dirty: true, dirtyFiles: ['a'], behind: 0, ahead: 0, diverged: false });
  assert.ok(plain.includes('--branch main'));
  assert.ok(!plain.includes('--remote-ref'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
