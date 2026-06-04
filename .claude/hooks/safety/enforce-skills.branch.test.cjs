#!/usr/bin/env node

const assert = require('assert');
const enforce = require('./enforce-skills.cjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.stack}`); }
}

console.log('checkBranchShift');

test('returns ok when BRANCH_VERIFIED=1 in command', () => {
  const r = enforce.checkBranchShift('BRANCH_VERIFIED=1 git commit -m x', '/tmp', 'fake');
  assert.strictEqual(r.ok, true);
});

test('returns ok when no starting branch is recorded', () => {
  delete process.env.BRANCH_VERIFIED;
  const r = enforce.checkBranchShift('git commit', process.cwd(), 'nonexistent-session-id');
  assert.strictEqual(r.ok, true);
});

test('returns ok when BRANCH_VERIFIED env var set', () => {
  process.env.BRANCH_VERIFIED = '1';
  const r = enforce.checkBranchShift('git commit', '/tmp', 'fake');
  assert.strictEqual(r.ok, true);
  delete process.env.BRANCH_VERIFIED;
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
