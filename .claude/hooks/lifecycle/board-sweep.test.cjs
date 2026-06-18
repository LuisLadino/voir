#!/usr/bin/env node

/**
 * Tests for board-sweep.cjs (#735).
 * Run: node .claude/hooks/lifecycle/board-sweep.test.cjs
 */

const assert = require('assert');
const S = require('./board-sweep.cjs');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}\n  ${e.message}`); }
}

const WS = [
  { slug: 'workflow', name: 'Workflow', keywords: ['skill', 'hook', 'dispatch'] },
  { slug: 'safety', name: 'Safety', keywords: ['safety', 'block'] },
];

// ── selectUnlaned ──
test('selectUnlaned returns only lane-less issues with suggestions', () => {
  const issues = [
    { number: 1, title: 'add a dispatch hook', labels: ['type/feature'] },     // unlaned, suggest workflow
    { number: 2, title: 'fix readme', labels: ['workstream/safety'] },         // laned → excluded
    { number: 3, title: 'rename a thing', labels: [] },                        // unlaned, no confident guess
  ];
  const out = S.selectUnlaned(issues, WS);
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out[0], { number: 1, title: 'add a dispatch hook', suggestion: 'workflow' });
  assert.strictEqual(out[1].suggestion, null);
});

test('selectUnlaned empty when all laned', () => {
  const issues = [{ number: 1, title: 'x', labels: ['workstream/workflow'] }];
  assert.deepStrictEqual(S.selectUnlaned(issues, WS), []);
});

// ── formatReport ──
test('formatReport empty for no unlaned', () => {
  assert.strictEqual(S.formatReport([]), '');
});

test('formatReport lists issues with hints and a triage prompt', () => {
  const r = S.formatReport([
    { number: 1, title: 'a', suggestion: 'workflow' },
    { number: 2, title: 'b', suggestion: null },
  ]);
  assert.ok(r.includes('#1: a  (suggest: workflow)'));
  assert.ok(r.includes('#2: b  (needs a lane)'));
  assert.ok(r.includes('/board'));
});

test('formatReport caps the list and notes the overflow', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ number: i + 1, title: `t${i}`, suggestion: null }));
  const r = S.formatReport(many, { max: 8 });
  assert.ok(r.includes('…and 4 more.'));
});

// ── handleHook ──
test('handleHook silent when no board', () => {
  let logged = false;
  S.handleHook({}, {
    run: () => 'true',
    readConfig: () => null,
    log: () => { logged = true; },
  });
  assert.strictEqual(logged, false);
});

test('handleHook silent when not a git repo', () => {
  let logged = false;
  S.handleHook({}, {
    run: () => 'false', // git rev-parse → not a repo
    readConfig: () => ({ workstreams: WS }),
    log: () => { logged = true; },
  });
  assert.strictEqual(logged, false);
});

test('handleHook reports unlaned issues', () => {
  let out = '';
  S.handleHook({}, {
    run: () => 'true',
    readConfig: () => ({ workstreams: WS }),
    listOpenIssues: () => [
      { number: 5, title: 'new safety block', labels: [] },
      { number: 6, title: 'done thing', labels: ['workstream/workflow'] },
    ],
    log: (s) => { out = s; },
  });
  assert.ok(out.includes('#5'));
  assert.ok(!out.includes('#6'));
});

test('handleHook respects CLAUDE_KIT_NO_BOARD_SWEEP', () => {
  process.env.CLAUDE_KIT_NO_BOARD_SWEEP = '1';
  let ran = false;
  S.handleHook({}, { run: () => { ran = true; return 'true'; }, readConfig: () => ({ workstreams: WS }) });
  delete process.env.CLAUDE_KIT_NO_BOARD_SWEEP;
  assert.strictEqual(ran, false);
});

console.log(`\n${'='.repeat(48)}`);
if (fail > 0) { console.error(`FAILED — ${fail} of ${pass + fail} assertions failed.`); process.exit(1); }
console.log(`PASSED — all ${pass} assertions green.`);
process.exit(0);
