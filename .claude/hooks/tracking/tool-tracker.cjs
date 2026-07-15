#!/usr/bin/env node

/**
 * Universal Tool Tracker
 *
 * Event: PostToolUse (all tools)
 * Purpose: Append a tracking event for every tool call.
 */

const path = require('path');

const {
  getSessionId,
  appendTrackingEvent
} = require('../lib/session-utils.cjs');

const { extractCommandSignals } = require('../lib/skill-patterns.cjs');

const { runStdinHook } = require('../lib/stdin-hook.cjs');
runStdinHook(handleHook, { mode: 'observability' });

function handleHook(data) {
  const { tool_name, tool_input, tool_response, session_id } = data;
  if (!tool_name) process.exit(0);

  const cwd = process.cwd();
  const sessionId = getSessionId(session_id);

  const entry = { type: 'tool', tool: tool_name, success: true };

  switch (tool_name) {
    case 'Skill':
      entry.skill = tool_input?.skill;
      entry.args = tool_input?.args;
      break;

    case 'Read':
    case 'Edit':
    case 'Write':
      entry.file = relativePath(cwd, tool_input?.file_path);
      break;

    case 'Glob':
      entry.pattern = tool_input?.pattern;
      entry.matchCount = countMatches(tool_response);
      break;

    case 'Grep':
      entry.pattern = tool_input?.pattern;
      entry.path = tool_input?.path;
      entry.matchCount = countMatches(tool_response);
      break;

    case 'Bash': {
      // Truncate the display copy, but extract completion signals from the FULL
      // command first — otherwise a signal in a compound-command tail past 100
      // chars is invisible to verify-before-stop / skill-telemetry (#895).
      entry.command = truncate(tool_input?.command, 100);
      const signals = extractCommandSignals(tool_input?.command);
      if (signals.length) entry.signals = signals;
      break;
    }

    case 'Task':
      entry.subagent = tool_input?.subagent_type;
      entry.description = tool_input?.description;
      break;

    case 'WebSearch':
      entry.query = tool_input?.query;
      break;

    case 'WebFetch':
      entry.url = tool_input?.url;
      break;

    case 'AskUserQuestion':
      entry.questionCount = tool_input?.questions?.length;
      break;

    default:
      if (tool_name.startsWith('mcp__')) {
        entry.category = 'mcp';
        const parts = tool_name.split('__');
        entry.server = parts[1];
        entry.function = parts[2];
        if (tool_input?.query) entry.query = truncate(tool_input.query, 100);
        if (tool_input?.libraryId) entry.libraryId = tool_input.libraryId;
      } else {
        entry.inputKeys = tool_input ? Object.keys(tool_input) : [];
      }
  }

  appendTrackingEvent(sessionId, entry);
  process.exit(0);
}

function relativePath(cwd, filePath) {
  if (!filePath) return null;
  if (filePath.startsWith(cwd)) return path.relative(cwd, filePath);
  if (filePath.startsWith(process.env.HOME)) {
    return '~' + filePath.slice(process.env.HOME.length);
  }
  return filePath;
}

function truncate(str, maxLen) {
  if (!str) return null;
  return str.length <= maxLen ? str : str.slice(0, maxLen) + '...';
}

function countMatches(response) {
  if (!response) return null;
  if (typeof response === 'string') {
    return response.split('\n').filter(l => l.trim()).length;
  }
  if (Array.isArray(response)) return response.length;
  return null;
}
