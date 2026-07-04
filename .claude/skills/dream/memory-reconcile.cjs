#!/usr/bin/env node

// memory-reconcile.cjs — deterministic index<->disk reconciliation for a
// per-project memory dir (#881). The /dream skill (Phase 4) calls this instead
// of eyeballing the corpus, so curation stops being vibes: it reports which
// files are dark (on disk but not in MEMORY.md), which index pointers dangle,
// which point-in-time files are safe to delete, which project snapshots need a
// human's eye, and which per-project files now duplicate a shared-layer memory
// (#679). It NEVER deletes — it classifies; /dream acts on the report
// backup-first. This mirrors cognee-sync.cjs: pure file work, no cognee, no
// network, so a skill step and a test compose the same core.

const fs = require('fs');
const os = require('os');
const path = require('path');

const INDEX_FILE = 'MEMORY.md';

// The single home for shared (feedback/user) memories (#679). Env override
// mirrors shared-memory.cjs so tests point it at a fixture dir.
function sharedMemoryDir(env = process.env) {
  if (env.CLAUDE_SHARED_MEMORY_DIR) return env.CLAUDE_SHARED_MEMORY_DIR;
  return path.join(os.homedir(), '.claude', 'memory');
}

// Every durable-name .md in dir except the index and dotfiles. Unlike
// cognee-sync's memoryFiles(), evals are INCLUDED: reconciliation must see the
// de-indexed snapshots to flag them for deletion. Missing dir → [].
function listMemoryFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith('.md') && !f.startsWith('.') && f !== INDEX_FILE)
    .sort();
}

// Filenames referenced by a MEMORY.md pointer, e.g. `- [Title](name.md) — hook`.
// A file is "indexed" iff its name appears inside a markdown link target here.
function indexedNames(dir) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(dir, INDEX_FILE), 'utf8');
  } catch {
    return new Set();
  }
  const names = new Set();
  const re = /\(([^()]+\.md)\)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    names.add(path.basename(m[1]));
  }
  return names;
}

// Point-in-time snapshot: excluded from cognee (VOLATILE_PATTERNS) and carries
// no durable cross-session value once de-indexed, so a dark eval is pure dead
// disk — safe to delete. Start-anchored so feedback_evaluate_* is never caught.
function isEval(name) {
  return /^eval_/.test(name);
}

// Project/observation snapshots describe state that can go stale. A dark one is
// a review candidate, not an auto-delete: some are load-bearing, some are
// deliberate tombstones (below).
function isProjectLike(name) {
  return /^(project_|observations_)/.test(name);
}

function isFeedbackLike(name) {
  return /^(feedback_|user_)/.test(name);
}

// A memory that asks to be preserved even though it describes dead work — a
// tombstone (e.g. coding_agent_bootstrap: "KILLED, not deferred … Do NOT
// surface, re-propose, or revive"). Deleting it would let the killed idea come
// back, which is the opposite of what the memory exists to prevent. Never
// auto-delete these.
const TOMBSTONE_RE =
  /\b(do not (revive|resurface|resurrect|delete)|keep to prevent|killed,? not deferred)\b/i;
function isTombstone(content) {
  return TOMBSTONE_RE.test(content || '');
}

// Classify every file in the per-project memory dir against its index and the
// shared layer. Returns fact buckets; the caller decides policy.
function classify(memoryDir, sharedDir = sharedMemoryDir()) {
  const files = listMemoryFiles(memoryDir);
  const onDisk = new Set(files);
  const indexed = indexedNames(memoryDir);
  const shared = new Set(listMemoryFiles(sharedDir));

  const records = files.map((name) => {
    let content = '';
    try {
      content = fs.readFileSync(path.join(memoryDir, name), 'utf8');
    } catch {
      /* unreadable → treat as empty; still classified by name */
    }
    return {
      name,
      indexed: indexed.has(name),
      sharedDuplicate: shared.has(name),
      tombstone: isTombstone(content),
      kind: isEval(name)
        ? 'eval'
        : isProjectLike(name)
        ? 'project'
        : isFeedbackLike(name)
        ? 'feedback'
        : 'other',
    };
  });

  const dark = records.filter((r) => !r.indexed);

  return {
    total: files.length,
    indexedCount: files.length - dark.length,
    // Index pointers whose target file no longer exists.
    missing: [...indexed].filter((n) => !onDisk.has(n)).sort(),
    // On disk but not indexed (superset of the actionable buckets below).
    dark: dark.map((r) => r.name),
    // Safe to delete: de-indexed point-in-time snapshots, not in cognee either.
    deletableEvals: dark.filter((r) => r.kind === 'eval').map((r) => r.name),
    // Surface for human review — never auto-delete.
    staleProjectCandidates: dark
      .filter((r) => r.kind === 'project' && !r.tombstone)
      .map((r) => r.name),
    // Dark but self-protected: re-index or keep, never delete.
    protectedTombstones: dark.filter((r) => r.tombstone).map((r) => r.name),
    // Dark feedback/user memories not yet in the shared layer → migrate there.
    darkFeedbackToShared: dark
      .filter((r) => r.kind === 'feedback' && !r.sharedDuplicate)
      .map((r) => r.name),
    // Already canonical in the shared layer → prune the per-project copy.
    sharedDuplicates: records.filter((r) => r.sharedDuplicate).map((r) => r.name),
    records,
  };
}

function formatReport(report) {
  const lines = [];
  lines.push(
    `INDEXED ${report.indexedCount}/${report.total}  DARK ${report.dark.length}`
  );
  const bucket = (label, arr) => {
    if (arr.length) lines.push(`${label} (${arr.length}): ${arr.join(', ')}`);
  };
  bucket('MISSING (index → no file)', report.missing);
  bucket('DELETABLE EVALS', report.deletableEvals);
  bucket('STALE PROJECT CANDIDATES (review)', report.staleProjectCandidates);
  bucket('PROTECTED TOMBSTONES (never delete)', report.protectedTombstones);
  bucket('DARK FEEDBACK → move to shared', report.darkFeedbackToShared);
  bucket('SHARED DUPLICATES → prune per-project copy', report.sharedDuplicates);
  return lines.join('\n');
}

function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: memory-reconcile.cjs <memory-dir>');
    process.exit(1);
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(`memory dir not found: ${dir}`);
    process.exit(1);
  }
  console.log(formatReport(classify(dir)));
}

if (require.main === module) {
  main();
}

module.exports = {
  sharedMemoryDir,
  listMemoryFiles,
  indexedNames,
  isEval,
  isProjectLike,
  isFeedbackLike,
  isTombstone,
  classify,
  formatReport,
};
