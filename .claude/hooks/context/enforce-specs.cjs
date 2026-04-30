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
  getRecentPromptScopedState,
  getRecentSessionScopedSpecState
} = require('../lib/session-utils.cjs');

const SPECS_DIR = '.claude/specs';
const STACK_CONFIG_PATH = '.claude/specs/stack-config.yaml';

// Files/paths to skip enforcement entirely
const SKIP_PATTERNS = [
  /node_modules/,
  /\.git\//,
  /package-lock\.json/,
  /yarn\.lock/,
  /pnpm-lock\.yaml/,
];

const { runStdinHook } = require('../lib/stdin-hook.cjs');
runStdinHook(handleHook, { mode: 'gating' });

function handleHook(data) {
  const { tool_input, agent_id } = data;
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

  // Subagents don't fire UserPromptSubmit, so no `prompt_start` is ever
  // written to their tracking file. Branch on `agent_id` and use the
  // session-scoped reader so enforcement works in subagent contexts.
  // See .claude/specs/claude-code/hooks.md for the payload contract.
  const isSubagent = typeof agent_id === 'string' && agent_id.length > 0;
  const readerState = isSubagent
    ? getRecentSessionScopedSpecState()
    : getRecentPromptScopedState();
  const promptState = readerState || { specsRead: [] };
  const specsRead = promptState.specsRead || [];

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
function scanSpecFiles() {
  const mappings = [];

  try {
    const specFiles = findSpecFiles(SPECS_DIR);

    for (const specFile of specFiles) {
      try {
        const frontmatter = readFrontmatter(specFile);
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

/**
 * Recursively find .md and .yaml files in a directory
 */
function findSpecFiles(dir) {
  const files = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        files.push(...findSpecFiles(fullPath));
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.yaml')) {
        // Skip README and stack-config (not specs)
        if (entry.name === 'README.md' || entry.name === 'stack-config.yaml') continue;
        files.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist or isn't readable
  }

  return files;
}

/**
 * Read YAML frontmatter from a file (--- delimited block at top).
 * For .yaml files, read the comment-based metadata instead.
 */
function readFrontmatter(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');

  if (filePath.endsWith('.yaml')) {
    return readYamlMetadata(content);
  }

  // Parse markdown frontmatter (--- delimited)
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  return parseSimpleYaml(match[1]);
}

/**
 * Read metadata from YAML file comments.
 * Looks for comment lines like:  #   name: system-map
 */
function readYamlMetadata(content) {
  const lines = content.split('\n');
  const metadata = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match comment-based metadata: #   key: value
    const metaMatch = line.match(/^#\s+(name|description|applies_to|excludes|category|related):\s*(.*)/);
    if (!metaMatch) continue;

    const key = metaMatch[1];
    const value = metaMatch[2].trim();

    if (key === 'applies_to' || key === 'excludes' || key === 'related') {
      // Collect as array from subsequent comment lines
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

/**
 * Simple YAML parser for frontmatter.
 * Handles: name, description, applies_to, related, category
 * No external yaml package needed.
 */
function parseSimpleYaml(yamlStr) {
  const result = {};
  const lines = yamlStr.split('\n');

  let currentKey = null;
  let currentArray = null;

  for (const line of lines) {
    // Key: value
    const kvMatch = line.match(/^(\w+):\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const value = kvMatch[2].trim();

      if (value === '' || value === '>') {
        if (value === '') {
          currentArray = [];
          result[currentKey] = currentArray;
        } else {
          result[currentKey] = '';
        }
      } else {
        result[currentKey] = value;
        currentArray = null;
      }
      continue;
    }

    // Array item:   - "value" or   - value
    const arrayMatch = line.match(/^\s+-\s+"?([^"]*)"?/);
    if (arrayMatch && currentArray !== null) {
      currentArray.push(arrayMatch[1]);
      continue;
    }

    // Multi-line string continuation
    if (currentKey && typeof result[currentKey] === 'string' && line.match(/^\s+\S/)) {
      result[currentKey] = result[currentKey]
        ? result[currentKey] + ' ' + line.trim()
        : line.trim();
    }
  }

  // Convert related from string to array if needed
  if (result.related && typeof result.related === 'string') {
    result.related = result.related.replace(/[\[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean);
  }

  return result;
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

function matchGlob(filePath, pattern) {
  let regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '{{DOUBLESTARSLASH}}')
    .replace(/\*\*/g, '{{DOUBLESTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
    .replace(/{{DOUBLESTARSLASH}}/g, '(.*/)?')
    .replace(/{{DOUBLESTAR}}/g, '.*');

  // Bare filename patterns (no /) should match at any depth
  if (!pattern.includes('/')) {
    regex = '(.*/)?'+ regex;
  }

  const re = new RegExp('^' + regex + '$');
  return re.test(filePath) || re.test(filePath.replace(/^.*?\.claude/, '.claude'));
}

