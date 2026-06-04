#!/usr/bin/env node

/**
 * Per-skill telemetry windowing — the single window-building core shared by
 * the prompt-scoped enforcement reader (session-utils.readSkillTelemetryState)
 * and the cross-session analytics collector (scripts/collect-analyze-data.cjs).
 *
 * #347 hoisted the completion *rule* into skill-patterns.cjs so "did this skill
 * complete" can't diverge between enforcement and analytics. This module is the
 * matching hoist for the *windowing mechanics* (#614): what opens and closes a
 * window, how tools and failures are counted, how fallbacks are attributed.
 * Both consumers now call one implementation.
 *
 * A window opens at a `skill_invocation` event (slash-command path) OR at a
 * `tool` event with `tool === 'Skill'` (assistant Skill-tool call). It closes
 * at the next window-opening event, the next segment boundary, or end-of-events.
 *
 * Two consumers, two segmentation policies — the ONLY axis on which they differ:
 *   - 'prompt-scoped' (enforcement): state resets at every `prompt_start`; only
 *     the most recent prompt's windows are returned; fails closed (returns [])
 *     when no `prompt_start` has been written, e.g. subagent sessions. This is
 *     what verify-before-stop reads at Stop time — a per-prompt nudge, not a
 *     gate, so prior turns must not re-trigger (#231).
 *   - 'all' (analytics): every window across every prompt and every session is
 *     kept, including the pre-first-`prompt_start` segment and whole-file
 *     subagent sessions with no `prompt_start` at all. /analyze needs the full
 *     trend, not just the last prompt.
 *
 * Fallback attribution is per-segment in both modes: a skill that never reached
 * its completion signal, followed by a *different* skill in the same segment, is
 * a fallback. Exempt and completed windows never count.
 */

const skillPatterns = require('./skill-patterns.cjs');

function reduceSkillWindows(events, endTimestamp) {
  const records = [];
  let openWindow = null;

  function closeWindow(ts) {
    if (!openWindow) return;
    const bashCommands = openWindow.tools
      .filter((t) => t.tool === 'Bash' && typeof t.command === 'string')
      .map((t) => t.command);
    const usedTools = new Set(openWindow.tools.map((t) => t.tool));
    const { complete } = skillPatterns.isSkillComplete(
      openWindow.skill_name,
      bashCommands,
      usedTools
    );
    const exempt = skillPatterns.isSkillExempt(openWindow.skill_name);
    const registered = skillPatterns.isSkillRegistered(openWindow.skill_name);
    const ended_at = ts || openWindow.last_activity || openWindow.started_at;
    const duration_seconds =
      openWindow.started_at && ended_at
        ? Math.max(0, (new Date(ended_at) - new Date(openWindow.started_at)) / 1000)
        : 0;
    records.push({
      skill_name: openWindow.skill_name,
      applied: true,
      completed: complete,
      fallback_used: false,
      tool_success_count: openWindow.tool_success_count,
      tool_failure_count: openWindow.tool_failure_count,
      source: openWindow.source,
      started_at: openWindow.started_at,
      ended_at,
      duration_seconds,
      exempt,
      registered,
    });
    openWindow = null;
  }

  function openOrSwitchWindow({ skill, source, timestamp }) {
    const skill_name = skillPatterns.normalizeSkillName(skill);
    if (openWindow) closeWindow(timestamp);
    openWindow = {
      skill_name,
      source,
      started_at: timestamp || null,
      last_activity: timestamp || null,
      tools: [],
      tool_success_count: 0,
      tool_failure_count: 0,
    };
  }

  function markFallbacks() {
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (rec.exempt || rec.completed) continue;
      const laterDifferent = records
        .slice(i + 1)
        .some((r) => r.skill_name !== rec.skill_name);
      if (laterDifferent) rec.fallback_used = true;
    }
  }

  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    if (ev.timestamp && openWindow) openWindow.last_activity = ev.timestamp;

    if (ev.type === 'skill_invocation' && ev.skill) {
      openOrSwitchWindow({
        skill: ev.skill,
        source: ev.source || 'slash_command',
        timestamp: ev.timestamp,
      });
      continue;
    }
    if (ev.type === 'tool' && ev.tool === 'Skill' && ev.skill) {
      openOrSwitchWindow({
        skill: ev.skill,
        source: 'skill_tool',
        timestamp: ev.timestamp,
      });
      continue;
    }
    if (!openWindow) continue;

    if (ev.type === 'tool') {
      openWindow.tools.push({ tool: ev.tool, command: ev.command });
      openWindow.tool_success_count += 1;
      continue;
    }
    if (ev.type === 'failure') {
      openWindow.tool_failure_count += 1;
      continue;
    }
  }

  closeWindow(endTimestamp);
  markFallbacks();
  return records;
}

function reduceSkillTelemetry(events, opts = {}) {
  const mode = opts.mode || 'all';

  const segments = [];
  let current = [];
  let openedByPromptStart = false;
  for (const ev of events) {
    if (ev && typeof ev === 'object' && ev.type === 'prompt_start') {
      segments.push({ events: current, endTimestamp: ev.timestamp || null, openedByPromptStart });
      current = [];
      openedByPromptStart = true;
      continue;
    }
    current.push(ev);
  }
  segments.push({ events: current, endTimestamp: null, openedByPromptStart });

  if (mode === 'prompt-scoped') {
    const last = segments[segments.length - 1];
    if (!last.openedByPromptStart) return [];
    return reduceSkillWindows(last.events, last.endTimestamp);
  }

  const records = [];
  for (const seg of segments) {
    if (seg.events.length) {
      records.push(...reduceSkillWindows(seg.events, seg.endTimestamp));
    }
  }
  return records;
}

module.exports = {
  reduceSkillWindows,
  reduceSkillTelemetry,
};
