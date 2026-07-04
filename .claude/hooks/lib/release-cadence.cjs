#!/usr/bin/env node

/**
 * Release Cadence: the pure counter behind the release-cut prompt (#873).
 *
 * `/commit` appends every feature and fix to CHANGELOG `[Unreleased]` but never
 * closes it into a dated version, so the block grows without bound — it hit
 * ~460 entries before #756 cleaned it up. CONTRIBUTING.md "Releases" documents
 * the cadence (cut a release once `[Unreleased]` crosses ~30 entries) but a
 * documented-only policy lapses silently. This lib makes the crossing
 * observable so the commit skill and a SessionStart advisory can surface it.
 *
 * An "entry" is a top-level `- ` bullet under the `## [Unreleased]` header, up
 * to the next `## [` version header. Indented sub-bullets (`  - `) and the
 * `### Added/Changed/...` subsection headers are not entries — matching how
 * #756 distinguished "~460 entries" from "519 bullets".
 *
 * The exported functions are pure: no stdin, no process.exit. The require.main
 * block owns the file IO so callers (a skill, a hook) compose the pure core,
 * mirroring doc-coverage.cjs.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_THRESHOLD = 30;
const UNRELEASED_RE = /^##\s+\[Unreleased\]/i;
const VERSION_HEADER_RE = /^##\s+\[/;
const ENTRY_RE = /^- /;

/** Resolve the effective threshold: env override wins, else the default. */
function resolveThreshold(env = process.env) {
  const raw = env.CLAUDE_RELEASE_CADENCE_THRESHOLD;
  if (raw !== undefined) {
    const n = Number.parseInt(raw, 10);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return DEFAULT_THRESHOLD;
}

/**
 * Count top-level `- ` entries inside the `## [Unreleased]` section of a
 * CHANGELOG body. Returns 0 when there is no `[Unreleased]` header or the
 * section is empty. Only the first `[Unreleased]` section is counted; the walk
 * stops at the next `## [` version header.
 */
function countUnreleasedEntries(changelogText) {
  if (typeof changelogText !== 'string' || changelogText.length === 0) return 0;
  const lines = changelogText.split('\n');
  let inSection = false;
  let count = 0;
  for (const line of lines) {
    if (!inSection) {
      if (UNRELEASED_RE.test(line)) inSection = true;
      continue;
    }
    if (VERSION_HEADER_RE.test(line)) break; // next dated version section
    if (ENTRY_RE.test(line)) count++;
  }
  return count;
}

/**
 * Read CHANGELOG.md from `cwd` and count its `[Unreleased]` entries. Returns
 * null when no CHANGELOG.md exists — the signal that this project has no
 * changelog to gate on (silent). A present-but-sectionless changelog returns
 * count 0.
 */
function readUnreleasedCount(cwd = process.cwd()) {
  const file = path.join(cwd, 'CHANGELOG.md');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  return { path: file, count: countUnreleasedEntries(text) };
}

/** True when the entry count has reached the threshold (a release is due). */
function shouldPromptReleaseCut(count, threshold = DEFAULT_THRESHOLD) {
  return typeof count === 'number' && count >= threshold;
}

/**
 * The advisory line surfaced by both callers. Kept here so the commit skill and
 * the SessionStart hook word it identically. Points at the steps that already
 * live in CONTRIBUTING.md rather than restating them.
 */
function releaseCutMessage(count, threshold = DEFAULT_THRESHOLD) {
  return (
    `[RELEASE] CHANGELOG [Unreleased] has ${count} entries (threshold ${threshold}). ` +
    `Time to cut a release — see CONTRIBUTING.md "Releases" for the steps.`
  );
}

if (require.main === module) {
  const threshold = resolveThreshold();
  const result = readUnreleasedCount();
  if (result === null) {
    console.log('No CHANGELOG.md found.');
  } else if (shouldPromptReleaseCut(result.count, threshold)) {
    console.log(releaseCutMessage(result.count, threshold));
  } else {
    console.log(
      `[Unreleased] has ${result.count} entries (threshold ${threshold}). Below threshold — no release due.`
    );
  }
}

module.exports = {
  DEFAULT_THRESHOLD,
  resolveThreshold,
  countUnreleasedEntries,
  readUnreleasedCount,
  shouldPromptReleaseCut,
  releaseCutMessage,
};
