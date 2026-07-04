/**
 * Unit tests for the shared kit-eval atoms (#859) and the #867 parser fix.
 * Pure functions only — claudeRun spawns a subprocess and is exercised by the
 * harnesses' live walks, not here.
 */

const assert = require('node:assert');
const { extractJsonObject, readJudgeVerdict, mapLocalVerdict } = require('./eval-harness.cjs');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${(e.stack || e.message).replace(/\n/g, '\n       ')}`); }
}

console.log('extractJsonObject');

test('bare clean JSON parses', () => {
  assert.deepStrictEqual(extractJsonObject('{"pass": true, "reason": "ok"}'), { pass: true, reason: 'ok' });
});
test('JSON embedded in prose is extracted', () => {
  assert.deepStrictEqual(extractJsonObject('Here is my verdict:\n{"pass": false, "reason": "vague"}\nThanks'), { pass: false, reason: 'vague' });
});
test('#867: fenced ```json block is unwrapped', () => {
  assert.deepStrictEqual(extractJsonObject('```json\n{"complies": true, "reason": "leads"}\n```'), { complies: true, reason: 'leads' });
});
test('#867: trailing prose with a stray brace does not defeat the match', () => {
  // The old greedy first-{ to last-} match spanned to the trailing brace and
  // failed JSON.parse, failing closed. The balanced scan takes the first object.
  assert.deepStrictEqual(extractJsonObject('Verdict:\n{"complies": true, "reason": "ok"}\nP.S. ignore the {brackets}.'), { complies: true, reason: 'ok' });
});
test('#867: a brace inside a string value is respected (string-aware scan)', () => {
  assert.deepStrictEqual(extractJsonObject('{"faithful": true, "reason": "names the {situation}"}'), { faithful: true, reason: 'names the {situation}' });
});
test('no JSON present yields null', () => {
  assert.strictEqual(extractJsonObject('I think it is fine.'), null);
});
test('empty and whitespace yield null', () => {
  assert.strictEqual(extractJsonObject(''), null);
  assert.strictEqual(extractJsonObject('   \n  '), null);
  assert.strictEqual(extractJsonObject(null), null);
});
test('malformed unclosed object yields null, never throws', () => {
  assert.strictEqual(extractJsonObject('{pass: yes'), null);
});

console.log('readJudgeVerdict');

test('clean pass verdict', () => {
  assert.deepStrictEqual(readJudgeVerdict('{"pass": true, "reason": "ok"}', 'pass', false), { pass: true, reason: 'ok' });
});
test('clean complies=false verdict', () => {
  assert.strictEqual(readJudgeVerdict('{"complies": false, "reason": "warm-up"}', 'complies', false).complies, false);
});
test('missing key falls back (null for faithfulness undecided)', () => {
  assert.strictEqual(readJudgeVerdict('{"reason": "no flag"}', 'faithful', null).faithful, null);
});
test('missing key falls back to false for the fail-closed harnesses', () => {
  assert.strictEqual(readJudgeVerdict('{"reason": "no flag"}', 'pass', false).pass, false);
});
test('string "true" is not a boolean pass (strict)', () => {
  assert.strictEqual(readJudgeVerdict('{"pass": "true"}', 'pass', false).pass, false);
});
test('non-boolean faithful yields the null fallback (strict)', () => {
  assert.strictEqual(readJudgeVerdict('{"faithful": "yes"}', 'faithful', null).faithful, null);
});
test('no JSON yields the fallback with a reason', () => {
  const v = readJudgeVerdict('looks fine to me', 'complies', false);
  assert.strictEqual(v.complies, false);
  assert.strictEqual(v.reason, 'no JSON verdict found');
});
test('#867: the fix flows through readJudgeVerdict', () => {
  assert.strictEqual(readJudgeVerdict('Verdict: {"pass": true, "reason": "ok"} (note the {edge})', 'pass', false).pass, true);
});

console.log('mapLocalVerdict');

test('ok + boolean true', () => {
  assert.deepStrictEqual(mapLocalVerdict({ ok: true, data: { pass: true, reason: 'good' } }, 'pass', false), { pass: true, reason: 'good' });
});
test('ok + false', () => {
  assert.strictEqual(mapLocalVerdict({ ok: true, data: { complies: false, reason: 'r' } }, 'complies', false).complies, false);
});
test('string "true" is not a boolean (strict)', () => {
  assert.strictEqual(mapLocalVerdict({ ok: true, data: { pass: 'true' } }, 'pass', false).pass, false);
});
test('non-ok result fails closed carrying the error', () => {
  const v = mapLocalVerdict({ ok: false, error: 'ollama down' }, 'complies', false);
  assert.strictEqual(v.complies, false);
  assert.strictEqual(v.reason, 'ollama down');
});
test('null result fails closed', () => {
  assert.strictEqual(mapLocalVerdict(null, 'pass', false).pass, false);
});
test('ok but missing data falls back', () => {
  assert.strictEqual(mapLocalVerdict({ ok: true }, 'pass', false).pass, false);
});
test('faithfulness null fallback: ok + boolean preserved', () => {
  assert.strictEqual(mapLocalVerdict({ ok: true, data: { faithful: true, reason: 'r' } }, 'faithful', null).faithful, true);
});
test('faithfulness null fallback: missing boolean yields null', () => {
  assert.strictEqual(mapLocalVerdict({ ok: true, data: { reason: 'r' } }, 'faithful', null).faithful, null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
