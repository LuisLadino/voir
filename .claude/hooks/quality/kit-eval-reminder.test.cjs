#!/usr/bin/env node

const assert = require('assert');
const path = require('path');

const {
  loadCorpora,
  remindersFor,
  formatReminder
} = require('./kit-eval-reminder.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.stack}`); }
}

// --- coupling seam: the hook reuses these exports from sibling modules ---
// A silent rename or signature change there makes the reminder stop firing with
// no error (the hook fails open). Guard the contract so CI catches it, symmetric
// with the tests_source drift guard in kit-eval-corpora.test.cjs.

test('the reused import contract holds', () => {
  const checkSpec = require('../safety/check-spec-conformance.cjs');
  const specConf = require('../lib/spec-conformance.cjs');
  const specFm = require('../lib/spec-frontmatter.cjs');
  assert.strictEqual(typeof checkSpec.isGitPush, 'function');
  assert.strictEqual(typeof checkSpec.isPrCreate, 'function');
  assert.strictEqual(typeof checkSpec.getPushDiff, 'function');
  assert.strictEqual(typeof specConf.parseDiff, 'function');
  assert.strictEqual(typeof specConf.matchGlob, 'function');
  assert.strictEqual(typeof specFm.readSpecFrontmatter, 'function');
});

// --- remindersFor: the pure changed-files x corpora mapping ---

const CORPORA = [
  {
    name: 'response-format',
    scope: 'instruction-wording',
    command: 'node .claude/scripts/instruction-wording-walk.cjs response-format',
    sources: ['.claude/hooks/context/inject-context.cjs'],
    corpusPath: '.claude/research/instruction-wording-evals/response-format.md'
  },
  {
    name: 'commit',
    scope: 'skill-output',
    command: 'node .claude/scripts/skill-output-eval.cjs commit',
    sources: ['.claude/skills/commit/SKILL.md'],
    corpusPath: '.claude/research/skill-output-evals/commit.md'
  }
];

test('a changed watched file produces a reminder with the exact walk command', () => {
  const r = remindersFor(['.claude/skills/commit/SKILL.md', 'README.md'], CORPORA);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].name, 'commit');
  assert.strictEqual(r[0].command, 'node .claude/scripts/skill-output-eval.cjs commit');
  assert.deepStrictEqual(r[0].matched, ['.claude/skills/commit/SKILL.md']);
});

test('a change touching no watched file produces no reminder', () => {
  const r = remindersFor(['src/index.ts', 'package.json'], CORPORA);
  assert.deepStrictEqual(r, []);
});

test('changes touching multiple corpora produce one reminder each', () => {
  const r = remindersFor(
    ['.claude/hooks/context/inject-context.cjs', '.claude/skills/commit/SKILL.md'],
    CORPORA
  );
  assert.strictEqual(r.length, 2);
  const names = r.map(x => x.name).sort();
  assert.deepStrictEqual(names, ['commit', 'response-format']);
});

test('one corpus matched by several changed files reports all of them once', () => {
  const corpora = [{
    name: 'specs', scope: 'instruction-wording',
    command: 'node .claude/scripts/instruction-wording-walk.cjs specs',
    sources: ['.claude/specs/**/*.md'],
    corpusPath: 'x'
  }];
  const r = remindersFor(['.claude/specs/kit/a.md', '.claude/specs/kit/b.md', 'other.md'], corpora);
  assert.strictEqual(r.length, 1);
  assert.deepStrictEqual(r[0].matched, ['.claude/specs/kit/a.md', '.claude/specs/kit/b.md']);
});

test('a glob source matches by pattern, not just exact path', () => {
  const corpora = [{
    name: 'g', scope: 'skill-output',
    command: 'node .claude/scripts/skill-output-eval.cjs g',
    sources: ['.claude/skills/*/SKILL.md'],
    corpusPath: 'x'
  }];
  const r = remindersFor(['.claude/skills/build/SKILL.md'], corpora);
  assert.strictEqual(r.length, 1);
});

// --- formatReminder: the advisory message ---

test('formatReminder names the command, the files, and frames as advisory', () => {
  const text = formatReminder(remindersFor(['.claude/skills/commit/SKILL.md'], CORPORA));
  assert.ok(text.includes('node .claude/scripts/skill-output-eval.cjs commit'), 'has the walk command');
  assert.ok(text.includes('.claude/skills/commit/SKILL.md'), 'names the changed file');
  assert.ok(/advisory/i.test(text), 'frames as advisory');
  assert.ok(/kit-eval/i.test(text), 'references kit-eval');
});

// --- loadCorpora: against the real repo corpora ---

test('loadCorpora reads tests_source and derives the right walk per scope', () => {
  const corpora = loadCorpora(REPO_ROOT);
  const rf = corpora.find(c => c.name === 'response-format');
  const commit = corpora.find(c => c.name === 'commit');
  assert.ok(rf, 'response-format corpus loaded');
  assert.strictEqual(rf.scope, 'instruction-wording');
  assert.strictEqual(rf.command, 'node .claude/scripts/instruction-wording-walk.cjs response-format');
  assert.ok(rf.sources.includes('.claude/hooks/context/inject-context.cjs'));
  assert.ok(commit, 'commit corpus loaded');
  assert.strictEqual(commit.scope, 'skill-output');
  assert.strictEqual(commit.command, 'node .claude/scripts/skill-output-eval.cjs commit');
  assert.ok(commit.sources.includes('.claude/skills/commit/SKILL.md'));
});

test('the real corpora resolve end to end: editing inject-context.cjs reminds the wording walk', () => {
  const r = remindersFor(['.claude/hooks/context/inject-context.cjs'], loadCorpora(REPO_ROOT));
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].command, 'node .claude/scripts/instruction-wording-walk.cjs response-format');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
