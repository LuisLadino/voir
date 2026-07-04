#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DEFAULT_THRESHOLD,
  resolveThreshold,
  countUnreleasedEntries,
  readUnreleasedCount,
  shouldPromptReleaseCut,
  releaseCutMessage,
} = require('./release-cadence.cjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.stack}`); }
}

function withTempProject(fn) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'release-cadence-')));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const KIT_STYLE = `# Changelog

## [Unreleased]

### Added

- **First feature (#1).** Body text.
- **Second feature (#2).** Body text.

### Changed

- **A change (#3).** Body text.

### Fixed

- **A fix (#4).** Body text.

## [3.0.0] - 2026-07-03

### Added

- **Old released entry (#0).** Must not be counted.
- **Another old entry.** Must not be counted.
`;

console.log('countUnreleasedEntries');

test('counts top-level entries across subsections, stops at the next version header', () => {
  assert.strictEqual(countUnreleasedEntries(KIT_STYLE), 4);
});

test('excludes indented sub-bullets', () => {
  const text = `## [Unreleased]

### Added

- **Parent entry.** Has sub-points:
  - a sub-bullet
  - another sub-bullet
- **Second entry.**
`;
  assert.strictEqual(countUnreleasedEntries(text), 2);
});

test('excludes ### subsection headers and blank lines', () => {
  const text = `## [Unreleased]

### Added

### Changed

- **Only real entry.**
`;
  assert.strictEqual(countUnreleasedEntries(text), 1);
});

test('returns 0 when there is no [Unreleased] header', () => {
  assert.strictEqual(countUnreleasedEntries('# Changelog\n\n## [2.0.0]\n\n- entry\n'), 0);
});

test('returns 0 for an empty [Unreleased] section', () => {
  assert.strictEqual(countUnreleasedEntries('## [Unreleased]\n\n### Added\n\n## [1.0.0]\n\n- old\n'), 0);
});

test('returns 0 for empty or non-string input', () => {
  assert.strictEqual(countUnreleasedEntries(''), 0);
  assert.strictEqual(countUnreleasedEntries(null), 0);
  assert.strictEqual(countUnreleasedEntries(undefined), 0);
});

test('counts only the first [Unreleased] section', () => {
  const text = `## [Unreleased]

- **one**

## [1.0.0]

- old

## [Unreleased]

- **stray second unreleased, not counted**
`;
  assert.strictEqual(countUnreleasedEntries(text), 1);
});

console.log('\nresolveThreshold');

test('defaults to 30 with no env override', () => {
  assert.strictEqual(resolveThreshold({}), DEFAULT_THRESHOLD);
  assert.strictEqual(DEFAULT_THRESHOLD, 30);
});

test('honors a valid positive integer env override', () => {
  assert.strictEqual(resolveThreshold({ CLAUDE_RELEASE_CADENCE_THRESHOLD: '10' }), 10);
});

test('falls back to default on non-integer, zero, or negative override', () => {
  assert.strictEqual(resolveThreshold({ CLAUDE_RELEASE_CADENCE_THRESHOLD: 'abc' }), 30);
  assert.strictEqual(resolveThreshold({ CLAUDE_RELEASE_CADENCE_THRESHOLD: '0' }), 30);
  assert.strictEqual(resolveThreshold({ CLAUDE_RELEASE_CADENCE_THRESHOLD: '-5' }), 30);
});

console.log('\nshouldPromptReleaseCut');

test('true at and above threshold, false below', () => {
  assert.strictEqual(shouldPromptReleaseCut(29, 30), false);
  assert.strictEqual(shouldPromptReleaseCut(30, 30), true);
  assert.strictEqual(shouldPromptReleaseCut(31, 30), true);
});

test('uses the default threshold when none passed', () => {
  assert.strictEqual(shouldPromptReleaseCut(30), true);
  assert.strictEqual(shouldPromptReleaseCut(29), false);
});

console.log('\nreadUnreleasedCount');

test('returns null when no CHANGELOG.md exists', () => {
  withTempProject(dir => {
    assert.strictEqual(readUnreleasedCount(dir), null);
  });
});

test('reads and counts a present CHANGELOG.md', () => {
  withTempProject(dir => {
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), KIT_STYLE);
    const result = readUnreleasedCount(dir);
    assert.strictEqual(result.count, 4);
    assert.strictEqual(result.path, path.join(dir, 'CHANGELOG.md'));
  });
});

console.log('\nreleaseCutMessage');

test('names the count, the threshold, and points at CONTRIBUTING.md', () => {
  const msg = releaseCutMessage(31, 30);
  assert.ok(msg.includes('31'), 'includes count');
  assert.ok(msg.includes('30'), 'includes threshold');
  assert.ok(/CONTRIBUTING\.md/.test(msg), 'points at CONTRIBUTING.md');
  assert.ok(msg.startsWith('[RELEASE]'), 'tagged [RELEASE]');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
