#!/usr/bin/env node
// Tests for dispatch-completion-notifier.cjs
// Uses a tempdir per test. No global state.

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const {
  findUnsynthesized,
  formatNotification,
  hasResultEvent,
  alreadySynthesized,
} = require('./dispatch-completion-notifier.cjs');
const registry = require('../lib/dispatch-registry.cjs');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

function mkTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-notifier-'));
  const dispatchDir = path.join(root, '.claude', 'dispatch');
  fs.mkdirSync(dispatchDir, { recursive: true });
  return root;
}

function writeActive(root, workers) {
  registry.resetAndSeed(root, workers);
}

function writeJsonl(root, sessionId, lines) {
  const p = path.join(root, '.claude', 'dispatch', `${sessionId}.jsonl`);
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
}

function writeResult(root, sessionId, result) {
  const p = path.join(root, '.claude', 'dispatch', `${sessionId}.result.json`);
  fs.writeFileSync(p, JSON.stringify(result, null, 2));
}

console.log('\nhasResultEvent');

test('returns false when file is empty', () => {
  const root = mkTempRoot();
  const p = writeJsonl(root, 'abc', []);
  assert.strictEqual(hasResultEvent(p), false);
});

test('returns false when no result event in file', () => {
  const root = mkTempRoot();
  const p = writeJsonl(root, 'abc', [
    '{"type":"system","x":1}',
    '{"type":"tool_use","name":"Bash"}',
  ]);
  assert.strictEqual(hasResultEvent(p), false);
});

test('returns true when result event present at end', () => {
  const root = mkTempRoot();
  const p = writeJsonl(root, 'abc', [
    '{"type":"system"}',
    '{"type":"tool_use"}',
    '{"type":"result","subtype":"completed"}',
  ]);
  assert.strictEqual(hasResultEvent(p), true);
});

test('returns true even with large file (tail-read works)', () => {
  const root = mkTempRoot();
  const lines = [];
  for (let i = 0; i < 5000; i++) {
    lines.push(`{"type":"tool_use","id":"${i}","data":"${'x'.repeat(50)}"}`);
  }
  lines.push('{"type":"result","subtype":"completed","total_cost_usd":1.23}');
  const p = writeJsonl(root, 'abc', lines);
  assert.strictEqual(hasResultEvent(p), true);
});

test('returns false when file does not exist', () => {
  assert.strictEqual(hasResultEvent('/tmp/does-not-exist-abc123.jsonl'), false);
});

console.log('\nalreadySynthesized');

test('returns false when no result.json exists', () => {
  const root = mkTempRoot();
  assert.strictEqual(alreadySynthesized(root, 'abc'), false);
});

test('returns true when result.json exists', () => {
  const root = mkTempRoot();
  writeResult(root, 'abc', { status: 'completed' });
  assert.strictEqual(alreadySynthesized(root, 'abc'), true);
});

console.log('\nfindUnsynthesized');

test('returns empty when no active.json', () => {
  const root = mkTempRoot();
  assert.deepStrictEqual(findUnsynthesized(root), []);
});

test('returns empty when active.json has no workers', () => {
  const root = mkTempRoot();
  writeActive(root, []);
  assert.deepStrictEqual(findUnsynthesized(root), []);
});

test('returns empty when active workers have not emitted result', () => {
  const root = mkTempRoot();
  const outputFile = writeJsonl(root, 'abc', [
    '{"type":"system"}',
    '{"type":"tool_use"}',
  ]);
  writeActive(root, [{ sessionId: 'abc', outputFile, target: { type: 'issue', value: '100' } }]);
  assert.deepStrictEqual(findUnsynthesized(root), []);
});

test('returns worker when result emitted and not synthesized', () => {
  const root = mkTempRoot();
  const outputFile = writeJsonl(root, 'abc', [
    '{"type":"result","subtype":"completed"}',
  ]);
  writeActive(root, [{ sessionId: 'abc', outputFile, target: { type: 'issue', value: '100' } }]);
  const pending = findUnsynthesized(root);
  assert.strictEqual(pending.length, 1);
  assert.strictEqual(pending[0].sessionId, 'abc');
});

test('skips worker when already synthesized (result.json exists)', () => {
  const root = mkTempRoot();
  const outputFile = writeJsonl(root, 'abc', [
    '{"type":"result","subtype":"completed"}',
  ]);
  writeResult(root, 'abc', { status: 'completed' });
  writeActive(root, [{ sessionId: 'abc', outputFile, target: { type: 'issue', value: '100' } }]);
  assert.deepStrictEqual(findUnsynthesized(root), []);
});

test('finds multiple unsynthesized workers', () => {
  const root = mkTempRoot();
  const out1 = writeJsonl(root, 'abc', ['{"type":"result","subtype":"completed"}']);
  const out2 = writeJsonl(root, 'def', ['{"type":"result","subtype":"completed"}']);
  const out3 = writeJsonl(root, 'ghi', ['{"type":"system"}']);
  writeActive(root, [
    { sessionId: 'abc', outputFile: out1, target: { type: 'issue', value: '100' } },
    { sessionId: 'def', outputFile: out2, target: { type: 'issue', value: '101' } },
    { sessionId: 'ghi', outputFile: out3, target: { type: 'issue', value: '102' } },
  ]);
  const pending = findUnsynthesized(root);
  assert.strictEqual(pending.length, 2);
  assert.deepStrictEqual(pending.map(p => p.sessionId).sort(), ['abc', 'def']);
});

test('handles malformed active.jsonl gracefully', () => {
  const root = mkTempRoot();
  const jsonlPath = path.join(root, '.claude', 'dispatch', 'active.jsonl');
  fs.writeFileSync(jsonlPath, '{ not valid json');
  assert.deepStrictEqual(findUnsynthesized(root), []);
});

test('skips workers with missing outputFile on disk', () => {
  const root = mkTempRoot();
  writeActive(root, [{
    sessionId: 'abc',
    outputFile: '/tmp/does-not-exist-xyz.jsonl',
    target: { type: 'issue', value: '100' }
  }]);
  assert.deepStrictEqual(findUnsynthesized(root), []);
});

console.log('\nformatNotification');

test('includes count in header', () => {
  const msg = formatNotification([
    { sessionId: 'abc123', target: { type: 'issue', value: '100' }, model: 'opus' },
  ]);
  assert.ok(msg.includes('1 worker(s) completed'));
});

test('lists each worker with issue number', () => {
  const msg = formatNotification([
    { sessionId: 'abc123', target: { type: 'issue', value: '100' }, model: 'opus' },
    { sessionId: 'def456', target: { type: 'issue', value: '101' }, model: 'sonnet' },
  ]);
  assert.ok(msg.includes('abc123'));
  assert.ok(msg.includes('#100'));
  assert.ok(msg.includes('def456'));
  assert.ok(msg.includes('#101'));
});

test('handles ad-hoc targets', () => {
  const msg = formatNotification([
    { sessionId: 'abc123', target: { type: 'adhoc', value: 'refactor button' }, model: 'opus' },
  ]);
  assert.ok(msg.includes('ad-hoc'));
});

test('mentions /dispatch --synthesize directive', () => {
  const msg = formatNotification([
    { sessionId: 'abc123', target: { type: 'issue', value: '100' }, model: 'opus' },
  ]);
  assert.ok(msg.includes('/dispatch --synthesize'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
process.exit(0);
