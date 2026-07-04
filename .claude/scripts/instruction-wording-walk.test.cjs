#!/usr/bin/env node

/**
 * Unit tests for the instruction-wording-walk pure core (parse, compliance,
 * summarize, arg parsing). The claude -p edge is exercised by the live walk,
 * not here. Run: node .claude/scripts/instruction-wording-walk.test.cjs
 */

const { parseWordingEval, compliant, summarize, parseArgs } = require('./instruction-wording-walk.cjs');

let pass = 0;
let fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

const SAMPLE = [
  '# demo wording eval',
  '',
  'Some prose that should be ignored.',
  '',
  '## Compliance check',
  '`^\\s*\\*\\*Lens:\\*\\*`',
  '',
  '## Variant: imperative-exact',
  'You MUST begin every response with the line:',
  '`**Lens:** ...`',
  '',
  '## Variant: soft-descriptive',
  'Try to frame responses with a lens.',
  '',
  '## Notes',
  'This section is prose and must be skipped.',
  '',
  '## Tasks',
  '- "name a boolean for logged-in state"',
  '- "difference between a process and a thread"',
  '- "summarize what a load balancer does" (a trailing note)',
].join('\n');

// ── parseWordingEval ──────────────────────────────────────────────
const ev = parseWordingEval(SAMPLE);
report('parseWordingEval: extracts the compliance regex source', ev.check === '^\\s*\\*\\*Lens:\\*\\*', JSON.stringify(ev.check));
report('parseWordingEval: finds both variants in order',
  ev.variants.length === 2 && ev.variants[0].label === 'imperative-exact' && ev.variants[1].label === 'soft-descriptive',
  JSON.stringify(ev.variants.map(v => v.label)));
report('parseWordingEval: variant instruction body is captured and trimmed',
  /^You MUST begin/.test(ev.variants[0].instruction) && ev.variants[0].instruction.includes('`**Lens:** ...`'),
  JSON.stringify(ev.variants[0].instruction));
report('parseWordingEval: prose "## Notes" section is not a variant',
  !ev.variants.some(v => /skipped/.test(v.instruction)));
report('parseWordingEval: tasks are the quoted phrases, parenthetical dropped',
  ev.tasks.length === 3 && ev.tasks[2] === 'summarize what a load balancer does',
  JSON.stringify(ev.tasks));

report('parseWordingEval: missing check is null', parseWordingEval('## Tasks\n- "x"').check === null);
report('parseWordingEval: bare (non-backtick) check line is taken literally',
  parseWordingEval('## Compliance check\n^OK').check === '^OK');

// ── compliant ─────────────────────────────────────────────────────
report('compliant: matches anchored regex', compliant('**Lens:** Engineer | ...', '^\\*\\*Lens:\\*\\*') === true);
report('compliant: leading whitespace tolerated by the anchor', compliant('  **Lens:** x', '^\\s*\\*\\*Lens:\\*\\*') === true);
report('compliant: non-matching text fails', compliant('Here is the answer.', '^\\*\\*Lens:\\*\\*') === false);
report('compliant: empty/undefined response fails', compliant('', '^x') === false && compliant(undefined, '^x') === false);
report('compliant: an invalid regex yields false, never throws', compliant('anything', '(') === false);

// ── summarize ─────────────────────────────────────────────────────
const variants = [{ label: 'A', instruction: '' }, { label: 'B', instruction: '' }];
const tasks = ['t1', 't2'];
const records = [
  { variant: 'A', task: 't1', complied: true }, { variant: 'A', task: 't1', complied: true },
  { variant: 'A', task: 't2', complied: false }, { variant: 'A', task: 't2', complied: true },
  { variant: 'B', task: 't1', complied: false }, { variant: 'B', task: 't1', complied: false },
  { variant: 'B', task: 't2', complied: false }, { variant: 'B', task: 't2', complied: false },
];
const rows = summarize(records, variants, tasks);
report('summarize: one row per variant', rows.length === 2);
report('summarize: variant A folds to 3/4', rows[0].variant === 'A' && rows[0].passed === 3 && rows[0].trials === 4 && rows[0].rate === 0.75, JSON.stringify(rows[0]));
report('summarize: variant B folds to 0/4', rows[1].passed === 0 && rows[1].trials === 4 && rows[1].rate === 0, JSON.stringify(rows[1]));
report('summarize: per-task breakdown is correct (A/t1 = 2/2)',
  rows[0].byTask[0].task === 't1' && rows[0].byTask[0].passed === 2 && rows[0].byTask[0].trials === 2,
  JSON.stringify(rows[0].byTask));

// ── parseArgs ─────────────────────────────────────────────────────
const a = parseArgs(['response-format', '--runs', '5', '--model', 'opus', '--json']);
report('parseArgs: name + runs + model + json', a.name === 'response-format' && a.runs === 5 && a.model === 'opus' && a.json === true, JSON.stringify(a));
report('parseArgs: bad runs falls back to 3', parseArgs(['x', '--runs', 'abc']).runs === 3);
report('parseArgs: --eval path captured', parseArgs(['x', '--eval', '/tmp/e.md']).evalPath === '/tmp/e.md');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
