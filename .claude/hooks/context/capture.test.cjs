'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { isCaptureRequest, check } = require('./capture.cjs');

// Genuine capture requests — imperatives the user issues. Must fire.
const SHOULD_FIRE = [
  'capture this',
  'remember this',
  'capture this insight about the daemon',
  'That was great. Capture that.',
  'capture: the daemon is gated on Ignite infra',
  'save this to memory',
  'capture the decision we just made',
  'write this down',
  'add this to decisions',
];

// Descriptive uses of the verb, and agent-result text reaching inject-context as
// the turn's "prompt". Must NOT fire. The first is the exact #817 regression:
// the phase-evaluator result carried issue #321's title, which the old
// /\bcapture[:\s]+.{5,}/ matched.
const SHOULD_NOT_FIRE = [
  'Issue #321: capture worker stdout/stderr JSONL streams',
  'we should capture worker metrics in the hook',
  'the hook captures errors and writes them',
  'Related: capture the trace from #321/#322 (cosmo dispatch dir)',
  '{ "title": "Issue #321: capture worker stdout/stderr JSONL streams" }',
  'The plan is to capture telemetry and remember the thresholds for later.',
];

for (const s of SHOULD_FIRE) {
  test(`fires on genuine request: ${JSON.stringify(s)}`, () => {
    assert.strictEqual(isCaptureRequest(s), true);
  });
}

for (const s of SHOULD_NOT_FIRE) {
  test(`does not fire on descriptive/agent text: ${JSON.stringify(s)}`, () => {
    assert.strictEqual(isCaptureRequest(s), false);
  });
}

test('#817 regression: phase-evaluator result with issue #321 title does not trigger', () => {
  const agentResult = [
    '## Phase Check',
    'Observations:',
    '- Issue #321: capture worker stdout/stderr JSONL streams (blocked on trace)',
    'Summary: kit ITERATE, on track.',
  ].join('\n');
  const result = check(agentResult);
  assert.strictEqual(result.triggered, false);
  assert.strictEqual(result.content, null);
});

test('check() returns the capture banner for a genuine request', () => {
  const result = check('capture this: the runtime decision is LangGraph');
  assert.strictEqual(result.triggered, true);
  assert.match(result.content, /\[CAPTURE TRIGGERED\]/);
});
