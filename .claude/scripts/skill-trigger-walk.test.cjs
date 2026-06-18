#!/usr/bin/env node

const assert = require('assert');
const { parseEvalMarkdown, decideFromEvents, parseArgs } = require('./skill-trigger-walk.cjs');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error('       ' + (e.stack || e.message).replace(/\n/g, '\n       '));
  }
}

// helpers to build stream-json events the way `claude -p` emits them
const assistantSkill = (skill) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill } }] } });
const assistantAgent = () => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'context-agent' } }] } });
const assistantText = (t) => ({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } });
const resultEvent = () => ({ type: 'result', subtype: 'success' });

console.log('parseEvalMarkdown');

const SAMPLE = `# capture-invariants trigger eval

## Should fire
- "what are the architectural invariants of this project?"
- "document the conventions for this codebase"

## Should not fire
- "what's our strategy?" (owned by \`strategy-kernel\`)
- "review this diff" (owned by \`review\`)

## Owns triggers
- "architectural invariants" (vs \`define\`)
`;

test('extracts should-fire phrases as shouldTrigger:true', () => {
  const cases = parseEvalMarkdown(SAMPLE).filter((c) => c.shouldTrigger);
  assert.deepStrictEqual(cases.map((c) => c.query), [
    'what are the architectural invariants of this project?',
    'document the conventions for this codebase',
  ]);
});

test('extracts should-not-fire phrases as shouldTrigger:false', () => {
  const cases = parseEvalMarkdown(SAMPLE).filter((c) => !c.shouldTrigger);
  assert.deepStrictEqual(cases.map((c) => c.query), [
    "what's our strategy?",
    'review this diff',
  ]);
});

test('strips the parenthetical note, keeps only the quoted phrase', () => {
  const c = parseEvalMarkdown(SAMPLE).find((x) => x.query.startsWith('review'));
  assert.strictEqual(c.query, 'review this diff');
});

test('skips non-test sections like Owns triggers', () => {
  const all = parseEvalMarkdown(SAMPLE).map((c) => c.query);
  assert.ok(!all.includes('architectural invariants'), 'Owns-triggers bullet must not become a test case');
  assert.strictEqual(parseEvalMarkdown(SAMPLE).length, 4);
});

test('returns empty for markdown with no fire sections', () => {
  assert.deepStrictEqual(parseEvalMarkdown('# title\n\nsome prose\n'), []);
});

console.log('decideFromEvents — confound 1: real skill name, not a temp uuid');

test('fires on the real installed skill name', () => {
  // run_eval keyed on `<skill>-skill-<uuid>` and would miss this; we key on the real name.
  const d = decideFromEvents([assistantSkill('capture-invariants')], 'capture-invariants');
  assert.deepStrictEqual(d, { decided: true, fired: true, otherSkill: null });
});

test('matches a namespaced skill id by substring', () => {
  const d = decideFromEvents([assistantSkill('project-management:init-project')], 'init-project');
  assert.strictEqual(d.fired, true);
});

console.log('decideFromEvents — confound 2: non-Skill tool before the Skill call');

test('Agent spawn before the Skill call does not pre-empt the verdict', () => {
  // run_eval returned not-fired on the first non-Skill/Read tool; the kit's
  // SessionStart hook spawns context-agent (Agent) first. Must still fire.
  const events = [assistantAgent(), assistantText('let me look'), assistantSkill('capture-invariants')];
  const d = decideFromEvents(events, 'capture-invariants');
  assert.deepStrictEqual(d, { decided: true, fired: true, otherSkill: null });
});

test('Agent + Skill in one assistant message still fires', () => {
  const mixed = { type: 'assistant', message: { content: [
    { type: 'tool_use', name: 'Agent', input: {} },
    { type: 'tool_use', name: 'Skill', input: { skill: 'capture-invariants' } },
  ] } };
  assert.strictEqual(decideFromEvents([mixed], 'capture-invariants').fired, true);
});

console.log('decideFromEvents — owns-triggers and not-fired');

test('a competing skill firing first counts as not-fired and is reported', () => {
  const d = decideFromEvents([assistantSkill('review')], 'capture-invariants');
  assert.deepStrictEqual(d, { decided: true, fired: false, otherSkill: 'review' });
});

test('end of turn with no Skill call is not-fired', () => {
  const d = decideFromEvents([assistantAgent(), assistantText('done'), resultEvent()], 'capture-invariants');
  assert.deepStrictEqual(d, { decided: true, fired: false, otherSkill: null });
});

test('undecided while only non-Skill tools have streamed', () => {
  const d = decideFromEvents([assistantAgent(), assistantText('thinking')], 'capture-invariants');
  assert.strictEqual(d.decided, false);
});

test('first Skill wins — a later matching skill does not override an earlier competitor', () => {
  const d = decideFromEvents([assistantSkill('review'), assistantSkill('capture-invariants')], 'capture-invariants');
  assert.deepStrictEqual(d, { decided: true, fired: false, otherSkill: 'review' });
});

console.log('parseArgs');

test('skill is the positional arg; runs defaults to 3', () => {
  const a = parseArgs(['capture-invariants']);
  assert.strictEqual(a.skill, 'capture-invariants');
  assert.strictEqual(a.runs, 3);
});

test('parses --eval, --model, --runs, --json', () => {
  const a = parseArgs(['my-skill', '--eval', '/tmp/e.md', '--model', 'opus', '--runs', '5', '--json']);
  assert.deepStrictEqual(
    { skill: a.skill, evalPath: a.evalPath, model: a.model, runs: a.runs, json: a.json },
    { skill: 'my-skill', evalPath: '/tmp/e.md', model: 'opus', runs: 5, json: true },
  );
});

test('malformed --runs falls back to 3, never NaN', () => {
  assert.strictEqual(parseArgs(['s', '--runs', 'abc']).runs, 3);
  assert.strictEqual(parseArgs(['s', '--runs', '0']).runs, 3);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
