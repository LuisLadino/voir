#!/usr/bin/env node

/**
 * Subagent Tracker
 *
 * Event: SubagentStart, SubagentStop
 * Purpose: Append a subagent_start or subagent_stop event. Readers pair them
 *          by id to compute duration — we no longer mutate past state.
 */

const {
  getSessionId,
  appendTrackingEvent
} = require('../lib/session-utils.cjs');

const { runStdinHook } = require('../lib/stdin-hook.cjs');
runStdinHook(handleHook, { mode: 'observability' });

function handleHook(data) {
  const { session_id, hook_type, subagent_id, subagent_type, description } = data;

  const sessionId = getSessionId(session_id);
  const isStart = hook_type?.includes('Start');

  appendTrackingEvent(sessionId, {
    type: isStart ? 'subagent_start' : 'subagent_stop',
    id: subagent_id,
    subagentType: subagent_type,
    description
  });

  process.exit(0);
}
