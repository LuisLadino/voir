#!/usr/bin/env node

/**
 * watch-ship.cjs tests.
 *
 * The decision logic is pure and exported; the poll loops take their I/O
 * (fetchPrState, healBehind, fetchStatus, sleep) as injected dependencies,
 * so every CI-race and deploy-probe scenario runs here with scripted inputs
 * and no live PR. This is the regression coverage #503 asked for — the
 * merge-state machine had four production-only bugs (#462, #464, #466, #478).
 *
 * Run: node .claude/hooks/lifecycle/watch-ship.test.cjs
 */

const {
  isValidPrNumber,
  buildPrLabel,
  parseDeployConfig,
  validateDeployConfig,
  classifyCiResult,
  classifyMergeState,
  classifyDeployStatus,
  failingRequiredChecks,
  pendingRequiredChecks,
  pollMergeState,
  probeDeploy
} = require('./watch-ship.cjs');

let pass = 0;
let fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else    { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

const noSleep = async () => {};
// fetchPrState stub: returns each reading in turn, repeating the last.
const scripted = (readings) => { let i = 0; return () => readings[Math.min(i++, readings.length - 1)]; };

(async () => {
  // ── isValidPrNumber ──
  report('isValidPrNumber: numeric string', isValidPrNumber('42') === true);
  report('isValidPrNumber: non-numeric', isValidPrNumber('abc') === false);
  report('isValidPrNumber: flag injection', isValidPrNumber('-R victim/repo') === false);
  report('isValidPrNumber: empty', isValidPrNumber('') === false);
  report('isValidPrNumber: embedded space', isValidPrNumber('4 2') === false);

  // ── buildPrLabel ──
  report('buildPrLabel: repo + title',
    buildPrLabel({ repo: 'claude-kit', title: 'fix the thing', prNumber: '5' }) === 'claude-kit PR #5 (fix the thing)');
  report('buildPrLabel: title only, no repo',
    buildPrLabel({ repo: '', title: 'fix the thing', prNumber: '5' }) === 'PR #5 (fix the thing)');
  report('buildPrLabel: repo only, no title',
    buildPrLabel({ repo: 'claude-kit', title: '', prNumber: '5' }) === 'claude-kit PR #5');
  report('buildPrLabel: bare fallback',
    buildPrLabel({ repo: '', title: '', prNumber: '5' }) === 'PR #5');
  report('buildPrLabel: title capped at 50',
    buildPrLabel({ repo: 'r', title: 'x'.repeat(60), prNumber: '5' }) === `r PR #5 (${'x'.repeat(50)}...)`);

  // ── parseDeployConfig ──
  report('parseDeployConfig: block with quoted url',
    JSON.stringify(parseDeployConfig('deploy:\n  url: "https://x.com"\n')) === JSON.stringify({ blockPresent: true, url: 'https://x.com' }));
  report('parseDeployConfig: block present, no url',
    JSON.stringify(parseDeployConfig('deploy:\n  foo: bar\n')) === JSON.stringify({ blockPresent: true, url: '' }));
  report('parseDeployConfig: no deploy block',
    JSON.stringify(parseDeployConfig('other:\n  url: https://x.com\n')) === JSON.stringify({ blockPresent: false, url: '' }));
  report('parseDeployConfig: url scoped to the deploy block',
    parseDeployConfig('deploy:\n  url: https://x.com\nnext:\n  url: https://y.com\n').url === 'https://x.com');
  report('parseDeployConfig: trailing whitespace stripped',
    parseDeployConfig('deploy:\n  url: https://x.com   \n').url === 'https://x.com');

  // ── validateDeployConfig ──
  report('validateDeployConfig: block + no url is an error',
    validateDeployConfig({ blockPresent: true, url: '' }).ok === false);
  report('validateDeployConfig: no block is ok',
    validateDeployConfig({ blockPresent: false, url: '' }).ok === true);
  report('validateDeployConfig: good https url is ok',
    validateDeployConfig({ blockPresent: true, url: 'https://x.com' }).ok === true);
  report('validateDeployConfig: bad scheme is an error',
    validateDeployConfig({ blockPresent: true, url: 'file:///etc/passwd' }).ok === false);
  report('validateDeployConfig: whitespace in url is an error',
    validateDeployConfig({ blockPresent: true, url: 'https://x.com /a' }).ok === false);

  // ── classifyCiResult ──
  report('classifyCiResult: checks ok -> proceed',
    classifyCiResult(true, '').action === 'proceed');
  report('classifyCiResult: checks fail + CLOSED -> closed',
    classifyCiResult(false, 'CLOSED').action === 'closed');
  report('classifyCiResult: checks fail + OPEN -> proceed (warn-only or race)',
    classifyCiResult(false, 'OPEN').action === 'proceed');
  report('classifyCiResult: checks fail + MERGED -> proceed (won the race)',
    classifyCiResult(false, 'MERGED').action === 'proceed');

  // ── classifyMergeState ──
  report('classifyMergeState: MERGED',
    classifyMergeState({ state: 'MERGED', mergeState: 'CLEAN' }).action === 'merged');
  report('classifyMergeState: CLOSED',
    classifyMergeState({ state: 'CLOSED', mergeState: '' }).action === 'closed');
  report('classifyMergeState: DIRTY',
    classifyMergeState({ state: 'OPEN', mergeState: 'DIRTY' }).action === 'dirty');
  report('classifyMergeState: BEHIND under cap -> heal',
    classifyMergeState({ state: 'OPEN', mergeState: 'BEHIND' }, { behindFixes: 2 }).action === 'heal-behind');
  report('classifyMergeState: BEHIND at cap -> exhausted',
    classifyMergeState({ state: 'OPEN', mergeState: 'BEHIND' }, { behindFixes: 3 }).action === 'behind-exhausted');
  report('classifyMergeState: BLOCKED 1st read -> continue (no required info)',
    classifyMergeState({ state: 'OPEN', mergeState: 'BLOCKED' }, { blockedReads: 0 }).action === 'continue');
  report('classifyMergeState: BLOCKED 3rd read -> blocked (no required info)',
    classifyMergeState({ state: 'OPEN', mergeState: 'BLOCKED' }, { blockedReads: 2 }).action === 'blocked');
  report('classifyMergeState: clean state resets blockedReads',
    classifyMergeState({ state: 'OPEN', mergeState: 'CLEAN' }, { blockedReads: 2 }).blockedReads === 0);

  // BLOCKED awareness of required checks (#576). The bug: non-required check
  // fails while required checks are still pending -> 3-read terminal kicks in
  // before required CI finishes -> false-positive "merge blocked" alert.
  const requiredContexts = ['checks', 'e2e'];
  const lighthouseFailedE2ePending = [
    { name: 'checks',     conclusion: 'SUCCESS' },
    { name: 'e2e',        conclusion: '',         status: 'IN_PROGRESS' },
    { name: 'lighthouse', conclusion: 'FAILURE' }
  ];
  report('classifyMergeState: BLOCKED + non-required failed, required pending -> continue (#576)',
    classifyMergeState(
      { state: 'OPEN', mergeState: 'BLOCKED', statusCheckRollup: lighthouseFailedE2ePending, requiredContexts },
      { blockedReads: 2 }
    ).action === 'continue');

  const requiredFailed = [
    { name: 'checks', conclusion: 'SUCCESS' },
    { name: 'e2e',    conclusion: 'FAILURE' }
  ];
  const blockedReal = classifyMergeState(
    { state: 'OPEN', mergeState: 'BLOCKED', statusCheckRollup: requiredFailed, requiredContexts },
    { blockedReads: 0 }
  );
  report('classifyMergeState: BLOCKED + required failed -> blocked immediately (#576)',
    blockedReal.action === 'blocked');
  report('classifyMergeState: blocked outcome lists failing required checks (#576)',
    Array.isArray(blockedReal.failingRequired) && blockedReal.failingRequired.includes('e2e'));

  // All required passed, BLOCKED for some other reason (reviews, admin). The
  // 3-consecutive heuristic still terminates so the alert doesn't hang.
  const requiredAllPassed = [
    { name: 'checks', conclusion: 'SUCCESS' },
    { name: 'e2e',    conclusion: 'SUCCESS' }
  ];
  report('classifyMergeState: BLOCKED + required passed, 1st read -> continue (admin/review)',
    classifyMergeState(
      { state: 'OPEN', mergeState: 'BLOCKED', statusCheckRollup: requiredAllPassed, requiredContexts },
      { blockedReads: 0 }
    ).action === 'continue');
  report('classifyMergeState: BLOCKED + required passed, 3rd read -> blocked (admin/review)',
    classifyMergeState(
      { state: 'OPEN', mergeState: 'BLOCKED', statusCheckRollup: requiredAllPassed, requiredContexts },
      { blockedReads: 2 }
    ).action === 'blocked');

  // ── failingRequiredChecks ──
  report('failingRequiredChecks: required FAILURE detected',
    JSON.stringify(failingRequiredChecks(requiredFailed, requiredContexts)) === JSON.stringify(['e2e']));
  report('failingRequiredChecks: non-required FAILURE ignored',
    failingRequiredChecks(lighthouseFailedE2ePending, requiredContexts).length === 0);
  report('failingRequiredChecks: StatusContext shape (state field)',
    JSON.stringify(failingRequiredChecks([{ context: 'e2e', state: 'FAILURE' }], requiredContexts)) === JSON.stringify(['e2e']));
  report('failingRequiredChecks: empty requiredContexts -> []',
    failingRequiredChecks(requiredFailed, []).length === 0);
  report('failingRequiredChecks: TIMED_OUT counts as failed',
    failingRequiredChecks([{ name: 'e2e', conclusion: 'TIMED_OUT' }], requiredContexts).includes('e2e'));

  // ── pendingRequiredChecks ──
  report('pendingRequiredChecks: in-progress required is pending',
    pendingRequiredChecks(lighthouseFailedE2ePending, requiredContexts).includes('e2e'));
  report('pendingRequiredChecks: missing-from-rollup required is pending',
    pendingRequiredChecks([{ name: 'checks', conclusion: 'SUCCESS' }], requiredContexts).includes('e2e'));
  report('pendingRequiredChecks: all required terminal -> none pending',
    pendingRequiredChecks(requiredAllPassed, requiredContexts).length === 0);
  report('pendingRequiredChecks: failed required is not pending',
    pendingRequiredChecks(requiredFailed, requiredContexts).length === 0);
  report('pendingRequiredChecks: empty requiredContexts -> []',
    pendingRequiredChecks(lighthouseFailedE2ePending, []).length === 0);

  // ── classifyDeployStatus ──
  report('classifyDeployStatus: 200 reachable', classifyDeployStatus('200') === true);
  report('classifyDeployStatus: 204 reachable', classifyDeployStatus('204') === true);
  report('classifyDeployStatus: 301 not reachable', classifyDeployStatus('301') === false);
  report('classifyDeployStatus: 500 not reachable', classifyDeployStatus('500') === false);
  report('classifyDeployStatus: empty not reachable', classifyDeployStatus('') === false);

  // ── pollMergeState ── happy path and every CI-race scenario
  let r = await pollMergeState({
    fetchPrState: scripted([{ state: 'OPEN', mergeState: 'CLEAN' }, { state: 'MERGED', mergeState: 'CLEAN' }]),
    healBehind: async () => ({ ok: true }), sleep: noSleep
  });
  report('pollMergeState: open then merged -> merged', r.outcome === 'merged', JSON.stringify(r));

  r = await pollMergeState({
    fetchPrState: scripted([{ state: 'CLOSED', mergeState: '' }]),
    healBehind: async () => ({ ok: true }), sleep: noSleep
  });
  report('pollMergeState: closed -> closed', r.outcome === 'closed', JSON.stringify(r));

  r = await pollMergeState({
    fetchPrState: scripted([{ state: 'OPEN', mergeState: 'DIRTY' }]),
    healBehind: async () => ({ ok: true }), sleep: noSleep
  });
  report('pollMergeState: dirty -> dirty', r.outcome === 'dirty', JSON.stringify(r));

  r = await pollMergeState({
    fetchPrState: scripted([{ state: 'OPEN', mergeState: 'BEHIND' }, { state: 'MERGED', mergeState: 'CLEAN' }]),
    healBehind: async () => ({ ok: true }), sleep: noSleep
  });
  report('pollMergeState: behind then merged -> merged (#462 heal)', r.outcome === 'merged', JSON.stringify(r));

  r = await pollMergeState({
    fetchPrState: scripted([{ state: 'OPEN', mergeState: 'BEHIND' }]),
    healBehind: async () => ({ ok: true }), sleep: noSleep
  });
  report('pollMergeState: perpetually behind -> behind-exhausted', r.outcome === 'behind-exhausted', JSON.stringify(r));

  r = await pollMergeState({
    fetchPrState: scripted([{ state: 'OPEN', mergeState: 'BEHIND' }]),
    healBehind: async () => ({ ok: false, error: 'update-branch failed' }), sleep: noSleep
  });
  report('pollMergeState: heal failure -> heal-failed',
    r.outcome === 'heal-failed' && r.detail === 'update-branch failed', JSON.stringify(r));

  r = await pollMergeState({
    fetchPrState: scripted([{ state: 'OPEN', mergeState: 'BLOCKED' }]),
    healBehind: async () => ({ ok: true }), sleep: noSleep
  });
  report('pollMergeState: blocked x3 -> blocked', r.outcome === 'blocked', JSON.stringify(r));

  r = await pollMergeState({
    fetchPrState: scripted([
      { state: 'OPEN', mergeState: 'BLOCKED' },
      { state: 'OPEN', mergeState: 'BLOCKED' },
      { state: 'MERGED', mergeState: 'CLEAN' }
    ]),
    healBehind: async () => ({ ok: true }), sleep: noSleep
  });
  report('pollMergeState: transient blocked then merged -> merged (#466)', r.outcome === 'merged', JSON.stringify(r));

  // PR #392 reproduction (#576). Lighthouse (non-required) fails while e2e
  // (required) is still pending; mergeStateStatus stays BLOCKED across all 3
  // legacy reads, then e2e succeeds and the PR auto-merges. Pre-fix this
  // would terminate as 'blocked' before the merge landed.
  const requiredFor576 = ['checks', 'e2e'];
  const pr392Rollup = [
    { name: 'checks',     conclusion: 'SUCCESS' },
    { name: 'e2e',        conclusion: '', status: 'IN_PROGRESS' },
    { name: 'lighthouse', conclusion: 'FAILURE' }
  ];
  const pr392RollupMerged = [
    { name: 'checks',     conclusion: 'SUCCESS' },
    { name: 'e2e',        conclusion: 'SUCCESS' },
    { name: 'lighthouse', conclusion: 'FAILURE' }
  ];
  r = await pollMergeState({
    fetchPrState: scripted([
      { state: 'OPEN',   mergeState: 'BLOCKED', statusCheckRollup: pr392Rollup,       requiredContexts: requiredFor576 },
      { state: 'OPEN',   mergeState: 'BLOCKED', statusCheckRollup: pr392Rollup,       requiredContexts: requiredFor576 },
      { state: 'OPEN',   mergeState: 'BLOCKED', statusCheckRollup: pr392Rollup,       requiredContexts: requiredFor576 },
      { state: 'OPEN',   mergeState: 'BLOCKED', statusCheckRollup: pr392Rollup,       requiredContexts: requiredFor576 },
      { state: 'MERGED', mergeState: 'CLEAN',   statusCheckRollup: pr392RollupMerged, requiredContexts: requiredFor576 }
    ]),
    healBehind: async () => ({ ok: true }), sleep: noSleep
  });
  report('pollMergeState: PR #392 repro — non-required failed, required pending then merged (#576)',
    r.outcome === 'merged', JSON.stringify(r));

  // Required check FAILS — terminal immediately with the failing check name.
  const requiredFailedRollup = [
    { name: 'checks', conclusion: 'SUCCESS' },
    { name: 'e2e',    conclusion: 'FAILURE' }
  ];
  r = await pollMergeState({
    fetchPrState: scripted([
      { state: 'OPEN', mergeState: 'BLOCKED', statusCheckRollup: requiredFailedRollup, requiredContexts: requiredFor576 }
    ]),
    healBehind: async () => ({ ok: true }), sleep: noSleep
  });
  report('pollMergeState: required FAILURE -> blocked terminal (#576)',
    r.outcome === 'blocked' && Array.isArray(r.failingRequired) && r.failingRequired.includes('e2e'),
    JSON.stringify(r));

  r = await pollMergeState({
    fetchPrState: scripted([{ state: 'OPEN', mergeState: 'CLEAN' }]),
    healBehind: async () => ({ ok: true }), sleep: noSleep, maxIterations: 5
  });
  report('pollMergeState: never merges -> timeout', r.outcome === 'timeout', JSON.stringify(r));

  // ── probeDeploy ──
  let p = await probeDeploy({ fetchStatus: () => '200', sleep: noSleep });
  report('probeDeploy: 200 -> reachable', p.reachable === true && p.lastStatus === '200', JSON.stringify(p));

  p = await probeDeploy({ fetchStatus: () => '500', sleep: noSleep, attempts: 3 });
  report('probeDeploy: always 500 -> not reachable', p.reachable === false && p.lastStatus === '500', JSON.stringify(p));

  p = await probeDeploy({ fetchStatus: scripted(['', '', '200']), sleep: noSleep });
  report('probeDeploy: reachable on a later attempt', p.reachable === true, JSON.stringify(p));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
