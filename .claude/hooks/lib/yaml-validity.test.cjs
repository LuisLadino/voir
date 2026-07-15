#!/usr/bin/env node

const assert = require('assert');
const {
  isWholeDocYaml,
  validateContent,
  formatReport,
  extractLine,
  cleanMessage
} = require('./yaml-validity.cjs');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}\n       ${err.stack || err.message}`);
  }
}

console.log('yaml-validity: isWholeDocYaml');

test('matches .yaml under .claude/specs', () => {
  assert.strictEqual(isWholeDocYaml('.claude/specs/architecture/system-map.yaml'), true);
});

test('matches .yml under .claude', () => {
  assert.strictEqual(isWholeDocYaml('.claude/board.yml'), true);
});

test('matches .claude/voice.yaml and top-level .claude yaml', () => {
  assert.strictEqual(isWholeDocYaml('.claude/voice.yaml'), true);
});

test('matches when .claude is nested under a repo path', () => {
  assert.strictEqual(isWholeDocYaml('some/project/.claude/specs/x.yaml'), true);
});

test('rejects a .md spec (frontmatter, not whole-doc)', () => {
  assert.strictEqual(isWholeDocYaml('.claude/specs/kit/injection-precision.md'), false);
});

test('rejects a .yaml outside .claude', () => {
  assert.strictEqual(isWholeDocYaml('config/app.yaml'), false);
});

test('rejects a non-yaml file under .claude', () => {
  assert.strictEqual(isWholeDocYaml('.claude/notes.txt'), false);
});

test('rejects a non-string', () => {
  assert.strictEqual(isWholeDocYaml(null), false);
  assert.strictEqual(isWholeDocYaml(undefined), false);
});

console.log('\nyaml-validity: validateContent');

test('accepts a valid document', () => {
  assert.deepStrictEqual(validateContent('name: demo\nlist:\n  - a\n  - b\n'), { ok: true });
});

test('accepts an empty document', () => {
  assert.deepStrictEqual(validateContent(''), { ok: true });
});

test('rejects the motivating nested colon-space, with the line', () => {
  const r = validateContent('note: agent latency (in: 0.1s, out: 0.2s)\n');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.line, 1);
  assert.ok(/mapping value/.test(r.message), r.message);
});

test('rejects a duplicate key, with the line', () => {
  const r = validateContent('a: 1\nb: 2\na: 3\n');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.line, 3);
  assert.ok(/duplicate key/.test(r.message), r.message);
});

test('the failure message is stripped of the yaml-mini: prefix', () => {
  const r = validateContent('a: b: c\n');
  assert.ok(!/^yaml-mini:/.test(r.message), r.message);
});

test('accepts a flow-map value (valid YAML)', () => {
  assert.deepStrictEqual(validateContent('exit_codes: { 0: allow, 2: deny }\n'), { ok: true });
});

console.log('\nyaml-validity: helpers + formatReport');

test('extractLine pulls the number from a yaml-mini message', () => {
  assert.strictEqual(extractLine('yaml-mini: bad thing at line 7'), 7);
  assert.strictEqual(extractLine('no number here'), null);
});

test('cleanMessage falls back to a default and strips the prefix', () => {
  assert.strictEqual(cleanMessage('yaml-mini: boom at line 2'), 'boom at line 2');
  assert.strictEqual(cleanMessage(''), 'invalid YAML');
});

test('formatReport is empty for no failures', () => {
  assert.strictEqual(formatReport([]), '');
});

test('formatReport names each file with its line and message', () => {
  const out = formatReport([
    { filePath: '.claude/specs/architecture/system-map.yaml', line: 12, message: 'mapping value not allowed in plain scalar (quote the value)' }
  ]);
  assert.ok(out.includes('[BLOCKED]'), out);
  assert.ok(out.includes('.claude/specs/architecture/system-map.yaml:12'), out);
  assert.ok(out.includes('mapping value not allowed'), out);
});

test('formatReport omits :line when line is null', () => {
  const out = formatReport([{ filePath: '.claude/board.yaml', line: null, message: 'invalid YAML' }]);
  assert.ok(out.includes('.claude/board.yaml\n'), out);
  assert.ok(!out.includes('.claude/board.yaml:'), out);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
