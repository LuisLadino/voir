#!/usr/bin/env node

/**
 * Instruction-wording walk. Measure how reliably an instruction produces a
 * compliant response, and compare wording variants of that instruction head to
 * head — the kit-side answer to the Anthropic memory-prompt "0/2 -> 3/3 via
 * wording" A/B pattern (see .claude/research/claude-code-leak, issue #413).
 *
 * The instruction under test is injected via `--append-system-prompt` and the
 * run is isolated with `--safe-mode`, so the kit's own hooks, CLAUDE.md, and
 * skills do NOT fire. That isolation is load-bearing: without it the kit's
 * ambient copy of an instruction (e.g. the response-format reminder hook) lands
 * on top of every variant and the comparison measures nothing. `--safe-mode`
 * keeps Auth, model selection, built-in tools, and permissions working, so the
 * walk runs on the project's normal OAuth without an API key.
 *
 * Compliance is a structural check on the final response text (a regex from the
 * eval file), not an LLM judge — Scope A is deliberately deterministic and
 * zero-cost-per-grade. Scope B (skill output quality) is where judging lives.
 *
 * Usage:
 *   node instruction-wording-walk.cjs <eval-name> [--eval <path>] [--runs N]
 *                                     [--model M] [--json]
 *
 * Default eval path: .claude/research/instruction-wording-evals/<name>.md
 * Default model: the project's configured model (no --model flag). Routing and
 * compliance are model-specific, so the report always names the model used.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// ---- pure core (deterministic, unit-tested) ----

/**
 * Parse an instruction-wording eval markdown file.
 *   `## Compliance check`  -> the first backtick-quoted token (else first
 *                             non-empty line) is a JS regex source.
 *   `## Variant: <label>`  -> everything until the next `##` is the instruction
 *                             text injected via --append-system-prompt.
 *   `## Tasks`             -> the first quoted phrase on each bullet is a task
 *                             prompt the variant should make compliant.
 * Any other `##` section is prose and ignored.
 */
function parseWordingEval(text) {
  const lines = String(text).split('\n');
  let section = null; // 'check' | 'variant' | 'tasks' | null
  let check = null;
  const variants = [];
  const tasks = [];
  let cur = null; // accumulating variant { label, lines: [] }

  const flush = () => {
    if (cur) {
      variants.push({ label: cur.label, instruction: cur.lines.join('\n').trim() });
      cur = null;
    }
  };

  for (const raw of lines) {
    const heading = raw.match(/^##\s+(.*)/);
    if (heading) {
      flush();
      const title = heading[1].trim();
      const low = title.toLowerCase();
      if (/^compliance check/.test(low)) section = 'check';
      else if (/^variant\s*:/.test(low)) {
        section = 'variant';
        cur = { label: title.replace(/^variant\s*:\s*/i, '').trim(), lines: [] };
      } else if (/^tasks?\b/.test(low)) section = 'tasks';
      else section = null;
      continue;
    }
    if (section === 'check') {
      if (check) continue;
      const tick = raw.match(/`([^`]+)`/);
      if (tick) check = tick[1];
      else if (raw.trim()) check = raw.trim();
    } else if (section === 'variant' && cur) {
      cur.lines.push(raw);
    } else if (section === 'tasks') {
      const line = raw.trim();
      if (!line.startsWith('-')) continue;
      const q = line.match(/"([^"]+)"/);
      if (q) tasks.push(q[1]);
    }
  }
  flush();
  return { check, variants, tasks };
}

/** A response complies when the check regex matches its text. */
function compliant(responseText, checkSource) {
  let re;
  try { re = new RegExp(checkSource); } catch (_) { return false; }
  return re.test(String(responseText || ''));
}

/**
 * Fold per-run booleans into a per-variant summary. `runs` is the flat list of
 * { variant, task, complied } records; returns one row per variant with the
 * compliance fraction over all (task x repeat) trials, plus per-task detail.
 */
function summarize(records, variants, tasks) {
  return variants.map((v) => {
    const mine = records.filter((r) => r.variant === v.label);
    const passed = mine.filter((r) => r.complied).length;
    const byTask = tasks.map((t) => {
      const tr = mine.filter((r) => r.task === t);
      return { task: t, passed: tr.filter((r) => r.complied).length, trials: tr.length };
    });
    return { variant: v.label, passed, trials: mine.length, rate: mine.length ? passed / mine.length : 0, byTask };
  });
}

// ---- edge (IO, subprocess, nondeterminism) ----

function runOnce(task, instruction, opts) {
  const { model, timeoutMs, cwd } = opts;
  return new Promise((resolve) => {
    const args = ['-p', task, '--safe-mode', '--append-system-prompt', instruction, '--output-format', 'json'];
    if (model) args.push('--model', model);
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const child = spawn('claude', args, { cwd, env });
    let out = '';
    let settled = false;
    const finish = (text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch (_) { /* already gone */ }
      resolve(text);
    };
    const timer = setTimeout(() => finish(''), timeoutMs);
    child.stdout.on('data', (c) => { out += c; });
    child.on('error', (err) => { console.error(`claude spawn failed: ${err.message}`); finish(''); });
    child.on('close', () => {
      let text = '';
      try { text = JSON.parse(out).result || ''; } catch (_) { text = ''; }
      finish(text);
    });
  });
}

async function walk(variants, tasks, check, opts) {
  const { runs, onResult } = opts;
  const records = [];
  for (const v of variants) {
    for (const task of tasks) {
      for (let i = 0; i < runs; i++) {
        const text = await runOnce(task, v.instruction, opts);
        const complied = compliant(text, check);
        const rec = { variant: v.label, task, complied };
        records.push(rec);
        if (onResult) onResult(rec);
      }
    }
  }
  return records;
}

// ---- CLI ----

function parseArgs(argv) {
  const out = { runs: 3, model: null, evalPath: null, json: false, name: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') { const n = parseInt(argv[++i], 10); out.runs = Number.isInteger(n) && n > 0 ? n : 3; }
    else if (a === '--model') out.model = argv[++i];
    else if (a === '--eval') out.evalPath = argv[++i];
    else if (a === '--json') out.json = true;
    else if (!out.name) out.name = a;
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.name) {
    console.error('usage: instruction-wording-walk.cjs <eval-name> [--eval <path>] [--runs N] [--model M] [--json]');
    process.exit(2);
  }
  const cwd = process.cwd();
  const evalPath = opts.evalPath ||
    path.join(cwd, '.claude', 'research', 'instruction-wording-evals', `${opts.name}.md`);
  if (!fs.existsSync(evalPath)) {
    console.error(`no wording eval at ${evalPath}`);
    process.exit(2);
  }
  const { check, variants, tasks } = parseWordingEval(fs.readFileSync(evalPath, 'utf8'));
  if (!check) { console.error(`no "## Compliance check" regex in ${evalPath}`); process.exit(2); }
  if (variants.length < 2) { console.error(`need >=2 "## Variant: <label>" sections in ${evalPath}`); process.exit(2); }
  if (tasks.length === 0) { console.error(`no "## Tasks" bullets in ${evalPath}`); process.exit(2); }

  // Spawn the runs in a neutral, empty cwd so the model cannot read this repo's
  // files to recover an instruction the injected prompt left out — the eval must
  // measure the wording alone, not the model's ability to go find the real rule.
  const runCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'iww-'));
  let records;
  try {
    records = await walk(variants, tasks, check, {
      runs: opts.runs,
      model: opts.model,
      timeoutMs: 120000,
      cwd: runCwd,
      onResult: (r) => console.error(`  [${r.complied ? 'OK ' : 'no '}] ${r.variant} :: ${r.task.slice(0, 56)}`),
    });
  } finally {
    try { fs.rmSync(runCwd, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }

  const rows = summarize(records, variants, tasks);
  const model = opts.model || '(configured default)';
  console.error(`\nInstruction: ${opts.name}  (check: /${check}/)  model: ${model}, ${opts.runs} runs/task`);
  for (const r of rows) {
    console.error(`  ${r.passed}/${r.trials}  ${r.variant}`);
  }
  const best = rows.slice().sort((a, b) => b.rate - a.rate)[0];
  console.error(`\nMost compliant wording: "${best.variant}" (${best.passed}/${best.trials}).`);
  if (opts.json) console.log(JSON.stringify({ name: opts.name, check, model, runs: opts.runs, rows }, null, 2));
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(2); });
}

module.exports = { parseWordingEval, compliant, summarize, parseArgs };
