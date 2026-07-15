#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  parseSections,
  collectSections,
  mergeIntoUnreleased,
  extractUnreleased,
  listFragmentFiles,
  FRAGMENT_DIR,
  SUBSECTIONS,
} = require('./changelog-assemble.cjs');

const emptyMap = () => Object.fromEntries(SUBSECTIONS.map((k) => [k, []]));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.stack}`); }
}
function withTempDir(fn) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'changelog-assemble-')));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

console.log('parseSections');

test('buckets bullets by ### subsection', () => {
  const out = parseSections(`### Added\n- **A feature (#1).**\n\n### Fixed\n- **A fix (#2).**\n`);
  assert.strictEqual(out.Added.length, 1);
  assert.strictEqual(out.Fixed.length, 1);
  assert.ok(out.Added[0].includes('A feature'));
});

test('keeps indented sub-bullets with their parent block', () => {
  const out = parseSections(`### Changed\n- **Parent (#3).** Details:\n  - sub one\n  - sub two\n`);
  assert.strictEqual(out.Changed.length, 1);
  assert.ok(out.Changed[0].includes('sub one') && out.Changed[0].includes('sub two'));
});

test('ignores content with no recognized subsection', () => {
  assert.deepStrictEqual(parseSections(`- orphan bullet, no header\n`), emptyMap());
});

test('handles empty / non-string input', () => {
  assert.deepStrictEqual(parseSections(''), emptyMap());
  assert.deepStrictEqual(parseSections(null), emptyMap());
});

test('recognizes all six Keep-a-Changelog subsections including Deprecated and Security', () => {
  const out = parseSections(`### Deprecated\n- **dep (#1)**\n\n### Security\n- **sec (#2)**\n`);
  assert.strictEqual(out.Deprecated.length, 1, 'Deprecated parsed');
  assert.strictEqual(out.Security.length, 1, 'Security parsed');
  assert.ok(out.Security[0].includes('sec (#2)'));
});

test('a fragment cannot smuggle an `## [version]` header into a bullet body', () => {
  // The injected h2 must not survive as continuation text — it would mis-slice
  // [Unreleased] on the next parse. It resets context; the bullet before it is kept.
  const out = parseSections(`### Added\n- **real (#3).** Detail.\n## [9.9.9] injected\n- **stray after boundary**\n`);
  assert.strictEqual(out.Added.length, 1, 'only the pre-boundary bullet is kept under Added');
  assert.ok(!out.Added[0].includes('9.9.9'), 'injected version header not swallowed into the block');
});

test('an existing `### Security` block folds through merge instead of being dropped', () => {
  const base = `## [Unreleased]\n\n### Security\n\n- **existing advisory (#0).**\n\n## [1.0.0]\n\n- old\n`;
  const collected = collectSections([parseSections(`### Added\n- **new (#7).**\n`)]);
  const unrel = extractUnreleased(mergeIntoUnreleased(base, collected));
  assert.ok(unrel.includes('existing advisory (#0)'), 'existing Security entry survives the round-trip');
  assert.ok(unrel.includes('new (#7)'), 'fragment Added folded in');
  assert.ok(unrel.indexOf('### Added') < unrel.indexOf('### Security'), 'Added emitted before Security (KaC order)');
});

console.log('\ncollectSections');

test('merges maps preserving order', () => {
  const merged = collectSections([parseSections(`### Added\n- **one**\n`), parseSections(`### Added\n- **two**\n`)]);
  assert.strictEqual(merged.Added.length, 2);
  assert.ok(merged.Added[0].includes('one') && merged.Added[1].includes('two'));
});

console.log('\nmergeIntoUnreleased');

const BASE = `# Changelog\n\n## [Unreleased]\n\n### Added\n\n- **Existing (#0).**\n\n## [1.0.0] - 2026-01-01\n\n### Added\n\n- **Old.**\n`;

test('folds fragments under matching subsections, keeps existing, leaves released untouched', () => {
  const collected = collectSections([parseSections(`### Added\n- **New feature (#5).**\n\n### Fixed\n- **New fix (#6).**\n`)]);
  const out = mergeIntoUnreleased(BASE, collected);
  const unrel = extractUnreleased(out);
  assert.ok(unrel.includes('Existing (#0)'), 'keeps existing');
  assert.ok(unrel.includes('New feature (#5)'), 'adds Added');
  assert.ok(unrel.includes('New fix (#6)'), 'adds Fixed');
  assert.ok(!out.slice(out.indexOf('## [1.0.0]')).includes('New feature'), 'released section untouched');
});

test('canonical subsection order Added, Changed, Removed, Fixed', () => {
  const collected = collectSections([parseSections(`### Fixed\n- **f**\n\n### Added\n- **a**\n\n### Removed\n- **r**\n`)]);
  const unrel = extractUnreleased(mergeIntoUnreleased(`## [Unreleased]\n\n## [1.0.0]\n\n- old\n`, collected));
  assert.ok(unrel.indexOf('### Added') < unrel.indexOf('### Removed'), 'Added before Removed');
  assert.ok(unrel.indexOf('### Removed') < unrel.indexOf('### Fixed'), 'Removed before Fixed');
});

test('throws when no [Unreleased] header', () => {
  assert.throws(() => mergeIntoUnreleased('# Changelog\n\n## [1.0.0]\n\n- x\n', collectSections([])));
});

console.log('\nlistFragmentFiles');

test('lists *.md except README, sorted; empty when dir missing', () => {
  withTempDir((dir) => {
    assert.deepStrictEqual(listFragmentFiles(path.join(dir, 'nope')), []);
    const fdir = path.join(dir, FRAGMENT_DIR);
    fs.mkdirSync(fdir);
    for (const n of ['README.md', 'b.md', 'a.md', 'note.txt']) fs.writeFileSync(path.join(fdir, n), 'x');
    assert.deepStrictEqual(listFragmentFiles(fdir).map((f) => path.basename(f)), ['a.md', 'b.md']);
  });
});

console.log('\nCLI assembly (deletion safety)');

const CLI = path.resolve(__dirname, 'changelog-assemble.cjs');
function runCli(cwd, args = []) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
}

test('CLI folds good fragments, deletes them, and LEAVES a malformed fragment in place', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n### Added\n\n## [1.0.0]\n\n- old\n');
    const fdir = path.join(dir, FRAGMENT_DIR);
    fs.mkdirSync(fdir);
    fs.writeFileSync(path.join(fdir, 'good.md'), '### Added\n- **good (#1)**\n');
    fs.writeFileSync(path.join(fdir, 'bad.md'), 'malformed, no subsection header\n');
    const r = runCli(dir);
    assert.strictEqual(r.status, 0, r.stderr);
    // good folded into [Unreleased], bad's content never lost
    assert.ok(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8').includes('good (#1)'), 'good folded');
    assert.ok(!fs.existsSync(path.join(fdir, 'good.md')), 'good fragment deleted');
    assert.ok(fs.existsSync(path.join(fdir, 'bad.md')), 'malformed fragment retained, not silently deleted');
    assert.ok(/left in place/.test(r.stderr), 'warns that malformed is retained');
    // Points operators at the synced spec, not the unsynced CONTRIBUTING.md (#924).
    assert.ok(r.stdout.includes('.claude/specs/kit/releases.md'), 'success output names the synced releases spec');
    assert.ok(!/CONTRIBUTING\.md/.test(r.stdout), 'does not dangle at the unsynced CONTRIBUTING.md');
  });
});

test('CLI exits 1 and deletes nothing when every fragment is malformed', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '## [Unreleased]\n\n## [1.0.0]\n\n- old\n');
    const fdir = path.join(dir, FRAGMENT_DIR);
    fs.mkdirSync(fdir);
    fs.writeFileSync(path.join(fdir, 'only-bad.md'), 'no header here\n');
    const r = runCli(dir);
    assert.strictEqual(r.status, 1, 'non-zero exit when nothing assembled');
    assert.ok(fs.existsSync(path.join(fdir, 'only-bad.md')), 'malformed fragment retained');
  });
});

test('CLI --draft writes nothing and deletes nothing', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '## [Unreleased]\n\n### Added\n\n## [1.0.0]\n\n- old\n');
    const fdir = path.join(dir, FRAGMENT_DIR);
    fs.mkdirSync(fdir);
    fs.writeFileSync(path.join(fdir, 'f.md'), '### Added\n- **draft (#2)**\n');
    const before = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
    const r = runCli(dir, ['--draft']);
    assert.strictEqual(r.status, 0);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8'), before, 'CHANGELOG untouched in draft');
    assert.ok(fs.existsSync(path.join(fdir, 'f.md')), 'fragment kept in draft');
    assert.ok(r.stdout.includes('draft (#2)'), 'draft previews the entry');
  });
});

test('CLI exits 1 with a clean message and keeps fragments when CHANGELOG.md is missing', () => {
  withTempDir((dir) => {
    const fdir = path.join(dir, FRAGMENT_DIR);
    fs.mkdirSync(fdir);
    fs.writeFileSync(path.join(fdir, 'f.md'), '### Added\n- **entry (#8)**\n');
    const r = runCli(dir); // no CHANGELOG.md in dir
    assert.strictEqual(r.status, 1, 'non-zero exit when CHANGELOG.md absent');
    assert.ok(/CHANGELOG\.md not found/.test(r.stderr), 'clean message, not a raw stack trace');
    assert.ok(!/at Object\.<anonymous>|\n\s+at /.test(r.stderr), 'no stack frames leaked');
    assert.ok(fs.existsSync(path.join(fdir, 'f.md')), 'fragment retained, never lost to a half-run');
  });
});

test('CLI exits 1 and keeps fragments when CHANGELOG.md has no [Unreleased] header', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [1.0.0]\n\n- old\n');
    const fdir = path.join(dir, FRAGMENT_DIR);
    fs.mkdirSync(fdir);
    fs.writeFileSync(path.join(fdir, 'f.md'), '### Added\n- **entry (#9)**\n');
    const r = runCli(dir);
    assert.strictEqual(r.status, 1, 'non-zero exit when no [Unreleased]');
    assert.ok(/Cannot assemble/.test(r.stderr), 'clean message');
    assert.ok(fs.existsSync(path.join(fdir, 'f.md')), 'fragment retained');
    assert.ok(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8').includes('## [1.0.0]'), 'CHANGELOG untouched');
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
