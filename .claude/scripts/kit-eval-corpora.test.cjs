#!/usr/bin/env node

/**
 * Corpus well-formedness gate for kit-eval. Parses every eval corpus with the
 * real harness parsers and asserts the structure each harness requires, so a
 * malformed corpus fails in CI (npm test) instead of at the first local walk.
 * This is the CI-runnable half of kit-eval — no claude -p, no model call.
 * Run: node .claude/scripts/kit-eval-corpora.test.cjs
 */

const fs = require('fs');
const path = require('path');

const { parseWordingEval } = require('./instruction-wording-walk.cjs');
const { parseOutputEval } = require('./skill-output-eval.cjs');
const { parseBehaviorEval } = require('./skill-behavior-walk.cjs');
const { readSpecFrontmatter } = require('../hooks/lib/spec-frontmatter.cjs');
const { matchGlob } = require('../hooks/lib/spec-conformance.cjs');

let pass = 0;
let fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

const ROOT = path.resolve(__dirname, '..', '..');
const wordingDir = path.join(ROOT, '.claude', 'research', 'instruction-wording-evals');
const outputDir = path.join(ROOT, '.claude', 'research', 'skill-output-evals');
const behaviorDir = path.join(ROOT, '.claude', 'research', 'skill-behavior-evals');

function mdFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => path.join(dir, f));
}

function compiles(src) {
  try { new RegExp(src); return true; } catch (_) { return false; }
}

// Envelope names a corpus's rules/scenario declare, e.g. {commit, pr} or {spec}:
// the `<<NAME>>` open markers minus the `<<END_…>>` closers, lowercased.
function declaredEnvelopes(text) {
  const names = new Set();
  const re = /<<([A-Z][A-Z0-9_]*)>>/g;
  let m;
  while ((m = re.exec(text)) !== null) { if (!/^END_/.test(m[1])) names.add(m[1].toLowerCase()); }
  return names;
}

const GLOB_META = /[*?[\]{}]/;

function listFilesUnder(rel, acc) {
  let entries;
  try { entries = fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) listFilesUnder(childRel, acc);
    else acc.push(childRel);
  }
}

// A tests_source entry resolves when its target exists. Exact paths stat
// directly; a glob resolves when at least one repo file matches it. This is the
// drift guard (#799): rename or delete a watched source and this test fails in
// CI before the reminder hook silently points at nothing.
function sourceResolves(glob) {
  if (typeof glob !== 'string' || glob.length === 0) return false;
  if (!GLOB_META.test(glob)) return fs.existsSync(path.join(ROOT, glob));
  const staticSegs = [];
  for (const s of glob.split('/')) { if (GLOB_META.test(s)) break; staticSegs.push(s); }
  const acc = [];
  listFilesUnder(staticSegs.join('/'), acc);
  return acc.some(f => matchGlob(f, glob));
}

// Every kit-eval corpus must declare, in `tests_source` frontmatter, the source
// file(s) it watches — the mapping the reminder hook reads to name the exact
// walk for a changed file (#799). No central registry; the corpus owns it.
function reportTestsSource(file) {
  const name = path.basename(file);
  const meta = readSpecFrontmatter(file);
  const sources = meta && Array.isArray(meta.tests_source) ? meta.tests_source : null;
  report(`corpus/${name}: declares a non-empty tests_source list`,
    Array.isArray(sources) && sources.length > 0 &&
      sources.every((s) => typeof s === 'string' && s.length > 0),
    JSON.stringify(meta && meta.tests_source));
  if (!Array.isArray(sources)) return;
  for (const src of sources) {
    report(`corpus/${name}: tests_source "${src}" resolves to a real file`, sourceResolves(src), src);
  }
}

const wordingFiles = mdFiles(wordingDir);
const outputFiles = mdFiles(outputDir);
const behaviorFiles = mdFiles(behaviorDir);

// The eval corpora live in the kit source's .claude/research/ and are NOT synced
// downstream (research/ is project-owned), so this kit-internal corpus-presence
// check only applies in the kit source. A downstream gets this test file but not
// its fixtures (#800); detect the kit source by sync-kit.sh at the repo root (the
// same signal #744 uses). Where corpora exist they are still validated below.
const inKitSource = fs.existsSync(path.join(ROOT, 'sync-kit.sh'));
if (inKitSource) {
  report('at least one eval corpus exists', wordingFiles.length + outputFiles.length + behaviorFiles.length > 0,
    `wording=${wordingFiles.length} output=${outputFiles.length} behavior=${behaviorFiles.length}`);
} else {
  console.log('SKIP  at least one eval corpus exists — kit-internal corpora are not synced downstream (#800)');
}

for (const file of wordingFiles) {
  const name = path.basename(file);
  const ev = parseWordingEval(fs.readFileSync(file, 'utf8'));
  report(`wording/${name}: has a compliance check regex that compiles`, !!ev.check && compiles(ev.check), JSON.stringify(ev.check));
  report(`wording/${name}: has >=2 variants, each with non-empty instruction text`,
    ev.variants.length >= 2 && ev.variants.every((v) => v.label && v.instruction),
    JSON.stringify(ev.variants.map((v) => v.label)));
  report(`wording/${name}: has >=1 task`, ev.tasks.length >= 1, `${ev.tasks.length} tasks`);
  reportTestsSource(file);
}

for (const file of outputFiles) {
  const name = path.basename(file);
  const spec = parseOutputEval(fs.readFileSync(file, 'utf8'));
  const envelopes = declaredEnvelopes(spec.rules + '\n' + spec.scenario);
  report(`output/${name}: has skill rules`, !!spec.rules);
  report(`output/${name}: has a scenario`, !!spec.scenario);
  report(`output/${name}: rules/scenario declare at least one <<NAME>> envelope`,
    envelopes.size >= 1, [...envelopes].join(','));
  report(`output/${name}: has >=1 assertion, each targeting 'any' or a declared envelope, regex compiles`,
    spec.assertions.length >= 1 &&
    spec.assertions.every((a) => (a.target === 'any' || envelopes.has(a.target)) && compiles(a.pattern)),
    JSON.stringify(spec.assertions.map((a) => `${a.target}:${a.name}`)));
  report(`output/${name}: judge target is 'any' or a declared envelope`,
    !spec.judge || spec.judgeTarget === 'any' || envelopes.has(spec.judgeTarget),
    spec.judgeTarget);
  reportTestsSource(file);
}

for (const file of behaviorFiles) {
  const name = path.basename(file);
  const spec = parseBehaviorEval(fs.readFileSync(file, 'utf8'));
  report(`behavior/${name}: has >=1 task`, spec.tasks.length >= 1, `${spec.tasks.length} tasks`);
  report(`behavior/${name}: defines at least one grader (Complies when / Violates when / Judge)`,
    !!(spec.compliesWhen || spec.violatesWhen || spec.judge));
  report(`behavior/${name}: any deterministic regexes compile`,
    (!spec.compliesWhen || compiles(spec.compliesWhen)) && (!spec.violatesWhen || compiles(spec.violatesWhen)),
    JSON.stringify({ compliesWhen: spec.compliesWhen, violatesWhen: spec.violatesWhen }));
  reportTestsSource(file);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
