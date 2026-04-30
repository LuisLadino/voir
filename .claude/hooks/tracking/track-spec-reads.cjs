#!/usr/bin/env node

/**
 * Track Spec Reads Hook
 *
 * Event: PostToolUse (Read)
 * Purpose: Track when spec files and the plan skill are read. Emits events
 * that per-prompt enforcement hooks use to decide whether to allow edits
 * and issue creation.
 *
 * Appends two event types:
 *   - spec_read       — a spec file was read; carries { name, filePath }
 *   - plan_skill_read — the plan skill's SKILL.md was read
 *
 * Reads spec definitions from stack-config.yaml so new specs get picked up
 * without code changes.
 */

const fs = require('fs');
const path = require('path');

const { getSessionId, appendTrackingEvent } = require('../lib/session-utils.cjs');

const STACK_CONFIG_PATH = '.claude/specs/stack-config.yaml';

// Pattern for plan skill (separate enforcement)
const PLAN_SKILL_PATTERN = /\.claude\/skills\/plan\/SKILL\.md$/;

const { runStdinHook } = require('../lib/stdin-hook.cjs');
runStdinHook(handleHook, { mode: 'observability' });

function handleHook(data) {
  const { tool_input, session_id } = data;
  const filePath = tool_input?.file_path;

  if (!filePath) process.exit(0);

  const isPlanSkill = PLAN_SKILL_PATTERN.test(filePath);
  const specName = findSpecName(filePath);

  if (!specName && !isPlanSkill) process.exit(0);

  const sessionId = getSessionId(session_id);

  if (specName) {
    appendTrackingEvent(sessionId, {
      type: 'spec_read',
      name: specName,
      filePath
    });
    console.log(`[READY] Read ${specName} spec - edits allowed this prompt.`);
  }

  if (isPlanSkill) {
    appendTrackingEvent(sessionId, {
      type: 'plan_skill_read',
      filePath
    });
    console.log(`[READY] Read plan skill - issue creation allowed this prompt.`);
  }

  process.exit(0);
}

function loadStackConfig() {
  try {
    const content = fs.readFileSync(STACK_CONFIG_PATH, 'utf8');
    return parseStackConfigYaml(content);
  } catch {
    return null;
  }
}

/**
 * Purpose-built parser for stack-config.yaml's spec structure.
 * Extracts specs: { category: [{ name, file }, ...] }
 */
function parseStackConfigYaml(content) {
  const result = { specs: {} };
  const lines = content.split('\n');

  let inSpecs = false;
  let currentCategory = null;
  let currentItem = null;

  for (const line of lines) {
    if (/^specs:\s*$/.test(line)) {
      inSpecs = true;
      continue;
    }

    if (inSpecs && /^\S/.test(line) && !line.startsWith('#')) {
      inSpecs = false;
      continue;
    }

    if (!inSpecs) continue;

    const catMatch = line.match(/^  (\S[^:]+):\s*$/);
    if (catMatch) {
      currentCategory = catMatch[1];
      result.specs[currentCategory] = [];
      currentItem = null;
      continue;
    }

    if (!currentCategory) continue;

    const itemMatch = line.match(/^\s{4}-\s+name:\s*(.+)/);
    if (itemMatch) {
      currentItem = { name: itemMatch[1].trim().replace(/^"|"$/g, '') };
      result.specs[currentCategory].push(currentItem);
      continue;
    }

    if (currentItem) {
      const propMatch = line.match(/^\s{6}(\w+):\s*(.+)/);
      if (propMatch) {
        const key = propMatch[1];
        const val = propMatch[2].trim().replace(/^"|"$/g, '');
        if (key === 'file') {
          currentItem.file = val;
        }
      }
    }
  }

  return result;
}

function findSpecName(filePath) {
  const config = loadStackConfig();

  // Config-aware match: use frontmatter name from stack-config.yaml when present.
  if (config?.specs) {
    const normalizedPath = filePath.replace(/^.*?\.claude\/specs\//, '');

    for (const category of Object.keys(config.specs)) {
      const specs = config.specs[category];
      if (!Array.isArray(specs)) continue;

      for (const spec of specs) {
        if (spec.file && normalizedPath.endsWith(spec.file.replace(/^.*\//, ''))) {
          return spec.name;
        }
        if (spec.file && filePath.includes(spec.file)) {
          return spec.name;
        }
      }
    }
  }

  // Fallback: any file in the specs directory becomes a generic spec name.
  // Runs even when stack-config.yaml is missing (fresh client projects before /sync-stack).
  if (filePath.includes('.claude/specs/')) {
    return path.basename(filePath, path.extname(filePath));
  }

  return null;
}
