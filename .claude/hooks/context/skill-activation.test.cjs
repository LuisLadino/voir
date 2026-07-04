#!/usr/bin/env node

/**
 * skill-activation hook tests.
 *
 * Unit: buildBlock() runtime-block assembly across the four extension fields
 * (planning + resume, filesystem, subagents per isolation, auto_summarize).
 * Integration: the full PreToolUse(Skill) hook via subprocess — provisions the
 * working-memory tree and emits the additionalContext block; no-ops on a
 * non-Skill tool and an unknown skill.
 *
 * Run: node .claude/hooks/context/skill-activation.test.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { buildBlock } = require('./skill-activation.cjs');
const runtime = require('../lib/skill-runtime.cjs');
const su = require('../lib/session-utils.cjs');

const HOOK = path.resolve(__dirname, 'skill-activation.cjs');
const SID = 'skill-activation-test-session';

let pass = 0, fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else    { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

const tmpRoots = [];
function tmpProj(skillName, frontmatter) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'skill-act-')));
  tmpRoots.push(dir);
  if (skillName) {
    const sk = path.join(dir, '.claude', 'skills', skillName);
    fs.mkdirSync(sk, { recursive: true });
    fs.writeFileSync(path.join(sk, 'SKILL.md'), frontmatter);
  }
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
  let json = null;
  try { json = JSON.parse(r.stdout); } catch {}
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

// ── buildBlock: header + planning (no prior plan) ───────────────────────────
{
  const proj = tmpProj();
  const skill = { skillName: 'research', extensions: { planning: { enabled: true, resume_on_activation: false } } };
  const block = buildBlock(skill, 'session', proj, SID);
  report('buildBlock: header names the skill', block.startsWith('[SKILL RUNTIME — /research]'));
  report('buildBlock: planning without prior plan prompts TodoWrite',
    block.includes('Planning: use TodoWrite'));
}

// ── buildBlock: planning resume reads the latest persisted plan ─────────────
{
  const proj = tmpProj();
  runtime.appendPlanEntry(proj, 'session', SID, 'research',
    { todos: [{ content: 'first task', status: 'in_progress' }] });
  const skill = { skillName: 'research', extensions: { planning: { enabled: true, resume_on_activation: true } } };
  const block = buildBlock(skill, 'session', proj, SID);
  report('buildBlock: resume emits the resume header', block.includes('Resuming prior plan'));
  report('buildBlock: resume lists the persisted todo', block.includes('[in_progress] first task'));
}

// ── buildBlock: resume_on_activation but no prior plan falls back ────────────
{
  const proj = tmpProj();
  const skill = { skillName: 'research', extensions: { planning: { enabled: true, resume_on_activation: true } } };
  const block = buildBlock(skill, 'session', proj, SID);
  report('buildBlock: resume with no prior plan falls back to TodoWrite prompt',
    block.includes('Planning: use TodoWrite') && !block.includes('Resuming prior plan'));
}

// ── buildBlock: filesystem note carries scope + relative root ───────────────
{
  const proj = tmpProj();
  const skill = { skillName: 'research', extensions: { filesystem: { enabled: true, root_hint: 'work' } } };
  const block = buildBlock(skill, 'session', proj, SID);
  report('buildBlock: filesystem note names the relative working-memory root',
    block.includes(path.join('.claude', 'skill-runtime', 'session', SID, 'research', 'fs', 'work')));
  report('buildBlock: filesystem note carries scope', block.includes('(scope=session)'));
}

// ── buildBlock: subagents render per isolation mode ─────────────────────────
{
  const proj = tmpProj();
  const skill = { skillName: 'research', extensions: { subagents: [
    { role: 'worker', isolation: 'process', agent: 'general-purpose' },
    { role: 'inline', isolation: 'none', agent: 'general-purpose' },
    { role: 'helper', isolation: 'forked', agent: 'Explore' }
  ] } };
  const block = buildBlock(skill, 'session', proj, SID);
  report('buildBlock: process isolation renders as a dispatch worker',
    block.includes('worker: dispatch worker (separate process + worktree)'));
  report('buildBlock: none isolation renders as an inline phase',
    block.includes('inline: inline phase (no spawn)'));
  report('buildBlock: forked isolation renders as an Agent spawn',
    block.includes('helper: Agent(subagent_type: Explore)'));
}

// ── buildBlock: auto_summarize note carries the threshold ───────────────────
{
  const proj = tmpProj();
  const skill = { skillName: 'research', extensions: { auto_summarize: { enabled: true, threshold_tokens: 8000, preserve: [] } } };
  const block = buildBlock(skill, 'session', proj, SID);
  report('buildBlock: auto_summarize note names the threshold', block.includes('~8000 tokens'));
}

// ── integration: full hook provisions dirs + emits PreToolUse block ─────────
{
  const proj = tmpProj('delta', `---
name: delta
description: a test skill
filesystem:
  enabled: true
  root_hint: work
planning:
  enabled: true
---
body`);
  const r = runHook({ tool_name: 'Skill', tool_input: { skill: 'delta' }, cwd: proj, session_id: SID }, proj);
  report('integration: exit 0', r.status === 0);
  report('integration: emits a PreToolUse additionalContext block',
    r.json && r.json.hookSpecificOutput && r.json.hookSpecificOutput.hookEventName === 'PreToolUse'
      && /\[SKILL RUNTIME — \/delta\]/.test(r.json.hookSpecificOutput.additionalContext),
    `stdout=${r.stdout}`);
  const baseDir = runtime.skillBase(proj, 'session', SID, 'delta');
  report('integration: provisions plans/ summaries/ fs/<hint>/',
    fs.existsSync(path.join(baseDir, 'plans')) &&
    fs.existsSync(path.join(baseDir, 'summaries')) &&
    fs.existsSync(path.join(baseDir, 'fs', 'work')));
}

// ── integration: no-op on non-Skill tool and unknown skill ──────────────────
{
  const proj = tmpProj('delta', `---
name: delta
description: a test skill
planning:
  enabled: true
---
body`);
  const r1 = runHook({ tool_name: 'Bash', tool_input: {}, cwd: proj, session_id: SID }, proj);
  report('integration: non-Skill tool is a silent no-op', r1.status === 0 && r1.stdout.trim() === '');
  const r2 = runHook({ tool_name: 'Skill', tool_input: { skill: 'no-such-skill' }, cwd: proj, session_id: SID }, proj);
  report('integration: unknown skill is a silent no-op', r2.status === 0 && r2.stdout.trim() === '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
