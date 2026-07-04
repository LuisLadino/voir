#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { findSpecFiles, matchGlob } = require('./spec-discovery.cjs');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}\n       ${err.stack || err.message}`);
  }
}

console.log('spec-discovery: matchGlob');

test('extension glob matches at any depth', () => {
  assert.strictEqual(matchGlob('src/foo.tsx', '**/*.tsx'), true);
  assert.strictEqual(matchGlob('src/foo.css', '**/*.tsx'), false);
});

test('bare filename matches at any depth', () => {
  assert.strictEqual(matchGlob('a/b/c/file.md', '*.md'), true);
  assert.strictEqual(matchGlob('file.md', '*.md'), true);
});

test('directory glob respects boundaries', () => {
  assert.strictEqual(matchGlob('.claude/hooks/safety/x.cjs', '.claude/hooks/**/*.cjs'), true);
  assert.strictEqual(matchGlob('scripts/x.cjs', '.claude/hooks/**/*.cjs'), false);
});

test('worktree-prefixed paths resolve via .claude root rewrite', () => {
  const fp = 'whatever/path/.claude/hooks/foo.cjs';
  assert.strictEqual(matchGlob(fp, '.claude/hooks/**/*.cjs'), true);
});

test('collapsing consecutive globstars preserves semantics', () => {
  assert.strictEqual(matchGlob('a/b/c.md', '**/**/*.md'), true);
  assert.strictEqual(matchGlob('a/b/c.md', '**/*.md'), true);
  assert.strictEqual(matchGlob('c.md', '**/**/*.md'), true);
  assert.strictEqual(matchGlob('a/b/c.css', '**/**/*.md'), false);
});

test('pathological globstar run resolves fast (ReDoS guard #805)', () => {
  const evil = '**/'.repeat(40) + 'x';
  const target = 'a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p';
  const start = Date.now();
  const result = matchGlob(target, evil);
  const ms = Date.now() - start;
  assert.strictEqual(result, false);
  assert.ok(ms < 500, `matchGlob took ${ms}ms — collapse should make it near-instant`);
});

test('excessive non-consecutive globstars fail safe (no match, no hang)', () => {
  const tooMany = 'a/**/b/**/c/**/d/**/e/**/f/**/g/**/h.md'; // 7 globstars > MAX_GLOBSTARS
  assert.strictEqual(matchGlob('a/x/b/y/c/z/d/w/e/v/f/u/g/t/h.md', tooMany), false);
});

console.log('\nspec-discovery: findSpecFiles');

test('walks nested directories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-disc-'));
  fs.mkdirSync(path.join(root, 'kit'), { recursive: true });
  fs.writeFileSync(path.join(root, 'kit', 'one.md'), '');
  fs.writeFileSync(path.join(root, 'two.yaml'), '');
  const found = findSpecFiles(root);
  assert.strictEqual(found.length, 2);
  fs.rmSync(root, { recursive: true });
});

test('skips README.md and stack-config.yaml', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-disc-'));
  fs.writeFileSync(path.join(root, 'README.md'), '');
  fs.writeFileSync(path.join(root, 'stack-config.yaml'), '');
  fs.writeFileSync(path.join(root, 'real.md'), '');
  const found = findSpecFiles(root);
  assert.strictEqual(found.length, 1);
  assert.ok(found[0].endsWith('real.md'));
  fs.rmSync(root, { recursive: true });
});

test('non-existent directory returns empty', () => {
  assert.deepStrictEqual(findSpecFiles('/no/such/path'), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
