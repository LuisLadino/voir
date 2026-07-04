#!/usr/bin/env node

/**
 * Unit tests for skill-active (resolve which extended skills are active).
 * Run: node .claude/hooks/lib/skill-active.test.cjs
 *
 * resolveScope is pure. activeExtendedSkills is exercised end-to-end against real
 * tracking fixtures written via session-utils.appendTrackingEvent. HOME is
 * redirected to a temp dir BEFORE requiring session-utils so its module-level
 * PROJECTS_DIR resolves inside throwaway state and the real ~/.claude is never
 * touched. The test runner spawns each file in its own node process, so the HOME
 * mutation never leaks to sibling suites.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-active-home-'));
process.env.HOME = TMP_HOME;

const { activeExtendedSkills, resolveScope } = require('./skill-active.cjs');
const { appendTrackingEvent, _resetRecentStateCache } = require('./session-utils.cjs');

let pass = 0;
let fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else    { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

const tmpRoots = [TMP_HOME];
function makeProject(skills) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-active-proj-'));
  tmpRoots.push(proj);
  const skillsDir = path.join(proj, '.claude', 'skills');
  for (const [name, body] of Object.entries(skills)) {
    const dir = path.join(skillsDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), body);
  }
  fs.mkdirSync(skillsDir, { recursive: true });
  return proj;
}
function active(proj, sid) {
  _resetRecentStateCache();
  return activeExtendedSkills(proj, sid);
}
process.on('exit', () => {
  for (const d of tmpRoots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
});

const EXT_PLANNER = ['---', 'name: planner', 'description: a planning skill', 'planning:', '  enabled: true', '  scope: session', '---'].join('\n');
const PLAIN = ['---', 'name: plain', 'description: no extensions', '---'].join('\n');

// ── resolveScope (pure) ───────────────────────────────────────────
report('resolveScope: filesystem.scope thread', resolveScope({ filesystem: { scope: 'thread' } }) === 'thread');
report('resolveScope: planning.scope thread', resolveScope({ planning: { scope: 'thread' } }) === 'thread');
report('resolveScope: filesystem wins over planning',
  resolveScope({ filesystem: { scope: 'session' }, planning: { scope: 'thread' } }) === 'session');
report('resolveScope: empty defaults to session', resolveScope({}) === 'session');
report('resolveScope: planning without scope defaults to session', resolveScope({ planning: {} }) === 'session');

// ── activeExtendedSkills (integration via tracking fixtures) ──────
const proj = makeProject({ planner: EXT_PLANNER, plain: PLAIN });

let sid = 'sess-invoked';
appendTrackingEvent(sid, { type: 'tool', tool: 'Skill', skill: 'planner' }, proj);
let res = active(proj, sid);
report('activeExtendedSkills: invoked extended skill is active',
  res.length === 1 && res[0].skillName === 'planner', JSON.stringify(res.map(r => r.skillName)));

sid = 'sess-other';
appendTrackingEvent(sid, { type: 'tool', tool: 'Skill', skill: 'commit' }, proj);
res = active(proj, sid);
report('activeExtendedSkills: extended skill not invoked is not active',
  res.length === 0, JSON.stringify(res.map(r => r.skillName)));

sid = 'sess-namespaced';
appendTrackingEvent(sid, { type: 'tool', tool: 'Skill', skill: '/project-management:planner' }, proj);
res = active(proj, sid);
report('activeExtendedSkills: namespaced invocation normalizes and matches',
  res.length === 1 && res[0].skillName === 'planner', JSON.stringify(res.map(r => r.skillName)));

sid = 'sess-noise';
appendTrackingEvent(sid, { type: 'tool', tool: 'Edit', file: 'x' }, proj);
appendTrackingEvent(sid, { type: 'tool', tool: 'Skill', skill: 'planner' }, proj);
appendTrackingEvent(sid, { type: 'tool', tool: 'Bash', command: 'ls' }, proj);
res = active(proj, sid);
report('activeExtendedSkills: Skill events are picked out from non-Skill tool noise',
  res.length === 1 && res[0].skillName === 'planner', JSON.stringify(res.map(r => r.skillName)));

res = active(proj, 'sess-no-tracking-file');
report('activeExtendedSkills: no tracking file yields empty', res.length === 0, JSON.stringify(res));

const projNoExt = makeProject({ plain: PLAIN });
sid = 'sess-noext';
appendTrackingEvent(sid, { type: 'tool', tool: 'Skill', skill: 'plain' }, projNoExt);
res = active(projNoExt, sid);
report('activeExtendedSkills: project with no extended skills yields empty (early return)',
  res.length === 0, JSON.stringify(res));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
