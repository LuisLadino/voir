#!/usr/bin/env node

/**
 * check-recent-ships.cjs tests.
 *
 * The hook surfaces two classes of ship problems at SessionStart:
 *   1. Recently-merged PRs that shipped with FAILURE/CANCELLED checks
 *   2. Open PRs auto-merging but stuck BEHIND base, waiting for heal
 *
 * Both are ship-correctness paths. Decisions are exported and the I/O
 * (`run`, acknowledged-set read/write, `log`) is injected here, so every
 * branch runs without invoking gh / git / the file system.
 *
 * Run: node .claude/hooks/lifecycle/check-recent-ships.test.cjs
 */

const {
  checkBrokenRecent,
  findStrandedBehind,
  healStrandedBehind,
  reportBroken,
  reportStranded,
  isBrokenRecent,
  selectBroken,
  isStrandedBehind,
  selectStranded,
  selectFreshBroken,
  formatBrokenReport,
  formatStrandedReport,
  BROKEN_RECENT_WINDOW_MS,
  MAX_HEALS_PER_SESSION,
} = require('./check-recent-ships.cjs');

let pass = 0;
let fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else    { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

const NOW = 1_700_000_000_000;
const cutoff = NOW - BROKEN_RECENT_WINDOW_MS;
const within = new Date(NOW - 1000).toISOString();
const stale  = new Date(NOW - 25 * 60 * 60 * 1000).toISOString();

// ── isBrokenRecent / selectBroken ──
report('isBrokenRecent: merged within window with FAILURE -> true',
  isBrokenRecent({ mergedAt: within, statusCheckRollup: [{ conclusion: 'FAILURE' }] }, cutoff) === true);
report('isBrokenRecent: CANCELLED also counts',
  isBrokenRecent({ mergedAt: within, statusCheckRollup: [{ conclusion: 'CANCELLED' }] }, cutoff) === true);
report('isBrokenRecent: SUCCESS only -> false',
  isBrokenRecent({ mergedAt: within, statusCheckRollup: [{ conclusion: 'SUCCESS' }] }, cutoff) === false);
report('isBrokenRecent: outside window -> false',
  isBrokenRecent({ mergedAt: stale, statusCheckRollup: [{ conclusion: 'FAILURE' }] }, cutoff) === false);
report('isBrokenRecent: no mergedAt -> false',
  isBrokenRecent({ statusCheckRollup: [{ conclusion: 'FAILURE' }] }, cutoff) === false);
report('isBrokenRecent: rollup missing -> false',
  isBrokenRecent({ mergedAt: within }, cutoff) === false);
report('isBrokenRecent: empty rollup -> false',
  isBrokenRecent({ mergedAt: within, statusCheckRollup: [] }, cutoff) === false);
report('isBrokenRecent: null pr -> false',
  isBrokenRecent(null, cutoff) === false);

const prs = [
  { number: 1, title: 'broken recent',  mergedAt: within, statusCheckRollup: [{ conclusion: 'FAILURE' }] },
  { number: 2, title: 'good',           mergedAt: within, statusCheckRollup: [{ conclusion: 'SUCCESS' }] },
  { number: 3, title: 'broken old',     mergedAt: stale,  statusCheckRollup: [{ conclusion: 'FAILURE' }] },
  { number: 4, title: 'cancelled',      mergedAt: within, statusCheckRollup: [{ conclusion: 'CANCELLED' }] },
];
report('selectBroken: picks FAILURE/CANCELLED in window',
  JSON.stringify(selectBroken(prs, cutoff).map(p => p.number)) === '[1,4]');
report('selectBroken: non-array -> []',
  JSON.stringify(selectBroken(null, cutoff)) === '[]');

// ── isStrandedBehind / selectStranded ──
report('isStrandedBehind: auto-merge + BEHIND -> true',
  isStrandedBehind({ autoMergeRequest: { enabledAt: 'x' }, mergeStateStatus: 'BEHIND' }) === true);
report('isStrandedBehind: no auto-merge -> false',
  isStrandedBehind({ autoMergeRequest: null, mergeStateStatus: 'BEHIND' }) === false);
report('isStrandedBehind: not BEHIND -> false',
  isStrandedBehind({ autoMergeRequest: { x: 1 }, mergeStateStatus: 'CLEAN' }) === false);
report('isStrandedBehind: null -> false',
  isStrandedBehind(null) === false);

const openPrs = [
  { number: 10, title: 'stranded',     autoMergeRequest: { x: 1 }, mergeStateStatus: 'BEHIND' },
  { number: 11, title: 'no automerge', autoMergeRequest: null,     mergeStateStatus: 'BEHIND' },
  { number: 12, title: 'clean',        autoMergeRequest: { x: 1 }, mergeStateStatus: 'CLEAN' },
  { number: 13, title: 'stranded2',    autoMergeRequest: { x: 1 }, mergeStateStatus: 'BEHIND' },
];
report('selectStranded: filters to auto-merge + BEHIND',
  JSON.stringify(selectStranded(openPrs).map(p => p.number)) === '[10,13]');

// ── selectFreshBroken ──
report('selectFreshBroken: filters acknowledged set',
  JSON.stringify(selectFreshBroken([{ number: 1 }, { number: 2 }, { number: 3 }], new Set(['2'])).map(p => p.number))
  === '[1,3]');
report('selectFreshBroken: accepts array as ack set',
  JSON.stringify(selectFreshBroken([{ number: 1 }, { number: 2 }], ['1']).map(p => p.number))
  === '[2]');
report('selectFreshBroken: empty ack returns all',
  JSON.stringify(selectFreshBroken([{ number: 1 }], new Set()).map(p => p.number))
  === '[1]');

// ── formatBrokenReport ──
{
  const text = formatBrokenReport([
    { number: 5, title: 'fix login' },
    { number: 7, title: 'add caching' }
  ]);
  report('formatBrokenReport: includes count and PRs',
    text.includes('[SHIP CATCH-UP] 2 PRs merged')
    && text.includes('PR #5: fix login')
    && text.includes('PR #7: add caching')
    && text.includes('shipped broken'),
    text);
  report('formatBrokenReport: singular grammar',
    formatBrokenReport([{ number: 5, title: 'x' }]).includes('1 PR merged'));
  report('formatBrokenReport: empty -> empty string',
    formatBrokenReport([]) === '');
}

// ── formatStrandedReport ──
{
  const text = formatStrandedReport({
    updated: [{ number: 10, title: 'fix' }],
    failed: [{ number: 11, title: 'conflict' }],
    skipped: 2
  });
  report('formatStrandedReport: includes updated, failed, skipped',
    text.includes('Updated 1 stranded PR')
    && text.includes('PR #10: fix')
    && text.includes('Failed to update 1 PR')
    && text.includes('PR #11: conflict')
    && text.includes('Skipped 2 additional BEHIND'),
    text);
  report('formatStrandedReport: empty outcome -> empty string',
    formatStrandedReport({ updated: [], failed: [], skipped: 0 }) === '');
  report('formatStrandedReport: only updated',
    formatStrandedReport({ updated: [{ number: 1, title: 't' }], failed: [], skipped: 0 })
      .includes('Updated 1 stranded PR'));
  report('formatStrandedReport: only failed',
    formatStrandedReport({ updated: [], failed: [{ number: 1, title: 't' }], skipped: 0 })
      .includes('Failed to update 1 PR'));
  report('formatStrandedReport: skipped only -> empty string (nothing happened)',
    formatStrandedReport({ updated: [], failed: [], skipped: 5 }) === '');
}

// ── checkBrokenRecent (with injected run + now) ──
{
  let calls = [];
  const run = (cmd) => {
    calls.push(cmd);
    if (cmd.startsWith('git log')) return 'abc1234 fix things';
    if (cmd.startsWith('gh pr list')) return JSON.stringify([prs[0], prs[1]]);
    return null;
  };
  const out = checkBrokenRecent({ run, now: () => NOW });
  report('checkBrokenRecent: returns broken PRs only',
    out.length === 1 && out[0].number === 1, JSON.stringify(out));
  report('checkBrokenRecent: called git log and gh pr list',
    calls.length === 2 && /git log/.test(calls[0]) && /gh pr list/.test(calls[1]));
}
{
  const run = (cmd) => cmd.startsWith('git log') ? null : 'should not reach';
  report('checkBrokenRecent: no recent commit -> [] (no network)',
    JSON.stringify(checkBrokenRecent({ run, now: () => NOW })) === '[]');
}
{
  const run = (cmd) => cmd.startsWith('git log') ? 'abc' : null;
  report('checkBrokenRecent: gh failure -> []',
    JSON.stringify(checkBrokenRecent({ run, now: () => NOW })) === '[]');
}
{
  const run = (cmd) => cmd.startsWith('git log') ? 'abc' : 'not json';
  report('checkBrokenRecent: bad JSON from gh -> []',
    JSON.stringify(checkBrokenRecent({ run, now: () => NOW })) === '[]');
}

// ── findStrandedBehind (with injected run) ──
{
  const run = (cmd) => {
    if (cmd.startsWith('git log')) return 'abc';
    if (cmd.startsWith('gh pr list')) return JSON.stringify(openPrs);
    return null;
  };
  const out = findStrandedBehind({ run });
  report('findStrandedBehind: filters to BEHIND auto-merge PRs',
    JSON.stringify(out.map(p => p.number)) === '[10,13]', JSON.stringify(out));
}
{
  const run = (cmd) => cmd.startsWith('git log') ? null : 'unreached';
  report('findStrandedBehind: no recent commit -> []',
    JSON.stringify(findStrandedBehind({ run })) === '[]');
}

// ── healStrandedBehind (with injected run) ──
{
  const targets = [
    { number: 10, title: 't10' },
    { number: 11, title: 't11' },
    { number: 12, title: 't12' },
  ];
  const run = (cmd) => cmd.includes('11') ? null : 'ok';
  const out = healStrandedBehind(targets, { run });
  report('healStrandedBehind: succeeds on ok, fails on null',
    JSON.stringify(out.updated.map(p => p.number)) === '[10,12]'
    && JSON.stringify(out.failed.map(p => p.number)) === '[11]'
    && out.skipped === 0, JSON.stringify(out));
}
{
  const targets = Array.from({ length: 7 }, (_, i) => ({ number: i + 1, title: `t${i + 1}` }));
  const run = () => 'ok';
  const out = healStrandedBehind(targets, { run, cap: MAX_HEALS_PER_SESSION });
  report('healStrandedBehind: respects cap',
    out.updated.length === MAX_HEALS_PER_SESSION && out.skipped === (7 - MAX_HEALS_PER_SESSION),
    JSON.stringify({ updated: out.updated.length, skipped: out.skipped }));
}
{
  let calls = [];
  const run = (cmd) => { calls.push(cmd); return 'ok'; };
  const out = healStrandedBehind(
    [{ number: '7; rm -rf /', title: 'malicious' }, { number: 3.14, title: 'float' }, { number: -1, title: 'neg' }],
    { run }
  );
  report('healStrandedBehind: rejects non-integer pr.number without invoking run (shell-injection guard)',
    out.updated.length === 0 && out.failed.length === 3 && calls.length === 0,
    JSON.stringify({ updated: out.updated, failed: out.failed.map(p => p.number), calls }));
}

// ── reportBroken (uses injected read/write/log) ──
{
  const logged = [];
  let written = null;
  reportBroken(
    [{ number: 1, title: 'fix' }],
    {
      read: () => new Set(),
      write: (set) => { written = [...set]; },
      log: (s) => logged.push(s),
    }
  );
  report('reportBroken: logs report when fresh',
    logged.length === 1 && logged[0].includes('PR #1: fix'));
  report('reportBroken: writes ack set',
    Array.isArray(written) && written.includes('1'));
}
{
  const logged = [];
  let written = null;
  reportBroken(
    [{ number: 1, title: 'fix' }],
    {
      read: () => new Set(['1']),
      write: (set) => { written = [...set]; },
      log: (s) => logged.push(s),
    }
  );
  report('reportBroken: silent when all acknowledged',
    logged.length === 0 && written === null);
}
{
  const logged = [];
  reportBroken([], { read: () => new Set(), write: () => {}, log: (s) => logged.push(s) });
  report('reportBroken: silent on empty broken list',
    logged.length === 0);
}

// ── reportStranded ──
{
  const logged = [];
  reportStranded(
    { updated: [{ number: 10, title: 't' }], failed: [], skipped: 0 },
    { log: (s) => logged.push(s) }
  );
  report('reportStranded: logs when updates occurred',
    logged.length === 1 && logged[0].includes('Updated 1 stranded PR'));
}
{
  const logged = [];
  reportStranded(
    { updated: [], failed: [], skipped: 0 },
    { log: (s) => logged.push(s) }
  );
  report('reportStranded: silent when nothing happened',
    logged.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
