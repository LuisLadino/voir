#!/usr/bin/env node

/**
 * Command Log Hook
 *
 * Event: PostToolUse (Bash)
 * Purpose: Append one tracking event per successful bash command.
 */

const {
  getSessionId,
  appendTrackingEvent
} = require('../lib/session-utils.cjs');

const { runStdinHook } = require('../lib/stdin-hook.cjs');
runStdinHook(handleHook, { mode: 'observability' });

function handleHook(data) {
  const { tool_input, tool_response, session_id } = data;
  const command = tool_input?.command;
  if (!command) process.exit(0);

  const sessionId = getSessionId(session_id);

  // PostToolUse only fires for successful commands (exit code 0).
  // Failed commands trigger PostToolUseFailure instead.
  appendTrackingEvent(sessionId, {
    type: 'command',
    command,
    exitCode: 0,
    success: true,
    stdout: tool_response?.stdout?.slice(0, 500) || '',
    interrupted: tool_response?.interrupted || false
  });

  process.exit(0);
}
