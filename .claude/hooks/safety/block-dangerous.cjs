#!/usr/bin/env node

/**
 * Block Dangerous Commands Hook
 *
 * Event: PreToolUse (Bash)
 * Purpose: Prevents execution of dangerous commands
 *
 * Reads patterns from config/security-patterns.json (dangerous_commands section).
 * Blocks destructive file ops, force pushes, database drops,
 * credential exposure, and system damage commands.
 */

const fs = require('fs');
const path = require('path');

function loadPatterns() {
  const configPath = path.join(__dirname, '..', 'config', 'security-patterns.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    return (config.dangerous_commands || []).map(entry => ({
      pattern: new RegExp(entry.pattern, entry.flags || ''),
      reason: entry.reason
    }));
  } catch (e) {
    // Config missing or invalid — fail open, don't break the session
    return [];
  }
}

const { runStdinHook } = require('../lib/stdin-hook.cjs');
runStdinHook(handleHook, { mode: 'gating' });

function handleHook(data) {
  const { tool_input } = data;
  const command = tool_input?.command;

  if (!command) {
    process.exit(0);
  }

  // Strip heredoc content to avoid false positives on embedded examples.
  const commandToCheck = stripHeredocs(command);

  const patterns = loadPatterns();

  for (const { pattern, reason } of patterns) {
    if (pattern.test(commandToCheck)) {
      console.error(`[BLOCKED] ${reason}`);
      console.error(`Command: ${command}`);
      process.exit(2);
    }
  }

  process.exit(0);
}

function stripHeredocs(cmd) {
  return cmd.replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\1(?:\s*\).*)?$/gm, '<<HEREDOC_STRIPPED');
}
