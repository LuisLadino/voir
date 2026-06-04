#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readSpecFrontmatter, readYamlMetadata } = require('./spec-frontmatter.cjs');

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

function tmpFile(name, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-fm-'));
  const full = path.join(dir, name);
  fs.writeFileSync(full, body);
  return { dir, full };
}

console.log('spec-frontmatter: markdown frontmatter');

test('parses flat scalar fields and block-style applies_to', () => {
  const { dir, full } = tmpFile('a.md', [
    '---',
    'name: sample',
    'category: coding',
    'applies_to:',
    '  - "**/*.tsx"',
    '  - "src/**/*.ts"',
    'excludes:',
    '  - "**/vendor/**"',
    '---',
    '',
    '# body'
  ].join('\n'));
  try {
    const fm = readSpecFrontmatter(full);
    assert.strictEqual(fm.name, 'sample');
    assert.strictEqual(fm.category, 'coding');
    assert.deepStrictEqual(fm.applies_to, ['**/*.tsx', 'src/**/*.ts']);
    assert.deepStrictEqual(fm.excludes, ['**/vendor/**']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('flow-style empty applies_to becomes an empty array', () => {
  const { dir, full } = tmpFile('b.md', ['---', 'name: empty', 'applies_to: []', '---'].join('\n'));
  try {
    const fm = readSpecFrontmatter(full);
    assert.deepStrictEqual(fm.applies_to, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('flow-style related becomes an array', () => {
  const { dir, full } = tmpFile('c.md', ['---', 'name: rel', 'related: [a, b, c]', '---'].join('\n'));
  try {
    assert.deepStrictEqual(readSpecFrontmatter(full).related, ['a', 'b', 'c']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('parses conformance_rules sequence-of-maps', () => {
  const { dir, full } = tmpFile('d.md', [
    '---',
    'name: d',
    'applies_to:',
    '  - "**/*.tsx"',
    'conformance_rules:',
    '  - name: r1',
    '    pattern: "foo"',
    '    message: |',
    '      bad foo',
    '---'
  ].join('\n'));
  try {
    const fm = readSpecFrontmatter(full);
    assert.strictEqual(Array.isArray(fm.conformance_rules), true);
    assert.strictEqual(fm.conformance_rules[0].name, 'r1');
    assert.strictEqual(fm.conformance_rules[0].pattern, 'foo');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('returns null when there is no frontmatter block', () => {
  const { dir, full } = tmpFile('e.md', '# just a heading\n\nbody\n');
  try {
    assert.strictEqual(readSpecFrontmatter(full), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('returns null for an unreadable path', () => {
  assert.strictEqual(readSpecFrontmatter('/no/such/spec.md'), null);
});

test('returns null on malformed yaml rather than throwing', () => {
  const { dir, full } = tmpFile('f.md', ['---', '  badindent: true', 'name: x', '---'].join('\n'));
  try {
    // yaml-mini requires column-0 start; a parse error fails open to null.
    assert.strictEqual(readSpecFrontmatter(full), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

console.log('\nspec-frontmatter: .yaml comment metadata');

test('reads comment-based metadata from a .yaml spec', () => {
  const { dir, full } = tmpFile('g.yaml', [
    '# Spec metadata (for enforce-specs integration):',
    '#   name: system-map',
    '#   description: How components connect.',
    '#   applies_to: defined in stack-config.yaml',
    '#   category: architecture',
    '',
    'real: data'
  ].join('\n'));
  try {
    const fm = readSpecFrontmatter(full);
    assert.strictEqual(fm.name, 'system-map');
    assert.strictEqual(fm.category, 'architecture');
    assert.deepStrictEqual(fm.applies_to, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('returns null for a .yaml file with no metadata comments', () => {
  const { dir, full } = tmpFile('h.yaml', 'key: value\nother: thing\n');
  try {
    assert.strictEqual(readSpecFrontmatter(full), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

console.log('\nspec-frontmatter: integration on real kit specs');

test('every real spec with a frontmatter block parses without throwing', () => {
  const root = path.resolve(__dirname, '..', '..', 'specs');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
    const full = path.join(d, e.name);
    if (e.isDirectory()) return walk(full);
    return (e.name.endsWith('.md') && e.name !== 'README.md') ? [full] : [];
  });
  let parsed = 0;
  for (const f of walk(root)) {
    const content = fs.readFileSync(f, 'utf8');
    if (!/^---\n[\s\S]*?\n---/.test(content)) continue;
    const fm = readSpecFrontmatter(f);
    assert.ok(fm !== null, `expected ${path.relative(root, f)} to parse`);
    parsed++;
  }
  assert.ok(parsed > 0, 'expected at least one real spec with frontmatter');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
