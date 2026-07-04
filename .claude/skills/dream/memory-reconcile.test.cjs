#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  listMemoryFiles,
  indexedNames,
  isEval,
  isProjectLike,
  isFeedbackLike,
  isTombstone,
  classify,
} = require('./memory-reconcile.cjs');

// --- name classifiers (start-anchored) ---
assert.strictEqual(isEval('eval_2026_06_01_current.md'), true, 'eval_ is a snapshot');
assert.strictEqual(isEval('feedback_evaluate_independently.md'), false, 'mid-name "eval" is not a snapshot');
assert.strictEqual(isProjectLike('project_x.md'), true, 'project_ is project-like');
assert.strictEqual(isProjectLike('observations_x.md'), true, 'observations_ is project-like');
assert.strictEqual(isProjectLike('feedback_x.md'), false, 'feedback_ is not project-like');
assert.strictEqual(isFeedbackLike('feedback_x.md'), true, 'feedback_ is feedback-like');
assert.strictEqual(isFeedbackLike('user_profile.md'), true, 'user_ is feedback-like');

// --- tombstone detection ---
assert.strictEqual(isTombstone('KILLED, not deferred — do not revive'), true, 'killed-not-deferred is a tombstone');
assert.strictEqual(isTombstone('Do NOT resurface this direction'), true, 'do-not-resurface is a tombstone');
assert.strictEqual(isTombstone('keep to prevent resurrection'), true, 'keep-to-prevent is a tombstone');
assert.strictEqual(isTombstone('An ordinary stale project note.'), false, 'ordinary content is not a tombstone');

// --- listMemoryFiles: durable .md only, evals INCLUDED, missing dir safe ---
assert.deepStrictEqual(listMemoryFiles('/no/such/dir/here'), [], 'absent dir → []');

// --- full classify() against a temp corpus + temp shared layer ---
const memDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-reconcile-'));
const sharedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-shared-'));
try {
  const w = (dir, name, body) => fs.writeFileSync(path.join(dir, name), body);

  // Index references 4 real files + 1 ghost (missing).
  w(
    memDir,
    'MEMORY.md',
    [
      '# Memory Index',
      '- [Quality](feedback_quality.md) — hook',
      '- [Active](project_active.md) — hook',
      '- [Recent eval](eval_recent.md) — hook',
      '- [Shared dup](feedback_shared_dup.md) — hook',
      '- [Ghost](ghost.md) — points at nothing',
    ].join('\n')
  );
  w(memDir, '.cognee-sync-state.json', '{}'); // dotfile, ignored

  // Indexed, on disk:
  w(memDir, 'feedback_quality.md', 'durable feedback\n');
  w(memDir, 'project_active.md', 'current project state\n');
  w(memDir, 'eval_recent.md', 'recent snapshot\n');
  w(memDir, 'feedback_shared_dup.md', 'lives in shared too\n');

  // Dark (not indexed):
  w(memDir, 'eval_old.md', 'stale snapshot\n'); // deletable eval
  w(memDir, 'project_dead.md', 'superseded project note\n'); // review candidate
  w(memDir, 'project_killed.md', 'KILLED, not deferred. Do NOT revive.\n'); // tombstone
  w(memDir, 'feedback_orphan.md', 'a feedback rule not yet shared\n'); // → shared

  // Shared layer holds the canonical copy of one feedback file.
  w(sharedDir, 'feedback_shared_dup.md', 'canonical shared copy\n');

  // indexedNames parses the markdown link targets.
  assert.deepStrictEqual(
    [...indexedNames(memDir)].sort(),
    ['eval_recent.md', 'feedback_quality.md', 'feedback_shared_dup.md', 'ghost.md', 'project_active.md'],
    'indexedNames pulls every (name.md) link target, including the ghost'
  );

  const r = classify(memDir, sharedDir);

  assert.strictEqual(r.total, 8, '8 durable .md files on disk (dotfile + MEMORY.md excluded)');
  assert.strictEqual(r.indexedCount, 4, '4 of them are indexed');
  assert.deepStrictEqual(r.dark.sort(), ['eval_old.md', 'feedback_orphan.md', 'project_dead.md', 'project_killed.md'], 'dark = the 4 unindexed files');
  assert.deepStrictEqual(r.missing, ['ghost.md'], 'ghost index pointer → missing');
  assert.deepStrictEqual(r.deletableEvals, ['eval_old.md'], 'dark eval is deletable; indexed eval_recent is not');
  assert.deepStrictEqual(r.staleProjectCandidates, ['project_dead.md'], 'dark non-tombstone project → review');
  assert.deepStrictEqual(r.protectedTombstones, ['project_killed.md'], 'dark tombstone is protected, NOT a stale candidate');
  assert.deepStrictEqual(r.darkFeedbackToShared, ['feedback_orphan.md'], 'dark feedback not in shared → migrate to shared');
  assert.deepStrictEqual(r.sharedDuplicates, ['feedback_shared_dup.md'], 'per-project file also in shared → prune candidate');

  // A tombstone must never leak into the auto-deletable/review lists.
  assert.ok(!r.staleProjectCandidates.includes('project_killed.md'), 'tombstone excluded from review-delete');
  assert.ok(!r.deletableEvals.includes('eval_recent.md'), 'indexed eval excluded from deletable');
} finally {
  fs.rmSync(memDir, { recursive: true, force: true });
  fs.rmSync(sharedDir, { recursive: true, force: true });
}

process.stdout.write('All tests passed\n');
