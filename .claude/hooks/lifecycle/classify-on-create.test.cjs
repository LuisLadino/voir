#!/usr/bin/env node

/**
 * Tests for classify-on-create.cjs (#735).
 * Run: node .claude/hooks/lifecycle/classify-on-create.test.cjs
 */

const assert = require('assert');
const H = require('./classify-on-create.cjs');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}\n  ${e.message}`); }
}

const CONFIG = {
  workstreams: [
    { slug: 'workflow', name: 'Workflow', keywords: ['skill', 'hook', 'dispatch'] },
    { slug: 'safety', name: 'Safety', keywords: ['safety', 'block'] },
  ],
};

// ── pure detectors ──
test('isGhIssueCreate matches at command position', () => {
  assert.strictEqual(H.isGhIssueCreate('gh issue create --title x'), true);
  assert.strictEqual(H.isGhIssueCreate('SKILL_ACTIVE=1 gh issue create --title x'), true);
});

test('isGhIssueCreate ignores the phrase inside a quoted arg', () => {
  assert.strictEqual(H.isGhIssueCreate('echo "gh issue create"'), false);
});

test('commandSetsWorkstream detects an existing lane label', () => {
  assert.strictEqual(H.commandSetsWorkstream('gh issue create --label "workstream/safety"'), true);
  assert.strictEqual(H.commandSetsWorkstream('gh issue create --label "type/bug"'), false);
});

test('extractIssueNumbers pulls all issue numbers from output', () => {
  assert.deepStrictEqual(
    H.extractIssueNumbers('https://github.com/o/r/issues/42'),
    [42]
  );
  assert.deepStrictEqual(
    H.extractIssueNumbers('.../issues/1\n.../issues/2'),
    [1, 2]
  );
  assert.deepStrictEqual(H.extractIssueNumbers(''), []);
});

// ── decide() ──
function classifyConfident(slug) {
  return () => ({ slug, confident: true });
}
const classifyNone = () => ({ slug: null, confident: false });

test('decide acts on a confident single-create with no existing lane', () => {
  const r = H.decide({
    command: 'gh issue create --title "new hook"',
    stdout: 'https://github.com/o/r/issues/77',
    config: CONFIG,
    classifyText: classifyConfident('workflow'),
  });
  assert.deepStrictEqual(r, { act: true, number: 77, slug: 'workflow' });
});

test('decide skips when command already set a workstream label', () => {
  const r = H.decide({
    command: 'gh issue create --title x --label "workstream/safety"',
    stdout: '.../issues/5',
    config: CONFIG,
    classifyText: classifyConfident('workflow'),
  });
  assert.strictEqual(r.act, false);
});

test('decide skips when classification is not confident', () => {
  const r = H.decide({
    command: 'gh issue create --title x',
    stdout: '.../issues/5',
    config: CONFIG,
    classifyText: classifyNone,
  });
  assert.strictEqual(r.act, false);
});

test('decide skips multi-create output (leaves it for the sweep)', () => {
  const r = H.decide({
    command: 'gh issue create -t a && gh issue create -t b',
    stdout: '.../issues/1\n.../issues/2',
    config: CONFIG,
    classifyText: classifyConfident('workflow'),
  });
  assert.strictEqual(r.act, false);
});

test('decide skips when no board config', () => {
  const r = H.decide({
    command: 'gh issue create --title x',
    stdout: '.../issues/5',
    config: null,
    classifyText: classifyConfident('workflow'),
  });
  assert.strictEqual(r.act, false);
});

test('decide skips when not a gh issue create', () => {
  const r = H.decide({
    command: 'gh pr create',
    stdout: '.../issues/5',
    config: CONFIG,
    classifyText: classifyConfident('workflow'),
  });
  assert.strictEqual(r.act, false);
});

// ── handleHook end-to-end with injected IO ──
test('handleHook applies the workstream label via gh issue edit', () => {
  const calls = [];
  H.handleHook(
    {
      tool_input: { command: 'gh issue create --title "add a dispatch hook"' },
      tool_response: { stdout: 'https://github.com/o/r/issues/123' },
    },
    {
      run: (cmd) => { calls.push(cmd); return ''; },
      readConfig: () => CONFIG,
      fetchIssueText: () => ({ title: 'add a dispatch hook', body: '' }),
      classifyByHeuristic: () => ({ slug: 'workflow', confident: true }),
    }
  );
  const edit = calls.find(c => c.includes('gh issue edit'));
  assert.ok(edit, 'should have run gh issue edit');
  assert.ok(edit.includes('123') && edit.includes('workstream/workflow'), edit);
});

test('handleHook does nothing when no board', () => {
  let ran = false;
  H.handleHook(
    { tool_input: { command: 'gh issue create -t x' }, tool_response: { stdout: '.../issues/1' } },
    { run: () => { ran = true; return ''; }, readConfig: () => null }
  );
  assert.strictEqual(ran, false);
});

console.log(`\n${'='.repeat(48)}`);
if (fail > 0) { console.error(`FAILED — ${fail} of ${pass + fail} assertions failed.`); process.exit(1); }
console.log(`PASSED — all ${pass} assertions green.`);
process.exit(0);
