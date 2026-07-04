#!/usr/bin/env node

// @kit-internal — required by inject-context.cjs

/**
 * Shared utilities for context injection modules
 */

const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || process.env.USERPROFILE;

const sessionUtils = require('../lib/session-utils.cjs');

/**
 * Read a spec file
 */
function readSpecFile(filePath) {
  const fullPath = path.join(process.cwd(), filePath);
  try {
    return fs.readFileSync(fullPath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Log injection to session tracking
 */
function logInjection(sessionId, actions) {
  if (!sessionId) return;

  try {
    sessionUtils.appendTrackingEvent(sessionId, {
      type: 'injection',
      ...actions
    });
  } catch {
    // Silent fail - tracking is optional
  }
}

// A background-agent completion or Monitor event reaches UserPromptSubmit as a
// synthetic user turn whose prompt is the task-notification envelope, not genuine
// user input. Both shapes start with `<task-notification>` (optionally behind the
// `[SYSTEM NOTIFICATION - NOT USER INPUT]` marker); a real user prompt never does.
// inject-context uses this to skip the prompt-content matchers (capture, voice,
// lens, reasoning, spec) so incidental text in an agent result — e.g. an issue
// title containing "capture worker stdout" — is not read as a user directive.
// Root of #817; see #824.
function isBackgroundNotification(prompt) {
  if (typeof prompt !== 'string') return false;
  return /^\s*(\[SYSTEM NOTIFICATION - NOT USER INPUT\]|<task-notification>)/.test(prompt);
}

module.exports = {
  HOME,
  readSpecFile,
  logInjection,
  isBackgroundNotification
};
