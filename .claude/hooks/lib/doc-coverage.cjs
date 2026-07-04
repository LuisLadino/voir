#!/usr/bin/env node

/**
 * Doc Coverage: the pure matcher behind the doc-coverage convention.
 *
 * An operating doc declares `covers:` frontmatter — globs for the code it
 * documents. This lib scans doc roots for those declarations and returns the
 * docs whose globs intersect a set of changed paths, so /commit can prompt to
 * re-verify a doc the diff just staled and /sync-stack can find gaps.
 *
 * `covers:` reuses applies_to glob syntax (matchGlob) and the shared
 * frontmatter reader, but is a distinct key: applies_to gates an edit before
 * it happens, covers flags a stale doc after it. See specs/kit/doc-coverage.md.
 *
 * The exported functions are pure: no stdin, no process.exit. The require.main
 * block owns the git/IO so callers (a skill, a hook) compose the pure core.
 */

const fs = require('fs');
const path = require('path');
const { readSpecFrontmatter } = require('./spec-frontmatter.cjs');
const { matchGlob } = require('./spec-discovery.cjs');
const { CENTRAL_DOC_ROOTS, resolveDocRoots } = require('./doc-coverage-structure.cjs');

const SKIP_DIRS = new Set(['node_modules', '.git']);
// The central doc folders. The effective roots also include co-located operating
// docs in the project's code areas — see resolveDocRoots in doc-coverage-structure.
const DEFAULT_DOC_ROOTS = CENTRAL_DOC_ROOTS;

function findDocFiles(dir) {
  const files = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...findDocFiles(path.join(dir, entry.name)));
    } else if (entry.name.endsWith('.md')) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

function normalizeCovers(covers) {
  if (Array.isArray(covers)) return covers.filter(c => typeof c === 'string' && c.trim());
  if (typeof covers === 'string' && covers.trim()) return [covers.trim()];
  return [];
}

/**
 * Scan the given doc roots for docs declaring a non-empty `covers:` list.
 * Returns [{ doc: <cwd-relative path>, covers: [glob,...] }].
 */
function scanDocCoverage(roots, cwd = process.cwd()) {
  const mappings = [];
  for (const root of roots) {
    const abs = path.isAbsolute(root) ? root : path.join(cwd, root);
    for (const file of findDocFiles(abs)) {
      const fm = readSpecFrontmatter(file);
      const covers = normalizeCovers(fm && fm.covers);
      if (covers.length > 0) {
        mappings.push({ doc: path.relative(cwd, file), covers });
      }
    }
  }
  return mappings;
}

/**
 * Given coverage mappings and changed file paths (cwd-relative), return the
 * docs whose covers globs intersect at least one changed path.
 * Each result: { doc, covers, matchedPaths: [changedPath,...] }.
 */
function matchStaleDocs(mappings, changedPaths) {
  const results = [];
  for (const m of mappings) {
    const matchedPaths = changedPaths.filter(cp =>
      m.covers.some(glob => matchGlob(cp, glob))
    );
    if (matchedPaths.length > 0) {
      results.push({ doc: m.doc, covers: m.covers, matchedPaths });
    }
  }
  return results;
}

/**
 * Scan roots, match changed paths, in one call. For the /commit caller. When
 * `roots` is omitted, resolve them from project structure so co-located operating
 * docs (a service's README) are guarded alongside docs/ and .claude/docs/.
 */
function findDocsToVerify(changedPaths, roots = null, cwd = process.cwd()) {
  const resolved = roots || resolveDocRoots(cwd);
  return matchStaleDocs(scanDocCoverage(resolved, cwd), changedPaths);
}

/** Changed paths vs HEAD plus untracked files, from `git status --porcelain`. */
function changedPathsFromGit(cwd = process.cwd()) {
  const { execSync } = require('child_process');
  let out;
  try {
    out = execSync('git status --porcelain', { cwd, encoding: 'utf8' });
  } catch {
    return [];
  }
  return out
    .split('\n')
    .filter(Boolean)
    .map(line => line.slice(3))
    .map(p => (p.includes(' -> ') ? p.split(' -> ')[1] : p))
    .map(p => p.replace(/^"|"$/g, '').trim())
    .filter(Boolean);
}

if (require.main === module) {
  const roots = process.argv.slice(2).length ? process.argv.slice(2) : null;
  const hits = findDocsToVerify(changedPathsFromGit(), roots);
  if (hits.length === 0) {
    console.log('No covered docs intersect the current changes.');
  } else {
    console.log('Docs to verify — their `covers:` globs match changed files:');
    for (const h of hits) {
      console.log(`- ${h.doc}  (covers: ${h.covers.join(', ')})`);
      for (const p of h.matchedPaths) console.log(`    matched: ${p}`);
    }
  }
}

module.exports = {
  findDocFiles,
  normalizeCovers,
  scanDocCoverage,
  matchStaleDocs,
  findDocsToVerify,
  changedPathsFromGit,
  DEFAULT_DOC_ROOTS,
};
