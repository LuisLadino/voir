'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { isBackgroundNotification } = require('./inject-utils.cjs');

// Background-completion turns (Monitor events + agent completions) reach
// UserPromptSubmit as a task-notification envelope. Verified against the live
// session transcript: every such turn's prompt starts with `<task-notification>`
// (optionally behind the `[SYSTEM NOTIFICATION - NOT USER INPUT]` marker), and no
// genuine user turn does. See #824.
const BACKGROUND = [
  '<task-notification>\n<task-id>ac1b899a94e867d1c</task-id>\n<summary>Agent done</summary>',
  // the exact #817 cause: a phase-evaluator result carrying issue #321's title
  '<task-notification>\n<result>Observations:\n- Issue #321: capture worker stdout/stderr JSONL streams</result>\n</task-notification>',
  '[SYSTEM NOTIFICATION - NOT USER INPUT]\nThis is an automated background-task event.\n<task-notification>x</task-notification>',
  '  \n<task-notification>leading whitespace</task-notification>',
];

const GENUINE = [
  'capture this',
  'remember this insight',
  'yeah do that grep hunt.',
  'alright go into 819. can we bundle an add in to the claude file',
  'We need to file an issue about the follow up gh issues',
  // mentions the marker mid-text, but is genuine user input — must NOT match
  'can you explain what a <task-notification> wrapper is?',
];

for (const p of BACKGROUND) {
  test(`detects background turn: ${JSON.stringify(p.slice(0, 40))}`, () => {
    assert.strictEqual(isBackgroundNotification(p), true);
  });
}

for (const p of GENUINE) {
  test(`treats as user input: ${JSON.stringify(p.slice(0, 40))}`, () => {
    assert.strictEqual(isBackgroundNotification(p), false);
  });
}

test('non-string input is not a background notification', () => {
  assert.strictEqual(isBackgroundNotification(undefined), false);
  assert.strictEqual(isBackgroundNotification(null), false);
  assert.strictEqual(isBackgroundNotification(42), false);
});
