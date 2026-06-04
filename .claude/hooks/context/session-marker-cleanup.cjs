#!/usr/bin/env node

/**
 * Session Marker Cleanup Hook
 *
 * Event: Stop
 * Purpose: Remove this session's marker from .claude/sessions/ on clean
 *   shutdown so the next SessionStart doesn't see a phantom concurrent
 *   session. Stale markers are also pruned by PID-liveness check.
 */

const fs = require('fs');
const path = require('path');

function run(data) {
  const sessionId = data && data.session_id;
  if (!sessionId) return;
  try {
    const markerPath = path.join(process.cwd(), '.claude/sessions', `${sessionId}.json`);
    if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);
  } catch {}
}

if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook(run, { mode: 'observability' });
}

module.exports = { run };
