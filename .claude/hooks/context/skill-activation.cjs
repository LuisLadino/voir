#!/usr/bin/env node

/**
 * Skill activation — PreToolUse hook scoped to the Skill tool.
 *
 * Slash (/research) and programmatic Skill(skill:"...") invocations both route
 * through the Skill tool, so one hook covers both. On a skill that declares
 * extension fields: provision its working-memory dirs (idempotent) and inject a
 * runtime context block via additionalContext (PreToolUse supports it —
 * hooks.md:158).
 */

const path = require('path');
const { runStdinHook } = require('../lib/stdin-hook.cjs');
const { loadExtendedSkills, normalizeSkillName } = require('../lib/skill-frontmatter.cjs');
const { resolveScope } = require('../lib/skill-active.cjs');
const runtime = require('../lib/skill-runtime.cjs');

function buildBlock(skill, scope, projectRoot, sessionId) {
  const ext = skill.extensions;
  const lines = [`[SKILL RUNTIME — /${skill.skillName}]`];

  if (ext.planning && ext.planning.enabled) {
    let resumed = false;
    if (ext.planning.resume_on_activation) {
      const prior = runtime.readLatestPlan(projectRoot, scope, sessionId, skill.skillName);
      if (prior && Array.isArray(prior.todos) && prior.todos.length) {
        lines.push('Resuming prior plan (update with TodoWrite):');
        for (const t of prior.todos) lines.push(`  [${t.status || 'pending'}] ${t.content || ''}`);
        resumed = true;
      }
    }
    if (!resumed) lines.push('Planning: use TodoWrite. Snapshots persist across activations.');
  }

  if (ext.filesystem && ext.filesystem.enabled) {
    const root = runtime.fsRoot(projectRoot, scope, sessionId, skill.skillName, ext.filesystem.root_hint);
    lines.push(`Working memory (write intermediate artifacts here): ${path.relative(projectRoot, root)} (scope=${scope})`);
  }

  if (Array.isArray(ext.subagents) && ext.subagents.length) {
    lines.push('Declared subagents:');
    for (const s of ext.subagents) {
      const via = s.isolation === 'process' ? 'dispatch worker (separate process + worktree)'
        : s.isolation === 'none' ? 'inline phase (no spawn)'
        : `Agent(subagent_type: ${s.agent})`;
      lines.push(`  - ${s.role}: ${via}`);
    }
  }

  if (ext.auto_summarize && ext.auto_summarize.enabled) {
    lines.push(`auto_summarize: tool outputs over ~${ext.auto_summarize.threshold_tokens} tokens are archived under summaries/ (retrievable by path after compaction). Does not shrink the live transcript.`);
  }

  return lines.join('\n');
}

function handleHook(data) {
  if (!data || data.tool_name !== 'Skill') return process.exit(0);
  const requested = data.tool_input && data.tool_input.skill;
  if (!requested) return process.exit(0);

  const projectRoot = data.cwd || process.cwd();
  const sessionId = data.session_id || '';
  const name = normalizeSkillName(requested);

  const skill = loadExtendedSkills(path.join(projectRoot, '.claude', 'skills'))[name];
  if (!skill) return process.exit(0);

  const scope = resolveScope(skill.extensions);
  runtime.sweepOldSessions(projectRoot);
  runtime.ensureSkillDirs(projectRoot, scope, sessionId, skill.skillName, {
    root_hint: skill.extensions.filesystem && skill.extensions.filesystem.root_hint
  });

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: buildBlock(skill, scope, projectRoot, sessionId)
    }
  }));
  process.exit(0);
}

if (require.main === module) {
  runStdinHook(handleHook, { mode: 'observability' });
}

module.exports = { handleHook, buildBlock };
