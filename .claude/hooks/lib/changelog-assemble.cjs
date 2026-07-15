#!/usr/bin/env node

/**
 * Changelog fragment assembler (#921).
 *
 * Parallel PRs used to append to CHANGELOG.md [Unreleased] at the same spot, so
 * every PR after the first conflicted on CHANGELOG.md — and GitHub ignores the
 * `merge=union` .gitattributes driver server-side, so the conflict was real on
 * GitHub, not just locally (#920 only mitigated the local rebase). The fix: each
 * PR writes a NEW file under `changelog.d/`; new files never conflict. This
 * script folds those fragments into CHANGELOG.md [Unreleased] at release-cut and
 * deletes them, mirroring towncrier / Changesets.
 *
 * A fragment is a Keep-a-Changelog-shaped body: any of the six KaC subsections
 * (`### Added|Changed|Deprecated|Removed|Fixed|Security`) with top-level `- `
 * bullets (indented sub-bullets allowed). One fragment per branch (filename =
 * sanitized branch slug), so two open PRs never touch the same file.
 *
 * Pure core (parse/merge) + a require.main IO block, mirroring
 * release-cadence.cjs: callers compose the pure functions; the CLI owns the file
 * IO and the fragment deletion. Run `--draft` to preview without writing.
 */

const fs = require('fs');
const path = require('path');

const FRAGMENT_DIR = 'changelog.d';
// The six Keep-a-Changelog change types, in KaC canonical order — renderUnreleasedBody
// emits in this order, so it doubles as the sort. Deprecated/Security are the two you
// least want to lose (security advisories especially), so the parser must recognize them.
const SUBSECTIONS = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];
const UNRELEASED_RE = /^##\s+\[Unreleased\]/i;
const VERSION_HEADER_RE = /^##\s+\[/;
const H2_RE = /^##\s/;
const SUBSECTION_RE = /^###\s+(Added|Changed|Deprecated|Removed|Fixed|Security)\b/i;
const ENTRY_RE = /^- /;

/**
 * Parse a Keep-a-Changelog-shaped body into { Added: [block,...], ... }.
 * A "block" is one top-level `- ` bullet plus its indented / blank continuation
 * lines, kept verbatim so multi-line entries survive assembly. Content outside a
 * known ### subsection, and stray lines before the first bullet, are ignored.
 */
function parseSections(text) {
  const out = {};
  for (const key of SUBSECTIONS) out[key] = [];
  if (typeof text !== 'string' || text.length === 0) return out;
  const lines = text.split('\n');
  let current = null;
  let block = null;
  const flush = () => {
    if (current && block && block.length) {
      while (block.length && block[block.length - 1].trim() === '') block.pop();
      out[current].push(block.join('\n'));
    }
    block = null;
  };
  for (const line of lines) {
    const m = line.match(SUBSECTION_RE);
    if (m) {
      flush();
      current = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
      continue;
    }
    // An `## ` h2 (version header) is a section boundary. A fragment must not
    // smuggle one into a bullet body: if it did, the injected header would
    // mis-slice `[Unreleased]` on the next parse. Reset context instead of
    // swallowing it as continuation text.
    if (H2_RE.test(line)) {
      flush();
      current = null;
      continue;
    }
    if (!current) continue;
    if (ENTRY_RE.test(line)) {
      flush();
      block = [line];
    } else if (block) {
      block.push(line);
    }
  }
  flush();
  return out;
}

/** Merge many parsed section-maps into one, preserving input order. */
function collectSections(sectionMaps) {
  const out = {};
  for (const key of SUBSECTIONS) out[key] = [];
  for (const map of sectionMaps) {
    if (!map) continue;
    for (const key of SUBSECTIONS) {
      if (map[key] && map[key].length) out[key].push(...map[key]);
    }
  }
  return out;
}

/**
 * Render the [Unreleased] body lines from a collected section-map: canonical
 * subsection order, only non-empty subsections emitted.
 */
function renderUnreleasedBody(collected) {
  const parts = [];
  for (const key of SUBSECTIONS) {
    const blocks = collected[key];
    if (!blocks || !blocks.length) continue;
    parts.push(`### ${key}`, '', blocks.join('\n'), '');
  }
  return parts;
}

/**
 * Fold collected fragment sections into CHANGELOG [Unreleased], merging with any
 * entries already there, canonical order. Returns the new changelog text.
 */
function mergeIntoUnreleased(changelogText, fragmentCollected) {
  const lines = changelogText.split('\n');
  const startIdx = lines.findIndex((l) => UNRELEASED_RE.test(l));
  if (startIdx === -1) {
    throw new Error('CHANGELOG.md has no "## [Unreleased]" header.');
  }
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (VERSION_HEADER_RE.test(lines[i])) { endIdx = i; break; }
  }
  const existing = parseSections(lines.slice(startIdx + 1, endIdx).join('\n'));
  const merged = collectSections([existing, fragmentCollected]);
  const bodyParts = renderUnreleasedBody(merged);
  const head = lines.slice(0, startIdx + 1);
  const tail = lines.slice(endIdx);
  return [...head, '', ...bodyParts, ...tail].join('\n');
}

/** Extract just the [Unreleased] section text (for --draft preview / tests). */
function extractUnreleased(changelogText) {
  const lines = changelogText.split('\n');
  const startIdx = lines.findIndex((l) => UNRELEASED_RE.test(l));
  if (startIdx === -1) return '';
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (VERSION_HEADER_RE.test(lines[i])) { endIdx = i; break; }
  }
  return lines.slice(startIdx, endIdx).join('\n').replace(/\s+$/, '') + '\n';
}

/** List fragment files in a dir: *.md except README.md, sorted; [] if missing. */
function listFragmentFiles(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith('.md') && n.toLowerCase() !== 'readme.md')
    .sort()
    .map((n) => path.join(dir, n));
}

if (require.main === module) {
  const draft = process.argv.includes('--draft') || process.argv.includes('--dry-run');
  const cwd = process.cwd();
  const dir = path.join(cwd, FRAGMENT_DIR);
  const files = listFragmentFiles(dir);
  if (files.length === 0) {
    console.log(`No changelog fragments in ${FRAGMENT_DIR}/ — nothing to assemble.`);
    process.exit(0);
  }
  // Only files that contributed a recognized entry get folded and deleted. A
  // malformed fragment (no recognized `### ` subsection) is left in place rather
  // than deleted, so its content is never silently lost — the operator fixes or
  // removes it and re-runs.
  const validSubsections = SUBSECTIONS.join('/');
  const maps = [];
  const contributing = [];
  for (const f of files) {
    const parsed = parseSections(fs.readFileSync(f, 'utf8'));
    const total = SUBSECTIONS.reduce((n, k) => n + parsed[k].length, 0);
    if (total === 0) {
      console.error(`warn: ${path.relative(cwd, f)} has no recognized "### ${validSubsections}" entries — left in place; fix or remove it, then re-run.`);
      continue;
    }
    maps.push(parsed);
    contributing.push(f);
  }
  if (contributing.length === 0) {
    console.error('No fragment held a recognized entry — nothing assembled.');
    process.exit(1);
  }
  const collected = collectSections(maps);
  const counts =
    SUBSECTIONS.filter((k) => collected[k].length)
      .map((k) => `${k} ${collected[k].length}`)
      .join(', ') || 'none';

  // Fail-safe: if CHANGELOG.md is missing or has no [Unreleased] header, exit
  // WITHOUT deleting any fragment, so pending entries are never lost to a
  // half-run. Print one clean line rather than a raw stack trace.
  const changelogPath = path.join(cwd, 'CHANGELOG.md');
  let changelog;
  try {
    changelog = fs.readFileSync(changelogPath, 'utf8');
  } catch {
    console.error(
      `CHANGELOG.md not found at ${path.relative(cwd, changelogPath) || 'CHANGELOG.md'} — create it with a "## [Unreleased]" section, then re-run. Fragments left in place.`
    );
    process.exit(1);
  }
  let next;
  try {
    next = mergeIntoUnreleased(changelog, collected);
  } catch (e) {
    console.error(`Cannot assemble: ${e.message} Fragments left in place.`);
    process.exit(1);
  }

  if (draft) {
    console.log(`[DRAFT] ${contributing.length} fragment(s) → CHANGELOG [Unreleased] (${counts}).`);
    console.log('--- [Unreleased] preview ---');
    console.log(extractUnreleased(next));
    process.exit(0);
  }

  fs.writeFileSync(changelogPath, next);
  for (const f of contributing) fs.unlinkSync(f);
  console.log(`Assembled ${contributing.length} fragment(s) into CHANGELOG [Unreleased] (${counts}) and removed them.`);
  console.log('Review [Unreleased], then cut the version per .claude/specs/kit/releases.md.');
  process.exit(0);
}

module.exports = {
  FRAGMENT_DIR,
  SUBSECTIONS,
  parseSections,
  collectSections,
  renderUnreleasedBody,
  mergeIntoUnreleased,
  extractUnreleased,
  listFragmentFiles,
};
