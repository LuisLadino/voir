#!/usr/bin/env node

/**
 * Deploy Drift Warning Hook
 *
 * Event: SessionStart
 * Purpose: Warn when the deploy/main worktree is behind origin or dirty, so a
 *   scheduled runtime won't silently run stale code. Interactive discoverability
 *   only — SessionStart is context-only and cannot block. The runtime guarantee
 *   is the deploy-guard CLI (.claude/scripts/deploy-guard.cjs); this just makes
 *   the drift visible the moment someone opens the deploy worktree. See #722 and
 *   specs/kit/session-isolation.md (Layer 5).
 *
 * Local-only by design: it reads the already-fetched origin ref and never
 * fetches, so it adds no per-session network cost. It activates only when HEAD
 * is on the deploy branch, so Conductor feature-branch sessions pay almost
 * nothing. The authoritative fetch happens in the guard, where it matters.
 *
 * Deploy branch defaults to main; override the local branch with
 * CLAUDE_KIT_DEPLOY_BRANCH and the tracked remote ref with
 * CLAUDE_KIT_DEPLOY_REMOTE_REF (default origin/<branch>, decoupled per #726).
 * Silence with CLAUDE_KIT_NO_DEPLOY_DRIFT_WARN=1.
 */

const fs = require('fs');
const path = require('path');

const {
  classify,
  gitFacts,
  currentBranch,
  isSafeBranch,
  isSafeRemoteRef,
  defaultRemoteRef,
  DEFAULT_DEPLOY_BRANCH,
} = require('../lib/deploy-currency.cjs');

function deployBranchName() {
  const env = process.env.CLAUDE_KIT_DEPLOY_BRANCH;
  return env && isSafeBranch(env) ? env : DEFAULT_DEPLOY_BRANCH;
}

function remoteRefName(deployBranch) {
  const env = process.env.CLAUDE_KIT_DEPLOY_REMOTE_REF;
  return env && isSafeRemoteRef(env) ? env : defaultRemoteRef(deployBranch);
}

// Returns a verdict to warn on, or null when nothing is worth saying.
function evaluate(cwd, deployBranch, remoteRef = defaultRemoteRef(deployBranch)) {
  if (currentBranch(cwd) !== deployBranch) return null; // off the deploy branch: not our concern
  const verdict = classify(gitFacts(cwd, deployBranch, remoteRef));
  if (verdict.dirty || verdict.behind > 0 || verdict.ahead > 0) return verdict;
  return null;
}

function warningText(verdict) {
  const ref = verdict.remoteRef || defaultRemoteRef(verdict.deployBranch);
  const lines = [
    '',
    '========================================',
    'DEPLOY WORKTREE DRIFT',
    '========================================',
    '',
    `This checkout is on ${verdict.deployBranch}, the deploy branch, and:`,
    '',
  ];
  if (verdict.dirty) lines.push(`  - dirty: ${verdict.dirtyFiles.length} uncommitted/untracked file(s)`);
  if (verdict.diverged) lines.push(`  - diverged from ${ref}: ${verdict.behind} behind, ${verdict.ahead} ahead`);
  else if (verdict.behind > 0) lines.push(`  - behind ${ref} by ${verdict.behind} commit(s) (since last fetch)`);
  else if (verdict.ahead > 0) lines.push(`  - ahead of ${ref} by ${verdict.ahead} local commit(s)`);
  lines.push('');
  lines.push('A scheduled runtime here would run stale or uncommitted code.');
  lines.push('Counts are from the last fetch — run `git fetch` to confirm.');
  lines.push('');
  lines.push('FIX: keep the deploy worktree clean and only ever fast-forwarded.');
  lines.push('Do dev work in a separate worktree (Conductor / claude -w). The');
  lines.push('deploy-guard CLI fast-forwards a clean tree and refuses a dirty one:');
  lines.push('');
  const refFlag = ref === defaultRemoteRef(verdict.deployBranch) ? '' : ` --remote-ref ${ref}`;
  lines.push(`  node .claude/scripts/deploy-guard.cjs --branch ${verdict.deployBranch}${refFlag}`);
  lines.push('');
  lines.push('Silence: CLAUDE_KIT_NO_DEPLOY_DRIFT_WARN=1');
  lines.push('========================================');
  lines.push('');
  return lines.join('\n');
}

function run() {
  if (process.env.CLAUDE_KIT_NO_DEPLOY_DRIFT_WARN === '1') return { state: 'silenced' };
  const projectRoot = process.cwd();
  if (!fs.existsSync(path.join(projectRoot, '.claude'))) return { state: 'not-framework' };
  const deployBranch = deployBranchName();
  const verdict = evaluate(projectRoot, deployBranch, remoteRefName(deployBranch));
  if (verdict) {
    process.stdout.write(warningText(verdict));
    return { state: 'drift', behind: verdict.behind, dirty: verdict.dirty };
  }
  return { state: 'clear' };
}

if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook(run, { mode: 'observability' });
}

module.exports = { run, evaluate, warningText, deployBranchName, remoteRefName };
