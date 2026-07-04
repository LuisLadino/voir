#!/usr/bin/env node

const assert = require('assert');
const { buildChatRequest, parseChatResponse, modelInTags } = require('./local-llm.cjs');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${(e.stack || e.message).replace(/\n/g, '\n       ')}`); }
}

console.log('buildChatRequest');

const SCHEMA = { type: 'object', properties: { faithful: { type: 'boolean' } }, required: ['faithful'] };

test('builds the /api/chat body with stream:false and the schema as format', () => {
  const req = buildChatRequest('qwen3:32b', 'judge this', SCHEMA);
  assert.strictEqual(req.model, 'qwen3:32b');
  assert.strictEqual(req.stream, false);
  assert.deepStrictEqual(req.messages, [{ role: 'user', content: 'judge this' }]);
  assert.deepStrictEqual(req.format, SCHEMA);
});

test('includes options when provided, omits the key when empty', () => {
  assert.deepStrictEqual(buildChatRequest('m', 'p', SCHEMA, { temperature: 0 }).options, { temperature: 0 });
  assert.strictEqual('options' in buildChatRequest('m', 'p', SCHEMA), false);
  assert.strictEqual('options' in buildChatRequest('m', 'p', SCHEMA, {}), false);
});

console.log('parseChatResponse');

test('extracts and parses the JSON document at message.content', () => {
  const raw = JSON.stringify({ message: { content: '{"faithful": true, "reason": "ok"}' } });
  assert.deepStrictEqual(parseChatResponse(raw), { ok: true, data: { faithful: true, reason: 'ok' } });
});

test('accepts an already-parsed object, not just a string', () => {
  const obj = { message: { content: '{"faithful": false}' } };
  const r = parseChatResponse(obj);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.faithful, false);
});

test('an ollama error field fails honest', () => {
  const r = parseChatResponse(JSON.stringify({ error: 'model "x" not found' }));
  assert.strictEqual(r.ok, false);
  assert.ok(/model "x" not found/.test(r.error));
});

test('missing message.content fails honest', () => {
  assert.strictEqual(parseChatResponse(JSON.stringify({ message: {} })).ok, false);
  assert.strictEqual(parseChatResponse(JSON.stringify({ message: { content: '   ' } })).ok, false);
});

test('content that is not valid JSON fails honest (no silent empty result)', () => {
  const r = parseChatResponse(JSON.stringify({ message: { content: 'I think it is faithful.' } }));
  assert.strictEqual(r.ok, false);
  assert.ok(/not valid JSON/.test(r.error));
});

test('a non-JSON outer response fails honest', () => {
  assert.strictEqual(parseChatResponse('<html>502 Bad Gateway</html>').ok, false);
});

console.log('modelInTags');

const TAGS = { models: [{ name: 'qwen3:32b' }, { name: 'llama3.3:70b' }, { name: 'deepseek-r1:32b' }] };

test('matches an exact tag', () => {
  assert.strictEqual(modelInTags(TAGS, 'qwen3:32b'), true);
  assert.strictEqual(modelInTags(TAGS, 'llama3.3:70b'), true);
});

test('a bare base name resolves any pulled tag of that base', () => {
  assert.strictEqual(modelInTags(TAGS, 'qwen3'), true);
  assert.strictEqual(modelInTags(TAGS, 'deepseek-r1'), true);
});

test('a different explicit tag does not fuzzy-match', () => {
  assert.strictEqual(modelInTags(TAGS, 'qwen3:8b'), false);
});

test('an unknown model is absent', () => {
  assert.strictEqual(modelInTags(TAGS, 'mistral'), false);
  assert.strictEqual(modelInTags({ models: [] }, 'qwen3'), false);
  assert.strictEqual(modelInTags({}, 'qwen3'), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
