#!/usr/bin/env node

/**
 * Block Dangerous Commands Hook
 *
 * Event: PreToolUse (Bash)
 * Purpose: Prevents execution of dangerous commands
 *
 * Reads patterns from config/security-patterns.json (dangerous_commands section).
 * Blocks destructive file ops, force pushes, database drops, credential
 * exposure, and system damage commands.
 *
 * Heredoc bodies are stripped (placeholder mode) before matching so a dangerous
 * pattern documented inside a heredoc example does not false-positive. The
 * shared stripper lives in command-position.cjs (#769).
 */

const fs = require('fs');
const path = require('path');
const { stripHeredocs } = require('../lib/command-position.cjs');

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

// Returns { reason } for the first matching dangerous pattern, else null.
// Heredoc bodies are neutralized first so an embedded example never trips a
// pattern that real execution would not.
function detectDangerous(command) {
  if (typeof command !== 'string' || !command) return null;
  const commandToCheck = stripHeredocs(command, { mode: 'placeholder' });
  for (const { pattern, reason } of loadPatterns()) {
    if (pattern.test(commandToCheck)) return { reason };
  }
  return null;
}

function handleHook(data) {
  const command = data && data.tool_input && data.tool_input.command;
  if (!command) {
    process.exit(0);
  }
  const hit = detectDangerous(command);
  if (hit) {
    console.error(`[BLOCKED] ${hit.reason}`);
    console.error(`Command: ${command}`);
    process.exit(2);
  }
  process.exit(0);
}

if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook(handleHook, { mode: 'gating' });
}

module.exports = { detectDangerous, handleHook };
