#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');
const { isPlanCommand } = require('./enforce-plan.cjs');

const HOOK = path.join(__dirname, 'enforce-plan.cjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.stack}`); }
}

// The literal phrase is split so reading/grepping THIS file does not trip the
// enforce-plan matcher (mirrors enforcement.test.cjs).
const REAL = 'gh ' + 'issue ' + 'create --title x';
const QUOTED = 'grep "gh ' + 'issue ' + 'create" notes.md';

test('isPlanCommand true for a real issue-create command', () => {
  assert.strictEqual(isPlanCommand(REAL), true);
  assert.strictEqual(isPlanCommand('foo && ' + REAL), true);
});

test('isPlanCommand false when the phrase is in an argument (#642)', () => {
  assert.strictEqual(isPlanCommand(QUOTED), false);
  assert.strictEqual(isPlanCommand('echo "remember to ' + REAL + '"'), false);
});

function runHook(input) {
  try {
    execFileSync('node', [HOOK], { input: JSON.stringify(input), stdio: ['pipe', 'pipe', 'pipe'] });
    return 0;
  } catch (e) { return e.status; }
}

test('integration: a substring-in-argument command is NOT blocked (exit 0)', () => {
  assert.strictEqual(runHook({ tool_input: { command: QUOTED } }), 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
