#!/usr/bin/env node

/**
 * Check Recent Ships Hook
 *
 * Event: SessionStart
 * Purpose: Catch ship issues that the in-session Monitor watcher missed
 * because the session ended before the PR settled. Two passes:
 *
 *   1. Recent merged PRs with FAILURE/CANCELLED checks. Surfaces a PR
 *      that shipped broken while the session was closed.
 *   2. Open PRs with auto-merge enabled, in BEHIND state. Heals a PR
 *      that a sibling merge stranded after the watcher exited. Runs
 *      `gh pr update-branch` per stranded PR; auto-merge then completes
 *      the ship on the next CI run.
 *
 * The in-session Monitor watcher spawned by /commit heals BEHIND inside
 * its own session (#462/#464). This hook heals BEHIND across a session
 * boundary (#465).
 *
 * Silent when:
 *   - Not a git repo
 *   - gh not authenticated or network failure
 *   - No recent commit activity (pre-check skips network I/O)
 *   - No actionable PRs in either pass
 *   - All currently-broken PRs already acknowledged this cycle
 *
 * Dedup:
 *   - Broken-ship alerts dedup via .claude/last-acknowledged-broken-ships,
 *     because a broken merge is a notification: once seen, don't re-fire.
 *   - BEHIND heal actions do NOT dedup: a PR can re-enter BEHIND after a
 *     successful heal if more siblings merge. Each session start queries
 *     fresh state and acts on the current BEHIND set.
 *
 * Network timeouts kept short to protect session-start latency.
 *
 * Decision logic is exported and unit-tested. The execSync wrapper and
 * filesystem reads are injected so the test suite runs without gh / git.
 * See check-recent-ships.test.cjs.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ACK_FILE = path.join('.claude', 'last-acknowledged-broken-ships');
const GH_TIMEOUT_MS = 3000;
const UPDATE_BRANCH_TIMEOUT_MS = 8000;
const MAX_HEALS_PER_SESSION = 5;
const BROKEN_RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────── Pure decision logic ───────────────────────────

// Decide if a PR shipped broken: merged inside the cutoff window AND has
// at least one FAILURE / CANCELLED check in its rollup.
function isBrokenRecent(pr, cutoffMs) {
  if (!pr || !pr.mergedAt) return false;
  if (new Date(pr.mergedAt).getTime() < cutoffMs) return false;
  if (!Array.isArray(pr.statusCheckRollup)) return false;
  return pr.statusCheckRollup.some(c =>
    c && (c.conclusion === 'FAILURE' || c.conclusion === 'CANCELLED')
  );
}

// Filter a list of merged-PR rollups to the broken-recent set. Used by
// reportBroken to decide what to surface.
function selectBroken(prs, cutoffMs) {
  if (!Array.isArray(prs)) return [];
  return prs.filter(pr => isBrokenRecent(pr, cutoffMs));
}

// Decide if an open PR is stranded BEHIND: auto-merge enabled AND merge
// state is BEHIND. The heal path runs `gh pr update-branch` on these.
function isStrandedBehind(pr) {
  return !!(pr && pr.autoMergeRequest != null && pr.mergeStateStatus === 'BEHIND');
}

function selectStranded(prs) {
  if (!Array.isArray(prs)) return [];
  return prs.filter(isStrandedBehind);
}

// Compute which broken PRs are "fresh" (not already acknowledged this
// cycle). Pure: takes the broken list and the acknowledged set.
function selectFreshBroken(broken, acknowledged) {
  if (!Array.isArray(broken)) return [];
  const ack = acknowledged instanceof Set ? acknowledged : new Set(acknowledged || []);
  return broken.filter(pr => !ack.has(String(pr.number)));
}

// Build the broken-ship report text. Pure.
function formatBrokenReport(fresh) {
  if (!Array.isArray(fresh) || fresh.length === 0) return '';
  const lines = fresh.map(p => `  - PR #${p.number}: ${p.title}`).join('\n');
  const plural = fresh.length > 1 ? 's' : '';
  return `[SHIP CATCH-UP] ${fresh.length} PR${plural} merged in the last 24h with failed or cancelled checks:
${lines}

These may have shipped broken. Investigate with: gh pr view <number>`;
}

// Build the stranded-heal report text from the heal outcome. Pure.
function formatStrandedReport({ updated, failed, skipped, cap = MAX_HEALS_PER_SESSION }) {
  const u = Array.isArray(updated) ? updated : [];
  const f = Array.isArray(failed) ? failed : [];
  const s = Number(skipped) || 0;
  if (u.length === 0 && f.length === 0) return '';

  const sections = [];
  if (u.length > 0) {
    const list = u.map(p => `  - PR #${p.number}: ${p.title}`).join('\n');
    const plural = u.length > 1 ? 's' : '';
    sections.push(
      `Updated ${u.length} stranded PR${plural} (was BEHIND base, CI re-triggered):\n${list}`
    );
  }
  if (f.length > 0) {
    const list = f.map(p => `  - PR #${p.number}: ${p.title}`).join('\n');
    const plural = f.length > 1 ? 's' : '';
    sections.push(
      `Failed to update ${f.length} PR${plural} (likely conflict, investigate with gh pr view <number>):\n${list}`
    );
  }
  if (s > 0) {
    sections.push(
      `Skipped ${s} additional BEHIND PR(s); cap of ${cap} per session.`
    );
  }
  return `[SHIP CATCH-UP] Healed cross-session stranded PRs:\n${sections.join('\n\n')}`;
}

// ──────────────────────── I/O wrappers (injectable) ────────────────────────

function defaultRun(cmd, timeout = 2000) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return null;
  }
}

function readAcknowledged(ackFile = ACK_FILE) {
  try {
    return new Set(
      fs.readFileSync(ackFile, 'utf8')
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

function writeAcknowledged(numbers, ackFile = ACK_FILE) {
  try {
    const dir = path.dirname(ackFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ackFile, [...numbers].join('\n') + '\n');
  } catch {
    /* Non-fatal; worst case is a repeated notification next session. */
  }
}

// ─────────────────────────── Hook entry points ─────────────────────────────

function checkBrokenRecent({ run = defaultRun, now = Date.now } = {}) {
  const recentCommit = run('git log --since="24 hours ago" --oneline -1');
  if (!recentCommit) return [];

  const json = run(
    `gh pr list --state merged --author "@me" --limit 15 ` +
    `--json number,title,mergedAt,statusCheckRollup`,
    GH_TIMEOUT_MS
  );
  if (!json) return [];

  let prs;
  try { prs = JSON.parse(json); } catch { return []; }

  return selectBroken(prs, now() - BROKEN_RECENT_WINDOW_MS);
}

function findStrandedBehind({ run = defaultRun } = {}) {
  // 30d gate matches verify-queue-surface and tolerates cross-vacation
  // BEHIND staleness, the core case #465 fixes.
  const recentCommit = run('git log --since="30 days ago" --oneline -1');
  if (!recentCommit) return [];

  const json = run(
    `gh pr list --state open --author "@me" --limit 20 ` +
    `--json number,title,mergeStateStatus,autoMergeRequest`,
    GH_TIMEOUT_MS
  );
  if (!json) return [];

  let prs;
  try { prs = JSON.parse(json); } catch { return []; }

  return selectStranded(prs);
}

function healStrandedBehind(prs, { run = defaultRun, cap = MAX_HEALS_PER_SESSION } = {}) {
  const targets = (prs || []).slice(0, cap);
  const updated = [];
  const failed = [];
  for (const pr of targets) {
    // PR numbers come from gh itself (integer), but force the type and run
    // the value through the validator anyway so an injected string never
    // reaches a shell. Skip the PR rather than corrupting the heal command.
    const num = Number(pr && pr.number);
    if (!Number.isInteger(num) || num <= 0) { failed.push(pr); continue; }
    const ok = run(`gh pr update-branch -- ${num}`, UPDATE_BRANCH_TIMEOUT_MS);
    if (ok !== null) updated.push(pr);
    else failed.push(pr);
  }
  return {
    updated,
    failed,
    skipped: prs.length - targets.length,
  };
}

function reportBroken(broken, {
  read = readAcknowledged,
  write = writeAcknowledged,
  log = console.log,
} = {}) {
  if (!Array.isArray(broken) || broken.length === 0) return;
  const acknowledged = read();
  const fresh = selectFreshBroken(broken, acknowledged);
  if (fresh.length === 0) return;
  log(formatBrokenReport(fresh));
  const updated = new Set([...acknowledged, ...fresh.map(p => String(p.number))]);
  write(updated);
}

function reportStranded(outcome, { log = console.log } = {}) {
  const text = formatStrandedReport(outcome);
  if (text) log(text);
}

function handleHook(_input, deps = {}) {
  const run = deps.run || defaultRun;
  const inRepo = run('git rev-parse --is-inside-work-tree');
  if (inRepo !== 'true') return process.exit(0);

  reportBroken(checkBrokenRecent({ run }), deps);

  const stranded = findStrandedBehind({ run });
  if (stranded.length > 0) {
    reportStranded(healStrandedBehind(stranded, { run }), deps);
  }

  process.exit(0);
}

if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook(handleHook, { mode: 'observability', parseJson: false });
} else {
  module.exports = {
    handleHook,
    checkBrokenRecent,
    findStrandedBehind,
    healStrandedBehind,
    reportBroken,
    reportStranded,
    // pure decision logic for testing:
    isBrokenRecent,
    selectBroken,
    isStrandedBehind,
    selectStranded,
    selectFreshBroken,
    formatBrokenReport,
    formatStrandedReport,
    // constants for tests:
    BROKEN_RECENT_WINDOW_MS,
    MAX_HEALS_PER_SESSION,
  };
}
