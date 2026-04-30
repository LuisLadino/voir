#!/usr/bin/env node

/**
 * Track File Changes Hook
 *
 * Event: PostToolUse (Edit|Write)
 * Purpose: Append a file_change event for every file edit or creation.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const {
  getSessionId,
  appendTrackingEvent
} = require('../lib/session-utils.cjs');

function fileExisted(filePath) {
  // spawnSync with argv bypasses the shell, so filenames with quotes or
  // metacharacters can't inject. `--` stops git from treating paths that
  // start with a dash as options.
  const res = spawnSync('git', ['ls-files', '--error-unmatch', '--', filePath], {
    stdio: 'pipe'
  });
  return res.status === 0;
}

const { runStdinHook } = require('../lib/stdin-hook.cjs');
runStdinHook(handleHook, { mode: 'observability' });

function handleHook(data) {
  const { tool_name, tool_input, session_id } = data;
  const filePath = tool_input?.file_path;
  if (!filePath) process.exit(0);

  const cwd = process.cwd();
  const sessionId = getSessionId(session_id);
  const relativePath = path.relative(cwd, filePath);
  const op = tool_name === 'Write' && !fileExisted(filePath) ? 'create' : 'modify';

  appendTrackingEvent(sessionId, {
    type: 'file_change',
    tool: tool_name,
    file: relativePath,
    op
  });

  process.exit(0);
}
