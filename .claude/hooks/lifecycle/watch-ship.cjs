#!/usr/bin/env node

// @kit-internal — spawned via Monitor by /commit skill, not a Claude Code lifecycle hook

/**
 * watch-ship.cjs — Post-commit verification for the /commit skill.
 *
 * Usage: node watch-ship.cjs <PR_NUMBER>
 *
 * Spawned via the Monitor tool from /commit step 9. Watches CI for the PR,
 * then probes the deploy URL configured in stack-config.yaml. The deploy
 * probe confirms the URL is reachable (HTTP 2xx), not that the merged commit
 * is the live build — projects without an auto-deploy hook from merge own
 * their own deploy step.
 *
 * Emits exactly one line to stdout on terminal state:
 *
 *   [ship] ✓ <repo> PR #N (<title>) merged [+ deploy reachable]   — happy path
 *   [ship] ✗ <repo> PR #N (<title>) — closed without merging      — needs action
 *   [ship] ✗ <repo> PR #N (<title>) merged but deploy unreachable — needs revert
 *
 * Rewritten from watch-ship.sh (#503). All decision logic is pure and
 * exported; the I/O — gh, curl, sleep — is injected into the poll loops, so
 * they run unit-tested without a live PR. See watch-ship.test.cjs.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ───────────────────────── Pure decision logic ─────────────────────────
// Side-effect-free and unit-tested. The poll loops below call into these.

// PR arg must be numeric. Blocks gh-flag injection (e.g. `-R victim/repo`)
// and fails fast instead of polling forever against a nonsense target.
function isValidPrNumber(arg) {
  return typeof arg === 'string' && /^[0-9]+$/.test(arg);
}

// Context-rich notification label. Title is capped to `cap` chars. Four-way
// fallback so a partial gh failure still yields a useful label. (#501)
function buildPrLabel({ repo, title, prNumber, cap = 50 }) {
  let t = (title || '').trim();
  if (t.length > cap) t = t.slice(0, cap) + '...';
  if (repo && t) return `${repo} PR #${prNumber} (${t})`;
  if (t) return `PR #${prNumber} (${t})`;
  if (repo) return `${repo} PR #${prNumber}`;
  return `PR #${prNumber}`;
}

// Parse the `deploy:` block out of stack-config.yaml text. Returns whether
// the block exists at all and the url within it. A bespoke parse of this one
// block — hook scripts do not take a full YAML dependency.
function parseDeployConfig(yamlContent) {
  let blockPresent = false;
  let url = '';
  let inDeploy = false;
  for (const line of (yamlContent || '').split('\n')) {
    if (/^deploy:[ \t]*$/.test(line)) { blockPresent = true; inDeploy = true; continue; }
    if (inDeploy && /^\S/.test(line)) inDeploy = false;
    if (inDeploy) {
      const m = line.match(/^[ \t]+url:[ \t]*(.*)$/);
      if (m) { url = m[1].replace(/['"]/g, '').replace(/[ \t]+$/, ''); break; }
    }
  }
  return { blockPresent, url };
}

// A `deploy:` block with no url is a misconfiguration — surface it rather
// than silently skipping the check. A url with a bad scheme or embedded
// whitespace is rejected (curl's --proto flag is the real SSRF defense; this
// is the clearer diagnostic when the config is wrong).
function validateDeployConfig({ blockPresent, url }) {
  if (blockPresent && !url) {
    return { ok: false, error: 'stack-config.yaml has a deploy: block but no valid url. Fix the config or remove the block.' };
  }
  if (url && (!/^https?:\/\//.test(url) || /\s/.test(url))) {
    return { ok: false, error: `stack-config.yaml deploy.url must start with http:// or https:// and contain no whitespace. Got: ${url}` };
  }
  return { ok: true };
}

// Initial `gh pr checks` exit handling. A non-zero exit can mean the watcher
// lost the auto-merge/delete-branch race the good way (PR already MERGED), or
// a warn-only check failed (false alarm). Both fall through to the poll loop,
// which distinguishes via mergeStateStatus. Only CLOSED is terminal here.
function classifyCiResult(checksOk, prState) {
  if (checksOk) return { action: 'proceed' };
  if (prState === 'CLOSED') return { action: 'closed' };
  return { action: 'proceed' };
}

// Filter a PR's statusCheckRollup down to required checks whose conclusion
// indicates a real failure. Used to tell a real BLOCKED (required check
// failed) apart from a transient BLOCKED (required check still pending).
function failingRequiredChecks(rollup, requiredContexts) {
  if (!Array.isArray(rollup) || !Array.isArray(requiredContexts) || requiredContexts.length === 0) return [];
  const required = new Set(requiredContexts);
  const failed = new Set();
  for (const c of rollup) {
    const name = (c && (c.name || c.context)) || '';
    if (!name || !required.has(name)) continue;
    const result = String(c.conclusion || c.state || '').toUpperCase();
    if (/^(FAILURE|TIMED_OUT|CANCELLED|STARTUP_FAILURE|ACTION_REQUIRED|ERROR)$/.test(result)) {
      failed.add(name);
    }
  }
  return Array.from(failed);
}

// Required contexts whose check has not reached a terminal conclusion yet
// (still queued, in progress, or never reported in). When any are pending,
// BLOCKED is just the branch-protection state during a normal CI run, not
// a real failure to abort on.
function pendingRequiredChecks(rollup, requiredContexts) {
  if (!Array.isArray(requiredContexts) || requiredContexts.length === 0) return [];
  const required = new Set(requiredContexts);
  const completed = new Set();
  for (const c of (Array.isArray(rollup) ? rollup : [])) {
    const name = (c && (c.name || c.context)) || '';
    if (!name || !required.has(name)) continue;
    const result = String(c.conclusion || c.state || '').toUpperCase();
    if (/^(SUCCESS|FAILURE|NEUTRAL|CANCELLED|SKIPPED|TIMED_OUT|ACTION_REQUIRED|STALE|STARTUP_FAILURE|ERROR)$/.test(result)) {
      completed.add(name);
    }
  }
  const pending = [];
  for (const name of required) {
    if (!completed.has(name)) pending.push(name);
  }
  return pending;
}

// Per-poll-iteration decision. Pure: given one reading and the running
// counters, name the next action — the loop executes the I/O and carries the
// counters forward. This is the state machine where #462, #464, #466, #478,
// and #576 all bugged, which is exactly why it is isolated and tested here.
function classifyMergeState({ state, mergeState, statusCheckRollup = [], requiredContexts = [] }, { behindFixes = 0, blockedReads = 0 } = {}) {
  if (state === 'MERGED') return { action: 'merged' };
  if (state === 'CLOSED') return { action: 'closed' };
  // A merge conflict will not self-resolve — terminal.
  if (mergeState === 'DIRTY') return { action: 'dirty' };
  // BEHIND: a sibling PR merged first, leaving this branch behind base. Heal
  // by updating the branch so auto-merge can still land it. Capped so a
  // branch that keeps going BEHIND still terminates. (#462)
  if (mergeState === 'BEHIND') {
    return behindFixes >= 3 ? { action: 'behind-exhausted' } : { action: 'heal-behind' };
  }
  if (mergeState === 'BLOCKED') {
    // When the required-checks list is known, distinguish a real failure
    // (a required check FAILED) from a transient state (required check still
    // pending). The 3-consecutive heuristic underneath would false-positive
    // here: a warn-only check failing trips --fail-fast and we enter this
    // loop while required checks still have ~40+s to run. (#576)
    if (Array.isArray(requiredContexts) && requiredContexts.length > 0) {
      const failed = failingRequiredChecks(statusCheckRollup, requiredContexts);
      if (failed.length > 0) return { action: 'blocked', failingRequired: failed };
      const pending = pendingRequiredChecks(statusCheckRollup, requiredContexts);
      if (pending.length > 0) return { action: 'continue', blockedReads: 0 };
      // All required checks passed but the PR is still BLOCKED. Could be
      // missing reviews, admin restrictions, or a stale branch-protection
      // recompute. Fall through to the 3-consecutive terminal threshold.
    }
    // Fallback for the case where the required-checks list is unavailable
    // (no branch protection, no admin scope on a private repo, gh failure).
    // Terminal only after 3 consecutive reads, same as before #576. (#466)
    const next = blockedReads + 1;
    return next >= 3 ? { action: 'blocked' } : { action: 'continue', blockedReads: next };
  }
  return { action: 'continue', blockedReads: 0 };
}

// HTTP 2xx means the deploy URL is reachable.
function classifyDeployStatus(httpStatus) {
  return typeof httpStatus === 'string' && /^2/.test(httpStatus);
}

// ─────────────────────── Poll loops (I/O injected) ─────────────────────
// `fetchPrState`, `healBehind`, `fetchStatus`, and `sleep` are injected so
// these loops run under test with scripted inputs and no real network.

// Poll mergeStateStatus until the PR reaches a terminal state. Resolves to
// one of: merged | closed | dirty | behind-exhausted | blocked | heal-failed
// | timeout. `healBehind` may be sync or async; its result is awaited.
async function pollMergeState({ fetchPrState, healBehind, sleep, maxIterations = 30, pollMs = 20000 }) {
  let behindFixes = 0;
  let blockedReads = 0;
  for (let i = 0; i < maxIterations; i++) {
    const decision = classifyMergeState(fetchPrState(), { behindFixes, blockedReads });
    switch (decision.action) {
      case 'merged':           return { outcome: 'merged' };
      case 'closed':           return { outcome: 'closed' };
      case 'dirty':            return { outcome: 'dirty' };
      case 'behind-exhausted': return { outcome: 'behind-exhausted' };
      case 'blocked':          return { outcome: 'blocked', failingRequired: decision.failingRequired || [] };
      case 'heal-behind': {
        behindFixes += 1;
        const healed = await healBehind();
        if (!healed.ok) return { outcome: 'heal-failed', detail: healed.error };
        // healBehind already waited for the re-triggered CI; skip the sleep.
        blockedReads = 0;
        continue;
      }
      case 'continue':
        blockedReads = decision.blockedReads;
        break;
    }
    await sleep(pollMs);
  }
  return { outcome: 'timeout' };
}

// Probe the deploy URL for HTTP 2xx. Shorter waits early so a fast deploy is
// not made to wait the full budget; ~2.5 min total across 9 attempts.
async function probeDeploy({ fetchStatus, sleep, attempts = 9 }) {
  let lastStatus = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    lastStatus = fetchStatus();
    if (classifyDeployStatus(lastStatus)) return { reachable: true, lastStatus };
    await sleep(attempt < 3 ? 10000 : 20000);
  }
  return { reachable: false, lastStatus };
}

// ───────────────────────────── I/O helpers ─────────────────────────────

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function ghOk(args) {
  try {
    execFileSync('gh', args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ──────────────────────────────── main ─────────────────────────────────

async function main() {
  const pr = process.argv[2];

  if (!pr) {
    console.log('[ship] ✗ watch-ship.cjs: no PR number given');
    process.exit(1);
  }
  if (!isValidPrNumber(pr)) {
    console.log(`[ship] ✗ watch-ship.cjs: PR must be numeric, got: ${pr}`);
    process.exit(1);
  }

  // Anchor file reads to the git root so the Monitor still finds
  // stack-config.yaml when spawned from a subdirectory.
  let root;
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    root = process.cwd();
  }

  // Build the notification label. One-shot gh calls; all failures silent.
  let repo = '';
  let title = '';
  try { repo = gh(['repo', 'view', '--json', 'name', '--jq', '.name']); } catch { /* silent */ }
  try { title = gh(['pr', 'view', pr, '--json', 'title', '--jq', '.title']); } catch { /* silent */ }
  const label = buildPrLabel({ repo, title, prNumber: pr });

  // Read and validate the deploy config.
  const configPath = path.join(root, '.claude', 'specs', 'stack-config.yaml');
  let deploy = { blockPresent: false, url: '' };
  if (fs.existsSync(configPath)) {
    deploy = parseDeployConfig(fs.readFileSync(configPath, 'utf8'));
  }
  const configCheck = validateDeployConfig(deploy);
  if (!configCheck.ok) {
    console.log(`[ship] ✗ ${label} — ${configCheck.error}`);
    process.exit(1);
  }

  // Wait for CI to reach a terminal state. `gh pr checks --watch` blocks.
  const ciOk = ghOk(['pr', 'checks', '--watch', '--fail-fast', '--', pr]);
  if (classifyCiResult(ciOk, ciOk ? '' : safeState(pr)).action === 'closed') {
    console.log(`[ship] ✗ ${label} — closed without merging. Investigate: gh pr view ${pr}`);
    process.exit(1);
  }

  // Required-checks list for the PR's base branch. One-shot fetch — branch
  // protection rarely changes mid-flight, and refetching per poll would burn
  // API budget. Empty list (no protection / no admin scope) makes the BLOCKED
  // classifier fall back to the legacy 3-consecutive heuristic.
  const requiredContexts = fetchRequiredContexts(pr);

  // Poll for the merge to land.
  const fetchPrState = () => {
    try {
      const json = gh(['pr', 'view', pr, '--json', 'state,mergeStateStatus,statusCheckRollup']);
      const data = JSON.parse(json);
      return {
        state: data.state || 'UNKNOWN',
        mergeState: data.mergeStateStatus || 'UNKNOWN',
        statusCheckRollup: Array.isArray(data.statusCheckRollup) ? data.statusCheckRollup : [],
        requiredContexts
      };
    } catch {
      return { state: 'UNKNOWN', mergeState: 'UNKNOWN', statusCheckRollup: [], requiredContexts };
    }
  };

  const healBehind = async () => {
    if (!ghOk(['pr', 'update-branch', '--', pr])) {
      return { ok: false, error: `BEHIND base and 'gh pr update-branch' failed (likely a conflict). Investigate: gh pr view ${pr}` };
    }
    // Updating the branch re-triggers required CI. Wait for it before
    // resuming the poll so the new run is not read as a stall.
    await sleep(10000);
    if (!ghOk(['pr', 'checks', '--watch', '--fail-fast', '--', pr])) {
      const postState = safeState(pr);
      if (postState === 'MERGED') return { ok: true };
      if (postState === 'CLOSED') {
        return { ok: false, error: `closed without merging after branch update. Investigate: gh pr view ${pr}` };
      }
      return { ok: false, error: `CI failed after updating the branch. Run: gh pr view ${pr}` };
    }
    return { ok: true };
  };

  const result = await pollMergeState({ fetchPrState, healBehind, sleep });
  const blockedDetail = (() => {
    const failed = Array.isArray(result.failingRequired) ? result.failingRequired : [];
    if (failed.length > 0) {
      return `merge blocked — required check(s) failed: ${failed.join(', ')}. Investigate: gh pr view ${pr}`;
    }
    return `merge blocked (BLOCKED). Investigate: gh pr view ${pr}`;
  })();
  const failMessage = {
    closed: `closed without merging. Investigate: gh pr view ${pr}`,
    dirty: `merge conflict (DIRTY). Investigate: gh pr view ${pr}`,
    'behind-exhausted': `still BEHIND after 3 update-branch attempts. Investigate: gh pr view ${pr}`,
    blocked: blockedDetail,
    timeout: `CI passed but PR did not merge within 10 min. Investigate: gh pr view ${pr}`
  };
  if (result.outcome !== 'merged') {
    const detail = result.outcome === 'heal-failed' ? result.detail : failMessage[result.outcome];
    console.log(`[ship] ✗ ${label} — ${detail}`);
    process.exit(1);
  }

  // Merged. Deploy check, if configured.
  if (!deploy.url) {
    console.log(`[ship] ✓ ${label} merged (no deploy check configured)`);
    process.exit(0);
  }

  // Give the deploy pipeline time to start, then poll for HTTP 2xx.
  await sleep(20000);
  const fetchStatus = () => {
    try {
      const head = execFileSync(
        'curl',
        ['-sI', '--max-time', '10', '--proto', '=https,http', '--max-redirs', '3', deploy.url],
        { encoding: 'utf8' }
      );
      const m = head.match(/^HTTP\/\S+\s+(\d+)/m);
      return m ? m[1] : '';
    } catch {
      return '';
    }
  };
  const probe = await probeDeploy({ fetchStatus, sleep });
  if (probe.reachable) {
    console.log(`[ship] ✓ ${label} merged + deploy reachable (${deploy.url} → HTTP ${probe.lastStatus})`);
    process.exit(0);
  }
  console.log(`[ship] ✗ ${label} merged but deploy unreachable (${deploy.url}). Last status: ${probe.lastStatus || 'no response'}. Check logs or revert.`);
  process.exit(1);
}

// Read PR state, tolerating gh failure.
function safeState(pr) {
  try {
    return gh(['pr', 'view', pr, '--json', 'state', '--jq', '.state']);
  } catch {
    return 'UNKNOWN';
  }
}

// Resolve the branch-protection required-checks list for the PR's base
// branch. Returns [] when protection isn't set or the API isn't reachable
// (no admin scope, gh failure). The classifier then falls back to the
// legacy 3-consecutive-BLOCKED heuristic.
function fetchRequiredContexts(pr) {
  let baseBranch = '';
  try { baseBranch = gh(['pr', 'view', pr, '--json', 'baseRefName', '--jq', '.baseRefName']); } catch { /* silent */ }
  if (!baseBranch) return [];
  try {
    const out = gh(['api', `repos/{owner}/{repo}/branches/${baseBranch}/protection/required_status_checks`, '--jq', '.contexts // []']);
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Run as a script; export pure logic + loops when required by the test.
if (require.main === module) {
  main();
} else {
  module.exports = {
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
  };
}
