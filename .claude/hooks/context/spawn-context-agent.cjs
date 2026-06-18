#!/usr/bin/env node

/**
 * Spawn Context Agent Hook
 *
 * Event: SessionStart
 * Purpose: Triggers Claude to spawn context-agent via Task tool
 *
 * Simple approach: Just inject an instruction. Claude spawns the agent
 * using the same Task tool infrastructure used for all other agents.
 */

// Uses Claude's native instruction patterns:
// - <commentary> matches how system prompt teaches tool reasoning
// - "proactively" triggers the built-in rule: "If the agent description
//   mentions that it should be used proactively, then you should try your
//   best to use it without the user having to ask for it first."
// - IMPORTANT: and Do NOT match emphasis patterns Claude responds to
function handleHook() {
  // A skill-gate trigger walk (skill-trigger-walk.cjs) drives `claude -p` to
  // measure whether a phrase routes to a skill. This dominant "spawn the agent"
  // instruction hijacks that one-shot turn into a context-evaluation, so the
  // phrase never gets routed and the walk records a false not-fired. Suppress
  // it during a walk so the measurement reflects skill routing, not this hook.
  if (process.env.CLAUDE_SKILL_GATE_WALK) return;

  console.log(`IMPORTANT: This is a session start. You MUST proactively spawn the context agent before responding to the user.

<commentary>
A new session has started. The context-agent is designed to be used proactively at session start. It establishes project context by reading the project definition, checking GitHub state, and evaluating the design thinking phase. Spawn it in the background so the user is not blocked.
</commentary>

Use the Agent tool with these exact parameters:
- description: "Establish project context"
- subagent_type: "context-agent"
- model: "haiku"
- prompt: "Evaluate the current project state. Check GitHub issues, milestones, and PRs. Check recent git activity. Determine the design thinking phase from activity signals. Do NOT read project-definition.yaml — the main session already has it."
- run_in_background: true

Do NOT skip this. Do NOT wait for the user to ask for it.`);
}

const { runStdinHook } = require('../lib/stdin-hook.cjs');
runStdinHook(handleHook, { mode: 'observability', parseJson: false });
