#!/usr/bin/env node

/**
 * Doc Coverage Structure: the project-structure layer shared by the matcher and
 * the gap detector.
 *
 * One source of truth for "what structural areas this project has": the guard
 * table of high-coupling categories (runtime, connectors, deploy, schema, CLI),
 * the directory/file signal resolution, and the doc roots an operating doc may
 * live in — the central doc folders plus the code areas themselves, where a
 * service's operating doc is correctly co-located as a README.
 *
 * doc-coverage.cjs (the matcher) reads this to resolve doc roots so a co-located
 * README is scanned by /commit's staleness guard. doc-coverage-gaps.cjs reads
 * the guard table to infer warranted categories for /sync-stack. Keeping both on
 * one structural definition is what stops the two from drifting — a single dir
 * list, not two copies. See specs/kit/doc-coverage.md.
 *
 * Pure: no stdin, no process.exit. The matcher reuses matchGlob so a guard-table
 * file signal can be a glob (fly*.toml) and not just a literal name.
 */

const fs = require('fs');
const path = require('path');
const { matchGlob } = require('./spec-discovery.cjs');

const CENTRAL_DOC_ROOTS = ['docs', '.claude/docs'];

/**
 * The high-coupling areas /commit guards, as structural signals. A category is
 * "warranted" when the project shows the signal — a directory (top level or one
 * level under src/) or a named config file. Directory signals become a `dir/**`
 * covers glob; file signals cover the file itself. A file entry may be a literal
 * name or a glob (`fly*.toml`) so multi-app projects with named configs (cosmo's
 * cosmo-runtime + cosmo-sams-line) are each detected.
 */
const GUARD_TABLE = [
  {
    category: 'runtime',
    label: 'Runtime / long-running services',
    dirs: ['runtime', 'server', 'daemon', 'workers', 'services'],
    files: [],
  },
  {
    category: 'connectors',
    label: 'External connectors / integrations',
    dirs: ['connectors', 'connector', 'integrations'],
    files: [],
  },
  {
    category: 'deploy',
    label: 'Deployment / infrastructure',
    dirs: ['deploy', 'infra', 'terraform', '.github/workflows'],
    files: [
      'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
      'vercel.json', 'netlify.toml', 'fly*.toml', 'render.yaml',
    ],
  },
  {
    category: 'schema',
    label: 'Data schema / migrations / contracts',
    dirs: ['migrations', 'db', 'database', 'schema', 'drizzle', 'prisma'],
    files: ['schema.graphql', 'schema.sql'],
  },
  {
    category: 'cli',
    label: 'CLI / command interface',
    dirs: ['bin', 'cli'],
    files: ['cli.ts', 'cli.js', 'cli.py'],
  },
];

function dirExists(cwd, rel) {
  try { return fs.statSync(path.join(cwd, rel)).isDirectory(); } catch { return false; }
}

function fileExists(cwd, rel) {
  try { return fs.statSync(path.join(cwd, rel)).isFile(); } catch { return false; }
}

/**
 * Where a directory signal may live: top level, and one level under src/.
 * A nested signal (containing a slash, e.g. ".github/workflows") is checked
 * only at its literal path — no src/ variant.
 */
function dirSignalMatches(cwd, name) {
  const candidates = name.includes('/') ? [name] : [name, `src/${name}`];
  return candidates.filter(rel => dirExists(cwd, rel));
}

/**
 * Resolve a file signal to the top-level files it matches. A literal name (no
 * `*`) resolves to itself when present; a glob is expanded against the project
 * root's entries via the shared matchGlob, so `fly*.toml` matches both `fly.toml`
 * and `fly.runtime.toml`. Each match becomes its own signal, so a doc covering
 * one named config satisfies the deploy area independent of the others.
 */
function fileSignalMatches(cwd, pattern) {
  if (!String(pattern).includes('*')) {
    return fileExists(cwd, pattern) ? [pattern] : [];
  }
  let entries;
  try { entries = fs.readdirSync(cwd, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter(e => e.isFile() && matchGlob(e.name, pattern))
    .map(e => e.name)
    .sort();
}

/** package.json "bin" targets (a string or a map of name->path), de-dotted. */
function readPackageBin(cwd) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  } catch {
    return [];
  }
  if (!pkg || !pkg.bin) return [];
  const vals = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin);
  return vals.filter(v => typeof v === 'string').map(v => v.replace(/^\.\//, ''));
}

/**
 * The code-area directories where a co-located operating doc may live: the guard
 * table's directory signals, resolved against this project (top level and src/),
 * existing only. Nested infra paths (.github/workflows) are excluded — they hold
 * config, not operating docs. This is what lets a service's co-located README
 * (services/sams-line/README.md) be scanned the same as a doc in docs/.
 */
function colocatedDocRoots(cwd) {
  const dirs = new Set();
  for (const entry of GUARD_TABLE) {
    for (const d of entry.dirs) {
      if (d.includes('/')) continue;
      for (const rel of dirSignalMatches(cwd, d)) dirs.add(rel);
    }
  }
  return [...dirs];
}

/**
 * Every root an operating doc may live in: the central doc folders, this
 * project's co-located code areas, plus any caller-supplied extras. Deduped,
 * order-stable (central first). Both the matcher and the gap detector resolve
 * their doc roots through this, so the two never scan different sets.
 */
function resolveDocRoots(cwd = process.cwd(), extraRoots = []) {
  const seen = new Set();
  const out = [];
  for (const r of [...CENTRAL_DOC_ROOTS, ...colocatedDocRoots(cwd), ...extraRoots]) {
    if (r && !seen.has(r)) { seen.add(r); out.push(r); }
  }
  return out;
}

module.exports = {
  CENTRAL_DOC_ROOTS,
  GUARD_TABLE,
  dirExists,
  fileExists,
  dirSignalMatches,
  fileSignalMatches,
  readPackageBin,
  colocatedDocRoots,
  resolveDocRoots,
};
