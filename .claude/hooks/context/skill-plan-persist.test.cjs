#!/usr/bin/env node

/**
 * skill-plan-persist hook tests.
 *
 * The PostToolUse(TodoWrite) hook appends the current todo list to plan.jsonl
 * for every active extended skill declaring planning.enabled and
 * planning.persist != false. Driven via subprocess: handleHook reads tracking
 * state to resolve active skills and exits, so the contract lives at the
 * stdin/filesystem boundary. "Active" is seeded with a Skill tool tracking
 * event before each spawn.
 *
 * Run: node .claude/hooks/context/skill-plan-persist.test.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const runtime = require('../lib/skill-runtime.cjs');
const su = require('../lib/session-utils.cjs');

const HOOK = path.resolve(__dirname, 'skill-plan-persist.cjs');
const SID = 'skill-plan-persist-test-session';

let pass = 0, fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else    { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

const tmpRoots = [];
function tmpProj(skillName, frontmatter, { active = true } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'skill-plan-')));
  tmpRoots.push(dir);
  const sk = path.join(dir, '.claude', 'skills', skillName);
  fs.mkdirSync(sk, { recursive: true });
  fs.writeFileSync(path.join(sk, 'SKILL.md'), frontmatter);
  if (active) su.appendTrackingEvent(SID, { type: 'tool', tool: 'Skill', skill: skillName }, dir);
  return dir;
}
process.on('exit', () => {
  for (const d of tmpRoots) {
    try { fs.rmSync(su.getProjectDir(d), { recursive: true, force: true }); } catch {}
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

function runHook(payload, cwd) {
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', cwd });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const PLANNING = `---
name: planner
description: a planning skill
planning:
  enabled: true
  resume_on_activation: true
---
body`;

// ── appends todos for an active planning skill ──────────────────────────────
{
  const proj = tmpProj('planner', PLANNING);
  const todos = [{ content: 'first', status: 'pending' }, { content: 'second', status: 'in_progress' }];
  const r = runHook({ tool_name: 'TodoWrite', tool_input: { todos }, cwd: proj, session_id: SID }, proj);
  report('exit 0', r.status === 0);
  const latest = runtime.readLatestPlan(proj, 'session', SID, 'planner');
  report('appends the todo snapshot to plan.jsonl',
    latest && Array.isArray(latest.todos) && latest.todos.length === 2 && latest.todos[0].content === 'first',
    `latest=${JSON.stringify(latest)}`);
}

// ── successive TodoWrites are append-only; readLatestPlan returns the newest ─
{
  const proj = tmpProj('planner', PLANNING);
  runHook({ tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'v1', status: 'pending' }] }, cwd: proj, session_id: SID }, proj);
  runHook({ tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'v2', status: 'completed' }] }, cwd: proj, session_id: SID }, proj);
  const file = path.join(runtime.skillBase(proj, 'session', SID, 'planner'), 'plans', 'plan.jsonl');
  const entries = fs.readFileSync(file, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
  report('plan.jsonl is append-only (two entries)', entries.length === 2);
  const latest = runtime.readLatestPlan(proj, 'session', SID, 'planner');
  report('readLatestPlan resumes the newest snapshot', latest.todos[0].content === 'v2');
}

// ── non-TodoWrite tool is a no-op ───────────────────────────────────────────
{
  const proj = tmpProj('planner', PLANNING);
  runHook({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: proj, session_id: SID }, proj);
  report('non-TodoWrite writes no plan', runtime.readLatestPlan(proj, 'session', SID, 'planner') === null);
}

// ── persist:false opts out of snapshotting ──────────────────────────────────
{
  const proj = tmpProj('noplan', `---
name: noplan
description: planning with persistence off
planning:
  enabled: true
  persist: false
---
body`);
  runHook({ tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'x', status: 'pending' }] }, cwd: proj, session_id: SID }, proj);
  report('planning.persist=false writes no plan', runtime.readLatestPlan(proj, 'session', SID, 'noplan') === null);
}

// ── an inactive skill is not snapshotted ────────────────────────────────────
{
  const proj = tmpProj('planner', PLANNING, { active: false });
  runHook({ tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'x', status: 'pending' }] }, cwd: proj, session_id: SID }, proj);
  report('inactive skill writes no plan', runtime.readLatestPlan(proj, 'session', SID, 'planner') === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
