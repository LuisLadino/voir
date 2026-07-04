#!/usr/bin/env node

/**
 * Skill trigger walk. Walk a skill's golden eval set against the installed kit
 * and report whether the skill fires on every should-fire phrase and stays
 * silent on every should-not-fire phrase.
 *
 * This exists because skill-creator's run_eval.py gives false negatives for any
 * skill already installed in a hook-heavy project. Two confounds, both fixed here:
 *   1. run_eval keys detection on a fabricated temp command name
 *      (`<skill>-skill-<uuid>`); the real installed skill fires as `<skill>`, so
 *      the match never lands. Here detection keys on the REAL skill name.
 *   2. run_eval returns not-fired on the first tool that is not Skill/Read; the
 *      kit's SessionStart hook makes the model spawn context-agent (Agent tool)
 *      first, so it bails before the skill can fire. Here a non-Skill tool before
 *      the Skill call is allowed — only a competing Skill or end-of-turn decides
 *      not-fired.
 *
 * Fired      = the model invokes Skill(<name>) before any other Skill.
 * Not-fired  = it finishes the turn, or picks a different Skill first.
 *
 * Usage:
 *   node skill-trigger-walk.cjs <skill-name> [--eval <path>] [--runs N]
 *                               [--model M] [--timeout MS] [--max-sessions N]
 *                               [--json]
 *
 * Cost: each phrase fires a fresh `claude -p`, runs times, so one walk is
 * phrases x runs cold sessions; the count is printed before spawning. On Max
 * those draw from the 5-hour quota window — a full-suite walk over every skill
 * is hundreds of sessions and can lock out interactive work (#852). Pass
 * --max-sessions N to abort an over-budget run; --model haiku for a cheap
 * pre-screen.
 *
 * Default eval path: .claude/research/skill-trigger-evals/<name>.md
 * Default model: the user's configured model (no --model flag), so the walk
 * tests the routing the project actually runs. Pass --model to pin one.
 * Default per-run timeout: 120000ms. A run that has not fired the skill by the
 * timeout is scored not-fired — correct for a should-not-fire phrase that makes
 * the model work instead of routing, and the reason a lower --timeout speeds the
 * walk without changing verdicts, since routing decisions land in the first
 * seconds while extended work is a not-fired either way.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

// ---- pure core (deterministic, unit-tested) ----

/**
 * Parse a golden eval markdown file into trigger test cases.
 * `## Should fire` bullets become shouldTrigger:true, `## Should not fire`
 * bullets become shouldTrigger:false. Any other section (e.g. `## Owns
 * triggers`) is documentation, not a test case, and is skipped. The query is
 * the first quoted phrase on the bullet; a trailing parenthetical is a note.
 */
function parseEvalMarkdown(text) {
  const cases = [];
  let section = null; // true | false | null(non-test section)
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    const heading = line.match(/^##\s+(.*)/);
    if (heading) {
      const title = heading[1].toLowerCase();
      if (/should\s+not\s+fire/.test(title)) section = false;
      else if (/should\s+fire/.test(title)) section = true;
      else section = null;
      continue;
    }
    if (section === null) continue;
    if (!line.startsWith('-')) continue;
    const phrase = line.match(/"([^"]+)"/);
    if (!phrase) continue;
    cases.push({ query: phrase[1], shouldTrigger: section });
  }
  return cases;
}

/**
 * Decide, from the stream-json events seen so far, whether the skill fired.
 * Returns a tri-state so a streaming caller can stop as soon as the verdict is
 * in: `{ decided:false }` means keep reading.
 *   - first Skill tool_use whose skill name contains `skillName` -> fired
 *   - first Skill tool_use for a different skill -> not fired (that skill owns
 *     the phrase)
 *   - a `result` event with no prior Skill -> not fired (turn ended)
 * Non-Skill tool calls (Agent, Bash, Read, ...) before the Skill call are
 * deliberately ignored, so the SessionStart context-agent spawn does not
 * pre-empt the decision.
 */
function decideFromEvents(events, skillName) {
  for (const e of events) {
    if (e && e.type === 'assistant') {
      const content = (e.message && e.message.content) || [];
      for (const c of content) {
        if (!c || c.type !== 'tool_use' || c.name !== 'Skill') continue;
        const sk = (c.input && c.input.skill) || '';
        return sk.includes(skillName)
          ? { decided: true, fired: true, otherSkill: null }
          : { decided: true, fired: false, otherSkill: sk };
      }
    } else if (e && e.type === 'result') {
      return { decided: true, fired: false, otherSkill: null };
    }
  }
  return { decided: false, fired: false, otherSkill: null };
}

// ---- edge (IO, subprocess, nondeterminism) ----

function runOnce(query, skillName, opts) {
  const { model, timeoutMs, cwd } = opts;
  return new Promise((resolve) => {
    const args = ['-p', query, '--output-format', 'stream-json', '--verbose'];
    if (model) args.push('--model', model);
    // CLAUDECODE guards against nesting an interactive session; a programmatic
    // `claude -p` subprocess is safe and must clear it to run.
    const env = { ...process.env };
    delete env.CLAUDECODE;
    // Suppress the SessionStart context-agent spawn for this run. Its dominant
    // "you MUST spawn the agent" instruction otherwise hijacks the one-shot turn
    // into a context-evaluation and the phrase never routes — a false not-fired.
    // The skill is still installed and discoverable; only the side-effect is off.
    env.CLAUDE_SKILL_GATE_WALK = '1';

    const child = spawn('claude', args, { cwd, env });
    const events = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch (_) { /* already gone */ }
      resolve(decideFromEvents(events, skillName));
    };
    const timer = setTimeout(finish, timeoutMs);

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      line = line.trim();
      if (!line) return;
      let e;
      try { e = JSON.parse(line); } catch (_) { return; }
      events.push(e);
      if (decideFromEvents(events, skillName).decided) finish();
    });
    // A spawn failure (e.g. `claude` not on PATH) must be loud, not silently
    // scored as a not-fired phrase.
    child.on('error', (err) => { console.error(`claude spawn failed: ${err.message}`); finish(); });
    child.on('close', finish);
  });
}

async function walk(skillName, cases, opts) {
  const { runs, onResult } = opts;
  const results = [];
  for (const tc of cases) {
    let fires = 0;
    const others = [];
    for (let i = 0; i < runs; i++) {
      const { fired, otherSkill } = await runOnce(tc.query, skillName, opts);
      if (fired) fires++;
      else if (otherSkill) others.push(otherSkill);
    }
    const rate = fires / runs;
    const pass = tc.shouldTrigger ? rate >= 0.5 : rate < 0.5;
    const rec = { query: tc.query, shouldTrigger: tc.shouldTrigger, fires, runs, rate, pass, others };
    results.push(rec);
    if (onResult) onResult(rec);
  }
  return results;
}

// ---- CLI ----

function parseArgs(argv) {
  const out = { runs: 3, model: null, evalPath: null, json: false, skill: null, timeoutMs: 120000, maxSessions: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') { const n = parseInt(argv[++i], 10); out.runs = Number.isInteger(n) && n > 0 ? n : 3; }
    else if (a === '--model') out.model = argv[++i];
    else if (a === '--eval') out.evalPath = argv[++i];
    else if (a === '--timeout') { const n = parseInt(argv[++i], 10); out.timeoutMs = Number.isInteger(n) && n > 0 ? n : 120000; }
    else if (a === '--max-sessions') { const n = parseInt(argv[++i], 10); out.maxSessions = Number.isInteger(n) && n > 0 ? n : null; }
    else if (a === '--json') out.json = true;
    else if (!out.skill) out.skill = a;
  }
  return out;
}

// Estimate the cold `claude -p` sessions a walk will spawn — one per phrase per
// run — and decide whether it exceeds an opt-in cap. Pure so the guard is
// testable without spawning; the whole point is not to fire the walk to learn
// its cost (#852). A full-suite walk loops this over every skill, so the
// per-skill estimate printed at start is what a batch runner multiplies — on
// Max that sum draws from the same 5-hour window interactive work needs.
function planSessions(caseCount, runs, maxSessions) {
  const estimate = caseCount * runs;
  const exceeded = Number.isInteger(maxSessions) && maxSessions > 0 && estimate > maxSessions;
  return { estimate, exceeded };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.skill) {
    console.error('usage: skill-trigger-walk.cjs <skill-name> [--eval <path>] [--runs N] [--model M] [--timeout MS] [--max-sessions N] [--json]');
    process.exit(2);
  }
  const cwd = process.cwd();
  const evalPath = opts.evalPath ||
    path.join(cwd, '.claude', 'research', 'skill-trigger-evals', `${opts.skill}.md`);
  if (!fs.existsSync(evalPath)) {
    console.error(`no golden eval at ${evalPath} — every skill must ship one (skills.md gate item 2)`);
    process.exit(2);
  }
  const cases = parseEvalMarkdown(fs.readFileSync(evalPath, 'utf8'));
  if (cases.length === 0) {
    console.error(`no test cases parsed from ${evalPath} — expected "## Should fire" / "## Should not fire" bullets`);
    process.exit(2);
  }

  // Routing is model-specific, so a verdict is only interpretable with the model
  // attached. `(configured default)` means the CLI's model, which varies by setup.
  const model = opts.model || '(configured default)';
  // Make the cost visible before spawning: each phrase fires a cold `claude -p`,
  // runs times, and on Max those draw from the same 5-hour quota window
  // interactive work needs (#852). --max-sessions aborts an over-budget run.
  const plan = planSessions(cases.length, opts.runs, opts.maxSessions);
  console.error(`walk: ${opts.skill} — ${cases.length} phrases × ${opts.runs} runs = ~${plan.estimate} cold claude -p sessions on ${model}`);
  if (plan.exceeded) {
    console.error(`estimated ${plan.estimate} sessions exceeds --max-sessions ${opts.maxSessions}; raise it to proceed. A full-suite walk over every skill is hundreds of sessions and can exhaust the Max 5-hour window — run deliberately, at low concurrency, and consider --model haiku for a cheap pre-screen (skills.md).`);
    process.exit(2);
  }

  const results = await walk(opts.skill, cases, {
    runs: opts.runs,
    model: opts.model,
    timeoutMs: opts.timeoutMs,
    cwd,
    onResult: (r) => {
      const status = r.pass ? 'PASS' : 'FAIL';
      const oth = r.others.length ? ` picked=${[...new Set(r.others)].join(',')}` : '';
      console.error(`[${status}] ${r.fires}/${r.runs} expect=${r.shouldTrigger}: ${r.query.slice(0, 64)}${oth}`);
    },
  });

  const passed = results.filter((r) => r.pass).length;
  const summary = { total: results.length, passed, failed: results.length - passed };
  console.error(`\n${passed}/${results.length} phrases pass — model: ${model}, ${opts.runs} runs/phrase`);
  if (opts.json) console.log(JSON.stringify({ skill: opts.skill, model, runs: opts.runs, summary, results }, null, 2));
  process.exit(summary.failed === 0 ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(2); });
}

module.exports = { parseEvalMarkdown, decideFromEvents, parseArgs, planSessions };
