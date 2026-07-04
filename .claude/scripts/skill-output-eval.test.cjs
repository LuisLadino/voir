#!/usr/bin/env node

/**
 * Unit tests for the skill-output-eval pure core (parse, split, assertions,
 * judge parsing, args). The claude -p produce/judge edge is exercised by the
 * live eval, not here. Run: node .claude/scripts/skill-output-eval.test.cjs
 */

const { parseOutputEval, parseEnvelopes, runAssertions, parseJudge, buildJudgePrompt, mapLocalVerdict, parseCalibration, parseArgs, JUDGE_SCHEMA } = require('./skill-output-eval.cjs');

let pass = 0;
let fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

const SAMPLE = [
  '# commit output eval',
  '',
  '## Skill rules',
  'Use conventional commits. Output the <<COMMIT>>/<<PR>> envelope.',
  '',
  '## Scenario',
  'Produce the artifact for issue #512.',
  'Second scenario line.',
  '',
  '## Assertions',
  '- commit `^(feat|fix)(\\([^)]+\\))?: .+` — conventional type',
  '- pr `## Summary` — summary section',
  '- pr `Addresses #512` — issue link',
  '- any `isSafePath` — references the helper',
  '',
  '## Judge (commit)',
  'Does the message describe the change accurately?',
].join('\n');

// ── parseOutputEval ───────────────────────────────────────────────
const spec = parseOutputEval(SAMPLE);
report('parseOutputEval: captures skill rules', /conventional commits/i.test(spec.rules) && /envelope/.test(spec.rules));
report('parseOutputEval: captures multi-line scenario', /issue #512/.test(spec.scenario) && /Second scenario line/.test(spec.scenario));
report('parseOutputEval: captures judge', /accurately/.test(spec.judge));
report('parseOutputEval: parses 4 assertions with target + pattern + name',
  spec.assertions.length === 4 &&
  spec.assertions[0].target === 'commit' && spec.assertions[0].pattern === '^(feat|fix)(\\([^)]+\\))?: .+' && spec.assertions[0].name === 'conventional type',
  JSON.stringify(spec.assertions));
report('parseOutputEval: assertion targets include pr and any',
  spec.assertions[1].target === 'pr' && spec.assertions[3].target === 'any');
report('parseOutputEval: parses judge target from heading', spec.judgeTarget === 'commit', spec.judgeTarget);
const specGeneric = parseOutputEval([
  '## Skill rules', 'Emit <<SPEC>>…<<END_SPEC>>.',
  '## Scenario', 'Produce the spec.',
  '## Assertions', '- spec `conformance_rule` — has a conformance rule',
  '## Judge', 'Is it good?',
].join('\n'));
report('parseOutputEval: arbitrary target (spec) parses', specGeneric.assertions[0].target === 'spec');
report('parseOutputEval: judge target defaults to any when unspecified', specGeneric.judgeTarget === 'any');

// ── parseEnvelopes ────────────────────────────────────────────────
const artifact = [
  'prelude to ignore',
  '<<COMMIT>>',
  'fix(auth): honor safe next param on post-login redirect',
  '<<END_COMMIT>>',
  '<<PR>>',
  '## Summary',
  '- honor next param',
  '',
  'Addresses #512',
  '',
  '## Test Plan',
  '- log in with ?next=/x',
  '<<END_PR>>',
  'trailing junk',
].join('\n');
const sec = parseEnvelopes(artifact);
report('parseEnvelopes: extracts commit between markers, trimmed',
  sec.commit === 'fix(auth): honor safe next param on post-login redirect', JSON.stringify(sec.commit));
report('parseEnvelopes: extracts pr body', /## Summary/.test(sec.pr) && /Addresses #512/.test(sec.pr) && /## Test Plan/.test(sec.pr));
report('parseEnvelopes: extracts an arbitrary envelope name (spec)',
  parseEnvelopes('<<SPEC>>\nname: cosmo-invariants\n<<END_SPEC>>').spec === 'name: cosmo-invariants');
report('parseEnvelopes: missing markers yield an empty object', Object.keys(parseEnvelopes('no markers here')).length === 0);
report('parseEnvelopes: backreference prevents cross-envelope match',
  parseEnvelopes('<<COMMIT>>\nx\n<<END_PR>>').commit === undefined);

// ── runAssertions ─────────────────────────────────────────────────
const results = runAssertions(sec, spec.assertions);
report('runAssertions: commit conventional-type passes', results[0].pass === true);
report('runAssertions: pr ## Summary passes', results[1].pass === true);
report('runAssertions: pr Addresses #512 passes', results[2].pass === true);
report('runAssertions: any-target searches both sections (isSafePath only in neither here → fail)',
  results[3].pass === false, JSON.stringify(results[3]));
report('runAssertions: a commit-target regex does not match pr-only content',
  runAssertions(sec, [{ target: 'commit', pattern: '## Summary', name: 'x' }])[0].pass === false);
report('runAssertions: invalid regex fails closed, never throws',
  runAssertions(sec, [{ target: 'commit', pattern: '(', name: 'bad' }])[0].pass === false);
report('runAssertions: multiline anchor matches a later PR line',
  runAssertions(sec, [{ target: 'pr', pattern: '^## Test Plan', name: 'tp' }])[0].pass === true);
report('runAssertions: any-target concatenates all sections (incl. a third)',
  runAssertions({ commit: 'a', pr: 'b', spec: 'zzz' }, [{ target: 'any', pattern: 'zzz', name: 'x' }])[0].pass === true);
report('runAssertions: arbitrary target resolves to its section',
  runAssertions({ spec: 'conformance_rule: foo' }, [{ target: 'spec', pattern: 'conformance_rule', name: 'x' }])[0].pass === true);

// ── parseJudge ────────────────────────────────────────────────────
report('parseJudge: clean JSON', (() => { const v = parseJudge('{"pass": true, "reason": "ok"}'); return v.pass === true && v.reason === 'ok'; })());
report('parseJudge: JSON embedded in prose', (() => { const v = parseJudge('Here is my verdict:\n{"pass": false, "reason": "vague"}\nThanks'); return v.pass === false && v.reason === 'vague'; })());
report('parseJudge: pass is strict boolean (string "true" is not pass)', parseJudge('{"pass": "true"}').pass === false);
report('parseJudge: no JSON → fail with reason', parseJudge('I think it is fine').pass === false);
report('parseJudge: malformed JSON → fail, never throws', parseJudge('{pass: yes').pass === false);

// ── parseArgs ─────────────────────────────────────────────────────
const a = parseArgs(['commit', '--model', 'opus', '--json']);
report('parseArgs: skill + model + json', a.skill === 'commit' && a.model === 'opus' && a.json === true, JSON.stringify(a));
report('parseArgs: --eval captured', parseArgs(['commit', '--eval', '/tmp/e.md']).evalPath === '/tmp/e.md');
report('parseArgs: --local + --host + --calibrate captured',
  (() => { const p = parseArgs(['commit', '--local', 'qwen3:32b', '--host', 'http://h:1', '--calibrate']); return p.local === 'qwen3:32b' && p.host === 'http://h:1' && p.calibrate === true; })());
report('parseArgs: defaults — no --local/--calibrate', (() => { const p = parseArgs(['commit']); return p.local === null && p.calibrate === false && p.host === undefined; })());

// ── buildJudgePrompt ──────────────────────────────────────────────
const jp = buildJudgePrompt('Does it describe the change?', 'fix: do the thing', 'commit');
report('buildJudgePrompt: includes criterion, artifact, and JSON instruction',
  /Does it describe the change\?/.test(jp) && /fix: do the thing/.test(jp) && /\{"pass": true\|false/.test(jp));
report('buildJudgePrompt: label reflects the target', /COMMIT PRODUCED:/.test(jp));
report('buildJudgePrompt: default/any target uses the generic label', /ARTIFACT PRODUCED:/.test(buildJudgePrompt('c', 'x', 'any')));
report('buildJudgePrompt: empty artifact renders as (none)', /\(none\)/.test(buildJudgePrompt('crit', '', 'commit')));

// ── mapLocalVerdict (fail-closed semantics) ───────────────────────
report('mapLocalVerdict: ok + pass:true → pass true', (() => { const v = mapLocalVerdict({ ok: true, data: { pass: true, reason: 'good' } }); return v.pass === true && v.reason === 'good'; })());
report('mapLocalVerdict: ok + pass:false → pass false', mapLocalVerdict({ ok: true, data: { pass: false, reason: 'bad' } }).pass === false);
report('mapLocalVerdict: pass is strict boolean (string "true" is not pass)', mapLocalVerdict({ ok: true, data: { pass: 'true' } }).pass === false);
report('mapLocalVerdict: non-ok result fails closed, carries the error', (() => { const v = mapLocalVerdict({ ok: false, error: 'ollama down' }); return v.pass === false && v.reason === 'ollama down'; })());
report('mapLocalVerdict: null result fails closed', mapLocalVerdict(null).pass === false);
report('mapLocalVerdict: ok but missing data → pass false', mapLocalVerdict({ ok: true }).pass === false);

// ── JUDGE_SCHEMA ──────────────────────────────────────────────────
report('JUDGE_SCHEMA: object schema requiring pass(boolean) + reason(string)',
  JUDGE_SCHEMA.type === 'object' &&
  JUDGE_SCHEMA.properties.pass.type === 'boolean' &&
  JUDGE_SCHEMA.properties.reason.type === 'string' &&
  JUDGE_SCHEMA.required.includes('pass') && JUDGE_SCHEMA.required.includes('reason'));

// ── parseCalibration ──────────────────────────────────────────────
const CAL = [
  '## Judge',
  'Does the message describe the change?',
  '',
  '## Calibration',
  'Some prose to ignore.',
  '',
  '### pass: accurate message',
  'fix(auth): honor safe next param',
  '',
  '### fail: wrong type',
  'feat: redesign everything',
  'second body line',
].join('\n');
const cal = parseCalibration(CAL);
report('parseCalibration: parses 2 cases', cal.length === 2, JSON.stringify(cal));
report('parseCalibration: pass case has expectPass true + the message body',
  cal[0].expectPass === true && cal[0].message === 'fix(auth): honor safe next param' && cal[0].label === 'accurate message');
report('parseCalibration: fail case expectPass false, multi-line message joined',
  cal[1].expectPass === false && cal[1].message === 'feat: redesign everything\nsecond body line');
report('parseCalibration: prose before the first ### case is not captured', !cal.some((c) => /prose to ignore/.test(c.message)));
report('parseCalibration: content outside ## Calibration is ignored (the ## Judge line)',
  !cal.some((c) => /describe the change/.test(c.message)));
report('parseCalibration: no Calibration section → no cases', parseCalibration('## Judge\ncriterion\n').length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
