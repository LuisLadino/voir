#!/usr/bin/env node

/**
 * Capture Corrections Hook (UserPromptSubmit)
 *
 * Detects when user is correcting Claude.
 * Outputs a reminder so Claude captures the correction as a memory.
 * Runs on every user message, exits 0 (never blocks).
 */

const CORRECTION_PATTERNS = [
  // Direct corrections about Claude's behavior
  /you('re| are) not (following|doing|applying|listening)/i,
  /you didn'?t (follow|do|apply|listen|read|check)/i,
  /I (told|asked) you (to|not to)/i,
  /why (aren't|didn't|haven't) you (follow|do|apply|read|check)/i,
  /that's (wrong|incorrect|not right|not what I asked)/i,

  // Methodology/instruction failures
  /you('re| are) not teaching/i,
  /you forgot to/i,
  /you skipped/i,
  /you missed the/i,

  // Explicit behavior callouts
  /stop (guessing|assuming|making up|hallucinating)/i,
  /you('re| are) (hallucinating|pattern.?matching|guessing)/i,
  /read (the code|the file|it) (first|again|before)/i,

  // Repeated corrections
  /I('ve| have) (already )?(told|corrected|reminded) you/i,
  /this is the (second|third|\d+) time/i,
  /we (already )?discussed this/i,
  /I already (said|told|explained)/i
];

function handleHook(data) {
  const message = data?.prompt || data?.message || '';
  if (!message) process.exit(0);

  const matches = [];
  for (const pattern of CORRECTION_PATTERNS) {
    if (pattern.test(message)) {
      matches.push(pattern.toString());
    }
  }

  if (matches.length === 0) process.exit(0);

  const truncatedMessage = message.length > 200
    ? message.slice(0, 200) + '...'
    : message;

  const reminder = `[CORRECTION DETECTED] The user is correcting you. Save this as a feedback memory so you don't repeat this mistake. User said: "${truncatedMessage}"`;

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: reminder
    }
  }));

  process.exit(0);
}

const { runStdinHook } = require('../lib/stdin-hook.cjs');
runStdinHook(handleHook, { mode: 'observability' });
