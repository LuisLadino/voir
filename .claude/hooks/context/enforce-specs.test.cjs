#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanSpecFiles, findAllMatchingSpecs } = require('./enforce-specs.cjs');

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

function writeSpec(root, rel, lines) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, lines.join('\n'));
}

console.log('enforce-specs: scanSpecFiles');

test('block-style applies_to spec is enforced with parsed patterns and excludes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enf-'));
  try {
    writeSpec(root, '.claude/specs/kit/real.md', [
      '---', 'name: real-spec',
      'applies_to:', '  - "**/*.tsx"', '  - "src/**/*.ts"',
      'excludes:', '  - "**/vendor/**"',
      'category: coding', '---', '', '# body'
    ]);
    const specs = scanSpecFiles(root);
    const m = specs.find(s => s.name === 'real-spec');
    assert.ok(m, 'expected real-spec in mappings');
    assert.deepStrictEqual(m.patterns, ['**/*.tsx', 'src/**/*.ts']);
    assert.deepStrictEqual(m.excludes, ['**/vendor/**']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('flow-style empty applies_to: [] spec is NOT enforced', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enf-'));
  try {
    writeSpec(root, '.claude/specs/kit/empty.md', [
      '---', 'name: empty-spec', 'applies_to: []', 'related: [other]', 'category: meta', '---'
    ]);
    const specs = scanSpecFiles(root);
    assert.ok(!specs.some(s => s.name === 'empty-spec'), 'empty applies_to must not enforce');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('name falls back to basename when frontmatter omits name', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enf-'));
  try {
    writeSpec(root, '.claude/specs/kit/noname.md', ['---', 'applies_to:', '  - "**/*.md"', '---']);
    const specs = scanSpecFiles(root);
    const m = specs.find(s => s.specPath.endsWith('noname.md'));
    assert.ok(m);
    assert.strictEqual(m.name, 'noname');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('related parses to an array via the flow-sequence extension', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enf-'));
  try {
    writeSpec(root, '.claude/specs/kit/rel.md', [
      '---', 'name: rel', 'applies_to:', '  - "**/*.cjs"', 'related: [a, b, c]', '---'
    ]);
    const specs = scanSpecFiles(root);
    assert.deepStrictEqual(specs.find(s => s.name === 'rel').related, ['a', 'b', 'c']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

console.log('\nenforce-specs: findAllMatchingSpecs');

test('matches a file against applies_to and returns the spec', () => {
  const mappings = [{ name: 'x', specPath: '.claude/specs/x.md', patterns: ['**/*.tsx'], excludes: [], related: [] }];
  const matches = findAllMatchingSpecs(path.resolve('src/Foo.tsx'), mappings);
  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].name, 'x');
});

test('excludes suppress an otherwise-matching spec', () => {
  const mappings = [{ name: 'x', specPath: '.claude/specs/x.md', patterns: ['**/*.tsx'], excludes: ['**/vendor/**'], related: [] }];
  assert.strictEqual(findAllMatchingSpecs(path.resolve('src/vendor/Foo.tsx'), mappings).length, 0);
  assert.strictEqual(findAllMatchingSpecs(path.resolve('src/Foo.tsx'), mappings).length, 1);
});

test('a non-matching path returns no specs', () => {
  const mappings = [{ name: 'x', specPath: '.claude/specs/x.md', patterns: ['**/*.tsx'], excludes: [], related: [] }];
  assert.strictEqual(findAllMatchingSpecs(path.resolve('src/Foo.css'), mappings).length, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
