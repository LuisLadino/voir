#!/usr/bin/env node

/**
 * Verify Queue Surface Hook
 *
 * Event: SessionStart
 * Purpose: Surface "shipped but unverified" issues — merged PRs that used
 * `Addresses #X` (not `Closes #X`) where the referenced issue is still open.
 * These await verification before close per CLAUDE.md verify-before-close
 * rule. Without this surface, the queue grows silently. See #317.
 *
 * Silent when:
 *   - Not a git repo
 *   - find-stale-addresses script absent (downstream projects pre-sync)
 *   - No commits in last 30 days (dead repo, skip network I/O)
 *   - find-stale-addresses returns empty
 *   - gh not authenticated or network failure
 *
 * Surfacing detail: prints up to 10 issue numbers, summarizes the rest as
 * +N more. Always surfaces when non-empty — no per-session dedup, because
 * the user needs the running reminder until the queue drains.
 *
 * Network timeouts kept short to protect session-start latency.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT_PATH = path.join('.claude', 'skills', 'verify', 'find-stale-addresses.cjs');
const MAX_VISIBLE = 10;
const SCRIPT_TIMEOUT_MS = 10000;

function run(cmd, args = [], timeout = 2000) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function handleHook() {
  const inRepo = run('git', ['rev-parse', '--is-inside-work-tree']);
  if (inRepo !== 'true') return process.exit(0);

  if (!fs.existsSync(SCRIPT_PATH)) return process.exit(0);

  const recentCommit = run('git', ['log', '--since=30 days ago', '--oneline', '-1']);
  if (!recentCommit) return process.exit(0);

  const json = run('node', [SCRIPT_PATH, '--all-ages', '--json'], SCRIPT_TIMEOUT_MS);
  if (!json) return process.exit(0);

  let stale;
  try { stale = JSON.parse(json); } catch { return process.exit(0); }
  if (!Array.isArray(stale) || stale.length === 0) return process.exit(0);

  const issueNumbers = [...new Set(stale.map(s => s.issue && s.issue.number).filter(Boolean))];
  if (issueNumbers.length === 0) return process.exit(0);

  const visible = issueNumbers.slice(0, MAX_VISIBLE);
  const remaining = issueNumbers.length - visible.length;
  const visibleStr = visible.map(n => `#${n}`).join(' ');
  const remainingStr = remaining > 0 ? ` (+${remaining} more)` : '';
  const plural = issueNumbers.length === 1 ? 'issue' : 'issues';

  console.log(
    `[VERIFY] ${issueNumbers.length} ${plural} awaiting verification: ${visibleStr}${remainingStr}\n` +
    `Run /verify to walk the queue.`
  );

  process.exit(0);
}

if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook(handleHook, { mode: 'observability', parseJson: false });
} else {
  module.exports = { handleHook };
}
