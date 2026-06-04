#!/usr/bin/env node

const assert = require('assert');
const {
  matchesDeploy,
  isDispatchWorker,
  findForeignDirty,
} = require('./block-dirty-deploy.cjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.stack}`); }
}

console.log('matchesDeploy');

test('vercel deploy matches', () => assert.strictEqual(matchesDeploy('vercel deploy'), true));
test('vercel --prod matches', () => assert.strictEqual(matchesDeploy('vercel --prod'), true));
test('vercel bare matches', () => assert.strictEqual(matchesDeploy('vercel'), true));
test('netlify deploy matches', () => assert.strictEqual(matchesDeploy('netlify deploy'), true));
test('firebase deploy matches', () => assert.strictEqual(matchesDeploy('firebase deploy --only hosting'), true));
test('wrangler deploy matches', () => assert.strictEqual(matchesDeploy('wrangler deploy'), true));

test('vercel env list does NOT match', () => assert.strictEqual(matchesDeploy('vercel env list'), false));
test('vercel login does NOT match', () => assert.strictEqual(matchesDeploy('vercel login'), false));
test('vercel link does NOT match', () => assert.strictEqual(matchesDeploy('vercel link'), false));
test('vercel logs does NOT match', () => assert.strictEqual(matchesDeploy('vercel logs'), false));
test('vercel --version does NOT match', () => assert.strictEqual(matchesDeploy('vercel --version'), false));

test('npm install does not match', () => assert.strictEqual(matchesDeploy('npm install'), false));
test('echo deploy does not match', () => assert.strictEqual(matchesDeploy('echo deploy'), false));

console.log('isDispatchWorker');

test('dispatch worktree root matches', () =>
  assert.strictEqual(isDispatchWorker('/Users/x/repo/.claude/worktrees/dispatch-abc123def456'), true));
test('subdir inside a dispatch worktree matches', () =>
  assert.strictEqual(isDispatchWorker('/Users/x/repo/.claude/worktrees/dispatch-abc123def456/src/lib'), true));
test('main checkout does not match', () =>
  assert.strictEqual(isDispatchWorker('/Users/x/repo'), false));
test('session worktree does not match', () =>
  assert.strictEqual(isDispatchWorker('/Users/x/repo/.claude/worktrees/session-foo'), false));
test('non-worktree .claude path does not match', () =>
  assert.strictEqual(isDispatchWorker('/Users/x/repo/.claude/hooks'), false));
test('empty string does not match', () =>
  assert.strictEqual(isDispatchWorker(''), false));
test('undefined does not match', () =>
  assert.strictEqual(isDispatchWorker(undefined), false));

console.log('findForeignDirty');

test('returns files in dirty but not in edited', () => {
  const dirty = ['a.md', 'b.ts', 'c.tsx'];
  const edited = new Set(['a.md']);
  assert.deepStrictEqual(findForeignDirty(dirty, edited), ['b.ts', 'c.tsx']);
});

test('returns empty when all dirty files are edited', () => {
  const dirty = ['a.md'];
  const edited = new Set(['a.md', 'b.ts']);
  assert.deepStrictEqual(findForeignDirty(dirty, edited), []);
});

test('returns all dirty when edited is empty', () => {
  const dirty = ['a.md'];
  const edited = new Set();
  assert.deepStrictEqual(findForeignDirty(dirty, edited), ['a.md']);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
