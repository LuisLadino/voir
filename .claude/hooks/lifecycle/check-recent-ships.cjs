#!/usr/bin/env node

/**
 * Check Recent Ships Hook
 *
 * Event: SessionStart
 * Purpose: Catch post-merge failures that happened after the last session
 * closed. Scans merged PRs from the current user in the last 24h and
 * reports any with failed or cancelled checks.
 *
 * Complements the in-session Monitor watcher spawned by /commit: if Luis
 * closed the session before CI finished, this catches the failure on the
 * next session start.
 *
 * Silent when:
 *   - Not a git repo
 *   - gh not authenticated
 *   - No local commits in the last 24h (cheap pre-check to skip network I/O)
 *   - No recent merged PRs by the current user
 *   - All recent PRs shipped cleanly
 *   - All currently-broken PRs have already been acknowledged this cycle
 *
 * Dedup: once a broken PR has been reported, its number is written to
 * .claude/last-acknowledged-broken-ships. Subsequent sessions skip those
 * PRs until new failures appear.
 *
 * Network timeouts are kept short (3s) to protect session-start latency.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ACK_FILE = path.join('.claude', 'last-acknowledged-broken-ships');
const GH_TIMEOUT_MS = 3000;

function run(cmd, timeout = 2000) {
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

function readAcknowledged() {
  try {
    return new Set(
      fs.readFileSync(ACK_FILE, 'utf8')
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

function writeAcknowledged(numbers) {
  try {
    const dir = path.dirname(ACK_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ACK_FILE, [...numbers].join('\n') + '\n');
  } catch {
    // Non-fatal; worst case is a repeated notification next session.
  }
}

function handleHook() {
  const inRepo = run('git rev-parse --is-inside-work-tree');
  if (inRepo !== 'true') return process.exit(0);

  // Cheap local pre-check: skip entirely if no commits in the last 24h.
  // Saves the gh network round-trip on idle projects.
  const recentCommit = run('git log --since="24 hours ago" --oneline -1');
  if (!recentCommit) return process.exit(0);

  // `@me` resolves to whichever identity gh is authed as, avoiding an
  // extra round-trip to fetch the login and avoiding shell-escaping the
  // username.
  const json = run(
    `gh pr list --state merged --author "@me" --limit 15 ` +
    `--json number,title,mergedAt,statusCheckRollup`,
    GH_TIMEOUT_MS
  );
  if (!json) return process.exit(0);

  let prs;
  try { prs = JSON.parse(json); } catch { return process.exit(0); }

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const broken = prs.filter(pr => {
    if (!pr.mergedAt) return false;
    if (new Date(pr.mergedAt).getTime() < cutoff) return false;
    if (!Array.isArray(pr.statusCheckRollup)) return false;
    return pr.statusCheckRollup.some(c =>
      c.conclusion === 'FAILURE' || c.conclusion === 'CANCELLED'
    );
  });

  if (broken.length === 0) return process.exit(0);

  // Dedup against previously-acknowledged PRs.
  const acknowledged = readAcknowledged();
  const fresh = broken.filter(p => !acknowledged.has(String(p.number)));
  if (fresh.length === 0) return process.exit(0);

  const lines = fresh.map(p => `  - PR #${p.number}: ${p.title}`).join('\n');
  const plural = fresh.length > 1 ? 's' : '';
  console.log(
`[SHIP CATCH-UP] ${fresh.length} PR${plural} merged in the last 24h with failed or cancelled checks:
${lines}

These may have shipped broken. Investigate with: gh pr view <number>`
  );

  // Record that we've shown these, so we don't repeat on every session start.
  const updated = new Set([...acknowledged, ...fresh.map(p => String(p.number))]);
  writeAcknowledged(updated);

  process.exit(0);
}

if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook(handleHook, { mode: 'observability', parseJson: false });
} else {
  module.exports = { handleHook };
}
