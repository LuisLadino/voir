#!/usr/bin/env node

/**
 * Voice Reminder Module
 *
 * Detects when Claude is being asked to write content on Luis's behalf and
 * injects the active voice contract's rules. Reinforces behavior at the
 * moment of writing instead of pointing to another file.
 *
 * Rule text is pulled from `.claude/voice.yaml` via the voice registry, so
 * the reminder stays in sync with the gate in `enforce-voice.cjs`. When the
 * registry is missing or invalid, falls back to the registry's hardcoded
 * Luis default.
 */

const { resolveVoice } = require('../lib/voice-registry.cjs');

const CONTENT_WRITING_PATTERNS = [
  /\b(write|draft|create|compose) (a |an |the |my |some )?(article|post|blog|email|message|bio|copy|content|text|description|about|intro|summary)\b/i,
  /\b(write|draft) (this |that |it )?(for me|in my voice)\b/i,
  /\b(portfolio|site|website|page) (content|copy|text)\b/i,
  /\b(home ?page|about page|landing page)\b/i,
  /\bcase study\b/i,
  /\bcover letter\b/i,
  /\bresume\b/i,
  /\blinkedin\b/i,
  /\btweet|thread|post\b/i,
  /\barticle (about|on|for)\b/i,
  /\bblog post\b/i,
  /\bwrite (up|out)\b/i,
  /\bput (this |it )?into words\b/i,
  /\bhow (should|would) (I|this) (say|phrase|word)\b/i,
  /\bwelcome comment\b/i,
  /\bslack message\b/i,
  /\b(final|review) form\b/i,
  /\b(write|draft|add|update|fix|change|edit) .{0,30}(comment|feedback|issue|section|point)\b/i,
  /\b(major|minor) issue/i,
  /\boccupational (review|assessment)\b/i
];

function isContentWriting(prompt) {
  return CONTENT_WRITING_PATTERNS.some(pattern => pattern.test(prompt));
}

function buildReminder(voice) {
  if (!voice.rules) return null;
  return `[VOICE: ${voice.name}] Writing on behalf of ${voice.name}. Apply these rules:\n${voice.rules}`;
}

function check(prompt) {
  if (!isContentWriting(prompt)) {
    return { content: null, voiceProfileLoaded: false };
  }

  const voice = resolveVoice({});
  const reminder = buildReminder(voice);

  if (!reminder) {
    return { content: null, voiceProfileLoaded: false };
  }

  return {
    content: [reminder],
    voiceProfileLoaded: true
  };
}

module.exports = {
  CONTENT_WRITING_PATTERNS,
  isContentWriting,
  check
};
