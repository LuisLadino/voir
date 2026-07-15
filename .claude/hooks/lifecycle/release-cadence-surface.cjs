#!/usr/bin/env node

/**
 * Release Cadence Surface Hook
 *
 * Event: SessionStart
 * Purpose: Surface a non-blocking reminder to cut a release when CHANGELOG
 * `[Unreleased]` plus pending `changelog.d/` fragments have crossed the cadence
 * threshold. `/commit` records every feature and fix (as a fragment) but never
 * closes the running log, so without this the block grows unbounded — the
 * ~460-entry accumulation #756 cleaned up. `.claude/specs/kit/releases.md`
 * documents the cadence; this makes the crossing enforced, not just documented.
 * See #873.
 *
 * Silent when:
 *   - No CHANGELOG.md in the repo root (projects without a changelog)
 *   - `[Unreleased]` is below the threshold
 *   - Silenced with CLAUDE_NO_RELEASE_CADENCE_WARN=1
 *
 * Surfacing: always fires while over threshold — no per-session dedup, because
 * the reminder must persist every session until a release is cut, exactly like
 * verify-queue-surface. Discoverability only: SessionStart cannot block, and a
 * commit must never be blocked on release hygiene.
 *
 * Local-only: reads CHANGELOG.md already on disk. No network, no git — zero
 * per-session tax. The counting logic lives in the shared release-cadence lib,
 * which the commit skill also calls.
 */

const {
  resolveThreshold,
  readUnreleasedCount,
  shouldPromptReleaseCut,
  releaseCutMessage,
} = require('../lib/release-cadence.cjs');

function handleHook() {
  if (process.env.CLAUDE_NO_RELEASE_CADENCE_WARN === '1') return process.exit(0);

  const result = readUnreleasedCount();
  if (result === null) return process.exit(0);

  const threshold = resolveThreshold();
  if (!shouldPromptReleaseCut(result.count, threshold)) return process.exit(0);

  console.log(releaseCutMessage(result.count, threshold));
  process.exit(0);
}

if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook(handleHook, { mode: 'observability', parseJson: false });
} else {
  module.exports = { handleHook };
}
