#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');
const { isCommitCommand } = require('./enforce-skills.cjs');

const HOOK = path.join(__dirname, 'enforce-skills.cjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.stack}`); }
}

test('isCommitCommand true for a real commit at a command position', () => {
  for (const c of [
    'git commit -m x',
    'git add . && git commit -m wip',
    'SKILL_ACTIVE=1 DOCS_CHECKED=1 git commit -m x',
    'x=$(git commit -m x)',
  ]) assert.strictEqual(isCommitCommand(c), true, c);
});

test('isCommitCommand false when git commit only appears in an argument (#642)', () => {
  for (const c of [
    "node -e 'process.exit(0); /* git commit -m x */'",
    'echo "git commit"',
    'grep "git commit" CHANGELOG.md',
    'echo "(git commit) is the fix"',
  ]) assert.strictEqual(isCommitCommand(c), false, c);
});

function runHook(input) {
  try {
    execFileSync('node', [HOOK], { input: JSON.stringify(input), stdio: ['pipe', 'pipe', 'pipe'] });
    return 0;
  } catch (e) { return e.status; }
}

test('integration: a substring-in-argument command is NOT blocked (exit 0)', () => {
  assert.strictEqual(
    runHook({ tool_input: { command: 'grep "git commit" CHANGELOG.md' } }),
    0
  );
});

test('integration: a real git commit is blocked with WORKFLOW REQUIRED (exit 2)', () => {
  assert.strictEqual(
    runHook({ tool_input: { command: 'git commit -m "x"' } }),
    2
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
