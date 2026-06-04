#!/usr/bin/env node

/**
 * Prompt Start Hook
 *
 * Event: UserPromptSubmit
 * Purpose: Mark the start of a new prompt so per-prompt enforcement state
 * resets. Appends a `prompt_start` event to tracking; readers filter
 * events after the most recent prompt_start.
 *
 * This replaces the old read-modify-write on session-state.json. Appends
 * are atomic; per-prompt flags now live in the tracking event stream, not
 * in a separate mutable file.
 *
 * Filename kept as clear-pending.cjs because ~/.claude/settings.json
 * references it by name in the UserPromptSubmit hook command.
 */

const { getSessionId, appendTrackingEvent } = require('../lib/session-utils.cjs');

// Captures the skill name when the user's prompt starts with `/name` or the
// plugin-namespaced `/plugin:name`. The optional `(?:[a-z][a-z0-9-]*:)?` group
// matches the `plugin:` prefix; without it the colon broke the trailing `\s|$`
// anchor and namespaced commands recorded nothing (#612). The full `plugin:skill`
// token is kept verbatim so the recorded value matches the Skill-tool path, which
// stores `tool_input.skill` unmodified; skill-patterns.normalizeSkillName collapses
// the namespace downstream. Written as a dedicated event so phase inference covers
// both invocation paths: the Skill tool captures assistant-side invocations via
// tool-tracker, and slash commands bypass the Skill tool entirely.
const SLASH_COMMAND_RE = /^\s*\/((?:[a-z][a-z0-9-]*:)?[a-z][a-z0-9-]*)(?:\s|$)/i;

function parseSlashCommandSkill(prompt) {
  const text = typeof prompt === 'string' ? prompt : '';
  const match = text.match(SLASH_COMMAND_RE);
  return match ? match[1].toLowerCase() : null;
}

function handleHook(data) {
  const sessionId = getSessionId(data?.session_id);
  appendTrackingEvent(sessionId, { type: 'prompt_start' });

  const skill = parseSlashCommandSkill(data?.prompt);
  if (skill) {
    appendTrackingEvent(sessionId, {
      type: 'skill_invocation',
      skill,
      source: 'slash_command'
    });
  }
}

if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook(handleHook, { mode: 'observability' });
}

module.exports = { parseSlashCommandSkill, handleHook, SLASH_COMMAND_RE };
