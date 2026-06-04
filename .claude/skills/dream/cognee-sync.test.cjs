#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  VOLATILE_PATTERNS,
  isVolatile,
  memoryFiles,
  concatMemory,
  sha256,
} = require('./cognee-sync.cjs');

// --- isVolatile classification ---
assert.strictEqual(isVolatile('eval_2026_06_01_current.md'), true, 'eval_ snapshot is volatile');
assert.strictEqual(isVolatile('project_handoff.md'), true, 'handoff is volatile');
assert.strictEqual(isVolatile('feedback_quality_standard.md'), false, 'feedback is durable');
assert.strictEqual(isVolatile('project_thread2_commitments.md'), false, 'durable project fact is kept');
assert.strictEqual(isVolatile('observations_voice_context_routing.md'), false, 'observation is durable');
assert.strictEqual(isVolatile('user_profile.md'), false, 'user file is durable');
assert.strictEqual(isVolatile('reference_dashboard.md'), false, 'reference is durable');

// Patterns are start-anchored: a durable file that merely contains "eval"
// mid-name must not be mis-excluded. Guards against dropping the ^ anchor.
assert.strictEqual(
  isVolatile('feedback_evaluate_independently.md'),
  false,
  'mid-name "eval" is not a volatile prefix'
);
assert.strictEqual(VOLATILE_PATTERNS.length, 2, 'exactly the two known volatile families');

// --- memoryFiles + concatMemory + hash, against a temp corpus ---
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cognee-sync-test-'));
try {
  const write = (name, body) => fs.writeFileSync(path.join(dir, name), body);

  write('MEMORY.md', '# index\n'); // index, never synced
  write('.cognee-sync-state.json', '{}'); // dotfile, never synced
  write('feedback_quality.md', 'durable A\n');
  write('project_thread2.md', 'durable B\n');
  write('eval_2026_06_01.md', 'snapshot v1\n'); // volatile
  write('project_handoff.md', 'handoff v1\n'); // volatile

  assert.deepStrictEqual(
    memoryFiles(dir),
    ['feedback_quality.md', 'project_thread2.md'],
    'memoryFiles keeps only durable .md, drops MEMORY.md / dotfile / volatile'
  );

  const concat = concatMemory(dir);
  assert.ok(concat.includes('durable A') && concat.includes('durable B'), 'durable content present');
  assert.ok(!concat.includes('snapshot v1'), 'eval snapshot excluded from payload');
  assert.ok(!concat.includes('handoff v1'), 'handoff excluded from payload');

  // The fix, stated as a hash invariant: volatile churn must NOT move the hash.
  const hashBefore = sha256(concatMemory(dir));
  write('eval_2026_06_01.md', 'snapshot v2 — totally different\n');
  write('project_handoff.md', 'handoff v2 — also changed\n');
  write('eval_2026_06_02.md', 'a brand new snapshot\n'); // new volatile file appears
  assert.strictEqual(
    sha256(concatMemory(dir)),
    hashBefore,
    'volatile changes (and new volatile files) do not flip the sync hash'
  );

  // A durable change MUST move the hash — the sync still fires when it should.
  write('feedback_quality.md', 'durable A — revised\n');
  assert.notStrictEqual(
    sha256(concatMemory(dir)),
    hashBefore,
    'a durable change flips the sync hash'
  );

  // A corpus of only volatile files yields an empty payload → /dream prints EMPTY.
  const onlyVolatile = fs.mkdtempSync(path.join(os.tmpdir(), 'cognee-sync-test-'));
  try {
    fs.writeFileSync(path.join(onlyVolatile, 'eval_x.md'), 'x');
    fs.writeFileSync(path.join(onlyVolatile, 'project_handoff.md'), 'y');
    assert.deepStrictEqual(memoryFiles(onlyVolatile), [], 'all-volatile corpus → empty payload');
  } finally {
    fs.rmSync(onlyVolatile, { recursive: true, force: true });
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

process.stdout.write('All tests passed\n');
