#!/usr/bin/env node

/**
 * Skill plan persist — PostToolUse hook scoped to TodoWrite.
 * Appends the current todo list to plans/plan.jsonl for every active extended
 * skill that declares planning.enabled and planning.persist != false.
 */

const { runStdinHook } = require('../lib/stdin-hook.cjs');
const { getSessionId } = require('../lib/session-utils.cjs');
const { activeExtendedSkills, resolveScope } = require('../lib/skill-active.cjs');
const runtime = require('../lib/skill-runtime.cjs');

runStdinHook(handleHook, { mode: 'observability' });

function handleHook(data) {
  if (!data || data.tool_name !== 'TodoWrite') return process.exit(0);
  const todos = (data.tool_input && data.tool_input.todos) || [];
  const projectRoot = data.cwd || process.cwd();
  const sessionId = getSessionId(data.session_id);

  for (const skill of activeExtendedSkills(projectRoot, sessionId)) {
    const p = skill.extensions.planning;
    if (!p || !p.enabled || p.persist === false) continue;
    runtime.appendPlanEntry(projectRoot, resolveScope(skill.extensions), sessionId, skill.skillName, { todos });
  }
  process.exit(0);
}
