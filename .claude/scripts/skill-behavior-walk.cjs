#!/usr/bin/env node

/**
 * Skill behavior walk — Scope C of kit-eval (#348). Where the trigger walk asks
 * "does the skill FIRE" and the output eval asks "is a produced artifact good",
 * this asks "does the skill CHANGE BEHAVIOR" — the only valid instrument for the
 * task-phrase lens skills the cold trigger walk cannot measure (#498): skills
 * whose should-fire phrase is a task the model just does ("draft an email"),
 * never invoking the Skill, yet whose value is a property of the output.
 *
 * It is an ABLATION. For each golden task it produces the output twice under
 * `claude -p --safe-mode` with a shared neutral base prompt:
 *   - warm: base + the skill's SKILL.md body appended as the system prompt
 *   - cold: base alone, skill absent
 * so the skill body is the ONLY differing variable. Each output is graded for
 * compliance independently — deterministic regex (`## Complies when` /
 * `## Violates when`) where the property allows, an LLM judge (`## Judge`) where
 * it does not — and the signal is the compliance-rate DELTA, warm minus cold.
 * A lens that flips many cases from non-compliant to compliant has value warm
 * even though it never fires cold; a lens whose warm rate equals its cold rate
 * is dead weight the model would satisfy anyway (#853). The keep/cut thresholds
 * are pre-registered in research/skill-behavior-eval-protocol-2026-06.md.
 *
 * The judge runs on `claude -p --safe-mode` by default, or on a local Ollama
 * model with `--local <model>` (#845). `--local` routes ONLY the judge — the
 * PRODUCER stays on Claude, because this grades what the shipped skill does on
 * its real model (the kit-eval routing convention). A local judge that cannot
 * run scores the output NON-compliant with the error surfaced, never a silent
 * pass. Validate a backend first with `--calibrate` against the corpus's
 * `## Calibration` cases (fixed outputs, known verdict, producer held out — the
 * #837 method).
 *
 * Concurrency + cost: each task fires 2 producer calls (+ up to 2 judge calls)
 * per run, all cold `claude -p`. Like every kit walk it is quota-hostile on Max
 * (#852); run at low concurrency and estimate sessions before a full pass.
 *
 * Usage:
 *   node skill-behavior-walk.cjs <skill> [--runs N] [--model M] [--timeout MS]
 *                                [--local <ollama-model>] [--host URL] [--json]
 *   node skill-behavior-walk.cjs <skill> --calibrate [--local <ollama-model>]
 *                                [--model M] [--json]
 *
 * Default corpus: .claude/research/skill-behavior-evals/<skill>.md
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { localJson, checkAvailable } = require('../hooks/lib/local-llm.cjs');
const { claudeRun, readJudgeVerdict, mapLocalVerdict: mapLocal } = require('../hooks/lib/eval-harness.cjs');

// A shared, task-neutral base prompt on BOTH conditions, so cold is not
// handicapped by an empty system prompt and the only variable across the two
// runs is the injected skill body. It asks for the deliverable inside an
// <<OUTPUT>> envelope so grading sees only the artifact, never the model's
// surrounding commentary — which, left in, can quote the very words a regex is
// hunting and zero out a correct skill (observed on concretize-pass, #348).
const BASE_SYSTEM = 'Respond to the user\'s request. Put ONLY your final deliverable — the rewritten text, email, issue, answer, or analysis they asked for — between the markers <<OUTPUT>> and <<END_OUTPUT>>. Put any reasoning, notes, or caveats outside the markers.';

// ---- pure core (deterministic, unit-tested) ----

/**
 * Parse a skill-behavior eval markdown file.
 *   `## Tasks`         -> quoted bullets; each is a -p prompt (a natural
 *                         task-phrase the skill should improve).
 *   `## Complies when` -> a backtick-quoted JS regex; match on the output ⇒ the
 *                         output exhibits the behavior.
 *   `## Violates when` -> a backtick-quoted JS regex; match on the output ⇒ it
 *                         does NOT (an anti-pattern is present).
 *   `## Judge`         -> a criterion posed to the judge per output, returning
 *                         {complies}. Used where a regex cannot decide.
 * At least one of Complies-when / Violates-when / Judge must be present.
 * `## Calibration` (### pass: / ### fail:) is parsed separately by
 * parseCalibration and ignored here.
 */
function parseBehaviorEval(text) {
  const lines = String(text).split('\n');
  let section = null;
  const buf = { tasks: [], compliesWhen: [], violatesWhen: [], judge: [] };
  for (const raw of lines) {
    const heading = raw.match(/^##\s+(.*)/);
    if (heading) {
      const low = heading[1].trim().toLowerCase();
      if (/^tasks?/.test(low)) section = 'tasks';
      else if (/^complies\s+when/.test(low)) section = 'compliesWhen';
      else if (/^violates\s+when/.test(low)) section = 'violatesWhen';
      else if (/^judge/.test(low)) section = 'judge';
      else section = null;
      continue;
    }
    if (section === 'judge') buf.judge.push(raw);
    else if (section === 'tasks') {
      const line = raw.trim();
      if (!line.startsWith('-')) continue;
      const q = line.match(/"([^"]+)"/);
      const task = q ? q[1] : line.replace(/^-\s*/, '').trim();
      if (task) buf.tasks.push(task);
    } else if (section === 'compliesWhen' || section === 'violatesWhen') {
      const m = raw.match(/`([^`]+)`/);
      if (m) buf[section].push(m[1]);
    }
  }
  return {
    tasks: buf.tasks,
    compliesWhen: buf.compliesWhen[0] || null,
    violatesWhen: buf.violatesWhen[0] || null,
    judge: buf.judge.join('\n').trim() || null,
  };
}

/** The skill's body — the SKILL.md with its frontmatter stripped. The body is
 * the methodology the warm condition injects; the frontmatter is routing metadata. */
function skillBody(text) {
  const m = String(text).match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  return (m ? m[1] : String(text)).trim();
}

/** The gradable artifact: the span between <<OUTPUT>> and <<END_OUTPUT>>, so a
 * grader sees the deliverable, not the model's surrounding commentary (which may
 * quote the very words a regex is hunting). Falls back to the whole text when the
 * model omits the envelope, so a format slip degrades rather than zeroes the run. */
function extractOutput(text) {
  const m = String(text || '').match(/<<OUTPUT>>\s*([\s\S]*?)\s*<<END_OUTPUT>>/);
  return (m ? m[1] : String(text || '')).trim();
}

/**
 * Deterministic compliance verdict for one output. Returns:
 *   - null  when neither regex is defined (this corpus is judge-only),
 *   - true  when Complies-when matches (if given) AND Violates-when does not
 *           (if given),
 *   - false otherwise.
 * A regex that fails to compile fails CLOSED (counts as non-compliant), never
 * throws — mirroring the output eval's assertion grading.
 */
function gradeDeterministic(output, { compliesWhen, violatesWhen }) {
  if (!compliesWhen && !violatesWhen) return null;
  const hay = String(output || '');
  // Case-insensitive + multiline: a corpus lists "significant" once, not every
  // capitalization, and `^`/`$` anchor per line so an opener regex matches the
  // first line of a multi-line draft.
  const test = (src) => { try { return new RegExp(src, 'im').test(hay); } catch (_) { return null; } };
  if (compliesWhen) {
    const m = test(compliesWhen);
    if (m !== true) return false; // no match, or bad regex (null) → fail closed
  }
  if (violatesWhen) {
    const m = test(violatesWhen);
    if (m !== false) return false; // matched the anti-pattern, or bad regex → fail closed
  }
  return true;
}

/** Combine the deterministic and judge verdicts into one compliance boolean.
 * Both present ⇒ AND (both must agree it complies). One present ⇒ that one.
 * Neither ⇒ null (caller guards: a corpus must define at least one grader). */
function complianceVerdict(det, judge) {
  if (det === null && judge === null) return null;
  if (det !== null && judge !== null) return det === true && judge === true;
  return det !== null ? det : judge;
}

/** The {complies, reason} verdict from a judge response, tolerant of prose/fences
 * (`eval-harness` extractJsonObject, #867). Fail-closed to complies=false. */
const parseBehaviorJudge = (text) => readJudgeVerdict(text, 'complies', false);

/** Map a local-llm result to {complies, reason}. Fail-closed: a non-ok result
 * (Ollama down / timeout / parse-fail) becomes complies=false carrying the error. */
const mapLocalVerdict = (r) => mapLocal(r, 'complies', false);

/** The judge prompt: the corpus criterion, the output under test, the JSON
 * instruction. Shared by the live walk and `--calibrate` so both grade alike. */
function buildBehaviorJudgePrompt(criterion, output) {
  return [
    'You are grading whether one model output exhibits a specific behavior.',
    '',
    `BEHAVIOR TO CHECK: ${criterion}`,
    '',
    'OUTPUT:',
    output || '(empty)',
    '',
    'Respond with ONLY a JSON object: {"complies": true|false, "reason": "<one sentence>"}.',
  ].join('\n');
}

/**
 * Aggregate per-run records into rates. Each record carries warmComplies and
 * coldComplies (boolean | null; null = the grade could not be computed and is
 * excluded from the rate, never silently counted as compliant). Returns warm/
 * cold compliance rates over the gradable trials, their delta, and a per-task
 * breakdown.
 */
function aggregate(records) {
  const rate = (key) => {
    const vals = records.map((r) => r[key]).filter((v) => v === true || v === false);
    if (!vals.length) return { rate: 0, n: 0 };
    return { rate: vals.filter(Boolean).length / vals.length, n: vals.length };
  };
  const warm = rate('warmComplies');
  const cold = rate('coldComplies');
  const byTask = {};
  for (const r of records) {
    const t = (byTask[r.task] ||= { task: r.task, warm: [], cold: [] });
    if (typeof r.warmComplies === 'boolean') t.warm.push(r.warmComplies);
    if (typeof r.coldComplies === 'boolean') t.cold.push(r.coldComplies);
  }
  const perTask = Object.values(byTask).map((t) => ({
    task: t.task,
    warmRate: t.warm.length ? t.warm.filter(Boolean).length / t.warm.length : null,
    coldRate: t.cold.length ? t.cold.filter(Boolean).length / t.cold.length : null,
  }));
  return {
    nTrials: records.length,
    warmRate: warm.rate, warmN: warm.n,
    coldRate: cold.rate, coldN: cold.n,
    delta: warm.rate - cold.rate,
    perTask,
  };
}

// Pre-registered keep/cut rule (#348, skill-behavior-eval-protocol-2026-06.md).
// label by the warm−cold delta; weakWarm flags a skill whose warm output is
// non-compliant more often than not even with the skill present.
const THRESHOLDS = { keepDelta: 0.4, deadDelta: 0.1, weakWarmRate: 0.5 };

/** Verdict from the aggregate, against the pre-registered thresholds. Returns a
 * delta `label` plus an independent `weakWarm` flag — not one mutually-exclusive
 * bucket — because a skill can both help (high delta) and be mediocre (low warm
 * rate), and collapsing those loses the fix-vs-cut distinction. */
function verdict(agg, thresholds = THRESHOLDS) {
  let label;
  if (agg.delta >= thresholds.keepDelta) label = 'KEEP';
  else if (agg.delta <= thresholds.deadDelta) label = 'DEAD-WEIGHT';
  else label = 'INCONCLUSIVE';
  return { label, weakWarm: agg.warmRate < thresholds.weakWarmRate, delta: agg.delta, warmRate: agg.warmRate, coldRate: agg.coldRate };
}

/**
 * Parse the corpus's optional `## Calibration` section: fixed outputs with a
 * known verdict, to validate a judge backend against ground truth (#837 method,
 * producer held out). `### pass: <label>` ⇒ the output complies; `### fail:
 * <label>` ⇒ it does not. The body until the next `###`/`##` is the output.
 */
function parseCalibration(text) {
  const cases = [];
  let inCal = false;
  let cur = null;
  const flush = () => {
    if (cur) { cases.push({ label: cur.label, expectComplies: cur.expectComplies, output: cur.lines.join('\n').trim() }); cur = null; }
  };
  for (const raw of String(text).split('\n')) {
    const h2 = raw.match(/^##\s+(.*)/);
    if (h2) { flush(); inCal = /^calibration\b/i.test(h2[1].trim()); continue; }
    if (!inCal) continue;
    const h3 = raw.match(/^###\s+(pass|fail)\s*:?\s*(.*)$/i);
    if (h3) { flush(); cur = { label: (h3[2] || '').trim() || h3[1].toLowerCase(), expectComplies: /pass/i.test(h3[1]), lines: [] }; continue; }
    if (cur) cur.lines.push(raw);
  }
  flush();
  return cases;
}

function parseArgs(argv) {
  const out = { skill: null, runs: 3, model: null, timeout: 120000, json: false, local: null, host: undefined, calibrate: false, out: null, resume: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') out.runs = parseInt(argv[++i], 10) || out.runs;
    else if (a === '--model') out.model = argv[++i];
    else if (a === '--timeout') out.timeout = parseInt(argv[++i], 10) || out.timeout;
    else if (a === '--local') out.local = argv[++i];
    else if (a === '--host') out.host = argv[++i];
    else if (a === '--calibrate') out.calibrate = true;
    else if (a === '--json') out.json = true;
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--resume') out.resume = true;
    else if (!out.skill) out.skill = a;
  }
  return out;
}

/** The judge verdict as a JSON schema for Ollama structured output. */
const JUDGE_SCHEMA = {
  type: 'object',
  properties: { complies: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['complies', 'reason'],
};

// ---- edge (IO, subprocess, nondeterminism) ----

/** One judge verdict on the chosen backend. Default `claude -p --safe-mode`,
 * parsed tolerantly; with opts.local, Ollama structured output at temperature 0,
 * failing closed. Only the judge is ever routed here — the producer stays Claude. */
async function runBehaviorJudge(judgePrompt, opts) {
  if (opts.local) {
    const r = await localJson({ prompt: judgePrompt, schema: JUDGE_SCHEMA, model: opts.local, host: opts.host, timeoutMs: opts.timeoutMs, options: { temperature: 0 } });
    return mapLocalVerdict(r);
  }
  const text = await claudeRun(judgePrompt, null, { model: opts.model, timeoutMs: opts.timeoutMs, cwd: opts.cwd });
  return parseBehaviorJudge(text);
}

/** Grade one output: extract the deliverable from its <<OUTPUT>> envelope, then
 * combine a deterministic verdict (if the corpus defines regexes) and a judge
 * verdict (if it defines a criterion). Both grade the artifact, not the model's
 * surrounding commentary. */
async function gradeOutput(output, spec, opts) {
  const artifact = extractOutput(output);
  const det = gradeDeterministic(artifact, spec);
  let judge = null;
  if (spec.judge) judge = (await runBehaviorJudge(buildBehaviorJudgePrompt(spec.judge, artifact), opts)).complies;
  return complianceVerdict(det, judge);
}

/** The ablation walk: each task × run produces warm + cold, grades both. The
 * producer always runs on Claude (never opts.local) — local routing is the
 * judge's alone. */
async function walk(spec, body, opts) {
  const warmSystem = `${BASE_SYSTEM}\n\n${body}`;
  const producer = { model: opts.model, timeoutMs: opts.timeoutMs, cwd: opts.cwd };
  const records = [];
  for (const task of spec.tasks) {
    for (let r = 0; r < opts.runs; r++) {
      const warmOut = await claudeRun(task, warmSystem, producer);
      const coldOut = await claudeRun(task, BASE_SYSTEM, producer);
      const warmComplies = await gradeOutput(warmOut, spec, opts);
      const coldComplies = await gradeOutput(coldOut, spec, opts);
      records.push({ task, run: r, warmComplies, coldComplies, warmOut, coldOut });
      console.error(`  ${task.slice(0, 48)}…  run ${r + 1}/${opts.runs}  warm:${fmt(warmComplies)} cold:${fmt(coldComplies)}`);
    }
  }
  return records;
}

const fmt = (v) => (v === true ? '✓' : v === false ? '✗' : '?');

// ---- CLI ----

/**
 * Validate a judge backend: grade the corpus's `## Calibration` outputs with the
 * judge alone (producer held out, fixed inputs), so judge variance is not
 * confounded with producer non-determinism (#837). Reports sensitivity (non-
 * compliant outputs caught) and specificity (compliant outputs passed); exits 0
 * only on a perfect split. Run on Claude and on `--local`; both must agree
 * before trusting a local backend.
 */
async function runCalibrate(opts, spec, cases) {
  if (!spec.judge) { console.error('corpus has no "## Judge" criterion to calibrate'); process.exit(2); }
  if (cases.length === 0) { console.error('no "## Calibration" cases (### pass: / ### fail:) in corpus'); process.exit(2); }
  const backend = opts.local ? `local:${opts.local}` : (opts.model || '(configured default)');
  const runCwd = opts.local ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'sbw-cal-'));
  const rows = [];
  try {
    for (const c of cases) {
      const v = await runBehaviorJudge(buildBehaviorJudgePrompt(spec.judge, c.output), { model: opts.model, local: opts.local, host: opts.host, timeoutMs: opts.timeout, cwd: runCwd });
      const correct = v.complies === c.expectComplies;
      rows.push({ label: c.label, expectComplies: c.expectComplies, gotComplies: v.complies, correct, reason: v.reason });
      console.error(`  [${correct ? 'OK ' : 'XX '}] expect ${c.expectComplies ? 'complies' : 'violates'}  ${c.label} → judge ${v.complies ? 'COMPLIES' : 'VIOLATES'}`);
      if (!correct) console.error(`      · ${v.reason}`);
    }
  } finally {
    if (runCwd) { try { fs.rmSync(runCwd, { recursive: true, force: true }); } catch (_) { /* best effort */ } }
  }
  const neg = rows.filter((r) => !r.expectComplies);
  const pos = rows.filter((r) => r.expectComplies);
  const sensitivity = neg.length ? neg.filter((r) => r.correct).length / neg.length : 1;
  const specificity = pos.length ? pos.filter((r) => r.correct).length / pos.length : 1;
  console.error(`\ncalibration — judge: ${backend}`);
  console.error(`  sensitivity (violations caught): ${(sensitivity * 100).toFixed(0)}% (${neg.filter((r) => r.correct).length}/${neg.length})`);
  console.error(`  specificity (compliant passed):  ${(specificity * 100).toFixed(0)}% (${pos.filter((r) => r.correct).length}/${pos.length})`);
  if (opts.json) console.log(JSON.stringify({ skill: opts.skill, judge: backend, sensitivity, specificity, rows }, null, 2));
  process.exit(sensitivity === 1 && specificity === 1 ? 0 : 1);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.skill) {
    console.error('usage: skill-behavior-walk.cjs <skill> [--runs N] [--model M] [--timeout MS] [--local <ollama-model>] [--host URL] [--json] [--out PATH] [--resume]');
    console.error('       skill-behavior-walk.cjs <skill> --calibrate [--local <ollama-model>] [--model M] [--json]');
    process.exit(2);
  }
  // --resume: a re-run after an idle-reap (#866) skips skills already written to
  // --out, so an operator's per-skill loop resumes instead of restarting.
  if (!opts.calibrate && opts.resume && opts.out && fs.existsSync(opts.out)) {
    console.error(`resume: ${opts.skill} already done at ${opts.out} — skipping`);
    process.exit(0);
  }
  const root = process.cwd();
  const corpusPath = path.join(root, '.claude', 'research', 'skill-behavior-evals', `${opts.skill}.md`);
  const skillPath = path.join(root, '.claude', 'skills', opts.skill, 'SKILL.md');
  if (!fs.existsSync(corpusPath)) { console.error(`no behavior corpus at ${corpusPath}`); process.exit(2); }
  if (!fs.existsSync(skillPath)) { console.error(`no skill at ${skillPath}`); process.exit(2); }
  const corpusText = fs.readFileSync(corpusPath, 'utf8');
  const spec = parseBehaviorEval(corpusText);
  const cases = parseCalibration(corpusText);
  const body = skillBody(fs.readFileSync(skillPath, 'utf8'));

  if (!spec.compliesWhen && !spec.violatesWhen && !spec.judge) {
    console.error('corpus needs at least one of "## Complies when", "## Violates when", or "## Judge"');
    process.exit(2);
  }

  if (opts.local) {
    const a = await checkAvailable({ model: opts.local, host: opts.host });
    if (!a.ok) { console.error(`[local] ${a.error}`); process.exit(2); }
  }

  if (opts.calibrate) return runCalibrate(opts, spec, cases);

  if (spec.tasks.length === 0) { console.error('corpus has no "## Tasks"'); process.exit(2); }

  // Neutral, empty cwd: under --safe-mode the model keeps Read/Bash, so running
  // in the repo would let it read the real skill and contaminate the cold
  // baseline. An empty cwd forces each output from the injected prompt alone.
  const runCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sbw-'));
  let records;
  try {
    records = await walk(spec, body, { runs: opts.runs, model: opts.model, local: opts.local, host: opts.host, timeoutMs: opts.timeout, cwd: runCwd });
  } finally {
    try { fs.rmSync(runCwd, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }

  const agg = aggregate(records);
  const v = verdict(agg);
  const producer = opts.model || '(configured default)';
  const judgeBackend = spec.judge ? (opts.local ? `local:${opts.local}` : producer) : '(deterministic only)';
  console.error(`\nSkill behavior walk: ${opts.skill}  producer: ${producer}  judge: ${judgeBackend}`);
  console.error(`  warm compliance: ${(agg.warmRate * 100).toFixed(0)}% (${agg.warmN} trials)`);
  console.error(`  cold compliance: ${(agg.coldRate * 100).toFixed(0)}% (${agg.coldN} trials)`);
  console.error(`  delta:           ${(agg.delta * 100).toFixed(0)} pts`);
  console.error(`  verdict:         ${v.label}${v.weakWarm ? ' (weak warm — fix the skill)' : ''}`);
  // records carry the raw warm/cold outputs: --json is the look-at-your-data
  // surface, so a confounded grade can be diagnosed without re-running the walk.
  const payload = JSON.stringify({ skill: opts.skill, producer, judge: judgeBackend, runs: opts.runs, ...agg, verdict: v, records }, null, 2);
  // Atomic write (temp + rename) so an idle-reap (#866) during the write cannot
  // leave a partial file that --resume would mistake for a completed skill.
  if (opts.out) { const tmp = `${opts.out}.tmp`; fs.writeFileSync(tmp, payload); fs.renameSync(tmp, opts.out); console.error(`  wrote ${opts.out}`); }
  if (opts.json) console.log(payload);
  // Exit 0 always: the walk is a measurement, not a gate. A DEAD-WEIGHT verdict
  // is a real finding for #853, not a CI failure.
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(2); });
}

module.exports = {
  parseBehaviorEval, skillBody, extractOutput, gradeDeterministic, complianceVerdict,
  parseBehaviorJudge, mapLocalVerdict, buildBehaviorJudgePrompt, aggregate,
  verdict, parseCalibration, parseArgs, THRESHOLDS, JUDGE_SCHEMA, BASE_SYSTEM,
};
