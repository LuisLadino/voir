#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  parseArgs,
  worktreeNameFromBranch,
  detectInstallCommand,
  readWorktreeConfig,
  WORKTREES_DIR_REL,
  SESSION_PREFIX,
} = require('./worktree.cjs');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error('       ' + (e.stack || e.message).replace(/\n/g, '\n       '));
  }
}

function withTempRepo(fn) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-test-')));
  spawnSync('git', ['init', '--initial-branch=main'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@test'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# test');
  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['commit', '-m', 'init'], { cwd: dir });
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

console.log('parseArgs');

test('no args returns help', () => {
  assert.strictEqual(parseArgs([]).mode, 'help');
});

test('list alone returns list mode', () => {
  assert.strictEqual(parseArgs(['list']).mode, 'list');
});

test('remove without name returns remove with undefined name', () => {
  const r = parseArgs(['remove']);
  assert.strictEqual(r.mode, 'remove');
  assert.strictEqual(r.name, undefined);
});

test('create branch returns create mode with branch', () => {
  const r = parseArgs(['create', 'feature/x']);
  assert.strictEqual(r.mode, 'create');
  assert.strictEqual(r.opts.branch, 'feature/x');
  assert.strictEqual(r.opts.install, true);
});

test('bare branch without create still defaults to create', () => {
  const r = parseArgs(['feature/x']);
  assert.strictEqual(r.mode, 'create');
  assert.strictEqual(r.opts.branch, 'feature/x');
});

test('create with --no-install', () => {
  const r = parseArgs(['create', 'foo', '--no-install']);
  assert.strictEqual(r.opts.install, false);
});

test('create with --from ref', () => {
  const r = parseArgs(['create', 'foo', '--from', 'origin/dev']);
  assert.strictEqual(r.opts.fromRef, 'origin/dev');
});

test('--from without ref returns error', () => {
  const r = parseArgs(['create', 'foo', '--from']);
  assert.strictEqual(r.mode, 'error');
});

test('unknown flag returns error', () => {
  const r = parseArgs(['create', 'foo', '--bogus']);
  assert.strictEqual(r.mode, 'error');
});

console.log('worktreeNameFromBranch');

test('strips slashes from branch name', () => {
  assert.strictEqual(worktreeNameFromBranch('feature/foo'), 'session-feature-foo');
});

test('numeric issue becomes session-N', () => {
  assert.strictEqual(worktreeNameFromBranch('451'), 'session-451');
});

test('strips trailing dashes from sanitization', () => {
  assert.strictEqual(worktreeNameFromBranch('fix///bug///'), 'session-fix-bug');
});

test('empty result after sanitization throws', () => {
  assert.throws(() => worktreeNameFromBranch('////'));
});

console.log('detectInstallCommand');

test('reads worktree.install_command from stack-config.yaml', () => {
  withTempRepo((dir) => {
    fs.mkdirSync(path.join(dir, '.claude/specs'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude/specs/stack-config.yaml'),
      'name: test\nworktree:\n  install_command: "pnpm install"\n');
    assert.strictEqual(detectInstallCommand(dir), 'pnpm install');
  });
});

test('falls back to npm ci on package-lock.json', () => {
  withTempRepo((dir) => {
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
    assert.strictEqual(detectInstallCommand(dir), 'npm ci');
  });
});

test('falls back to pnpm on pnpm-lock.yaml', () => {
  withTempRepo((dir) => {
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 6\n');
    assert.strictEqual(detectInstallCommand(dir), 'pnpm install --frozen-lockfile');
  });
});

test('returns null when no lockfile and no config', () => {
  withTempRepo((dir) => {
    assert.strictEqual(detectInstallCommand(dir), null);
  });
});

console.log('readWorktreeConfig');

test('merges dispatch.context_dirs and worktree.context_dirs, dedup', () => {
  withTempRepo((dir) => {
    fs.mkdirSync(path.join(dir, '.claude/specs'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude/specs/stack-config.yaml'),
      'dispatch:\n  context_dirs:\n    - .vercel\nworktree:\n  context_dirs:\n    - .vercel\n    - .next\n');
    const cfg = readWorktreeConfig(dir);
    assert.deepStrictEqual(cfg.context_dirs.sort(), ['.next', '.vercel']);
  });
});

test('returns dispatch config when worktree block absent', () => {
  withTempRepo((dir) => {
    fs.mkdirSync(path.join(dir, '.claude/specs'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude/specs/stack-config.yaml'),
      'dispatch:\n  context_dirs:\n    - .vercel\n');
    const cfg = readWorktreeConfig(dir);
    assert.deepStrictEqual(cfg.context_dirs, ['.vercel']);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
