#!/usr/bin/env node

/**
 * Spec Discovery: shared file walker and glob matcher.
 *
 * Both enforce-specs and check-spec-conformance need to scan the kit's
 * spec directories and decide which files a given path matches. Kept
 * here so the two hooks cannot drift on glob semantics.
 *
 * Frontmatter parsing lives in the sibling lib/spec-frontmatter.cjs as a
 * single readSpecFrontmatter(); both hooks consume it so they cannot drift
 * on frontmatter semantics (#590 resolved the follow-up noted here).
 */

const fs = require('fs');
const path = require('path');

function findSpecFiles(dir) {
  const files = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findSpecFiles(full));
    } else if (entry.name.endsWith('.md') || entry.name.endsWith('.yaml')) {
      if (entry.name === 'README.md' || entry.name === 'stack-config.yaml') continue;
      files.push(full);
    }
  }
  return files;
}

// A real glob never needs more than one or two `**`. Beyond this a pattern is
// pathological, and we fail safe rather than build a catastrophically
// backtracking regex (ReDoS, #805).
const MAX_GLOBSTARS = 6;

function matchGlob(filePath, pattern) {
  // Collapse consecutive globstar runs before translating: `**/**/` matches the
  // same set as `**/`, but a run becomes nested `(.*/)?...(.*/)?` quantifiers
  // that backtrack catastrophically against a non-matching path. Then cap the
  // total `**` count and fail safe above it — the synchronous regex can't be
  // timed out, so prevention is the only guard (#805).
  const glob = pattern.replace(/(?:\*\*\/)+/g, '**/').replace(/\*{3,}/g, '**');
  if ((glob.match(/\*\*/g) || []).length > MAX_GLOBSTARS) {
    try { process.stderr.write(`[spec-discovery] glob rejected (>${MAX_GLOBSTARS} '**'): ${pattern}\n`); } catch {}
    return false;
  }
  let regexStr = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '{{DOUBLESTARSLASH}}')
    .replace(/\*\*/g, '{{DOUBLESTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
    .replace(/{{DOUBLESTARSLASH}}/g, '(.*/)?')
    .replace(/{{DOUBLESTAR}}/g, '.*');
  if (!glob.includes('/')) {
    regexStr = '(.*/)?'+ regexStr;
  }
  const re = new RegExp('^' + regexStr + '$');
  return re.test(filePath) || re.test(filePath.replace(/^.*?\.claude/, '.claude'));
}

module.exports = { findSpecFiles, matchGlob };
