#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, 'spawn-context-agent.cjs');

let pass = 0;
let fail = 0;

function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) {
    fail++;
    console.error(`  FAIL ${name}`);
    console.error('       ' + (e.stack || e.message).replace(/\n/g, '\n       '));
  }
}

function run(extraEnv) {
  const env = { ...process.env };
  delete env.CLAUDE_SKILL_GATE_WALK;
  Object.assign(env, extraEnv || {});
  return spawnSync('node', [HOOK], { input: '{}', encoding: 'utf8', env });
}

console.log('spawn-context-agent');

test('emits the spawn-context-agent instruction by default', () => {
  const r = run();
  assert.match(r.stdout, /You MUST proactively spawn the context agent/);
});

test('suppressed during a skill-gate walk (CLAUDE_SKILL_GATE_WALK set)', () => {
  // A trigger walk must not inherit this dominant instruction; it would hijack
  // the one-shot `claude -p` turn and the skill phrase would never route.
  const r = run({ CLAUDE_SKILL_GATE_WALK: '1' });
  assert.strictEqual(r.stdout.trim(), '');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
