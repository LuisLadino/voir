#!/usr/bin/env node
// @kit-internal — called by .git/hooks/commit-msg and /commit skill, not a Claude Code lifecycle hook
// Scans text for AI-attribution patterns. Used by client-mode projects to
// prevent Claude/Anthropic attribution from landing in client repos.
//
// Called by:
//   .git/hooks/commit-msg  — git passes commit message file path as $1
//   /commit skill          — scans PR body before gh pr create
//
// This is a CLI utility, not a Claude Code lifecycle hook. Exit code 1
// indicates attribution found (blocks caller). Exit 0 is clean.
//
// Usage:
//   scan-attribution.cjs <file>       Read file and scan
//   scan-attribution.cjs --stdin      Read from stdin
//
// Exit codes:
//   0  clean
//   1  attribution found
//   2  usage or read error

const fs = require('fs');

const ATTRIBUTION_PATTERNS = [
  { name: 'Claude co-author trailer', regex: /^Co-Authored-By:.*claude/im },
  { name: 'Anthropic co-author trailer', regex: /^Co-Authored-By:.*anthropic/im },
  { name: 'Generated with Claude', regex: /Generated with Claude/i },
  { name: 'Built with Claude Code', regex: /Built with Claude Code/i },
  { name: 'Emoji-generated-with attribution', regex: /🤖\s*Generated with/i },
];

function scan(text) {
  const violations = [];
  for (const pattern of ATTRIBUTION_PATTERNS) {
    const match = text.match(pattern.regex);
    if (match) {
      violations.push({ pattern: pattern.name, match: match[0] });
    }
  }
  return violations;
}

function readStdin() {
  return fs.readFileSync(0, 'utf-8');
}

function main() {
  const arg = process.argv[2];

  if (!arg) {
    console.error('Usage: scan-attribution.cjs <file> | scan-attribution.cjs --stdin');
    process.exit(2);
  }

  let text;
  if (arg === '--stdin') {
    text = readStdin();
  } else {
    try {
      text = fs.readFileSync(arg, 'utf-8');
    } catch (err) {
      console.error(`scan-attribution: cannot read ${arg}: ${err.message}`);
      process.exit(2);
    }
  }

  const violations = scan(text);

  if (violations.length > 0) {
    console.error('');
    console.error('AI-attribution patterns found (client mode blocks these):');
    for (const v of violations) {
      console.error(`  • ${v.pattern}: "${v.match.trim()}"`);
    }
    console.error('');
    console.error('Remove the attribution and retry.');
    process.exit(1);
  }

  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { scan, ATTRIBUTION_PATTERNS };
