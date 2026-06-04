#!/usr/bin/env node

/**
 * Unit tests for the shared skill-pattern module.
 * Run: node .claude/hooks/lib/skill-patterns.test.cjs
 */

const {
  isSkillComplete,
  isSkillExempt,
  isSkillRegistered,
  normalizeSkillName,
  buildSentinelRegex
} = require('./skill-patterns.cjs');

let pass = 0;
let fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else    { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

report('strips leading slash', normalizeSkillName('/research') === 'research');
report('strips plugin namespace', normalizeSkillName('/project-management:sync-stack') === 'sync-stack');
report('passes through bare name', normalizeSkillName('research') === 'research');
report('handles undefined', normalizeSkillName(undefined) === '');

report('research is registered', isSkillRegistered('research'));
report('define is registered (exempt)', isSkillRegistered('define'));
report('unknown is not registered', !isSkillRegistered('this-is-not-a-skill'));

report('define is exempt', isSkillExempt('define'));
report('research is not exempt', !isSkillExempt('research'));
report('unknown is not exempt', !isSkillExempt('this-is-not-a-skill'));

const setOf = (...names) => new Set(names);

const r1 = isSkillComplete('research', [], setOf('WebSearch'));
report('research complete via WebSearch tool', r1.complete === true);

const r2 = isSkillComplete('research', [], setOf('Read'));
report('research incomplete with only Read', r2.complete === false && r2.expected !== null);

const c1 = isSkillComplete('commit', ['git push origin main'], setOf());
report('commit complete via git push', c1.complete === true);

const c2 = isSkillComplete('commit', ['git status'], setOf());
report('commit incomplete with only git status', c2.complete === false);

const s1 = isSkillComplete('plan', ['echo SKILL_COMPLETE: plan'], setOf());
report('sentinel completes plan', s1.complete === true);

const s2 = isSkillComplete('plan', ['echo SKILL_COMPLETE: plan-foo'], setOf());
report('sentinel does not match plan-foo for plan', s2.complete === false);

const e1 = isSkillComplete('define', [], setOf());
report('exempt skill complete with no signal', e1.complete === true);

const u1 = isSkillComplete('this-is-not-a-skill', ['git push'], setOf('WebSearch'));
report('unknown skill never complete (tripwire)', u1.complete === false);

const p1 = isSkillComplete('/project-management:sync-stack', [], setOf());
report('namespaced sync-stack treated as exempt', p1.complete === true);

const rx = buildSentinelRegex('skill-with-dash');
report('sentinel matches with dash', rx.test('SKILL_COMPLETE: skill-with-dash'));
report('sentinel does not partial-match', !rx.test('SKILL_COMPLETE: skill-with-dash-extra'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
