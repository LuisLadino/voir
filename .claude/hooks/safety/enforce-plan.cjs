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
 * SKILL.md is read; readPromptScopedState scopes it to the current prompt.
 */

const {
  stripCommandContent,
  getRecentPromptScopedState,
  getRecentSessionScopedSpecState
} = require('../lib/session-utils.cjs');

// Commands that require the plan skill to be read first
const PLAN_COMMANDS = [
  /gh\s+issue\s+create/i,
];

// Allow if invoked from within the skill (bypass marker)
const SKILL_ACTIVE_MARKER = 'SKILL_ACTIVE=1';

const { runStdinHook } = require('../lib/stdin-hook.cjs');
runStdinHook(handleHook, { mode: 'gating' });

function handleHook(data) {
  const { tool_input, agent_id } = data;
  const command = tool_input?.command;

  if (!command) process.exit(0);

  if (command.includes(SKILL_ACTIVE_MARKER)) process.exit(0);

  const commandToCheck = stripCommandContent(command);
  const isPlanCommand = PLAN_COMMANDS.some(pattern => pattern.test(commandToCheck));

  if (!isPlanCommand) process.exit(0);

  // Subagents don't fire UserPromptSubmit, so no `prompt_start` is ever
  // written. Branch on `agent_id` to pick the session-scoped reader.
  // See .claude/specs/claude-code/hooks.md for the payload contract.
  const isSubagent = typeof agent_id === 'string' && agent_id.length > 0;
  const readerState = isSubagent
    ? getRecentSessionScopedSpecState()
    : getRecentPromptScopedState();
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
