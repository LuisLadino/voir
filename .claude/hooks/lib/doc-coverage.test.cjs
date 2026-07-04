#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  findDocFiles,
  normalizeCovers,
  scanDocCoverage,
  matchStaleDocs,
  findDocsToVerify,
} = require('./doc-coverage.cjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.stack}`); }
}

function withTempProject(fn) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'doc-coverage-')));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function writeDoc(dir, rel, covers, body = 'doc body') {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const fm = covers === null
    ? ''
    : `---\ncovers:\n${covers.map(c => `  - "${c}"`).join('\n')}\n---\n`;
  fs.writeFileSync(full, fm + body + '\n');
}

console.log('normalizeCovers');

test('array of strings is kept, blanks dropped', () => {
  assert.deepStrictEqual(normalizeCovers(['runtime/**', '', '  ', 'x.ts']), ['runtime/**', 'x.ts']);
});

test('single string is wrapped', () => {
  assert.deepStrictEqual(normalizeCovers('runtime/**'), ['runtime/**']);
});

test('missing / non-string yields empty list', () => {
  assert.deepStrictEqual(normalizeCovers(undefined), []);
  assert.deepStrictEqual(normalizeCovers(null), []);
  assert.deepStrictEqual(normalizeCovers(42), []);
});

console.log('findDocFiles');

test('finds .md recursively, skips node_modules/.git, ignores non-md', () => {
  withTempProject(dir => {
    writeDoc(dir, 'docs/a.md', ['x']);
    writeDoc(dir, 'docs/sub/b.md', ['y']);
    fs.mkdirSync(path.join(dir, 'docs/node_modules'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs/node_modules/c.md'), 'x');
    fs.writeFileSync(path.join(dir, 'docs/notes.txt'), 'x');
    const found = findDocFiles(path.join(dir, 'docs')).map(f => path.relative(dir, f)).sort();
    assert.deepStrictEqual(found, ['docs/a.md', 'docs/sub/b.md']);
  });
});

test('missing directory returns empty, does not throw', () => {
  withTempProject(dir => {
    assert.deepStrictEqual(findDocFiles(path.join(dir, 'nope')), []);
  });
});

console.log('scanDocCoverage');

test('returns only docs with a non-empty covers list', () => {
  withTempProject(dir => {
    writeDoc(dir, 'docs/runbook.md', ['runtime/**', 'scripts/brief.*']);
    writeDoc(dir, 'docs/plain.md', null);           // no frontmatter
    writeDoc(dir, 'docs/tutorial.md', []);          // empty covers
    const mappings = scanDocCoverage(['docs'], dir);
    assert.strictEqual(mappings.length, 1);
    assert.strictEqual(mappings[0].doc, 'docs/runbook.md');
    assert.deepStrictEqual(mappings[0].covers, ['runtime/**', 'scripts/brief.*']);
  });
});

test('scans multiple roots, skips a root that does not exist', () => {
  withTempProject(dir => {
    writeDoc(dir, 'docs/a.md', ['src/**']);
    writeDoc(dir, '.claude/docs/b.md', ['lib/**']);
    const mappings = scanDocCoverage(['docs', '.claude/docs', 'missing'], dir);
    assert.deepStrictEqual(mappings.map(m => m.doc).sort(), ['.claude/docs/b.md', 'docs/a.md']);
  });
});

console.log('matchStaleDocs');

const mappings = [
  { doc: 'docs/runtime.md', covers: ['runtime/**'] },
  { doc: 'docs/brief.md', covers: ['scripts/morning-brief.*'] },
];

test('directory glob matches a changed file beneath it', () => {
  const hits = matchStaleDocs(mappings, ['runtime/server.ts']);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].doc, 'docs/runtime.md');
  assert.deepStrictEqual(hits[0].matchedPaths, ['runtime/server.ts']);
});

test('nested path under directory glob matches', () => {
  const hits = matchStaleDocs(mappings, ['runtime/sub/deep.ts']);
  assert.deepStrictEqual(hits.map(h => h.doc), ['docs/runtime.md']);
});

test('extension glob matches the exact file', () => {
  const hits = matchStaleDocs(mappings, ['scripts/morning-brief.ts']);
  assert.deepStrictEqual(hits.map(h => h.doc), ['docs/brief.md']);
});

test('unrelated change matches nothing', () => {
  assert.deepStrictEqual(matchStaleDocs(mappings, ['frontend/app.tsx']), []);
});

test('one changed path can hit multiple docs; multiple matched paths recorded', () => {
  const m = [
    { doc: 'docs/a.md', covers: ['runtime/**'] },
    { doc: 'docs/b.md', covers: ['runtime/server.ts'] },
  ];
  const hits = matchStaleDocs(m, ['runtime/server.ts', 'runtime/other.ts']);
  assert.deepStrictEqual(hits.map(h => h.doc).sort(), ['docs/a.md', 'docs/b.md']);
  const a = hits.find(h => h.doc === 'docs/a.md');
  assert.deepStrictEqual(a.matchedPaths.sort(), ['runtime/other.ts', 'runtime/server.ts']);
});

console.log('findDocsToVerify (end to end)');

test('scans roots and matches changed paths in one call', () => {
  withTempProject(dir => {
    writeDoc(dir, 'docs/runtime.md', ['runtime/**']);
    writeDoc(dir, 'docs/unrelated.md', ['marketing/**']);
    const hits = findDocsToVerify(['runtime/x.ts', 'README.md'], ['docs'], dir);
    assert.deepStrictEqual(hits.map(h => h.doc), ['docs/runtime.md']);
  });
});

test('no covered docs yields empty result', () => {
  withTempProject(dir => {
    writeDoc(dir, 'docs/plain.md', null);
    assert.deepStrictEqual(findDocsToVerify(['runtime/x.ts'], ['docs'], dir), []);
  });
});

test('default roots resolve co-located service docs, so /commit guards a service README (#835)', () => {
  withTempProject(dir => {
    fs.mkdirSync(path.join(dir, 'services'), { recursive: true });
    writeDoc(dir, 'services/sams-line/README.md', ['services/sams-line/**']);
    // roots omitted (null) → resolved from structure; the co-located README is seen.
    const hits = findDocsToVerify(['services/sams-line/persistence/db.py'], null, dir);
    assert.deepStrictEqual(hits.map(h => h.doc), ['services/sams-line/README.md']);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
