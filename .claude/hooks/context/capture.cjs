#!/usr/bin/env node

// @kit-internal — required by inject-context.cjs

/**
 * Capture Module
 *
 * Handles "capture this" / "remember that" requests.
 * Redirects to Claude's native memory system instead of brain files.
 */

// Capture trigger patterns. A capture request is an IMPERATIVE the user issues,
// so each pattern is anchored to the start of the prompt, a line, or a sentence
// (?:^|[\n.!?]). This stops the verb "capture"/"remember" used descriptively
// mid-text — e.g. an agent result containing "Issue #321: capture worker
// stdout" reaching inject-context as the turn's prompt — from reading as a save
// request. The old /\bcapture[:\s]+.{5,}/ matched any "capture <noun>" anywhere
// and false-fired on background-agent result text (#817).
const CAPTURE_PATTERNS = [
  /(?:^|[\n.!?])\s*capture[:\s]+(this|that|the|it|my|our)\b/i,
  /(?:^|[\n.!?])\s*capture:\s*\S/i,
  /(?:^|[\n.!?])\s*save (this|that) (to|in) (the )?(brain|learnings|decisions|patterns|memory)\b/i,
  /(?:^|[\n.!?])\s*remember (this|that)\b/i,
  /(?:^|[\n.!?])\s*write (this|that) down\b/i,
  /(?:^|[\n.!?])\s*add (this|that) to (the )?(learnings|decisions|patterns|memory)\b/i
];

/**
 * Check if prompt is a capture request
 */
function isCaptureRequest(prompt) {
  return CAPTURE_PATTERNS.some(pattern => pattern.test(prompt));
}

/**
 * Check prompt for capture requests
 * @param {string} prompt - User's prompt
 * @returns {{ content: string|null, triggered: boolean }}
 */
function check(prompt) {
  if (!isCaptureRequest(prompt)) {
    return { content: null, triggered: false };
  }

  return {
    content: `[CAPTURE TRIGGERED]
User wants to save something. Use your memory system to persist it.

Choose the appropriate memory type:
- **user** — information about Luis's role, goals, preferences
- **feedback** — corrections or guidance Luis has given you
- **project** — ongoing work context, decisions, discoveries
- **reference** — pointers to external resources

Write the memory file, then update MEMORY.md index. Confirm what was captured.`,
    triggered: true
  };
}

module.exports = {
  CAPTURE_PATTERNS,
  isCaptureRequest,
  check
};
