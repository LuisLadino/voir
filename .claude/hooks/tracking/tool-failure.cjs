#!/usr/bin/env node

/**
 * Tool Failure Tracker
 *
 * Event: PostToolUseFailure (all tools)
 * Purpose: Append one tracking event per failed tool call.
 */

const {
  getSessionId,
  appendTrackingEvent
} = require('../lib/session-utils.cjs');
const { classifyFailure } = require('./classify-failure.cjs');

const { runStdinHook } = require('../lib/stdin-hook.cjs');
runStdinHook(handleHook, { mode: 'observability' });

function handleHook(data) {
  const { tool_name, tool_input, tool_response, session_id } = data;
  if (!tool_name) process.exit(0);

  const sessionId = getSessionId(session_id);

  const entry = {
    type: 'failure',
    tool: tool_name,
    failureKind: classifyFailure(tool_name, tool_input),
    error: tool_response?.error || tool_response?.stderr || 'Unknown error'
  };

  switch (tool_name) {
    case 'Read':
    case 'Edit':
    case 'Write':
      entry.file = tool_input?.file_path;
      break;
    case 'Bash':
      entry.command = tool_input?.command?.slice(0, 100);
      break;
    case 'Glob':
    case 'Grep':
      entry.pattern = tool_input?.pattern;
      break;
    default:
      if (tool_name.startsWith('mcp__')) {
        entry.server = tool_name.split('__')[1];
      }
  }

  appendTrackingEvent(sessionId, entry);
  process.exit(0);
}

