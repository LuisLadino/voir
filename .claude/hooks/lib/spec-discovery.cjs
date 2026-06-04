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

function matchGlob(filePath, pattern) {
  let regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '{{DOUBLESTARSLASH}}')
    .replace(/\*\*/g, '{{DOUBLESTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
    .replace(/{{DOUBLESTARSLASH}}/g, '(.*/)?')
    .replace(/{{DOUBLESTAR}}/g, '.*');
  if (!pattern.includes('/')) {
    regexStr = '(.*/)?'+ regexStr;
  }
  const re = new RegExp('^' + regexStr + '$');
  return re.test(filePath) || re.test(filePath.replace(/^.*?\.claude/, '.claude'));
}

module.exports = { findSpecFiles, matchGlob };
