#!/usr/bin/env node

/**
 * Unit tests for the skill-behavior-walk pure core (parse, body-strip, grade,
 * combine, aggregate, verdict, calibration, args). The claude -p ablation +
 * judge edge is exercised by the live walk, not here.
 * Run: node .claude/scripts/skill-behavior-walk.test.cjs
 */

const {
  parseBehaviorEval, skillBody, extractOutput, gradeDeterministic, complianceVerdict,
  parseBehaviorJudge, mapLocalVerdict, buildBehaviorJudgePrompt, aggregate,
  verdict, parseCalibration, parseArgs, THRESHOLDS, JUDGE_SCHEMA, BASE_SYSTEM,
} = require('./skill-behavior-walk.cjs');

let pass = 0;
let fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

// ── parseBehaviorEval ─────────────────────────────────────────────
const SAMPLE = [
  '# lead-with-decision behavior eval',
  '',
  '## Tasks',
  '- "draft an email asking my manager to approve the budget"',
  '- "write the issue for this bug"',
  '',
  '## Complies when',
  '- `^[^.!?\\n]{0,120}\\b(recommend|should|approve|do not|by \\w+day)\\b`',
  '',
  '## Violates when',
  '- `^\\s*(I wanted to|I\'ve been thinking|Hope you|I hope this)`',
  '',
  '## Judge',
  'Does the first sentence state the decision or ask, not a warm-up?',
].join('\n');
const spec = parseBehaviorEval(SAMPLE);
report('parseBehaviorEval: parses 2 tasks from quoted bullets',
  spec.tasks.length === 2 && spec.tasks[0] === 'draft an email asking my manager to approve the budget',
  JSON.stringify(spec.tasks));
report('parseBehaviorEval: captures compliesWhen regex', /recommend\|should\|approve/.test(spec.compliesWhen || ''));
report('parseBehaviorEval: captures violatesWhen regex', /I wanted to/.test(spec.violatesWhen || ''));
report('parseBehaviorEval: captures judge criterion', /first sentence/.test(spec.judge || ''));
const judgeOnly = parseBehaviorEval('## Tasks\n- "x"\n## Judge\nGrade it.');
report('parseBehaviorEval: judge-only corpus has null regexes',
  judgeOnly.compliesWhen === null && judgeOnly.violatesWhen === null && judgeOnly.judge === 'Grade it.');

// ── skillBody ─────────────────────────────────────────────────────
report('skillBody: strips frontmatter, returns body',
  skillBody('---\nname: x\ndescription: y\n---\n\n# Title\nThe method.') === '# Title\nThe method.');
report('skillBody: no frontmatter returns the text trimmed', skillBody('  just body  ') === 'just body');

// ── extractOutput ─────────────────────────────────────────────────
report('extractOutput: pulls the span inside the envelope, trimmed',
  extractOutput('reasoning here\n<<OUTPUT>>\nApprove the budget.\n<<END_OUTPUT>>\ntrailing note') === 'Approve the budget.');
report('extractOutput: grades only the envelope, not the commentary that quotes a flagged word',
  extractOutput('I removed "significant".\n<<OUTPUT>>\nLatency dropped to 80ms.\n<<END_OUTPUT>>') === 'Latency dropped to 80ms.');
report('extractOutput: no envelope falls back to the whole text', extractOutput('  just the answer  ') === 'just the answer');
report('extractOutput: empty/nullish input is safe', extractOutput('') === '' && extractOutput(null) === '');

// ── gradeDeterministic ────────────────────────────────────────────
report('gradeDeterministic: null when no checks defined',
  gradeDeterministic('anything', { compliesWhen: null, violatesWhen: null }) === null);
report('gradeDeterministic: compliesWhen match → true',
  gradeDeterministic('We should ship it.', { compliesWhen: '\\bshould\\b', violatesWhen: null }) === true);
report('gradeDeterministic: compliesWhen no match → false',
  gradeDeterministic('Maybe later.', { compliesWhen: '\\bshould\\b', violatesWhen: null }) === false);
report('gradeDeterministic: violatesWhen anti-pattern present → false',
  gradeDeterministic('I wanted to reach out.', { compliesWhen: null, violatesWhen: '^I wanted to' }) === false);
report('gradeDeterministic: violatesWhen absent → true',
  gradeDeterministic('Approve the budget by Friday.', { compliesWhen: null, violatesWhen: '^I wanted to' }) === true);
report('gradeDeterministic: both checks must hold',
  gradeDeterministic('We should approve it.', { compliesWhen: '\\bshould\\b', violatesWhen: '^I wanted' }) === true &&
  gradeDeterministic('I wanted to say we should.', { compliesWhen: '\\bshould\\b', violatesWhen: '^I wanted' }) === false);
report('gradeDeterministic: invalid compliesWhen regex fails closed, never throws',
  gradeDeterministic('x', { compliesWhen: '(', violatesWhen: null }) === false);
report('gradeDeterministic: invalid violatesWhen regex fails closed',
  gradeDeterministic('x', { compliesWhen: null, violatesWhen: '(' }) === false);
report('gradeDeterministic: matching is case-insensitive (Significant ⇒ violation)',
  gradeDeterministic('This is a Significant gain.', { compliesWhen: null, violatesWhen: '\\bsignificant\\b' }) === false &&
  gradeDeterministic('Latency dropped to 80ms.', { compliesWhen: null, violatesWhen: '\\bsignificant\\b' }) === true);

// ── complianceVerdict ─────────────────────────────────────────────
report('complianceVerdict: both null → null', complianceVerdict(null, null) === null);
report('complianceVerdict: det only → det', complianceVerdict(true, null) === true && complianceVerdict(false, null) === false);
report('complianceVerdict: judge only → judge', complianceVerdict(null, true) === true && complianceVerdict(null, false) === false);
report('complianceVerdict: both present → AND',
  complianceVerdict(true, true) === true && complianceVerdict(true, false) === false && complianceVerdict(false, true) === false);

// ── parseBehaviorJudge ────────────────────────────────────────────
report('parseBehaviorJudge: clean JSON', (() => { const v = parseBehaviorJudge('{"complies": true, "reason": "leads with ask"}'); return v.complies === true && v.reason === 'leads with ask'; })());
report('parseBehaviorJudge: embedded in prose', (() => { const v = parseBehaviorJudge('Verdict:\n{"complies": false, "reason": "warm-up opener"}\ndone'); return v.complies === false && v.reason === 'warm-up opener'; })());
report('parseBehaviorJudge: complies is strict boolean (string is not true)', parseBehaviorJudge('{"complies": "true"}').complies === false);
report('parseBehaviorJudge: no JSON → false with reason', parseBehaviorJudge('looks fine to me').complies === false);
report('parseBehaviorJudge: malformed JSON → false, never throws', parseBehaviorJudge('{complies: yes').complies === false);

// ── mapLocalVerdict (fail-closed) ─────────────────────────────────
report('mapLocalVerdict: ok + complies:true', (() => { const v = mapLocalVerdict({ ok: true, data: { complies: true, reason: 'r' } }); return v.complies === true && v.reason === 'r'; })());
report('mapLocalVerdict: ok + complies:false', mapLocalVerdict({ ok: true, data: { complies: false, reason: 'r' } }).complies === false);
report('mapLocalVerdict: complies strict boolean', mapLocalVerdict({ ok: true, data: { complies: 'true' } }).complies === false);
report('mapLocalVerdict: non-ok fails closed carrying the error', (() => { const v = mapLocalVerdict({ ok: false, error: 'ollama down' }); return v.complies === false && v.reason === 'ollama down'; })());
report('mapLocalVerdict: null fails closed', mapLocalVerdict(null).complies === false);

// ── buildBehaviorJudgePrompt ──────────────────────────────────────
const jp = buildBehaviorJudgePrompt('Does it lead with the ask?', 'Approve the budget.');
report('buildBehaviorJudgePrompt: includes criterion, output, JSON instruction',
  /Does it lead with the ask\?/.test(jp) && /Approve the budget\./.test(jp) && /\{"complies": true\|false/.test(jp));
report('buildBehaviorJudgePrompt: empty output renders as (empty)', /\(empty\)/.test(buildBehaviorJudgePrompt('c', '')));

// ── aggregate ─────────────────────────────────────────────────────
const records = [
  { task: 't1', run: 0, warmComplies: true, coldComplies: false },
  { task: 't1', run: 1, warmComplies: true, coldComplies: false },
  { task: 't2', run: 0, warmComplies: false, coldComplies: false },
  { task: 't2', run: 1, warmComplies: true, coldComplies: null }, // null excluded from cold rate
];
const agg = aggregate(records);
report('aggregate: warm rate over gradable trials (3/4)', Math.abs(agg.warmRate - 0.75) < 1e-9, JSON.stringify(agg));
report('aggregate: cold rate excludes null (0/3)', agg.coldRate === 0 && agg.coldN === 3);
report('aggregate: delta is warm − cold', Math.abs(agg.delta - 0.75) < 1e-9);
report('aggregate: per-task breakdown computed', (() => {
  const t1 = agg.perTask.find((t) => t.task === 't1');
  return t1 && t1.warmRate === 1 && t1.coldRate === 0;
})(), JSON.stringify(agg.perTask));

// ── verdict (pre-registered thresholds) ───────────────────────────
report('verdict: high delta → KEEP', verdict({ delta: 0.6, warmRate: 0.8, coldRate: 0.2 }).label === 'KEEP');
report('verdict: low delta → DEAD-WEIGHT', verdict({ delta: 0.05, warmRate: 0.9, coldRate: 0.85 }).label === 'DEAD-WEIGHT');
report('verdict: mid delta → INCONCLUSIVE', verdict({ delta: 0.25, warmRate: 0.6, coldRate: 0.35 }).label === 'INCONCLUSIVE');
report('verdict: weakWarm flags low warm rate independent of delta',
  verdict({ delta: 0.5, warmRate: 0.4, coldRate: 0.0 }).weakWarm === true &&
  verdict({ delta: 0.5, warmRate: 0.8, coldRate: 0.3 }).weakWarm === false);
report('verdict: thresholds at the documented values', THRESHOLDS.keepDelta === 0.4 && THRESHOLDS.deadDelta === 0.1 && THRESHOLDS.weakWarmRate === 0.5);

// ── parseCalibration ──────────────────────────────────────────────
const CAL = [
  '## Judge',
  'Does it lead with the ask?',
  '',
  '## Calibration',
  'prose to ignore',
  '',
  '### pass: clean lead',
  'Approve the budget by Friday.',
  '',
  '### fail: warm-up',
  'I wanted to reach out about the budget.',
  'It would be great to discuss.',
].join('\n');
const cal = parseCalibration(CAL);
report('parseCalibration: parses 2 cases', cal.length === 2, JSON.stringify(cal));
report('parseCalibration: pass case expectComplies true + body',
  cal[0].expectComplies === true && cal[0].output === 'Approve the budget by Friday.' && cal[0].label === 'clean lead');
report('parseCalibration: fail case expectComplies false, multi-line joined',
  cal[1].expectComplies === false && cal[1].output === 'I wanted to reach out about the budget.\nIt would be great to discuss.');
report('parseCalibration: prose before first case not captured', !cal.some((c) => /prose to ignore/.test(c.output)));
report('parseCalibration: no Calibration section → no cases', parseCalibration('## Judge\nx\n').length === 0);

// ── parseArgs ─────────────────────────────────────────────────────
report('parseArgs: defaults', (() => { const p = parseArgs(['lead-with-decision']); return p.skill === 'lead-with-decision' && p.runs === 3 && p.timeout === 120000 && p.local === null && p.calibrate === false; })());
report('parseArgs: runs + model + timeout + json',
  (() => { const p = parseArgs(['x', '--runs', '5', '--model', 'opus', '--timeout', '60000', '--json']); return p.runs === 5 && p.model === 'opus' && p.timeout === 60000 && p.json === true; })());
report('parseArgs: --local + --host + --calibrate',
  (() => { const p = parseArgs(['x', '--local', 'qwen3:32b', '--host', 'http://h:1', '--calibrate']); return p.local === 'qwen3:32b' && p.host === 'http://h:1' && p.calibrate === true; })());
report('parseArgs: --out + --resume default null/false', (() => { const p = parseArgs(['x']); return p.out === null && p.resume === false; })());
report('parseArgs: --out + --resume parsed', (() => { const p = parseArgs(['x', '--out', '/t/x.json', '--resume']); return p.out === '/t/x.json' && p.resume === true; })());

// ── JUDGE_SCHEMA + BASE_SYSTEM ────────────────────────────────────
report('JUDGE_SCHEMA: requires complies(boolean) + reason(string)',
  JUDGE_SCHEMA.properties.complies.type === 'boolean' && JUDGE_SCHEMA.properties.reason.type === 'string' &&
  JUDGE_SCHEMA.required.includes('complies') && JUDGE_SCHEMA.required.includes('reason'));
report('BASE_SYSTEM: shared neutral base prompt is non-empty', typeof BASE_SYSTEM === 'string' && BASE_SYSTEM.length > 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
