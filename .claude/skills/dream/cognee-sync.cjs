#!/usr/bin/env node

// cognee-sync.cjs — bridges the file-based memory directory into the cognee
// knowledge graph. The per-project memory files are the live layer; cognee is
// the durable cross-project layer. The /dream skill runs this so the two stay
// in sync.
//
// Full-replace, not incremental — a deliberate ROI choice, NOT a cognee
// limitation. #663 validated that cognee's per-item delete IS reliable:
// delete(data_id, mode="hard") removes a document's chunk, its data item, and
// its degree-one entity nodes cleanly (no orphans), while shared entities that
// remain referenced survive. Data items are named `text_<md5(content)>`, so a
// memory file maps to its data item by content hash — a per-file incremental
// sync (dirty-set → delete removed files, remember changed files) is feasible.
// It is not implemented because post-#662 (volatile files excluded) the ROI is
// modest and the full-replace is simpler and lower-risk on a live cross-project
// graph. Revisit if durable-memory churn or corpus size grows. The content hash
// gates the rebuild — an unchanged memory dir skips it entirely.
//
// Volatile files are excluded from the payload and the hash: the rolling
// handoff (project_handoff.md) and the dated context-eval snapshots (eval_*.md)
// are per-session state, not durable knowledge. They change on every /dream, so
// hashing them flipped the gate every session and forced a full re-cognify of
// the whole corpus for a change that carries nothing worth recalling across
// projects. Excluding them gates the rebuild on durable-knowledge changes and
// keeps session noise out of the recall graph (#662). The file layer still
// holds these files; only the cognee sync skips them — do not re-include them.
//
// One dataset per project, keyed off the workspace directory. /dream runs
// per-project, so a shared dataset would mean each project's full-replace wiped
// every other project's memory. Per-project datasets keep them isolated; a
// recall with no dataset filter still spans all of them for the unified view.
//
// This helper never calls cognee. It only does file work. The cognee writes
// (delete_dataset, remember) run from /dream as MCP tool calls so they go
// through the shared daemon and never race the Kuzu single-writer lock.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const STATE_FILE = '.cognee-sync-state.json';

// Per-session state, not durable knowledge: the rolling handoff and the dated
// context-eval snapshots. Anchored at the start so a durable file that merely
// contains "eval" mid-name (e.g. feedback_evaluate_independently.md) is kept.
const VOLATILE_PATTERNS = [/^eval_/, /^project_handoff/];

function isVolatile(file) {
  return VOLATILE_PATTERNS.some((re) => re.test(file));
}

// MEMORY.md is the index, not content — the files it points to carry the facts.
function memoryFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter(
      (f) =>
        f.endsWith('.md') &&
        !f.startsWith('.') &&
        f !== 'MEMORY.md' &&
        !isVolatile(f)
    )
    .sort();
}

function concatMemory(dir) {
  return memoryFiles(dir)
    .map((f) => `# === ${f} ===\n\n${fs.readFileSync(path.join(dir, f), 'utf8')}`)
    .join('\n\n');
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// Memory dirs live at ~/.claude/projects/<workspace-key>/memory. The workspace
// key is unique and stable per project, so it makes a collision-free dataset.
function datasetName(memoryDir) {
  const workspaceKey = path.basename(path.dirname(path.resolve(memoryDir)));
  const slug = workspaceKey
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return `mem_${slug}`;
}

function readState(dir) {
  const p = path.join(dir, STATE_FILE);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function cmdCheck(dir) {
  const files = memoryFiles(dir);
  if (files.length === 0) {
    console.log('EMPTY');
    return;
  }
  const concat = concatMemory(dir);
  const hash = sha256(concat);
  const state = readState(dir);
  if (state && state.hash === hash) {
    console.log('UNCHANGED');
    return;
  }
  const payload = path.join(os.tmpdir(), `cognee-memory-sync-${hash.slice(0, 12)}.md`);
  fs.writeFileSync(payload, concat);
  // /dream reads exactly these four lines: status, payload path, hash, dataset.
  console.log('CHANGED');
  console.log(payload);
  console.log(hash);
  console.log(datasetName(dir));
}

function cmdCommit(dir, hash) {
  const state = {
    hash,
    synced_at: new Date().toISOString(),
    file_count: memoryFiles(dir).length,
  };
  fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify(state, null, 2) + '\n');
  console.log('committed');
}

function main() {
  const [cmd, dir, hash] = process.argv.slice(2);
  if (!cmd || !dir) {
    console.error('usage: cognee-sync.cjs <check|commit> <memory-dir> [hash]');
    process.exit(1);
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(`memory dir not found: ${dir}`);
    process.exit(1);
  }
  if (cmd === 'check') {
    cmdCheck(dir);
  } else if (cmd === 'commit') {
    if (!hash) {
      console.error('commit requires <hash>');
      process.exit(1);
    }
    cmdCommit(dir, hash);
  } else {
    console.error(`unknown command: ${cmd}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  VOLATILE_PATTERNS,
  isVolatile,
  memoryFiles,
  concatMemory,
  sha256,
  datasetName,
};
