#!/usr/bin/env node

const assert = require('assert');
const { check, isContentWriting } = require('./voice-identity.cjs');

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

console.log('isContentWriting pattern detection');

test('detects "draft my cover letter"', () => {
  assert.ok(isContentWriting('draft my cover letter for this job'));
});

test('detects "write a blog post"', () => {
  assert.ok(isContentWriting('write a blog post about design thinking'));
});

test('detects "bio"', () => {
  assert.ok(isContentWriting('write me a bio paragraph for linkedin'));
});

test('rejects "edit the config"', () => {
  assert.ok(!isContentWriting('edit the config file'));
});

test('rejects "fix the bug"', () => {
  assert.ok(!isContentWriting('fix the bug in enforce-voice.cjs'));
});

console.log('\ncheck() integration with voice registry');

test('content-writing prompt injects registry-sourced rules', () => {
  const r = check('write my cover letter');
  assert.strictEqual(r.voiceProfileLoaded, true);
  assert.ok(Array.isArray(r.content));
  assert.strictEqual(r.content.length, 1);
  assert.ok(r.content[0].includes('[VOICE:'), 'expected [VOICE: ...] tag');
});

test('non-content prompt returns null', () => {
  const r = check('explain how the registry works');
  assert.strictEqual(r.content, null);
  assert.strictEqual(r.voiceProfileLoaded, false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
