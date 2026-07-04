#!/usr/bin/env node

/**
 * Skill faithfulness walk. Where the trigger walk asks "does the skill FIRE"
 * and the output eval asks "is the OUTPUT good", this asks "does the skill's
 * one-line `description:` faithfully foreground what its body actually does".
 *
 * It gates a faithfulness VIOLATION: a description that CONTRADICTS the body or
 * MISSTATES its scope, so a reader is misled about what the tool is for. It does
 * NOT flag a description that is accurate but could foreground the distinctive
 * core more sharply — that under-foregrounding is a writing-quality preference,
 * not a faithfulness violation, and the #837 calibration showed that forcing a
 * judge to enforce it drives over-flagging (LLM judges have a low true-negative
 * rate). The target is the contradiction/misstatement subset of the #749 drift,
 * the part no mechanical check (byte budget, grep, signature linter) can see.
 * This is an LLM-as-judge gate, adapting skill-output-eval's `claude -p
 * --safe-mode` judge mechanics and skill-trigger-walk's N× loop.
 *
 * The judge runs N× and the verdict aggregates to bias AGAINST false positives.
 * LLM judges have a low true-negative rate — they over-flag — and a gate that
 * false-blocks a clean skill is worse than one that misses a marginal case. So a
 * skill is flagged as drifted only when the faithful-rate falls below a
 * threshold (default 0.5: a strict majority of runs must call it unfaithful to
 * block). The threshold is set empirically by the calibration run (#837): low
 * enough that the clean control passes, high enough that the known drift fails.
 *
 * Two modes:
 *   - gate:      skill-faithfulness-walk.cjs <skill>   reads description + body
 *                from the installed skill (or command), judges N×, exits
 *                non-zero when the skill is flagged as drifted.
 *   - calibrate: skill-faithfulness-walk.cjs --calibrate [--corpus <path>]
 *                runs the judge over a labeled corpus (known-drift + known-clean)
 *                and reports sensitivity (drift caught) and specificity (clean
 *                passed) — the evidence that the judge and threshold are sound.
 *
 * Usage:
 *   node skill-faithfulness-walk.cjs <skill> [--runs N] [--threshold R] [--model M] [--json]
 *   node skill-faithfulness-walk.cjs --calibrate [--corpus <path>] [--runs N] [--threshold R] [--model M] [--json]
 *
 * --threshold R (default 0.5): a skill PASSES when faithful-rate >= R. Lower R
 *   means harder to flag — more bias against the judge's over-flagging tendency.
 * Default model: the project's configured model (no --model). The judge runs
 *   under --safe-mode in an empty cwd, so it grades only the injected text.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { localJson, checkAvailable } = require('../hooks/lib/local-llm.cjs');
const { claudeRun, readJudgeVerdict, mapLocalVerdict: mapLocal } = require('../hooks/lib/eval-harness.cjs');

// ---- pure core (deterministic, unit-tested) ----

/**
 * Split a SKILL.md / command .md into its frontmatter `description:` and body.
 * Handles the folded `description: >` form and the inline `description: text`
 * form. The body is everything after the closing `---`. Whitespace is collapsed
 * in the description so byte-for-byte newline differences do not leak in.
 */
function parseSkillDoc(text) {
  const t = String(text || '').replace(/\r\n/g, '\n');
  const fm = t.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fm) return { description: '', body: t.trim() };
  const front = fm[1];
  const body = (fm[2] || '').trim();
  const m = front.match(/description:\s*([\s\S]*?)(?=\n[A-Za-z_-]+:\s|\n?$)/);
  let description = m ? m[1].trim() : '';
  if (description.startsWith('>') || description.startsWith('|')) description = description.slice(1).trim();
  description = description.replace(/\s+/g, ' ').trim();
  return { description, body };
}

/**
 * The judge prompt. Comparative-factual on purpose: it asks only whether the
 * description foregrounds the body's distinctive core, NOT whether the writing
 * is good. Framing it as a quality judgment would invite the self-preference
 * bias that shows up when Claude grades Claude-written prose; framing it as a
 * does-A-represent-B check does not.
 */
function buildJudgePrompt(description, body) {
  return [
    "You are auditing whether a tool's one-line description is FAITHFUL to what the tool actually does, judged against its full instructions. A reader who sees only the description must not be MISLED about what the tool is for.",
    '',
    'FAITHFUL: the description is consistent with the body. It may be a general, partial, or less-sharp summary — that is fine. What matters is that it does not contradict the body and does not claim a purpose or scope the body does not have.',
    'A VIOLATION (unfaithful): the description CONTRADICTS the body — it says or implies the tool does something the body shows it does not do, or works opposite to how the body says — OR it MISSTATES the scope, claiming the tool covers more, less, or different ground than it actually does. A reader would reach for it in the wrong situation, or miss it in the right one.',
    '',
    'Do NOT flag a description merely for being less sharp than it could be. An accurate-but-generic summary that omits some distinctive nuance is FAITHFUL, not a violation — under-foregrounding the distinctive core is a writing-quality preference, not a faithfulness problem. Flag ONLY a genuine contradiction or scope misstatement. This is NOT a writing-quality judgment: do not reward eloquence or penalize terseness.',
    '',
    'Example of a VIOLATION: a tool whose body "renames the current git branch in place" described as "delete the current git branch" — the described action contradicts the body. Flag it.',
    'Example of FAITHFUL: a tool whose body formats files with a specific formatter and sorts imports, described as "format your code" — generic and less sharp than it could be, but not misleading and not contradicted. Pass it.',
    '',
    'DESCRIPTION:',
    description,
    '',
    'FULL INSTRUCTIONS (BODY):',
    body,
    '',
    'Decide whether the description contradicts the body or misstates its scope. Respond with ONLY a JSON object: {"faithful": true|false, "reason": "<the contradiction or scope misstatement if any, else why the description is consistent with the body>"}.',
  ].join('\n');
}

/** The {faithful, reason} verdict from a judge response, tolerant of prose/fences
 * (`eval-harness` extractJsonObject, #867). Undecided (faithful=null) when no JSON
 * parses or `faithful` is absent or non-boolean. */
const parseJudge = (text) => readJudgeVerdict(text, 'faithful', null);

/**
 * Aggregate N per-run verdicts into one gate result. A run with a null verdict
 * (parse failure / timeout) is conservatively counted as NOT faithful so a
 * broken judge call cannot silently pass a skill. The skill passes when the
 * faithful-rate is at or above the threshold.
 */
function aggregate(verdicts, threshold) {
  const runs = verdicts.length;
  const faithfulCount = verdicts.filter((v) => v && v.faithful === true).length;
  const errored = verdicts.filter((v) => !v || v.faithful === null).length;
  const valid = runs - errored;
  const rate = runs === 0 ? 0 : faithfulCount / runs;
  // A run that produced ZERO usable verdicts (e.g. Ollama down or every call timed
  // out, all null) never passes, regardless of threshold — a gate must not green-
  // light a skill on a judge that could not run. Errored runs still count against
  // the rate (conservative); they are reported separately so a timeout-driven FAIL
  // is not mistaken for a real "unfaithful" verdict.
  const pass = valid > 0 && rate >= threshold;
  const reasons = verdicts.map((v) => (v ? v.reason : 'no verdict'));
  return { runs, faithfulCount, errored, valid, rate, pass, reasons };
}

/**
 * Parse a calibration corpus. `## Drift` bullets expect faithful=false, `##
 * Clean` bullets expect faithful=true. A bullet is `- <name>` (read both
 * description and body from disk) or `- <name> | <description override>` (use
 * the override as the description, read the body from disk — the form a known
 * drift case needs, since its drifted description was fixed and now lives only
 * in git history). The `|` delimiter is quote-safe: a real description carries
 * embedded double-quotes (its trigger phrases), so an inline `"..."` override
 * would truncate at the first one. Any other section is ignored.
 */
function parseCorpus(text) {
  const cases = [];
  let expect = null; // false (drift) | true (clean) | null (ignore)
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    const heading = line.match(/^##\s+(.*)/);
    if (heading) {
      const title = heading[1].toLowerCase();
      if (/violation|drift/.test(title)) expect = false;
      else if (/faithful|clean/.test(title)) expect = true;
      else expect = null;
      continue;
    }
    if (expect === null || !line.startsWith('-')) continue;
    const m = line.match(/^-\s*([A-Za-z0-9_-]+)\s*(?:\|\s*(.*\S))?\s*$/);
    if (!m) continue;
    cases.push({ name: m[1], descriptionOverride: m[2] != null ? m[2] : null, expectFaithful: expect });
  }
  return cases;
}

/** Resolve a skill or command name to its source .md path, skills first. */
function resolveSkillPath(name, cwd) {
  const skill = path.join(cwd, '.claude', 'skills', name, 'SKILL.md');
  if (fs.existsSync(skill)) return skill;
  const cmds = path.join(cwd, '.claude', 'commands');
  const found = findCommand(cmds, `${name}.md`);
  return found || null;
}

function findCommand(dir, basename) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return null; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const hit = findCommand(p, basename); if (hit) return hit; }
    else if (e.name === basename) return p;
  }
  return null;
}

// ---- edge (IO, subprocess, nondeterminism) ----

/** The verdict the judge returns, as a JSON schema for Ollama structured output. */
const FAITHFUL_SCHEMA = {
  type: 'object',
  properties: { faithful: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['faithful', 'reason'],
};

/**
 * Judge one description+body N× and aggregate. Two backends:
 *  - Claude (default): `claude -p --safe-mode` in an empty cwd, hermetic, so the
 *    judge grades only the injected text, never the live skill on disk (which
 *    matters for calibration overrides that differ from disk).
 *  - Local (--local <model>): Ollama with FAITHFUL_SCHEMA via structured output.
 *    A failed call (Ollama down, model missing, timeout) becomes a null verdict
 *    carrying the error; aggregate counts null as not-faithful, so a broken local
 *    judge fails CLOSED (does not pass the skill) and the error shows in reasons.
 */
async function judge(description, body, opts) {
  const { runs, threshold, model, local, host, timeoutMs } = opts;
  const prompt = buildJudgePrompt(description, body);
  const verdicts = [];
  if (local) {
    for (let i = 0; i < runs; i++) {
      const r = await localJson({ prompt, schema: FAITHFUL_SCHEMA, model: local, host, timeoutMs, options: { temperature: 0 } });
      verdicts.push(mapLocal(r, 'faithful', null));
    }
  } else {
    const runCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sfw-'));
    try {
      for (let i = 0; i < runs; i++) {
        const text = await claudeRun(prompt, null, { model, timeoutMs, cwd: runCwd });
        verdicts.push(parseJudge(text));
      }
    } finally {
      try { fs.rmSync(runCwd, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    }
  }
  return aggregate(verdicts, threshold);
}

// ---- CLI ----

function parseArgs(argv) {
  const out = { skill: null, runs: 3, threshold: 0.5, model: null, json: false, calibrate: false, corpus: null, local: null, host: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') { const n = parseInt(argv[++i], 10); out.runs = Number.isInteger(n) && n > 0 ? n : 3; }
    else if (a === '--threshold') { const r = parseFloat(argv[++i]); out.threshold = Number.isFinite(r) && r >= 0 && r <= 1 ? r : 0.5; }
    else if (a === '--model') out.model = argv[++i];
    else if (a === '--local') out.local = argv[++i];
    else if (a === '--host') out.host = argv[++i];
    else if (a === '--calibrate') out.calibrate = true;
    else if (a === '--corpus') out.corpus = argv[++i];
    else if (a === '--json') out.json = true;
    else if (!out.skill) out.skill = a;
  }
  return out;
}

async function runGate(opts, cwd) {
  const srcPath = resolveSkillPath(opts.skill, cwd);
  if (!srcPath) { console.error(`no skill or command named "${opts.skill}" under .claude/skills or .claude/commands`); process.exit(2); }
  const { description, body } = parseSkillDoc(fs.readFileSync(srcPath, 'utf8'));
  if (!description) { console.error(`no description: field in ${srcPath}`); process.exit(2); }
  if (opts.local) { const a = await checkAvailable({ model: opts.local, host: opts.host }); if (!a.ok) { console.error(`[local] ${a.error}`); process.exit(2); } }
  const res = await judge(description, body, { runs: opts.runs, threshold: opts.threshold, model: opts.model, local: opts.local, host: opts.host, timeoutMs: 120000 });
  const model = opts.local ? `local:${opts.local}` : (opts.model || '(configured default)');
  const status = res.pass ? 'PASS' : 'FAIL';
  const errNote = res.errored ? ` (${res.errored} errored — judge could not run)` : '';
  console.error(`[${status}] faithful ${res.faithfulCount}/${res.runs}${errNote} (threshold ${opts.threshold}) — ${opts.skill}`);
  if (!res.pass) for (const r of res.reasons) console.error(`    · ${r}`);
  console.error(`\nfaithfulness: ${status} — model: ${model}, ${res.runs} runs/judge`);
  if (opts.json) console.log(JSON.stringify({ skill: opts.skill, model, threshold: opts.threshold, ...res }, null, 2));
  process.exit(res.pass ? 0 : 1);
}

async function runCalibrate(opts, cwd) {
  const corpusPath = opts.corpus || path.join(cwd, '.claude', 'research', 'skill-faithfulness-evals', 'calibration.md');
  if (!fs.existsSync(corpusPath)) { console.error(`no calibration corpus at ${corpusPath}`); process.exit(2); }
  const cases = parseCorpus(fs.readFileSync(corpusPath, 'utf8'));
  if (cases.length === 0) { console.error(`no cases parsed from ${corpusPath} — expected "## Drift" / "## Clean" bullets`); process.exit(2); }
  if (opts.local) { const a = await checkAvailable({ model: opts.local, host: opts.host }); if (!a.ok) { console.error(`[local] ${a.error}`); process.exit(2); } }
  const rows = [];
  for (const c of cases) {
    const srcPath = resolveSkillPath(c.name, cwd);
    if (!srcPath) { console.error(`  skip ${c.name}: no source file`); continue; }
    const doc = parseSkillDoc(fs.readFileSync(srcPath, 'utf8'));
    const description = c.descriptionOverride != null ? c.descriptionOverride : doc.description;
    const res = await judge(description, doc.body, { runs: opts.runs, threshold: opts.threshold, model: opts.model, local: opts.local, host: opts.host, timeoutMs: 120000 });
    // A drift case (expectFaithful=false) is "correct" when the gate flags it (res.pass=false).
    const correct = res.pass === c.expectFaithful;
    rows.push({ name: c.name, expectFaithful: c.expectFaithful, gatePass: res.pass, rate: res.rate, correct, reasons: res.reasons });
    const eNote = res.errored ? ` [${res.errored} errored]` : '';
    console.error(`[${correct ? 'OK ' : 'XX '}] ${c.expectFaithful ? 'clean' : 'drift'} ${c.name}: faithful-rate ${res.rate.toFixed(2)}${eNote} → gate ${res.pass ? 'PASS' : 'FLAG'}`);
    if (!correct) for (const r of res.reasons) console.error(`      · ${r}`);
  }
  const drift = rows.filter((r) => !r.expectFaithful);
  const clean = rows.filter((r) => r.expectFaithful);
  const sensitivity = drift.length ? drift.filter((r) => r.correct).length / drift.length : 1; // drift caught
  const specificity = clean.length ? clean.filter((r) => r.correct).length / clean.length : 1; // clean passed
  const model = opts.local ? `local:${opts.local}` : (opts.model || '(configured default)');
  console.error(`\ncalibration — model: ${model}, ${opts.runs} runs/judge, threshold ${opts.threshold}`);
  console.error(`  sensitivity (drift caught): ${(sensitivity * 100).toFixed(0)}% (${drift.filter((r) => r.correct).length}/${drift.length})`);
  console.error(`  specificity (clean passed): ${(specificity * 100).toFixed(0)}% (${clean.filter((r) => r.correct).length}/${clean.length})`);
  if (opts.json) console.log(JSON.stringify({ model, threshold: opts.threshold, runs: opts.runs, sensitivity, specificity, rows }, null, 2));
  // Calibration succeeds only on a perfect split: every drift flagged, every clean passed.
  process.exit(sensitivity === 1 && specificity === 1 ? 0 : 1);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  if (opts.calibrate) return runCalibrate(opts, cwd);
  if (!opts.skill) {
    console.error('usage: skill-faithfulness-walk.cjs <skill> [--runs N] [--threshold R] [--model M] [--local <ollama-model>] [--host URL] [--json]');
    console.error('       skill-faithfulness-walk.cjs --calibrate [--corpus <path>] [--runs N] [--threshold R] [--local <ollama-model>]');
    process.exit(2);
  }
  return runGate(opts, cwd);
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(2); });
}

module.exports = { parseSkillDoc, buildJudgePrompt, parseJudge, aggregate, parseCorpus, resolveSkillPath, parseArgs };
