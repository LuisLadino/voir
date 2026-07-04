#!/usr/bin/env node

/**
 * Awareness Hook
 *
 * Event: UserPromptSubmit
 * Purpose: Flag accumulated tool failures in the current session
 *
 * Checks tracking data for accumulated failures and outputs a gentle
 * heads-up when the threshold is crossed. This is a session-local signal:
 * cross-project kit health has its own path (npm run kit-health + the
 * kit-health-surface hook, #887), so this hook no longer points there.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  getSessionId,
  readTrackingState,
  sanitizeSessionId
} = require('../lib/session-utils.cjs');

const { runStdinHook } = require('../lib/stdin-hook.cjs');

const FAILURES_THRESHOLD = 5;
const COOLDOWN_MINUTES = 30;
const COOLDOWN_FILE_PREFIX = 'claude-awareness-cooldown-';
const COOLDOWN_FILE_SUFFIX = '.json';
const COOLDOWN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Per-session cooldown file. The previous global file at
// os.tmpdir()/claude-awareness-cooldown.json raced between parallel
// claude processes (orchestrator + dispatched workers), losing or
// cross-contaminating cooldowns. See #372.
function cooldownFilePath(sessionId) {
  return path.join(
    os.tmpdir(),
    `${COOLDOWN_FILE_PREFIX}${sanitizeSessionId(sessionId)}${COOLDOWN_FILE_SUFFIX}`
  );
}

function cleanupExpiredCooldowns(now = Date.now()) {
  const dir = os.tmpdir();
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    return;
  }
  for (const file of entries) {
    if (!file.startsWith(COOLDOWN_FILE_PREFIX)) continue;
    if (!file.endsWith(COOLDOWN_FILE_SUFFIX)) continue;
    const filePath = path.join(dir, file);
    try {
      const stat = fs.statSync(filePath);
      if (now - stat.mtime.getTime() > COOLDOWN_MAX_AGE_MS) {
        fs.unlinkSync(filePath);
      }
    } catch (e) {}
  }
}

function inCooldown(cooldowns, key, now) {
  if (!cooldowns[key]) return false;
  const elapsed = (now - cooldowns[key]) / 60000;
  return elapsed < COOLDOWN_MINUTES;
}

function handleHook(data) {
  const { session_id } = data;

  cleanupExpiredCooldowns();

  if (!session_id) {
    process.exit(0);
  }

  const cooldownFile = cooldownFilePath(session_id);

  let cooldowns = {};
  try {
    cooldowns = JSON.parse(fs.readFileSync(cooldownFile, 'utf8'));
  } catch (e) {}

  const now = Date.now();
  const warnings = [];

  // Only count genuine tool errors. nonzero_exit (grep no-match,
  // diff with differences) is excluded. Legacy events without a
  // failureKind count as tool_error to preserve prior behavior. See #369.
  const sessionId = getSessionId(session_id);
  const tracking = readTrackingState(sessionId);

  const failureCount = (tracking.failures || []).filter(
    f => !f.failureKind || f.failureKind === 'tool_error'
  ).length;
  if (failureCount >= FAILURES_THRESHOLD && !inCooldown(cooldowns, 'failures', now)) {
    warnings.push(`${failureCount} tool failures this session. Worth investigating.`);
    cooldowns.failures = now;
  }

  try {
    fs.writeFileSync(cooldownFile, JSON.stringify(cooldowns, null, 2));
  } catch (e) {}

  if (warnings.length > 0) {
    const message = [
      '[AWARENESS] System check:',
      ...warnings.map(w => `  - ${w}`)
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

if (require.main === module) {
  runStdinHook(handleHook, { mode: 'observability' });
}

module.exports = {
  handleHook,
  cooldownFilePath,
  cleanupExpiredCooldowns,
  inCooldown,
  COOLDOWN_FILE_PREFIX,
  COOLDOWN_FILE_SUFFIX,
  COOLDOWN_MAX_AGE_MS,
  COOLDOWN_MINUTES,
  FAILURES_THRESHOLD
};
