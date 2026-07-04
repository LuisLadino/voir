#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseSkillDoc,
  buildJudgePrompt,
  parseJudge,
  aggregate,
  parseCorpus,
  resolveSkillPath,
  parseArgs,
} = require('./skill-faithfulness-walk.cjs');

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

console.log('parseSkillDoc');

test('extracts a folded `description: >` field and the body', () => {
  const doc = parseSkillDoc(`---
name: x
description: >
  Do the thing. Triggers: "a", "b". Forces a pass.
---

# Heading

Body line one.`);
  assert.strictEqual(doc.description, 'Do the thing. Triggers: "a", "b". Forces a pass.');
  assert.ok(doc.body.startsWith('# Heading'));
  assert.ok(doc.body.includes('Body line one.'));
});

test('extracts an inline `description:` field', () => {
  const doc = parseSkillDoc(`---
description: Wire it together. Not generic docs.
---

Body.`);
  assert.strictEqual(doc.description, 'Wire it together. Not generic docs.');
  assert.strictEqual(doc.body, 'Body.');
});

test('collapses whitespace in a multi-line folded description', () => {
  const doc = parseSkillDoc(`---
description: >
  One two
  three four
---
b`);
  assert.strictEqual(doc.description, 'One two three four');
});

test('a field after description bounds the capture', () => {
  const doc = parseSkillDoc(`---
name: x
description: Just this.
allowed-tools: Read
---
b`);
  assert.strictEqual(doc.description, 'Just this.');
});

test('no frontmatter yields empty description and the whole text as body', () => {
  const doc = parseSkillDoc('no frontmatter here');
  assert.strictEqual(doc.description, '');
  assert.strictEqual(doc.body, 'no frontmatter here');
});

console.log('buildJudgePrompt');

test('embeds description and body and the JSON contract', () => {
  const p = buildJudgePrompt('THE DESC', 'THE BODY');
  assert.ok(p.includes('THE DESC'));
  assert.ok(p.includes('THE BODY'));
  assert.ok(p.includes('"faithful": true|false'));
});

test('frames the judgment as comparative-factual, not quality', () => {
  const p = buildJudgePrompt('d', 'b');
  assert.ok(/NOT a writing-quality judgment/i.test(p));
  assert.ok(/distinctive core/i.test(p));
});

test('sets the violation bar: flag contradiction/misstatement, pass accurate-but-generic', () => {
  const p = buildJudgePrompt('d', 'b');
  assert.ok(/contradict/i.test(p));
  assert.ok(/misstate/i.test(p));
  assert.ok(/less sharp/i.test(p)); // explicit: do not flag for under-foregrounding alone
});

console.log('parseJudge');

test('parses a clean faithful=true verdict', () => {
  assert.deepStrictEqual(parseJudge('{"faithful": true, "reason": "foregrounds the core"}'), { faithful: true, reason: 'foregrounds the core' });
});

test('parses faithful=false', () => {
  assert.strictEqual(parseJudge('{"faithful": false, "reason": "buries it"}').faithful, false);
});

test('tolerates prose around the JSON', () => {
  assert.strictEqual(parseJudge('Here is my verdict: {"faithful": true, "reason": "ok"} done').faithful, true);
});

test('missing boolean faithful yields null verdict', () => {
  assert.strictEqual(parseJudge('{"reason": "no flag"}').faithful, null);
});

test('non-boolean faithful yields null verdict', () => {
  assert.strictEqual(parseJudge('{"faithful": "yes"}').faithful, null);
});

test('no JSON yields null verdict', () => {
  assert.strictEqual(parseJudge('I think it is fine.').faithful, null);
});

console.log('aggregate');

test('all-faithful passes', () => {
  const r = aggregate([{ faithful: true }, { faithful: true }, { faithful: true }], 0.5);
  assert.strictEqual(r.pass, true);
  assert.strictEqual(r.rate, 1);
});

test('majority faithful passes at threshold 0.5', () => {
  const r = aggregate([{ faithful: true }, { faithful: true }, { faithful: false }], 0.5);
  assert.strictEqual(r.pass, true);
});

test('minority faithful fails at threshold 0.5', () => {
  const r = aggregate([{ faithful: true }, { faithful: false }, { faithful: false }], 0.5);
  assert.strictEqual(r.pass, false);
});

test('rate exactly at threshold passes (>=)', () => {
  const r = aggregate([{ faithful: true }, { faithful: false }], 0.5);
  assert.strictEqual(r.rate, 0.5);
  assert.strictEqual(r.pass, true);
});

test('a lower threshold biases against flagging (one faithful vote saves it)', () => {
  // rate = 1/3 ≈ 0.333; at threshold 0.5 it would flag, at 0.3 the lone faithful vote passes it.
  assert.strictEqual(aggregate([{ faithful: true }, { faithful: false }, { faithful: false }], 0.5).pass, false);
  assert.strictEqual(aggregate([{ faithful: true }, { faithful: false }, { faithful: false }], 0.3).pass, true);
});

test('null verdicts count as not faithful', () => {
  const r = aggregate([{ faithful: null }, { faithful: null }, { faithful: true }], 0.5);
  assert.strictEqual(r.faithfulCount, 1);
  assert.strictEqual(r.pass, false);
});

test('empty verdict set fails, does not divide by zero', () => {
  const r = aggregate([], 0.5);
  assert.strictEqual(r.rate, 0);
  assert.strictEqual(r.pass, false);
});

test('zero usable verdicts never passes, even at threshold 0 (fail-honest)', () => {
  // every call errored (e.g. local model down/timeout) → all null → must not pass at ANY threshold
  const r = aggregate([{ faithful: null }, { faithful: null }, { faithful: null }], 0);
  assert.strictEqual(r.valid, 0);
  assert.strictEqual(r.errored, 3);
  assert.strictEqual(r.pass, false);
});

test('errored counts null verdicts; valid counts the real ones', () => {
  const r = aggregate([{ faithful: true }, { faithful: null }, { faithful: false }], 0.5);
  assert.strictEqual(r.errored, 1);
  assert.strictEqual(r.valid, 2);
});

console.log('parseCorpus');

const CORPUS = `# calibration

## Drift (expect faithful=false)
- sync-stack | Wire project together, verify setup, generate project specs.
- handoff | Capture session context. Triggers: "handoff", "end session". Runs /dream.

## Clean (expect faithful=true)
- counterfactual-check
- sync-stack

## Notes
- not a case
`;

test('drift bullets expect faithful=false, clean expect true', () => {
  const cases = parseCorpus(CORPUS);
  const drift = cases.filter((c) => c.expectFaithful === false);
  const clean = cases.filter((c) => c.expectFaithful === true);
  assert.strictEqual(drift.length, 2);
  assert.strictEqual(clean.length, 2);
});

test('a `|` override is captured; a bare name has none', () => {
  const cases = parseCorpus(CORPUS);
  const sync = cases.find((c) => c.name === 'sync-stack' && c.expectFaithful === false);
  assert.strictEqual(sync.descriptionOverride, 'Wire project together, verify setup, generate project specs.');
  const cf = cases.find((c) => c.name === 'counterfactual-check');
  assert.strictEqual(cf.descriptionOverride, null);
});

test('an override preserves embedded double-quotes (trigger phrases)', () => {
  const handoff = parseCorpus(CORPUS).find((c) => c.name === 'handoff');
  assert.strictEqual(handoff.descriptionOverride, 'Capture session context. Triggers: "handoff", "end session". Runs /dream.');
});

test('non Drift/Clean sections are ignored', () => {
  const names = parseCorpus(CORPUS).map((c) => c.name);
  assert.ok(!names.includes('not'));
});

console.log('parseArgs');

test('defaults: runs 3, threshold 0.5, not calibrate', () => {
  const a = parseArgs(['affordance-audit']);
  assert.strictEqual(a.skill, 'affordance-audit');
  assert.strictEqual(a.runs, 3);
  assert.strictEqual(a.threshold, 0.5);
  assert.strictEqual(a.calibrate, false);
});

test('--calibrate sets the mode and --corpus the path', () => {
  const a = parseArgs(['--calibrate', '--corpus', 'x.md']);
  assert.strictEqual(a.calibrate, true);
  assert.strictEqual(a.corpus, 'x.md');
});

test('--threshold parses and clamps to [0,1]', () => {
  assert.strictEqual(parseArgs(['s', '--threshold', '0.34']).threshold, 0.34);
  assert.strictEqual(parseArgs(['s', '--threshold', '9']).threshold, 0.5);
  assert.strictEqual(parseArgs(['s', '--threshold', 'nope']).threshold, 0.5);
});

test('--runs parses and rejects non-positive', () => {
  assert.strictEqual(parseArgs(['s', '--runs', '5']).runs, 5);
  assert.strictEqual(parseArgs(['s', '--runs', '0']).runs, 3);
});

test('--local and --host select the local backend; default is null (Claude)', () => {
  const def = parseArgs(['s']);
  assert.strictEqual(def.local, null);
  const loc = parseArgs(['s', '--local', 'qwen3:32b', '--host', 'http://h:1']);
  assert.strictEqual(loc.local, 'qwen3:32b');
  assert.strictEqual(loc.host, 'http://h:1');
});

console.log('resolveSkillPath');

function withTempTree(fn) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sfw-test-')));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function writeFixture(dir, rel, body = 'x') {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

test('resolves a skill at .claude/skills/<name>/SKILL.md', () => {
  withTempTree((dir) => {
    writeFixture(dir, '.claude/skills/foo/SKILL.md');
    assert.strictEqual(resolveSkillPath('foo', dir), path.join(dir, '.claude/skills/foo/SKILL.md'));
  });
});

test('resolves a nested command at .claude/commands/**/<name>.md', () => {
  withTempTree((dir) => {
    writeFixture(dir, '.claude/commands/sub/bar.md');
    assert.strictEqual(resolveSkillPath('bar', dir), path.join(dir, '.claude/commands/sub/bar.md'));
  });
});

test('prefers the skill over a same-named command', () => {
  withTempTree((dir) => {
    writeFixture(dir, '.claude/skills/baz/SKILL.md');
    writeFixture(dir, '.claude/commands/baz.md');
    assert.strictEqual(resolveSkillPath('baz', dir), path.join(dir, '.claude/skills/baz/SKILL.md'));
  });
});

test('returns null for an unknown name', () => {
  withTempTree((dir) => {
    assert.strictEqual(resolveSkillPath('nope', dir), null);
  });
});

console.log('calibration corpus integrity');

test('every name in the real calibration corpus resolves to a skill or command', () => {
  const root = path.resolve(__dirname, '..', '..');
  const corpusPath = path.join(root, '.claude/research/skill-faithfulness-evals/calibration.md');
  const cases = parseCorpus(fs.readFileSync(corpusPath, 'utf8'));
  assert.ok(cases.length > 0, 'corpus parses to at least one case');
  for (const c of cases) {
    assert.ok(resolveSkillPath(c.name, root), `corpus case "${c.name}" does not resolve to a skill or command`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
