#!/usr/bin/env node

/**
 * Skill output-quality eval. Where the trigger walk asks "does the skill FIRE",
 * this asks "when it fires, is the OUTPUT good" — for artifact-producing skills
 * with objectively gradable output (commit, capture-invariants, ...), the second
 * half the kit's Skill Addition Gate did not cover (issue #413, #706).
 *
 * Hermetic by construction: the skill's artifact rules are injected via
 * `--append-system-prompt` under `--safe-mode`, and a fixed scenario asks the
 * model to PRODUCE the artifact in one or more `<<NAME>>` envelopes the corpus
 * declares (commit's COMMIT+PR, an invariants spec's SPEC).
 * Nothing touches git or gh, so the eval has no side effects and needs no
 * sandbox repo. The produced artifact is graded two ways:
 *   - deterministic assertions: regexes from the eval file, each scoped to a
 *     section (commit | pr | any). Zero-cost, no judge.
 *   - one judge assertion: a `{pass, reason}` JSON verdict for the one
 *     subjective criterion (does the message accurately describe the diff?).
 *     This is the Scope-B framework decision (#413 D4): a ~1-call cjs judge on
 *     the existing infra, not a Python eval framework — boring-check wins.
 *
 * The judge runs on `claude -p --safe-mode` by default, or on a local Ollama
 * model with `--local <model>` (#845). `--local` routes ONLY the judge — the
 * PRODUCER stays on Claude, because this eval grades what the shipped skill
 * produces on its real model; swapping the producer would measure local-model
 * artifact quality, a different question. That is the routing convention: route
 * a JUDGE returning a structured verdict, never a PRODUCER whose model identity
 * is the thing under test (see `specs/kit/kit-eval.md`). A local judge that
 * cannot run (Ollama down / model missing / timeout / parse-fail) scores the
 * assertion FAIL with the error surfaced — never a silent pass.
 *
 * Before trusting `--local`, validate it: `--calibrate` grades the corpus's
 * `## Calibration` cases (fixed commit messages with a known pass/fail verdict)
 * with the judge alone, the producer held out. Run it on Claude and on `--local`
 * and confirm they agree (the #837 method, fixed inputs to isolate the judge
 * from the producer's non-determinism).
 *
 * Usage:
 *   node skill-output-eval.cjs <skill-name> [--eval <path>] [--model M]
 *                              [--local <ollama-model>] [--host URL] [--json]
 *   node skill-output-eval.cjs <skill-name> --calibrate
 *                              [--local <ollama-model>] [--model M] [--json]
 *
 * Default eval path: .claude/research/skill-output-evals/<name>.md
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { localJson, checkAvailable } = require('../hooks/lib/local-llm.cjs');
const { claudeRun, readJudgeVerdict, mapLocalVerdict: mapLocal } = require('../hooks/lib/eval-harness.cjs');

// ---- pure core (deterministic, unit-tested) ----

/**
 * Parse a skill-output eval markdown file.
 *   `## Skill rules`     -> injected as --append-system-prompt (the artifact rules).
 *   `## Scenario`        -> the -p prompt; must instruct the marker envelope(s).
 *   `## Assertions`      -> bullets `<target> \`<regex>\` — <name>`; target is
 *                           `any` or a declared envelope name (commit, pr, spec, …).
 *   `## Judge (target)`  -> the subjective criterion, graded against the named
 *                           envelope (default `any` = the whole artifact).
 */
function parseOutputEval(text) {
  const lines = String(text).split('\n');
  let section = null;
  let judgeTarget = 'any';
  const buf = { rules: [], scenario: [], judge: [] };
  const assertions = [];
  for (const raw of lines) {
    const heading = raw.match(/^##\s+(.*)/);
    if (heading) {
      const low = heading[1].trim().toLowerCase();
      if (/^skill rules/.test(low)) section = 'rules';
      else if (/^scenario/.test(low)) section = 'scenario';
      else if (/^assertions?/.test(low)) section = 'assertions';
      else if (/^judge\b/.test(low)) {
        section = 'judge';
        const tm = heading[1].match(/\(([^)]+)\)/);
        judgeTarget = tm ? tm[1].trim().toLowerCase() : 'any';
      }
      else section = null;
      continue;
    }
    if (section === 'rules') buf.rules.push(raw);
    else if (section === 'scenario') buf.scenario.push(raw);
    else if (section === 'judge') buf.judge.push(raw);
    else if (section === 'assertions') {
      const line = raw.trim();
      if (!line.startsWith('-')) continue;
      const m = line.match(/^-\s*([a-zA-Z][\w-]*)\s+`([^`]+)`\s*(?:—|-)?\s*(.*)$/);
      if (m) assertions.push({ target: m[1].toLowerCase(), pattern: m[2], name: (m[3] || m[2]).trim() });
    }
  }
  return {
    rules: buf.rules.join('\n').trim(),
    scenario: buf.scenario.join('\n').trim(),
    judge: buf.judge.join('\n').trim(),
    judgeTarget,
    assertions,
  };
}

/**
 * Extract every `<<NAME>> … <<END_NAME>>` envelope from a produced artifact,
 * keyed by lowercased NAME. NAME is `[A-Z][A-Z0-9_]*`; the `\1` backreference
 * ties each open marker to its own close, so `<<COMMIT>>…<<END_PR>>` never
 * cross-matches. commit's two-face artifact (COMMIT + PR) and a single-face
 * spec artifact (SPEC) both parse through this one path — the corpus owns the
 * shape, the harness stays generic.
 */
function parseEnvelopes(text) {
  const t = String(text || '');
  const sections = {};
  const re = /<<([A-Z][A-Z0-9_]*)>>\s*([\s\S]*?)\s*<<END_\1>>/g;
  let m;
  while ((m = re.exec(t)) !== null) sections[m[1].toLowerCase()] = m[2].trim();
  return sections;
}

/** Run the deterministic assertions against the split sections. */
function runAssertions(sections, assertions) {
  return assertions.map((a) => {
    const hay = a.target === 'any' ? Object.values(sections).join('\n') : (sections[a.target] || '');
    let ok = false;
    try { ok = new RegExp(a.pattern, 'm').test(hay); } catch (_) { ok = false; }
    return { name: a.name, target: a.target, pattern: a.pattern, pass: ok };
  });
}

/** The {pass, reason} verdict from a judge response, tolerant of prose/fences
 * (`eval-harness` extractJsonObject, #867). Fail-closed to pass=false. */
const parseJudge = (text) => readJudgeVerdict(text, 'pass', false);

/**
 * The judge prompt: the corpus's subjective criterion, the produced artifact
 * under test, and the JSON-verdict instruction. Shared by the live eval (the
 * artifact is freshly produced) and `--calibrate` (it is a fixed corpus case),
 * so both backends grade with identical wording. `target` labels the artifact
 * (COMMIT, SPEC, …); `any` uses a generic label.
 */
function buildJudgePrompt(criterion, artifact, target) {
  const label = target && target !== 'any' ? `${target.toUpperCase()} PRODUCED:` : 'ARTIFACT PRODUCED:';
  return [
    criterion,
    '',
    label,
    artifact || '(none)',
    '',
    'Respond with ONLY a JSON object: {"pass": true|false, "reason": "<one sentence>"}.',
  ].join('\n');
}

/** Map a local-llm result to a {pass, reason} verdict. Fail-closed: a non-ok
 * result (Ollama down / model missing / timeout / parse-fail) becomes pass=false
 * carrying the error, so a judge that could not run never silently passes. */
const mapLocalVerdict = (r) => mapLocal(r, 'pass', false);

/**
 * Parse the corpus's optional `## Calibration` section: fixed commit messages
 * with a known verdict, to validate a judge backend against ground truth (the
 * #837 method, producer held out). Each `### pass: <label>` / `### fail: <label>`
 * heading opens a case whose body — every line until the next `###`/`##` — is the
 * commit message. `expectPass` is true for a `pass` case. parseOutputEval ignores
 * this whole section (it is not a rules/scenario/assertions/judge heading), so
 * the two parsers share one corpus file without colliding.
 */
function parseCalibration(text) {
  const cases = [];
  let inCal = false;
  let cur = null;
  const flush = () => {
    if (cur) { cases.push({ label: cur.label, expectPass: cur.expectPass, message: cur.lines.join('\n').trim() }); cur = null; }
  };
  for (const raw of String(text).split('\n')) {
    const h2 = raw.match(/^##\s+(.*)/);
    if (h2) { flush(); inCal = /^calibration\b/i.test(h2[1].trim()); continue; }
    if (!inCal) continue;
    const h3 = raw.match(/^###\s+(pass|fail)\s*:?\s*(.*)$/i);
    if (h3) { flush(); cur = { label: (h3[2] || '').trim() || h3[1].toLowerCase(), expectPass: /pass/i.test(h3[1]), lines: [] }; continue; }
    if (cur) cur.lines.push(raw);
  }
  flush();
  return cases;
}

// ---- edge (IO, subprocess, nondeterminism) ----

/** The judge verdict as a JSON schema for Ollama structured output. */
const JUDGE_SCHEMA = {
  type: 'object',
  properties: { pass: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['pass', 'reason'],
};

/**
 * One judge verdict on the chosen backend. Default: `claude -p --safe-mode`,
 * parsed tolerantly. With opts.local: Ollama structured output at temperature 0
 * for a reproducible verdict, failing closed via mapLocalVerdict. Only the judge
 * is ever routed here — the producer always runs on Claude (see evaluate).
 */
async function runJudge(judgePrompt, opts) {
  if (opts.local) {
    const r = await localJson({ prompt: judgePrompt, schema: JUDGE_SCHEMA, model: opts.local, host: opts.host, timeoutMs: opts.timeoutMs, options: { temperature: 0 } });
    return mapLocalVerdict(r);
  }
  const text = await claudeRun(judgePrompt, null, opts);
  return parseJudge(text);
}

async function evaluate(spec, opts) {
  // The producer always runs on Claude — never opts.local. This eval grades what
  // the SHIPPED skill produces on its real model; routing the producer local
  // would measure local-model artifact quality, a different question. Pass an
  // explicit producer-options object (no `local`) so the invariant holds at the
  // call site, not by trusting claudeRun to drop the field.
  const artifact = await claudeRun(spec.scenario, spec.rules, { model: opts.model, timeoutMs: opts.timeoutMs, cwd: opts.cwd });
  const sections = parseEnvelopes(artifact);
  const deterministic = runAssertions(sections, spec.assertions);

  let judge = null;
  if (spec.judge) {
    const target = spec.judgeTarget || 'any';
    const judged = target === 'any' ? Object.values(sections).join('\n') : (sections[target] || '');
    judge = await runJudge(buildJudgePrompt(spec.judge, judged, target), opts);
  }
  return { artifact, sections, deterministic, judge };
}

// ---- CLI ----

function parseArgs(argv) {
  const out = { model: null, evalPath: null, json: false, skill: null, local: null, host: undefined, calibrate: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') out.model = argv[++i];
    else if (a === '--eval') out.evalPath = argv[++i];
    else if (a === '--local') out.local = argv[++i];
    else if (a === '--host') out.host = argv[++i];
    else if (a === '--calibrate') out.calibrate = true;
    else if (a === '--json') out.json = true;
    else if (!out.skill) out.skill = a;
  }
  return out;
}

/**
 * Validate a judge backend against ground truth: grade the corpus's `##
 * Calibration` cases with the judge alone (producer held out, fixed inputs), so
 * judge variance is not confounded with the producer's non-determinism (#837).
 * Reports sensitivity (bad messages caught) and specificity (good messages
 * passed); exits 0 only on a perfect split. Run on Claude and on `--local` and
 * confirm they agree before trusting a local judge backend.
 */
async function runCalibrate(opts, spec) {
  if (!spec.judge) { console.error('corpus has no "## Judge" criterion to calibrate'); process.exit(2); }
  if (spec.cases.length === 0) { console.error('no "## Calibration" cases (### pass: / ### fail:) in corpus'); process.exit(2); }
  const backend = opts.local ? `local:${opts.local}` : (opts.model || '(configured default)');
  const runCwd = opts.local ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'soe-cal-'));
  const rows = [];
  try {
    for (const c of spec.cases) {
      const verdict = await runJudge(buildJudgePrompt(spec.judge, c.message, spec.judgeTarget), { model: opts.model, local: opts.local, host: opts.host, timeoutMs: 120000, cwd: runCwd });
      const correct = verdict.pass === c.expectPass;
      rows.push({ label: c.label, expectPass: c.expectPass, gotPass: verdict.pass, correct, reason: verdict.reason });
      console.error(`  [${correct ? 'OK ' : 'XX '}] expect ${c.expectPass ? 'pass' : 'fail'}  ${c.label} → judge ${verdict.pass ? 'PASS' : 'FAIL'}`);
      if (!correct) console.error(`      · ${verdict.reason}`);
    }
  } finally {
    if (runCwd) { try { fs.rmSync(runCwd, { recursive: true, force: true }); } catch (_) { /* best effort */ } }
  }
  const fails = rows.filter((r) => !r.expectPass);
  const passes = rows.filter((r) => r.expectPass);
  const sensitivity = fails.length ? fails.filter((r) => r.correct).length / fails.length : 1; // bad messages caught
  const specificity = passes.length ? passes.filter((r) => r.correct).length / passes.length : 1; // good messages passed
  console.error(`\ncalibration — judge: ${backend}`);
  console.error(`  sensitivity (bad caught):  ${(sensitivity * 100).toFixed(0)}% (${fails.filter((r) => r.correct).length}/${fails.length})`);
  console.error(`  specificity (good passed): ${(specificity * 100).toFixed(0)}% (${passes.filter((r) => r.correct).length}/${passes.length})`);
  if (opts.json) console.log(JSON.stringify({ skill: opts.skill, judge: backend, sensitivity, specificity, rows }, null, 2));
  process.exit(sensitivity === 1 && specificity === 1 ? 0 : 1);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.skill) {
    console.error('usage: skill-output-eval.cjs <skill-name> [--eval <path>] [--model M] [--local <ollama-model>] [--host URL] [--json]');
    console.error('       skill-output-eval.cjs <skill-name> --calibrate [--local <ollama-model>] [--model M] [--json]');
    process.exit(2);
  }
  const cwd = process.cwd();
  const evalPath = opts.evalPath ||
    path.join(cwd, '.claude', 'research', 'skill-output-evals', `${opts.skill}.md`);
  if (!fs.existsSync(evalPath)) { console.error(`no output eval at ${evalPath}`); process.exit(2); }
  const evalText = fs.readFileSync(evalPath, 'utf8');
  const spec = parseOutputEval(evalText);
  spec.cases = parseCalibration(evalText);

  // Fail honest before any work: a --local run needs Ollama up and the model
  // pulled, in both eval and calibrate modes.
  if (opts.local) {
    const a = await checkAvailable({ model: opts.local, host: opts.host });
    if (!a.ok) { console.error(`[local] ${a.error}`); process.exit(2); }
  }

  if (opts.calibrate) return runCalibrate(opts, spec);

  if (!spec.scenario || spec.assertions.length === 0) {
    console.error(`eval needs a "## Scenario" and at least one "## Assertions" bullet`);
    process.exit(2);
  }

  // Neutral, empty cwd: under --safe-mode the model still has Read/Bash, so
  // running in the repo would let it read the real skill to compensate for an
  // incomplete injected prompt — contaminating the grade. An empty cwd forces
  // the artifact to come from the injected rules alone.
  const runCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'soe-'));
  let res;
  try {
    res = await evaluate(spec, { model: opts.model, local: opts.local, host: opts.host, timeoutMs: 120000, cwd: runCwd });
  } finally {
    try { fs.rmSync(runCwd, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
  const producer = opts.model || '(configured default)';
  const judgeBackend = opts.local ? `local:${opts.local}` : producer;
  console.error(`\nSkill output eval: ${opts.skill}  producer: ${producer}  judge: ${judgeBackend}`);
  for (const a of res.deterministic) {
    console.error(`  [${a.pass ? 'PASS' : 'FAIL'}] ${a.target}: ${a.name}`);
  }
  if (res.judge) console.error(`  [${res.judge.pass ? 'PASS' : 'FAIL'}] judge: ${res.judge.reason}`);

  const detFail = res.deterministic.filter((a) => !a.pass).length;
  const judgeFail = res.judge && !res.judge.pass ? 1 : 0;
  const failed = detFail + judgeFail;
  const total = res.deterministic.length + (res.judge ? 1 : 0);
  console.error(`\n${total - failed}/${total} assertions pass`);
  if (opts.json) console.log(JSON.stringify({ skill: opts.skill, producer, judge: judgeBackend, ...res }, null, 2));
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(2); });
}

module.exports = { parseOutputEval, parseEnvelopes, runAssertions, parseJudge, buildJudgePrompt, mapLocalVerdict, parseCalibration, parseArgs, JUDGE_SCHEMA };
