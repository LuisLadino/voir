#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { sharedMemoryDir, readSharedMemories, parseMemory, memorySummary, buildInjection } = require('./shared-memory.cjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.stack}`); }
}

function withTempDir(fn) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shared-mem-')));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

console.log('sharedMemoryDir');

test('defaults to ~/.claude/memory', () => {
  assert.strictEqual(sharedMemoryDir({}), path.join(os.homedir(), '.claude', 'memory'));
});

test('honors CLAUDE_SHARED_MEMORY_DIR override', () => {
  assert.strictEqual(sharedMemoryDir({ CLAUDE_SHARED_MEMORY_DIR: '/tmp/x' }), '/tmp/x');
});

console.log('\nreadSharedMemories');

test('returns [] when the dir does not exist', () => {
  assert.deepStrictEqual(readSharedMemories('/no/such/dir/here'), []);
});

test('returns [] for an empty dir', () => {
  withTempDir(dir => assert.deepStrictEqual(readSharedMemories(dir), []));
});

test('reads .md files, sorted by name, excluding MEMORY.md', () => {
  withTempDir(dir => {
    fs.writeFileSync(path.join(dir, 'feedback_b.md'), 'B body');
    fs.writeFileSync(path.join(dir, 'feedback_a.md'), 'A body');
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), '# index');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored non-md');
    const mems = readSharedMemories(dir);
    assert.deepStrictEqual(mems.map(m => m.name), ['feedback_a.md', 'feedback_b.md']);
    assert.strictEqual(mems[0].body, 'A body');
  });
});

test('ignores subdirectories', () => {
  withTempDir(dir => {
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'nested.md'), 'nested');
    fs.writeFileSync(path.join(dir, 'top.md'), 'top');
    assert.deepStrictEqual(readSharedMemories(dir).map(m => m.name), ['top.md']);
  });
});

console.log('\nbuildInjection');

test('returns null for no memories', () => {
  assert.strictEqual(buildInjection([]), null);
  assert.strictEqual(buildInjection(null), null);
});

test('one line per memory, framed as background context', () => {
  const inj = buildInjection([
    { name: 'feedback_x.md', body: 'do X\n' },
    { name: 'user_who.md', body: 'Luis is Y' },
  ]);
  assert.ok(inj.includes('[SHARED MEMORY]'), 'has the layer tag');
  assert.ok(/not new instructions|background context/i.test(inj), 'framed as background, not instructions');
  assert.ok(inj.includes('- do X') && inj.includes('- Luis is Y'), 'one bullet per memory');
  // exactly two bullet lines (one per memory), no multi-line bodies
  assert.strictEqual((inj.match(/^- /gm) || []).length, 2, 'two summary lines');
});

test('injects the description only, NOT the body or frontmatter', () => {
  const withFm = [
    '---',
    'name: take-reins',
    'description: "Decide and drive on expertise domains."',
    'metadata:',
    '  node_type: memory',
    '  type: feedback',
    '  originSessionId: abc-123',
    '---',
    '',
    '# Take the reins',
    'The actual rule body, which is long and should NOT be injected.',
  ].join('\n');
  const inj = buildInjection([{ name: 'feedback_take_reins.md', body: withFm }]);
  assert.ok(inj.includes('- Decide and drive on expertise domains.'), 'surfaces the description as the line');
  assert.ok(!inj.includes('The actual rule body'), 'drops the body (weight-saving)');
  assert.ok(!inj.includes('# Take the reins'), 'drops the body heading');
  assert.ok(!inj.includes('originSessionId') && !inj.includes('node_type'), 'drops frontmatter bookkeeping');
});

console.log('\nmemorySummary');

test('uses the description when present', () => {
  assert.strictEqual(memorySummary('---\ndescription: the rule\n---\n\n# H\nbody'), 'the rule');
});

test('falls back to the first non-heading body line when no description', () => {
  assert.strictEqual(memorySummary('# Heading\nfirst real line\nsecond'), 'first real line');
});

console.log('\nparseMemory');

test('extracts description and strips frontmatter from a typed memory', () => {
  const { description, content } = parseMemory('---\nname: x\ndescription: hello world\nmetadata:\n  type: feedback\n---\n\n# Body\ntext');
  assert.strictEqual(description, 'hello world');
  assert.strictEqual(content, '# Body\ntext');
});

test('returns whole body and null description when there is no frontmatter', () => {
  const { description, content } = parseMemory('just a plain body\nno frontmatter');
  assert.strictEqual(description, null);
  assert.strictEqual(content, 'just a plain body\nno frontmatter');
});

test('handles empty / non-string input', () => {
  assert.deepStrictEqual(parseMemory(''), { description: null, content: '' });
  assert.deepStrictEqual(parseMemory(null), { description: null, content: '' });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
