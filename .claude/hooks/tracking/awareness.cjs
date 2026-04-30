#!/usr/bin/env node

/**
 * Awareness Hook
 *
 * Event: UserPromptSubmit
 * Purpose: Detect conditions that warrant running /analyze
 *
 * Checks tracking data for accumulated failures.
 * Outputs a gentle reminder when conditions are met.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  getSessionId,
  readTrackingState
} = require('../lib/session-utils.cjs');

const { runStdinHook } = require('../lib/stdin-hook.cjs');
runStdinHook(handleHook, { mode: 'observability' });

// Thresholds
const FAILURES_THRESHOLD = 5;

// Cooldown: don't spam the same warning
const COOLDOWN_FILE = path.join(os.tmpdir(), 'claude-awareness-cooldown.json');
const COOLDOWN_MINUTES = 30;

function handleHook(data) {
  const { session_id } = data;

  let cooldowns = {};
  try {
    cooldowns = JSON.parse(fs.readFileSync(COOLDOWN_FILE, 'utf8'));
  } catch (e) {}

  const now = Date.now();
  const warnings = [];

  // Check session tracking for failures
  if (session_id) {
    const sessionId = getSessionId(session_id);
    const tracking = readTrackingState(sessionId);

    const failureCount = tracking.failures?.length || 0;
    if (failureCount >= FAILURES_THRESHOLD && !inCooldown(cooldowns, 'failures', now)) {
      warnings.push(`${failureCount} tool failures this session. Worth investigating.`);
      cooldowns.failures = now;
    }
  }

  // Save cooldown state
  try {
    fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(cooldowns, null, 2));
  } catch (e) {}

  // Output warnings via UserPromptSubmit response JSON on stdout.
  // stderr on exit 0 is only shown in verbose mode; additionalContext reaches
  // Claude's context.
  if (warnings.length > 0) {
    const message = [
      '[AWARENESS] System check:',
      ...warnings.map(w => `  - ${w}`),
      'Consider running /analyze (from the claude-kit repo) to investigate.'
    ].join('\n');
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: message
      }
    }));
  }

  process.exit(0);
}

function inCooldown(cooldowns, key, now) {
  if (!cooldowns[key]) return false;
  const elapsed = (now - cooldowns[key]) / 60000;
  return elapsed < COOLDOWN_MINUTES;
}
