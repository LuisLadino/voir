#!/usr/bin/env node

/**
 * Enforce Plan Skill Hook
 *
 * Event: PreToolUse (Bash)
 * Purpose: DENY `gh issue create` until the plan skill has been read.
 *
 * Issues are the system of record for WHY work happens. The plan skill
 * documents how to create issues with proper context. This hook ensures
 * Claude reads those guidelines before creating issues.
 *
 * Reads plan-skill-read state from the tracking event log. The
 * track-spec-reads hook emits `plan_skill_read` when the plan skill's
 * SKILL.md is read; readSessionScopedSpecState scans the whole session,
 * so the read stays satisfied across prompts (#459, #452, #552).
 */

const {
  stripCommandContent,
  getRecentSessionScopedSpecState
} = require('../lib/session-utils.cjs');
const { atCommandPosition } = require('../lib/command-position.cjs');

// `gh issue create` cores. Anchored at a command position so the gate fires on
// a real invocation, not on the phrase inside a quoted argument such as
// `grep "gh issue create" notes` — the settings matcher `Bash(*gh issue
// create*)` is only a coarse substring pre-filter (#642).
const PLAN_COMMAND_CORES = [
  String.raw`gh\s+issue\s+create\b`,
];

// Allow if invoked from within the skill (bypass marker)
const SKILL_ACTIVE_MARKER = 'SKILL_ACTIVE=1';

// True when the (content-stripped) command actually runs `gh issue create` at a
// command position.
function isPlanCommand(command) {
  const commandToCheck = stripCommandContent(command);
  return PLAN_COMMAND_CORES.some((core) => atCommandPosition(commandToCheck, core, 'i'));
}

if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook(handleHook, { mode: 'gating' });
}

function handleHook(data) {
  const { tool_input, session_id } = data;
  const command = tool_input?.command;

  if (!command) process.exit(0);

  if (command.includes(SKILL_ACTIVE_MARKER)) process.exit(0);

  if (!isPlanCommand(command)) process.exit(0);

  // Plan-skill-read state is session-scoped (#552, #459, #452): once /plan is
  // read, the gate stays satisfied across prompt cycles, so a planning session
  // that creates several issues across turns doesn't re-require the read on
  // each new prompt. Session-scoped also subsumes the subagent branch — those
  // never fire UserPromptSubmit, so the old prompt-scoped reader would fail
  // closed on them anyway. Thread `session_id` so parallel CC sessions can't
  // steal the read via mtime race. See #263.
  const readerState = getRecentSessionScopedSpecState(undefined, session_id);
  const promptState = readerState || { planSkillRead: false };
  if (promptState.planSkillRead) process.exit(0);

  console.error(`[BLOCKED] Creating GitHub issue without reading plan guidelines.

**Why this matters:**
Issues are the system of record for WHY work happens. They need proper context
so future sessions (including Claude) understand the problem being solved.

**To fix:**
Invoke the plan skill first: Skill(skill: "plan")

The skill documents required sections (Problem, Why It Matters) and proper labels.`);

  process.exit(2);
}

module.exports = { isPlanCommand };
