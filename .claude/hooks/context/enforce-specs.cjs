#!/usr/bin/env node

/**
 * Enforce Specs Hook
 *
 * Event: PreToolUse (Edit|Write)
 * Purpose: DENY file edits until ALL relevant specs have been read
 *
 * Scans .claude/specs/ for spec files with frontmatter.
 * Each spec declares applies_to patterns in its frontmatter.
 * A file can match multiple specs — all must be read before editing.
 *
 * No manual registration needed — create a spec with frontmatter,
 * it's automatically enforced.
 */

const fs = require('fs');
const path = require('path');

const {
  getRecentSessionScopedSpecState
} = require('../lib/session-utils.cjs');

const STACK_CONFIG_PATH = '.claude/specs/stack-config.yaml';
const { getSpecRoots } = require('../lib/spec-roots.cjs');
const { findSpecFiles, matchGlob } = require('../lib/spec-discovery.cjs');
const { readSpecFrontmatter } = require('../lib/spec-frontmatter.cjs');

// Files/paths to skip enforcement entirely
const SKIP_PATTERNS = [
  /node_modules/,
  /\.git\//,
  /package-lock\.json/,
  /yarn\.lock/,
  /pnpm-lock\.yaml/,
];

const { runStdinHook } = require('../lib/stdin-hook.cjs');

if (require.main === module) {
  runStdinHook(handleHook, { mode: 'gating' });
}

function handleHook(data) {
  const { tool_input, session_id } = data;
  const filePath = tool_input?.file_path;

  if (!filePath) {
    process.exit(0); // Allow
  }

  // Check if should skip entirely
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(filePath)) {
      process.exit(0); // Allow
    }
  }

  // Scan spec files for applies_to patterns
  const mappings = scanSpecFiles();
  if (!mappings || mappings.length === 0) {
    process.exit(0); // No specs with applies_to, allow
  }

  // Find ALL specs that apply to this file
  const matches = findAllMatchingSpecs(filePath, mappings);

  if (matches.length === 0) {
    process.exit(0); // No spec requirement for this file type
  }

  // Spec-read state is session-scoped (#459, #452): a spec read once in the
  // session stays satisfied across prompt cycles and `/build` branch switches.
  // The old prompt-scoped reader reset state at every prompt_start, so every
  // new prompt re-required every spec for the file being edited. Dispatch
  // isolation is unaffected — each worker is a separate CC session with its
  // own tracking file, so it still reads its own specs. Subagents need this
  // reader too: they never fire UserPromptSubmit, so no prompt_start is ever
  // written and a prompt-scoped reader would fail closed. Thread `session_id`
  // so the reader opens THIS session's tracking file, not whichever file a
  // sibling CC session wrote to last. See #263.
  const readerState = getRecentSessionScopedSpecState(undefined, session_id);
  const specState = readerState || { specsRead: [] };
  const specsRead = specState.specsRead || [];

  // For each matching spec, check if it was read
  // Accept both frontmatter name and file basename — track-spec-reads may use either
  // Note: related specs are recommendations, not substitutes
  const unreadSpecs = matches.filter(match => {
    const basename = path.basename(match.specPath, path.extname(match.specPath));
    const ownNames = [match.name, basename];
    return !ownNames.some(name => specsRead.includes(name));
  });

  if (unreadSpecs.length === 0) {
    process.exit(0); // All required specs were read, allow
  }

  // Some specs not read - DENY and list all unread
  const specList = unreadSpecs.map(s => `  - ${s.specPath}`).join('\n');

  // Fresh client projects that haven't run /sync-stack hit a confusing loop:
  // spec reads don't register (track-spec-reads falls back to basename now,
  // but the missing config is still a setup gap worth surfacing).
  const syncStackHint = fs.existsSync(STACK_CONFIG_PATH)
    ? ''
    : '\n\nNote: .claude/specs/stack-config.yaml is missing. If this is a fresh client project, run `/sync-stack` to generate it.';

  console.error(`[BLOCKED] Read all required specs before editing.

You're about to edit: ${path.basename(filePath)}
Unread specs (${unreadSpecs.length}):
${specList}

**Read each spec listed above, then retry this edit.**${syncStackHint}`);

  process.exit(2); // DENY
}

/**
 * Scan .claude/specs/ recursively for files with frontmatter containing applies_to.
 * Returns array of { name, specPath, patterns, related }
 */
function scanSpecFiles(cwd = process.cwd()) {
  const mappings = [];

  try {
    const { roots } = getSpecRoots(cwd);
    const specFiles = roots.flatMap(root => findSpecFiles(root));

    for (const specFile of specFiles) {
      try {
        const frontmatter = readSpecFrontmatter(specFile);
        if (frontmatter && frontmatter.applies_to && frontmatter.applies_to.length > 0) {
          mappings.push({
            name: frontmatter.name || path.basename(specFile, path.extname(specFile)),
            specPath: specFile,
            patterns: frontmatter.applies_to,
            excludes: frontmatter.excludes || [],
            related: frontmatter.related || []
          });
        }
      } catch {
        // Skip files with bad frontmatter — don't crash enforcement
      }
    }
  } catch {
    // If specs dir doesn't exist, no enforcement
  }

  return mappings;
}

function findAllMatchingSpecs(filePath, mappings) {
  const normalizedPath = path.relative(process.cwd(), filePath);
  const matches = [];

  for (const mapping of mappings) {
    let included = false;
    for (const pattern of mapping.patterns) {
      if (matchGlob(normalizedPath, pattern)) {
        included = true;
        break;
      }
    }
    if (!included) continue;

    // Check excludes — if any exclude pattern matches, skip this spec
    let excluded = false;
    for (const pattern of mapping.excludes) {
      if (matchGlob(normalizedPath, pattern)) {
        excluded = true;
        break;
      }
    }
    if (excluded) continue;

    matches.push(mapping);
  }

  return matches;
}

module.exports = { scanSpecFiles, findAllMatchingSpecs, handleHook };

