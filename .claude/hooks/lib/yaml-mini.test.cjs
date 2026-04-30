#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parse } = require('./yaml-mini.cjs');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error('       ' + (e.stack || e.message).replace(/\n/g, '\n       '));
  }
}

test('empty document returns empty object', () => {
  assert.deepStrictEqual(parse(''), {});
  assert.deepStrictEqual(parse('\n\n'), {});
});

test('comments-only document returns empty object', () => {
  assert.deepStrictEqual(parse('# just a comment\n# another\n'), {});
});

test('top-level plain scalar map', () => {
  assert.deepStrictEqual(parse('default: luis\n'), { default: 'luis' });
});

test('multiple top-level plain scalars', () => {
  const out = parse('default: luis\nother: value\n');
  assert.deepStrictEqual(out, { default: 'luis', other: 'value' });
});

test('double-quoted scalar', () => {
  assert.deepStrictEqual(parse('key: "hello world"\n'), { key: 'hello world' });
});

test('single-quoted scalar with escaped quote', () => {
  assert.deepStrictEqual(parse("key: 'it''s'\n"), { key: "it's" });
});

test('double-quoted scalar with escape sequences', () => {
  assert.deepStrictEqual(parse('key: "line1\\nline2"\n'), { key: 'line1\nline2' });
});

test('null literal', () => {
  assert.deepStrictEqual(parse('rules: null\n'), { rules: null });
});

test('tilde alias for null', () => {
  assert.deepStrictEqual(parse('rules: ~\n'), { rules: null });
});

test('nested map', () => {
  const yaml = 'voices:\n  luis:\n    rules: null\n';
  assert.deepStrictEqual(parse(yaml), { voices: { luis: { rules: null } } });
});

test('block scalar preserves newlines and trailing newline (clip chomping)', () => {
  const yaml = 'rules: |\n  line one\n  line two\n  line three\n';
  assert.deepStrictEqual(parse(yaml), { rules: 'line one\nline two\nline three\n' });
});

test('block scalar with blank line inside', () => {
  const yaml = 'rules: |\n  para one\n\n  para two\n';
  assert.deepStrictEqual(parse(yaml), { rules: 'para one\n\npara two\n' });
});

test('block scalar under nested map', () => {
  const yaml = 'voices:\n  luis:\n    rules: |\n      No em dashes.\n      Active voice.\n';
  assert.deepStrictEqual(parse(yaml), {
    voices: { luis: { rules: 'No em dashes.\nActive voice.\n' } }
  });
});

test('sequence of maps', () => {
  const yaml = 'paths:\n  - match: "foo/**"\n    voice: none\n  - match: "bar/**"\n    voice: luis\n';
  assert.deepStrictEqual(parse(yaml), {
    paths: [
      { match: 'foo/**', voice: 'none' },
      { match: 'bar/**', voice: 'luis' }
    ]
  });
});

test('sequence item with plain unquoted match', () => {
  const yaml = 'paths:\n  - match: README.md\n    voice: none\n';
  assert.deepStrictEqual(parse(yaml), {
    paths: [{ match: 'README.md', voice: 'none' }]
  });
});

test('inline comment stripped after value', () => {
  const yaml = 'default: luis  # fallback\n';
  assert.deepStrictEqual(parse(yaml), { default: 'luis' });
});

test('comment inside quoted value is preserved', () => {
  const yaml = 'key: "a # b"\n';
  assert.deepStrictEqual(parse(yaml), { key: 'a # b' });
});

test('key with colon inside quoted string', () => {
  const yaml = '"client:ignite":\n  rules: null\n';
  assert.deepStrictEqual(parse(yaml), { 'client:ignite': { rules: null } });
});

test('blank lines between top-level entries', () => {
  const yaml = 'default: luis\n\n\nvoices:\n  luis:\n    rules: null\n';
  assert.deepStrictEqual(parse(yaml), { default: 'luis', voices: { luis: { rules: null } } });
});

test('combined: voice.yaml shape', () => {
  const yaml = `default: luis

voices:
  luis:
    rules: |
      No em dashes. Use periods or colons.
      Active voice, short sentences, contractions.
  none:
    rules: null

paths:
  - match: "CHANGELOG.md"
    voice: none
`;
  const out = parse(yaml);
  assert.strictEqual(out.default, 'luis');
  assert.ok(out.voices.luis.rules.includes('No em dashes'));
  assert.strictEqual(out.voices.none.rules, null);
  assert.strictEqual(out.paths.length, 1);
  assert.deepStrictEqual(out.paths[0], { match: 'CHANGELOG.md', voice: 'none' });
});

test('combined: red-team-ops voice.yaml shape (multi-rule paths)', () => {
  const yaml = `default: luis

voices:
  luis:
    rules: |
      No em dashes.
  none:
    rules: null

paths:
  - match: "context/*/attacks/**"
    voice: none
  - match: "contracts/safety-contract/prompt-writing/**"
    voice: none
  - match: "scripts/attack/**"
    voice: none
`;
  const out = parse(yaml);
  assert.strictEqual(out.paths.length, 3);
  assert.strictEqual(out.paths[0].match, 'context/*/attacks/**');
  assert.strictEqual(out.paths[2].voice, 'none');
});

test('malformed: missing colon throws', () => {
  assert.throws(() => parse('just a word\n'), /expected 'key: value'/);
});

test('malformed: unterminated quoted string throws', () => {
  assert.throws(() => parse('key: "no close\n'), /unterminated quoted string/);
});

test('malformed: document not starting at column 0 throws', () => {
  assert.throws(() => parse('  key: value\n'), /must start at column 0/);
});

test('parses claude-kit voice.yaml from disk', () => {
  const root = path.resolve(__dirname, '../../..');
  const voicePath = path.join(root, '.claude/voice.yaml');
  if (!fs.existsSync(voicePath)) {
    console.log('       SKIP: .claude/voice.yaml not present');
    return;
  }
  const text = fs.readFileSync(voicePath, 'utf8');
  const out = parse(text);
  assert.ok(typeof out === 'object' && out !== null, 'expected object');
  assert.ok(out.voices && typeof out.voices === 'object', 'expected voices map');
});

test('matches yaml package output for voice.yaml', () => {
  let YAML;
  try {
    YAML = require('yaml');
  } catch {
    console.log('       SKIP: yaml package not installed in this environment');
    return;
  }
  const voicePath = path.resolve(__dirname, '../../voice.yaml');
  if (!fs.existsSync(voicePath)) {
    console.log('       SKIP: .claude/voice.yaml not present');
    return;
  }
  const text = fs.readFileSync(voicePath, 'utf8');
  const mine = parse(text);
  const theirs = YAML.parse(text);
  assert.deepStrictEqual(mine, theirs, 'yaml-mini output must match yaml package for voice.yaml');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
