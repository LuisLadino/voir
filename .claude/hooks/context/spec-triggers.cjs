#!/usr/bin/env node

/**
 * Spec Triggers Module
 *
 * Auto-loads spec files based on keywords in the user's prompt.
 *
 * Dynamic — scans .claude/specs/ for files with a `triggers` field in
 * frontmatter. No hardcoded paths. Works in any project.
 *
 * Spec frontmatter example:
 *   ---
 *   name: design-system
 *   triggers: [style, design, color, typography, tailwind]
 *   ---
 *
 */

const fs = require('fs');
const path = require('path');

const {
  getRecentTrackingState,
  stripCommandContent,
  logError
} = require('../lib/session-utils.cjs');
const { escapeRegex } = require('../lib/regex.cjs');

/**
 * Parse YAML frontmatter from a markdown file (simple parser — no deps)
 * Returns { name, triggers } or null
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;

  const yaml = match[1];
  const result = {};

  // Parse name
  const nameMatch = yaml.match(/^name:\s*(.+)$/m);
  if (nameMatch) result.name = nameMatch[1].trim().replace(/^["']|["']$/g, '');

  // Parse triggers — supports both inline [a, b] and multi-line list
  const triggersInline = yaml.match(/^triggers:\s*\[([^\]]+)\]/m);
  const triggersBlock = yaml.match(/^triggers:\s*\n((?:\s+-\s+.+\n?)+)/m);

  if (triggersInline) {
    result.triggers = triggersInline[1].split(',').map(t => t.trim().replace(/^["']|["']$/g, ''));
  } else if (triggersBlock) {
    result.triggers = triggersBlock[1]
      .split('\n')
      .map(line => line.replace(/^\s*-\s*/, '').trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }

  return result.triggers ? result : null;
}

/**
 * Recursively find all .md files in a directory
 */
function findMarkdownFiles(dir) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findMarkdownFiles(fullPath));
      } else if (entry.name.endsWith('.md') && entry.name !== 'README.md') {
        results.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist — fine
  }
  return results;
}

/**
 * Build trigger list. Two trigger shapes coexist:
 *   - file-based:    { patterns, specFile, label }           — loaded from .claude/specs/**\/*.md frontmatter
 *   - synthetic:     { patterns, providerFn, label }         — built-ins with a function data source
 *
 * `check()` prefers `providerFn` when present; otherwise reads `specFile`.
 * Synthetic triggers registered AFTER file-based so their output appears last
 * in the injected context block.
 *
 * Runs once per hook process — no module-level cache needed.
 */
function buildTriggers() {
  const specsDir = path.join(process.cwd(), '.claude/specs');
  const files = findMarkdownFiles(specsDir);
  const triggers = [];

  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const meta = parseFrontmatter(content);
      if (meta && meta.triggers && meta.triggers.length > 0) {
        const relPath = path.relative(process.cwd(), filePath);
        triggers.push({
          patterns: meta.triggers.map(t => new RegExp(`\\b${escapeRegex(t)}\\b`, 'i')),
          specFile: relPath,
          label: meta.name || path.basename(filePath, '.md')
        });
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Built-in synthetic triggers. Patterns require intent qualifiers so
  // incidental phrases like "end this session" or "what's done for lunch"
  // don't trigger context injection.
  triggers.push({
    patterns: [
      /what.*changed/i,
      /files.*modified/i,
      /(?:what|show|happened|summary|recap).{0,30}this session/i,
      /what.*\b(?:has|have|was|were|got|we['\u2019]?ve?|did)\b.*\bdone\b/i
    ],
    providerFn: provideSessionChanges,
    label: 'Session Changes'
  });

  return triggers;
}

/**
 * Redact likely secret patterns from a command string. Belt-and-suspenders
 * with stripCommandContent — that handles quoted bodies; this catches tokens
 * in header args and environment-style assignments.
 */
function redactSecrets(s) {
  return s
    .replace(/(Authorization:\s*Bearer\s+)\S+/gi, '$1<redacted>')
    .replace(/(-H\s+["']?Authorization:\s*Bearer\s+)\S+/gi, '$1<redacted>')
    .replace(/(token=|password=|api[_-]?key=|secret=)\S+/gi, '$1<redacted>')
    .replace(/\bghp_[A-Za-z0-9]{20,}/g, '<redacted-github-token>')
    .replace(/\bsk-[A-Za-z0-9]{20,}/g, '<redacted-api-key>')
    .replace(/\bAKIA[0-9A-Z]{16}/g, '<redacted-aws-key>');
}

/**
 * Sanitize a command for injection into Claude's context. Three-step
 * defense: strip heredoc/flag content, redact common secret patterns,
 * truncate to bound any remaining exposure.
 */
function sanitizeCommand(cmd) {
  if (!cmd) return null;
  const stripped = stripCommandContent(cmd);
  const redacted = redactSecrets(stripped);
  const max = 100;
  return redacted.length > max ? redacted.slice(0, max) + '…' : redacted;
}

/**
 * Synthetic-trigger provider: summarize what's happened in the current session.
 * Returns markdown string or null when no tracking data exists.
 */
function provideSessionChanges() {
  const state = getRecentTrackingState();
  if (!state) return null;

  const filesCreated = state.filesCreated || [];
  const filesModified = state.filesModified || [];
  const commands = state.commands || [];

  if (filesCreated.length === 0 && filesModified.length === 0 && commands.length === 0) {
    return null;
  }

  const parts = [];
  if (filesCreated.length > 0) {
    parts.push('**Files Created:**');
    filesCreated.forEach(f => parts.push(`- ${f}`));
  }
  if (filesModified.length > 0) {
    if (parts.length > 0) parts.push('');
    parts.push('**Files Modified:**');
    filesModified.forEach(f => parts.push(`- ${f}`));
  }
  if (commands.length > 0) {
    if (parts.length > 0) parts.push('');
    parts.push('**Commands Run (last 10):**');
    commands.slice(-10).forEach(c => {
      const raw = typeof c === 'string' ? c : c.command;
      const safe = sanitizeCommand(raw);
      if (safe) parts.push(`- ${safe}`);
    });
  }

  return parts.join('\n');
}

/**
 * Read a spec file
 */
function readSpecFile(filePath) {
  const fullPath = path.join(process.cwd(), filePath);
  try {
    return fs.readFileSync(fullPath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Check prompt for spec triggers
 * @param {string} prompt - User's prompt
 * @returns {{ content: string[]|null, specsLoaded: string[] }}
 */
function check(prompt) {
  const triggers = buildTriggers();
  const contentParts = [];
  const specsLoaded = [];

  for (const trigger of triggers) {
    const matches = trigger.patterns.some(pattern => pattern.test(prompt));
    if (!matches) continue;

    let content = null;
    if (typeof trigger.providerFn === 'function') {
      try {
        content = trigger.providerFn();
      } catch (err) {
        logError('spec-triggers', `providerFn "${trigger.label}" threw: ${err.message}`);
        content = null;
      }
    } else if (trigger.specFile) {
      content = readSpecFile(trigger.specFile);
    }

    if (content) {
      specsLoaded.push(trigger.label);
      contentParts.push(`[Auto-loaded: ${trigger.label}]\n${content}`);
    }
  }

  return {
    content: contentParts.length > 0 ? contentParts : null,
    specsLoaded
  };
}

module.exports = {
  buildTriggers,
  parseFrontmatter,
  readSpecFile,
  check
};
