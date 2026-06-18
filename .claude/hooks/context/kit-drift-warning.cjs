#!/usr/bin/env node

/**
 * Kit Drift Warning Hook
 *
 * Event: SessionStart
 * Purpose: Warn when a downstream project's kit-owned files have drifted from
 *   the kit source. Conductor sessions are git worktrees that read kit-owned
 *   `.claude/` files from committed `main`, so a `sync-kit.sh` run that only
 *   writes the working tree of a canonical clone never reaches any session and
 *   the drift is silent and continuous (#736). This makes it visible.
 *
 * Two local signals:
 *   - UNCOMMITTED: kit-owned files are modified-but-uncommitted in this
 *     checkout. A sync wrote them here but nobody committed; worktrees read
 *     committed `main` and won't see them. This is the exact cosmo smoking gun.
 *   - BEHIND: kit-owned files committed in this checkout differ from what the
 *     kit source now ships (changed, added, or removed upstream). A fresh
 *     worktree off this `main` would run stale kit tooling.
 *
 * Discoverability only — SessionStart is context-only and cannot block. The fix
 * is `/kit-sync` in the project's own session followed by a normal `/commit`, so
 * the current kit files land on `main` where worktrees read them.
 *
 * Local-only: reads files already on disk (this checkout + the kit source
 * checkout) and `git status`. No network, no fetch — zero per-session network
 * tax, matching deploy-drift-warning. The kit source is located via
 * CLAUDE_KIT_SOURCE, else the conventional ~/Repositories/Personal/claude-kit.
 * The BEHIND signal compares against whatever that checkout currently holds, so
 * keep the kit source on a current `main` for an accurate count (it carries its
 * own deploy-drift warning). When the kit source can't be found, the UNCOMMITTED
 * signal still fires; only BEHIND needs it.
 *
 * No-ops outside a downstream (no .claude/.kit-manifest), which includes the
 * kit source repo itself (it ships no manifest). Silence with
 * CLAUDE_KIT_NO_KIT_DRIFT_WARN=1.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { dirtyFiles } = require('../lib/deploy-currency.cjs');

const MANIFEST_NAME = '.kit-manifest';
const KIT_PATHS_CONF = 'kit-paths.conf';
const DEFAULT_KIT_SOURCE = path.join(os.homedir(), 'Repositories', 'Personal', 'claude-kit');

// Load the kit-owned path layout from the kit source's kit-paths.conf — the same
// file sync-kit.sh reads, the single source of truth so propagator and detector
// never disagree about what is kit-owned (#737). Returns { dirs, files, exclude:Set },
// paths relative to `.claude/`. A missing or unreadable file degrades to empty
// lists: the source-walk (added-upstream detection) goes quiet, while the
// manifest-driven changed/removed signals in evaluate still work.
function loadKitPaths(kitSource) {
  const out = { dirs: [], files: [], exclude: new Set() };
  let raw;
  try { raw = fs.readFileSync(path.join(kitSource, KIT_PATHS_CONF), 'utf8'); } catch { return out; }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*(dir|file|exclude)\s+(\S.*?)\s*$/);
    if (!m) continue;
    if (m[1] === 'dir') out.dirs.push(m[2]);
    else if (m[1] === 'file') out.files.push(m[2]);
    else out.exclude.add(m[2]);
  }
  return out;
}

// Resolve the kit source checkout to compare against. CLAUDE_KIT_SOURCE wins;
// otherwise the conventional canonical clone. Returns an absolute path only when
// it exists and looks like the kit source (.claude/CLAUDE.md present, no
// .kit-manifest — the kit source is never itself a downstream). Else null.
function resolveKitSource() {
  const candidates = [];
  if (process.env.CLAUDE_KIT_SOURCE) candidates.push(process.env.CLAUDE_KIT_SOURCE);
  candidates.push(DEFAULT_KIT_SOURCE);
  for (const c of candidates) {
    try {
      const root = fs.realpathSync(c);
      if (!fs.existsSync(path.join(root, '.claude', 'CLAUDE.md'))) continue;
      if (fs.existsSync(path.join(root, '.claude', MANIFEST_NAME))) continue; // a downstream, not the source
      return root;
    } catch { /* missing / unreadable — try next */ }
  }
  return null;
}

// Read a downstream's manifest (the kit-owned files as of its last sync).
// Returns sorted unique relative paths, or [] when absent (not a downstream).
function readManifest(projectRoot) {
  const p = path.join(projectRoot, '.claude', MANIFEST_NAME);
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); } catch { return []; }
  return [...new Set(raw.split('\n').map(s => s.trim()).filter(Boolean))].sort();
}

// Walk a kit source checkout for the set of files it currently ships, applying
// the layout and exclude rule from kit-paths.conf. Relative-to-.claude paths.
// Best-effort: an unreadable dir yields nothing rather than throwing.
function kitSourceFiles(kitSource) {
  const { dirs, files, exclude } = loadKitPaths(kitSource);
  const out = new Set();
  const claude = path.join(kitSource, '.claude');
  const walk = (absDir, relDir) => {
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(absDir, e.name), rel);
      else if (e.isFile() && !exclude.has(rel)) out.add(rel);
    }
  };
  for (const dir of dirs) walk(path.join(claude, dir), dir);
  for (const f of files) {
    if (exclude.has(f)) continue;
    if (fs.existsSync(path.join(claude, f))) out.add(f);
  }
  return out;
}

function sameContent(a, b) {
  try { return fs.readFileSync(a).equals(fs.readFileSync(b)); }
  catch { return false; } // one side missing/unreadable counts as drift
}

// Returns a verdict to warn on, or null when nothing is worth saying.
// projectRoot is the downstream repo root; kitSource may be null (BEHIND off).
function evaluate(projectRoot, kitSource = resolveKitSource()) {
  const manifest = readManifest(projectRoot);
  if (manifest.length === 0) return null; // not a downstream (kit source has no manifest)

  // UNCOMMITTED: which kit-owned files are dirty in this checkout. dirtyFiles
  // returns repo-relative paths; kit-owned files live under `.claude/`.
  const manifestSet = new Set(manifest.map(rel => `.claude/${rel}`));
  const uncommitted = dirtyFiles(projectRoot)
    .filter(f => manifestSet.has(f))
    .map(f => f.replace(/^\.claude\//, ''))
    .sort();

  // BEHIND: how the downstream's on-disk kit files compare to the kit source.
  // In a clean worktree, on-disk == committed, so this is what a fresh worktree
  // off `main` would read. Skip when the source can't be found or resolves to
  // this same repo (misconfig / the kit itself).
  let behind = [];
  let comparedAgainst = null;
  if (kitSource) {
    let projReal = null;
    try { projReal = fs.realpathSync(projectRoot); } catch { projReal = projectRoot; }
    if (projReal !== kitSource) {
      comparedAgainst = kitSource;
      const seen = new Set();
      const drift = new Set();
      // changed/removed are manifest-driven and need no path layout, so they
      // survive a missing kit-paths.conf; only added-upstream needs the walk.
      for (const rel of manifest) {
        seen.add(rel);
        const here = path.join(projectRoot, '.claude', rel);
        const there = path.join(kitSource, '.claude', rel);
        if (!fs.existsSync(there)) { drift.add(rel); continue; }    // removed upstream
        if (!sameContent(here, there)) drift.add(rel);             // changed upstream
      }
      for (const rel of kitSourceFiles(kitSource)) {
        if (!seen.has(rel)) drift.add(rel);                         // added upstream
      }
      behind = [...drift].sort();
    }
  }

  if (uncommitted.length === 0 && behind.length === 0) return null;
  return { projectName: path.basename(projectRoot), uncommitted, behind, kitSource: comparedAgainst };
}

function warningText(verdict) {
  const lines = [
    '',
    '========================================',
    'KIT DRIFT',
    '========================================',
    '',
    `This project's kit-owned files have drifted from the kit:`,
    '',
  ];
  if (verdict.uncommitted.length > 0) {
    lines.push(`  - UNCOMMITTED: ${verdict.uncommitted.length} kit file(s) modified but not committed`);
    lines.push('    A sync wrote these into the working tree; nobody committed them.');
    lines.push('    Conductor worktrees read committed `main` and never see them.');
    for (const f of verdict.uncommitted.slice(0, 8)) lines.push(`      .claude/${f}`);
    if (verdict.uncommitted.length > 8) lines.push(`      ... and ${verdict.uncommitted.length - 8} more`);
  }
  if (verdict.behind.length > 0) {
    lines.push(`  - BEHIND KIT: ${verdict.behind.length} committed kit file(s) differ from the kit source`);
    lines.push('    A fresh worktree off this `main` runs stale kit tooling.');
    for (const f of verdict.behind.slice(0, 8)) lines.push(`      .claude/${f}`);
    if (verdict.behind.length > 8) lines.push(`      ... and ${verdict.behind.length - 8} more`);
  }
  lines.push('');
  if (verdict.kitSource) lines.push(`Compared against the kit source at ${verdict.kitSource} (its current checkout).`);
  lines.push('Counts are local — no fetch was run. Keep the kit source on a current `main`.');
  lines.push('');
  lines.push('FIX: in THIS project\'s own session, sync the kit and commit it so the');
  lines.push('files land on `main` where worktrees read them:');
  lines.push('');
  lines.push('  /kit-sync          # applies the current kit to this repo');
  lines.push('  /commit            # lands it on main via the normal gated flow');
  lines.push('');
  lines.push('Silence: CLAUDE_KIT_NO_KIT_DRIFT_WARN=1');
  lines.push('========================================');
  lines.push('');
  return lines.join('\n');
}

function run() {
  if (process.env.CLAUDE_KIT_NO_KIT_DRIFT_WARN === '1') return { state: 'silenced' };
  const projectRoot = process.cwd();
  if (!fs.existsSync(path.join(projectRoot, '.claude'))) return { state: 'not-framework' };
  let verdict;
  try { verdict = evaluate(projectRoot); }
  catch { return { state: 'error' }; } // never break SessionStart
  if (verdict) {
    process.stdout.write(warningText(verdict));
    return { state: 'drift', uncommitted: verdict.uncommitted.length, behind: verdict.behind.length };
  }
  return { state: 'clear' };
}

if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook(run, { mode: 'observability' });
}

module.exports = { run, evaluate, warningText, resolveKitSource, readManifest, kitSourceFiles, loadKitPaths };
