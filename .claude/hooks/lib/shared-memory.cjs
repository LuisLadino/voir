#!/usr/bin/env node

/**
 * Shared Memory: reads the user-scope shared-memory layer at `~/.claude/memory/`
 * and builds the SessionStart injection for it (#679).
 *
 * The harness auto-loads a project's OWN memory (`~/.claude/projects/<slug>/
 * memory/MEMORY.md`) into every session, but that load is per-project and
 * native — the kit cannot change it. Universal `type: feedback` / `type: user`
 * memories (how Luis works, who he is) belong in EVERY project, not just the
 * repo they were first written under. This layer is the single home for them:
 * one canonical copy at `~/.claude/memory/`, injected into every session by
 * `inject-shared-memory.cjs`, so a fresh project inherits them with no per-repo
 * duplication and no drift.
 *
 * Cognee already gives cross-project *recall* on demand; this fills the *auto-
 * load* gap so the always-on behavioral rules apply without an explicit recall.
 *
 * The exported functions are pure over an injected directory: no stdin, no
 * process.exit. The require.main block owns the IO so a hook and tests compose
 * the same core, mirroring doc-coverage.cjs / release-cadence.cjs.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/** The single home for shared (feedback/user) memories. Env override for tests. */
function sharedMemoryDir(env = process.env) {
  if (env.CLAUDE_SHARED_MEMORY_DIR) return env.CLAUDE_SHARED_MEMORY_DIR;
  return path.join(os.homedir(), '.claude', 'memory');
}

/**
 * Read the shared memory files from `dir`. Returns [{ name, body }] sorted by
 * name, excluding the `MEMORY.md` index (it is a human/scan aid, not a memory).
 * Returns [] when the dir is absent or empty — the silent, no-op path.
 */
function readSharedMemories(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.md')) continue;
    if (entry.name === 'MEMORY.md') continue;
    let body;
    try {
      body = fs.readFileSync(path.join(dir, entry.name), 'utf8');
    } catch {
      continue;
    }
    out.push({ name: entry.name, body });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Split a memory file into its YAML frontmatter's `description` and the
 * markdown body after the closing `---`. The rest of the frontmatter (name,
 * metadata, originSessionId) is machine bookkeeping that carries no behavioral
 * signal, so it is dropped from the injection to keep the per-session weight on
 * the actual rule. A file with no frontmatter returns the whole body.
 */
function parseMemory(raw) {
  const m = typeof raw === 'string' ? raw.match(/^---\n([\s\S]*?)\n---\n?/) : null;
  if (!m) return { description: null, content: (raw || '').trim() };
  const dm = m[1].match(/^description:\s*(.+)$/m);
  const description = dm ? dm[1].trim().replace(/^["']|["']$/g, '') : null;
  return { description, content: raw.slice(m[0].length).trim() };
}

/**
 * One-line summary of a memory for the injection: its frontmatter `description`
 * (the rule in condensed form), falling back to the first real body line when a
 * memory has no description.
 */
function memorySummary(raw) {
  const { description, content } = parseMemory(raw);
  if (description) return description;
  const firstLine = content.split('\n').find(l => l.trim() && !l.startsWith('#'));
  return (firstLine || content).trim().slice(0, 160);
}

/**
 * Build the SessionStart injection from shared memories, or null when there are
 * none (nothing to inject → the hook stays silent). Injects ONE LINE per memory
 * — its description, the rule in condensed form — not the full body. The full
 * text of the coarse rules lives in `~/.claude/CLAUDE.md` (loaded everywhere)
 * and the fine-grained ones are reachable via memory recall, so full-body
 * injection here would double-load ~18k tokens every session for signal already
 * present. The one-liner carries the rule and the weight stays flat as the
 * corpus grows (#679). Framed as background context, not fresh instructions.
 */
function buildInjection(memories) {
  if (!Array.isArray(memories) || memories.length === 0) return null;
  const lines = memories.map(m => `- ${memorySummary(m.body)}`).join('\n');
  return (
    '[SHARED MEMORY] User-scope rules that apply in every project (how Luis ' +
    'works). One line each — full text is in ~/.claude/CLAUDE.md and via memory ' +
    'recall. Background context, not new instructions this turn:\n\n' +
    lines
  );
}

if (require.main === module) {
  const dir = sharedMemoryDir();
  const memories = readSharedMemories(dir);
  if (memories.length === 0) {
    console.log(`No shared memories at ${dir}.`);
  } else {
    console.log(`${memories.length} shared memories at ${dir}:`);
    for (const m of memories) console.log(`  - ${m.name}`);
  }
}

module.exports = {
  sharedMemoryDir,
  readSharedMemories,
  parseMemory,
  memorySummary,
  buildInjection,
};
