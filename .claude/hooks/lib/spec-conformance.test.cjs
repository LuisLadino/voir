#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseDiff,
  findViolations,
  formatReport,
  matchGlob,
  ruleAppliesToFile,
  normalizeRules,
  readSpec,
  loadSpecsWithRules
} = require('./spec-conformance.cjs');

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

console.log('spec-conformance: matchGlob');

test('exact-extension match works', () => {
  assert.strictEqual(matchGlob('src/foo.tsx', '**/*.tsx'), true);
  assert.strictEqual(matchGlob('src/foo.css', '**/*.tsx'), false);
});

test('bare filename matches at any depth', () => {
  assert.strictEqual(matchGlob('a/b/c/file.md', '*.md'), true);
  assert.strictEqual(matchGlob('file.md', '*.md'), true);
});

test('directory glob respects boundaries', () => {
  assert.strictEqual(matchGlob('.claude/hooks/safety/x.cjs', '.claude/hooks/**/*.cjs'), true);
  assert.strictEqual(matchGlob('scripts/x.cjs', '.claude/hooks/**/*.cjs'), false);
});

console.log('\nspec-conformance: parseDiff');

test('parses added lines from a single-file diff', () => {
  const diff = [
    'diff --git a/src/foo.tsx b/src/foo.tsx',
    'index abc..def 100644',
    '--- a/src/foo.tsx',
    '+++ b/src/foo.tsx',
    '@@ -1,0 +2,2 @@',
    '+const color = "#fff";',
    '+export {};'
  ].join('\n');
  const entries = parseDiff(diff);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].filePath, 'src/foo.tsx');
  assert.strictEqual(entries[0].additions.length, 2);
  assert.strictEqual(entries[0].additions[0].lineNo, 2);
  assert.strictEqual(entries[0].additions[0].content, 'const color = "#fff";');
  assert.strictEqual(entries[0].additions[1].lineNo, 3);
});

test('parses multiple files', () => {
  const diff = [
    'diff --git a/a.tsx b/a.tsx',
    '--- a/a.tsx',
    '+++ b/a.tsx',
    '@@ -0,0 +1 @@',
    '+a',
    'diff --git a/b.css b/b.css',
    '--- a/b.css',
    '+++ b/b.css',
    '@@ -5,0 +6,1 @@',
    '+b'
  ].join('\n');
  const entries = parseDiff(diff);
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].filePath, 'a.tsx');
  assert.strictEqual(entries[1].filePath, 'b.css');
  assert.strictEqual(entries[1].additions[0].lineNo, 6);
});

test('ignores removals', () => {
  const diff = [
    'diff --git a/foo b/foo',
    '--- a/foo',
    '+++ b/foo',
    '@@ -1,2 +1,1 @@',
    '-removed',
    '+kept'
  ].join('\n');
  const entries = parseDiff(diff);
  assert.strictEqual(entries[0].additions.length, 1);
  assert.strictEqual(entries[0].additions[0].content, 'kept');
});

test('handles deleted files (/dev/null target)', () => {
  const diff = [
    'diff --git a/old b/old',
    'deleted file mode 100644',
    '--- a/old',
    '+++ /dev/null',
    '@@ -1,1 +0,0 @@',
    '-gone'
  ].join('\n');
  const entries = parseDiff(diff);
  assert.strictEqual(entries.length, 0);
});

test('returns empty for empty input', () => {
  assert.deepStrictEqual(parseDiff(''), []);
  assert.deepStrictEqual(parseDiff(null), []);
});

console.log('\nspec-conformance: normalizeRules');

test('drops rules missing required fields', () => {
  const captured = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (m) => { captured.push(m); return true; };
  try {
    const rules = normalizeRules({
      conformance_rules: [
        { name: 'ok', pattern: 'foo', message: 'fix' },
        { name: 'missing-pattern', message: 'fix' },
        { pattern: 'foo', message: 'fix' },
        { name: 'bad', pattern: '[', message: 'fix' },
        'not-a-map'
      ]
    }, '/fake.md');
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].name, 'ok');
  } finally {
    process.stderr.write = origWrite;
  }
  assert.ok(captured.some(m => m.includes('missing name, pattern, or message')));
  assert.ok(captured.some(m => m.includes('invalid regex')));
});

test('parses applies_to and excludes when present', () => {
  const rules = normalizeRules({
    conformance_rules: [{
      name: 'r', pattern: 'x', message: 'm',
      applies_to: ['**/*.tsx'],
      excludes: ['**/skip/**']
    }]
  }, '/fake.md');
  assert.deepStrictEqual(rules[0].appliesTo, ['**/*.tsx']);
  assert.deepStrictEqual(rules[0].excludes, ['**/skip/**']);
});

console.log('\nspec-conformance: ruleAppliesToFile');

test('uses spec applies_to when rule has none', () => {
  const spec = { appliesTo: ['**/*.tsx'], excludes: [] };
  const rule = { appliesTo: null, excludes: [] };
  assert.strictEqual(ruleAppliesToFile(rule, spec, 'src/x.tsx'), true);
  assert.strictEqual(ruleAppliesToFile(rule, spec, 'src/x.css'), false);
});

test('rule applies_to overrides spec applies_to', () => {
  const spec = { appliesTo: ['**/*.tsx', '**/*.css'], excludes: [] };
  const rule = { appliesTo: ['**/*.tsx'], excludes: [] };
  assert.strictEqual(ruleAppliesToFile(rule, spec, 'src/x.tsx'), true);
  assert.strictEqual(ruleAppliesToFile(rule, spec, 'src/x.css'), false);
});

test('respects spec-level excludes', () => {
  const spec = { appliesTo: ['**/*.tsx'], excludes: ['**/vendor/**'] };
  const rule = { appliesTo: null, excludes: [] };
  assert.strictEqual(ruleAppliesToFile(rule, spec, 'src/x.tsx'), true);
  assert.strictEqual(ruleAppliesToFile(rule, spec, 'src/vendor/x.tsx'), false);
});

test('respects rule-level excludes on top of spec', () => {
  const spec = { appliesTo: ['**/*.tsx'], excludes: [] };
  const rule = { appliesTo: null, excludes: ['**/tokens.*'] };
  assert.strictEqual(ruleAppliesToFile(rule, spec, 'src/foo.tsx'), true);
  assert.strictEqual(ruleAppliesToFile(rule, spec, 'src/tokens.tsx'), false);
});

console.log('\nspec-conformance: findViolations');

test('reports violation for matching added line', () => {
  const specs = [{
    name: 'design-craft',
    specPath: '/specs/craft.md',
    appliesTo: ['**/*.tsx'],
    excludes: [],
    rules: [{
      name: 'no-pure-white',
      regex: /#fff\b/,
      pattern: '#fff\\b',
      message: 'no #fff',
      appliesTo: null,
      excludes: []
    }]
  }];
  const entries = [{
    filePath: 'src/Card.tsx',
    additions: [{ lineNo: 10, content: 'color: "#fff",' }]
  }];
  const { violations: v } = findViolations(entries, specs);
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].filePath, 'src/Card.tsx');
  assert.strictEqual(v[0].lineNo, 10);
  assert.strictEqual(v[0].ruleName, 'no-pure-white');
  assert.strictEqual(v[0].specName, 'design-craft');
});

test('skips files outside the rule scope', () => {
  const specs = [{
    name: 'design-craft',
    specPath: '/specs/craft.md',
    appliesTo: ['**/*.tsx'],
    excludes: [],
    rules: [{
      name: 'r', regex: /#fff/, pattern: '#fff',
      message: 'm', appliesTo: null, excludes: []
    }]
  }];
  const entries = [{
    filePath: 'README.md',
    additions: [{ lineNo: 1, content: 'use #fff to denote pure white' }]
  }];
  assert.deepStrictEqual(findViolations(entries, specs).violations, []);
});

test('empty specs list yields no violations', () => {
  const entries = [{ filePath: 'src/x.tsx', additions: [{ lineNo: 1, content: '#fff' }] }];
  assert.deepStrictEqual(findViolations(entries, []).violations, []);
});

test('one rule, multiple matches across files', () => {
  const specs = [{
    name: 's', specPath: '/s.md',
    appliesTo: ['**/*.tsx'], excludes: [],
    rules: [{
      name: 'r', regex: /BANNED/, pattern: 'BANNED',
      message: 'm', appliesTo: null, excludes: []
    }]
  }];
  const entries = [
    { filePath: 'a.tsx', additions: [{ lineNo: 5, content: 'BANNED' }] },
    { filePath: 'b.tsx', additions: [{ lineNo: 9, content: 'also BANNED here' }] }
  ];
  const { violations: v } = findViolations(entries, specs);
  assert.strictEqual(v.length, 2);
});

test('skips lines past maxLineLength to defuse minified-line ReDoS', () => {
  const specs = [{
    name: 's', specPath: '/s.md',
    appliesTo: ['**/*.tsx'], excludes: [],
    rules: [{
      name: 'r', regex: /BANNED/, pattern: 'BANNED',
      message: 'm', appliesTo: null, excludes: []
    }]
  }];
  const huge = 'BANNED'.padEnd(5000, '-');
  const entries = [{ filePath: 'x.tsx', additions: [{ lineNo: 1, content: huge }] }];
  const { violations: v } = findViolations(entries, specs, { maxLineLength: 4096 });
  assert.strictEqual(v.length, 0);
});

test('aborts and flags when wall-clock budget is exceeded', () => {
  const specs = [{
    name: 's', specPath: '/s.md',
    appliesTo: ['**/*.tsx'], excludes: [],
    rules: [{
      name: 'r', regex: /BANNED/, pattern: 'BANNED',
      message: 'm', appliesTo: null, excludes: []
    }]
  }];
  const entries = [{ filePath: 'x.tsx', additions: [{ lineNo: 1, content: 'BANNED' }] }];
  let ticks = 0;
  const captured = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (m) => { captured.push(m); return true; };
  try {
    const result = findViolations(entries, specs, {
      maxScanMs: 1,
      now: () => { ticks += 1; return ticks * 10; }
    });
    assert.strictEqual(result.aborted, true);
    assert.strictEqual(result.violations.length, 0);
  } finally {
    process.stderr.write = origWrite;
  }
  assert.ok(captured.some(m => m.includes('exceeded') && m.includes('budget')));
});

console.log('\nspec-conformance: formatReport');

test('formats per-file grouped violations with the principle', () => {
  const violations = [{
    filePath: 'src/Card.tsx',
    lineNo: 10,
    content: '  color: "#fff",',
    specName: 'craft',
    specPath: '/specs/craft.md',
    ruleName: 'no-pure-white',
    ruleMessage: 'Use an off-white token.'
  }];
  const r = formatReport(violations);
  assert.ok(r.includes('[BLOCKED]'));
  assert.ok(r.includes('src/Card.tsx'));
  assert.ok(r.includes('craft > no-pure-white'));
  assert.ok(r.includes('Use an off-white token.'));
  assert.ok(r.includes('every token on that line in scope'));
});

test('empty violations gives empty string', () => {
  assert.strictEqual(formatReport([]), '');
});

console.log('\nspec-conformance: readSpec + loadSpecsWithRules');

test('readSpec parses frontmatter with conformance_rules sequence-of-maps', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-conf-'));
  const specPath = path.join(tmpDir, 'sample.md');
  fs.writeFileSync(specPath, [
    '---',
    'name: sample',
    'applies_to:',
    '  - "**/*.tsx"',
    'category: design',
    'conformance_rules:',
    '  - name: r1',
    '    pattern: "foo"',
    '    message: |',
    '      bad foo',
    '---',
    '',
    '# body'
  ].join('\n'));
  const parsed = readSpec(specPath);
  assert.strictEqual(parsed.name, 'sample');
  assert.strictEqual(Array.isArray(parsed.conformance_rules), true);
  assert.strictEqual(parsed.conformance_rules.length, 1);
  assert.strictEqual(parsed.conformance_rules[0].name, 'r1');
  assert.strictEqual(parsed.conformance_rules[0].pattern, 'foo');
  fs.rmSync(tmpDir, { recursive: true });
});

test('loadSpecsWithRules returns specs from a temp workspace', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-conf-ws-'));
  const specsDir = path.join(tmpDir, '.claude', 'specs', 'design');
  fs.mkdirSync(specsDir, { recursive: true });
  fs.writeFileSync(path.join(specsDir, 'demo.md'), [
    '---',
    'name: demo',
    'applies_to:',
    '  - "**/*.tsx"',
    'category: design',
    'conformance_rules:',
    '  - name: ban-x',
    '    pattern: "BANNED"',
    '    message: "no BANNED"',
    '---'
  ].join('\n'));
  const specs = loadSpecsWithRules(tmpDir);
  assert.strictEqual(specs.length, 1);
  assert.strictEqual(specs[0].name, 'demo');
  assert.strictEqual(specs[0].rules.length, 1);
  assert.strictEqual(specs[0].rules[0].name, 'ban-x');
  fs.rmSync(tmpDir, { recursive: true });
});

test('loadSpecsWithRules skips specs without conformance_rules', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-conf-ws-'));
  const specsDir = path.join(tmpDir, '.claude', 'specs');
  fs.mkdirSync(specsDir, { recursive: true });
  fs.writeFileSync(path.join(specsDir, 'plain.md'), [
    '---',
    'name: plain',
    'applies_to:',
    '  - "**/*.ts"',
    '---'
  ].join('\n'));
  const specs = loadSpecsWithRules(tmpDir);
  assert.deepStrictEqual(specs, []);
  fs.rmSync(tmpDir, { recursive: true });
});

console.log('\nspec-conformance: integration on real kit specs');

test('craft.md ships at least one conformance rule', () => {
  const cwd = path.resolve(__dirname, '..', '..', '..');
  const specs = loadSpecsWithRules(cwd);
  const craft = specs.find(s => s.name === 'design-craft');
  assert.ok(craft, 'expected design-craft spec to surface conformance rules');
  assert.ok(craft.rules.length >= 1, 'expected at least one rule on craft.md');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
