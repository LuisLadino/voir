#!/usr/bin/env node

/**
 * Spec Frontmatter: the single frontmatter reader for the kit.
 *
 * enforce-specs and check-spec-conformance both turn a spec file into a
 * metadata map. They used to carry separate parsers — an inline flat parser
 * in enforce-specs and a yaml-mini call in spec-conformance — which could
 * silently drift on any field past a scalar or scalar list. This module is
 * the one place that parses spec frontmatter, so the two hooks cannot diverge
 * again (#590, completing the shared-discovery work in #460).
 *
 * Markdown specs: the `---` delimited frontmatter block, parsed by yaml-mini.
 * YAML specs (e.g. system-map.yaml): metadata lives in a leading comment block
 * (`#   name: ...`), since the file body is config data, not frontmatter. That
 * comment format is parsed here too.
 *
 * Returns the parsed map, or null when the file is unreadable, has no
 * frontmatter, or fails to parse. Callers treat null as "no spec metadata"
 * and skip — a parse failure can never freeze enforcement or a commit.
 */

const fs = require('fs');
const yamlMini = require('./yaml-mini.cjs');

function readSpecFrontmatter(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  if (filePath.endsWith('.yaml')) {
    return readYamlMetadata(content);
  }

  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  try {
    return yamlMini.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Read metadata from YAML-file comments. Looks for comment lines like:
 *   #   name: system-map
 * Moved verbatim from enforce-specs.cjs — .yaml specs declare their metadata
 * in a leading comment block because the body is config data, not frontmatter.
 */
function readYamlMetadata(content) {
  const lines = content.split('\n');
  const metadata = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const metaMatch = line.match(/^#\s+(name|description|applies_to|excludes|category|related):\s*(.*)/);
    if (!metaMatch) continue;

    const key = metaMatch[1];
    const value = metaMatch[2].trim();

    if (key === 'applies_to' || key === 'excludes' || key === 'related') {
      const arr = [];
      for (let j = i + 1; j < lines.length; j++) {
        const itemMatch = lines[j].match(/^#\s+-\s+"?([^"]*)"?/);
        if (itemMatch) {
          arr.push(itemMatch[1]);
        } else if (lines[j].match(/^#\s+\w+:/) || !lines[j].match(/^#/)) {
          break;
        }
      }
      metadata[key] = arr;
    } else {
      metadata[key] = value;
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : null;
}

module.exports = { readSpecFrontmatter, readYamlMetadata };
