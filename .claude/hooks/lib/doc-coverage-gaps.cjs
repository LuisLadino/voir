#!/usr/bin/env node

/**
 * Doc Coverage Gaps: structure-driven gap inference for /sync-stack.
 *
 * doc-coverage.cjs is the matcher — given changed paths, which docs (by their
 * covers: frontmatter) just went stale. This lib answers the inverse question
 * /sync-stack asks at setup/sync time: given the project's STRUCTURE, which
 * high-coupling areas warrant an operating doc, which warranted areas already
 * have a covering doc, which docs are un-annotated, and — across runs — what
 * newly became warranted or went stale versus the doc-map persisted in
 * stack-config.yaml.
 *
 * The guard table here is the structural twin of the one /commit names
 * (runtime, connectors, deploy, schema, CLI). Warranted categories are inferred
 * from project structure — a directory or a config file — not from a
 * hand-maintained doc-map that would itself go stale. See
 * specs/kit/doc-coverage.md.
 *
 * It reuses the matcher's frontmatter scan (scanDocCoverage) and file walk
 * (findDocFiles); it does not reimplement them. Persisted-map reads use the
 * zero-dep yaml-mini, never a runtime dependency, so downstream hooks stay
 * dependency-free.
 *
 * The exported functions are pure. The require.main block owns the IO: it walks
 * the project, reads the persisted doc-map, and prints the report (human or
 * --json).
 */

const fs = require('fs');
const path = require('path');
const { scanDocCoverage, findDocFiles } = require('./doc-coverage.cjs');
const {
  GUARD_TABLE,
  fileExists,
  dirSignalMatches,
  fileSignalMatches,
  readPackageBin,
  resolveDocRoots,
} = require('./doc-coverage-structure.cjs');
const yamlMini = require('./yaml-mini.cjs');

const STACK_CONFIG_REL = '.claude/specs/stack-config.yaml';

/**
 * Infer the warranted high-coupling categories from project structure.
 * Each result: { category, label, signals: [{kind,path}], covers: [glob], roots: [path] }.
 * `covers` is what a doc should declare to cover the area; `roots` is the set of
 * path prefixes used to decide whether an existing doc already points into it.
 */
function inferWarrantedCategories(cwd = process.cwd()) {
  const binTargets = readPackageBin(cwd);
  const warranted = [];

  for (const entry of GUARD_TABLE) {
    const signals = [];
    for (const d of entry.dirs) {
      for (const rel of dirSignalMatches(cwd, d)) signals.push({ kind: 'dir', path: rel });
    }
    for (const f of entry.files) {
      for (const rel of fileSignalMatches(cwd, f)) signals.push({ kind: 'file', path: rel });
    }
    if (entry.category === 'cli') {
      for (const t of binTargets) {
        if (!fileExists(cwd, t)) continue;
        signals.push({ kind: 'file', path: t });
      }
    }
    if (signals.length === 0) continue;

    const seen = new Set();
    const uniq = signals.filter(s => (seen.has(s.path) ? false : (seen.add(s.path), true)));
    warranted.push({
      category: entry.category,
      label: entry.label,
      signals: uniq,
      covers: uniq.map(s => (s.kind === 'dir' ? `${s.path}/**` : s.path)),
      roots: uniq.map(s => s.path),
    });
  }
  return warranted;
}

/** Literal directory prefix of a glob — the part before the first `*` segment. */
function globPrefix(glob) {
  const out = [];
  for (const seg of String(glob).split('/')) {
    if (seg.includes('*')) break;
    out.push(seg);
  }
  return out.join('/');
}

/** True when one path is a segment-wise prefix of the other (or they are equal). */
function pathOverlap(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const as = a.split('/'), bs = b.split('/');
  const n = Math.min(as.length, bs.length);
  for (let i = 0; i < n; i++) {
    if (as[i] !== bs[i]) return false;
  }
  return true;
}

/** Does a doc's covers globs point into a warranted category's roots? */
function docCoversCategory(docCovers, categoryRoots) {
  return docCovers.some(glob => {
    const gp = globPrefix(glob);
    return categoryRoots.some(root => pathOverlap(gp, root));
  });
}

/**
 * Split warranted categories into covered (≥1 doc points into the area) and
 * gaps (no covering doc). `mappings` is scanDocCoverage output: [{doc, covers}].
 */
function computeCoverage(warranted, mappings) {
  const covered = [];
  const gaps = [];
  for (const cat of warranted) {
    const docs = mappings
      .filter(m => docCoversCategory(m.covers, cat.roots))
      .map(m => m.doc);
    if (docs.length > 0) covered.push({ ...cat, docs });
    else gaps.push(cat);
  }
  return { covered, gaps };
}

// Fact-bearing keywords (annotate) vs intent keywords (leave alone), from
// specs/kit/doc-coverage.md "Which docs to annotate / NOT to annotate".
const ANNOTATE_HINTS = [
  'runbook', 'operating', 'setup', 'install', 'onboard', 'config', 'configuration',
  'reference', 'api', 'cli', 'interface', 'endpoint', 'route', 'flag', 'schema',
  'contract', 'migration', 'deploy', 'deployment', 'infra', 'infrastructure', 'environment',
];
const SKIP_HINTS = [
  'tutorial', 'explanation', 'rationale', 'adr', 'decision', 'roadmap', 'vision',
  'positioning', 'contributing', 'process', 'governance', 'glossary', 'terminology',
];

/** A hint matches as a whole word, so "reference" never fires inside "preferences". */
function hasWord(text, word) {
  return new RegExp(`(^|[^a-z])${word}([^a-z]|$)`).test(text);
}

/**
 * Advisory: does a doc's path read as fact-bearing (warrants covers:) rather
 * than intent? Intent keywords veto. Ambiguous defaults to false — the report
 * surfaces the clear candidates and only counts the rest, so the check never
 * nags about ADRs or roadmaps.
 */
function likelyWarranted(docPath) {
  const p = docPath.toLowerCase();
  if (SKIP_HINTS.some(h => hasWord(p, h))) return false;
  return ANNOTATE_HINTS.some(h => hasWord(p, h));
}

/**
 * Docs under the doc roots with no covers: frontmatter — invisible to the
 * /commit guard. Each: { doc, likelyWarranted }.
 */
function findUnannotatedDocs(cwd, roots) {
  const annotated = new Set(scanDocCoverage(roots, cwd).map(m => m.doc));
  const all = [];
  for (const root of roots) {
    const abs = path.isAbsolute(root) ? root : path.join(cwd, root);
    for (const file of findDocFiles(abs)) all.push(path.relative(cwd, file));
  }
  return all
    .filter(doc => !annotated.has(doc))
    .map(doc => ({ doc, likelyWarranted: likelyWarranted(doc) }));
}

/**
 * Govern: compare freshly-inferred categories against a persisted doc-map.
 * newlyWarranted = areas that now have code but weren't persisted; nowStale =
 * persisted areas whose code went away. Categories only — coverage regressions
 * surface in the per-run gaps list.
 */
function diffDocMap(persistedCategories, currentCategories) {
  const persistedSet = new Set((persistedCategories || []).map(c => c.category));
  const currentSet = new Set(currentCategories.map(c => c.category));
  return {
    newlyWarranted: currentCategories.filter(c => !persistedSet.has(c.category)).map(c => c.category),
    nowStale: (persistedCategories || []).filter(c => !currentSet.has(c.category)).map(c => c.category),
  };
}

/**
 * Read the persisted doc_coverage: block from stack-config.yaml. Slices only
 * that top-level block and parses it with yaml-mini, so a construct elsewhere in
 * the file can never break the read. Returns { last_inferred, warranted } or
 * null when absent/unreadable. A parse failure degrades to null (no prior map),
 * never an error — same contract as readSpecFrontmatter.
 */
function readPersistedDocMap(cwd = process.cwd()) {
  let content;
  try {
    content = fs.readFileSync(path.join(cwd, STACK_CONFIG_REL), 'utf8');
  } catch {
    return null;
  }
  const lines = content.split('\n');
  const start = lines.findIndex(l => /^doc_coverage:\s*$/.test(l));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) { end = i; break; }
  }
  try {
    const parsed = yamlMini.parse(lines.slice(start, end).join('\n'));
    const dc = parsed && parsed.doc_coverage;
    if (!dc) return null;
    return {
      last_inferred: dc.last_inferred || null,
      warranted: Array.isArray(dc.warranted) ? dc.warranted : [],
    };
  } catch {
    return null;
  }
}

/**
 * The full pure report. Detect (covered / gaps / un-annotated), Define (docMap,
 * the block to persist), and Govern (diff vs persisted). buildReport takes
 * `persisted` so it stays pure; the CLI reads it from disk and passes it in.
 */
function buildReport({ cwd = process.cwd(), docRoots = null, persisted = null } = {}) {
  const roots = docRoots || resolveDocRoots(cwd);
  const warranted = inferWarrantedCategories(cwd);
  const mappings = scanDocCoverage(roots, cwd);
  const { covered, gaps } = computeCoverage(warranted, mappings);
  const unannotated = findUnannotatedDocs(cwd, roots);

  const docMap = warranted.map(cat => {
    const cov = covered.find(c => c.category === cat.category);
    return {
      category: cat.category,
      covers: cat.covers,
      signal: cat.signals.map(s => s.path).join(', '),
      docs: cov ? cov.docs : [],
    };
  });

  return {
    warranted,
    covered,
    gaps,
    unannotated,
    docMap,
    governance: persisted ? diffDocMap(persisted.warranted, warranted) : null,
    hadPriorMap: persisted !== null,
    docRoots: roots,
  };
}

function formatReport(report) {
  const out = [];
  out.push('DOCUMENTATION COVERAGE');
  out.push('');

  if (report.warranted.length === 0) {
    out.push('No high-coupling areas detected (runtime, connectors, deploy, schema, CLI).');
    out.push('Technology and component specs are sufficient; nothing to cover.');
  } else {
    out.push(`Warranted high-coupling areas: ${report.warranted.length}`);
    for (const c of report.covered) {
      out.push(`  [covered] ${c.category.padEnd(11)} ${c.docs.join(', ')}`);
    }
    for (const g of report.gaps) {
      const sig = g.signals.map(s => s.path).join(', ');
      out.push(`  [GAP]     ${g.category.padEnd(11)} ${sig} — no doc declares covers: over it`);
      out.push(`            → write one via /build, or file a tracked issue. Do not auto-generate.`);
    }
  }

  out.push('');
  const flagged = report.unannotated.filter(u => u.likelyWarranted);
  const rest = report.unannotated.length - flagged.length;
  if (report.unannotated.length === 0) {
    out.push('Un-annotated docs: none.');
  } else if (flagged.length === 0) {
    out.push(`Un-annotated docs: ${report.unannotated.length}, all read as intent docs — none need covers:.`);
  } else {
    out.push(`Un-annotated docs: ${report.unannotated.length} total. Recommend adding covers: to ${flagged.length} fact-bearing doc(s):`);
    for (const u of flagged) out.push(`  - ${u.doc}`);
    if (rest > 0) out.push(`  (${rest} other(s) read as intent docs — tutorials, ADRs, archives — left as-is)`);
  }

  out.push('');
  if (!report.hadPriorMap) {
    out.push('Governance: initial doc-map (no prior sync to compare).');
  } else {
    const g = report.governance;
    if (g.newlyWarranted.length === 0 && g.nowStale.length === 0) {
      out.push('Governance: doc-map unchanged since last sync.');
    } else {
      out.push('Governance (vs persisted doc-map):');
      if (g.newlyWarranted.length) out.push(`  + newly warranted: ${g.newlyWarranted.join(', ')}`);
      if (g.nowStale.length) out.push(`  - now stale (code removed; prune): ${g.nowStale.join(', ')}`);
    }
  }

  return out.join('\n');
}

if (require.main === module) {
  const asJson = process.argv.includes('--json');
  const report = buildReport({ persisted: readPersistedDocMap() });
  console.log(asJson ? JSON.stringify(report, null, 2) : formatReport(report));
}

module.exports = {
  GUARD_TABLE,
  inferWarrantedCategories,
  globPrefix,
  pathOverlap,
  docCoversCategory,
  computeCoverage,
  likelyWarranted,
  findUnannotatedDocs,
  diffDocMap,
  readPersistedDocMap,
  buildReport,
  formatReport,
};
