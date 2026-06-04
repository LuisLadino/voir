#!/usr/bin/env node

/**
 * Skill completion patterns and the rule that decides whether a given skill
 * invocation produced a recognizable completion signal.
 *
 * Two consumers must share one rule:
 *   - verify-before-stop.cjs: gates Stop with INCOMPLETE SKILL INVOCATION when
 *     an invoked skill has no completion signal in the current prompt.
 *   - session-utils.readSkillTelemetryState: produces the per-skill rollup
 *     (applied / completed / fallback_used / tool_success_count /
 *     tool_failure_count) that tracking-persistence.md formalizes.
 *
 * This module has no dependency on session-utils. That is deliberate:
 * verify-before-stop already requires session-utils, so importing the table
 * the other direction (session-utils <- verify-before-stop) would be a
 * circular require. A dependency-free table module keeps the graph a DAG.
 */

const skillCompletionPatterns = {
  commit: {
    description: 'git push, gh pr create, or gh pr merge',
    bash: [/git\s+push/, /gh\s+pr\s+create/, /gh\s+pr\s+merge/],
    tools: []
  },
  plan: {
    description: 'gh issue create (with SKILL_ACTIVE=1)',
    bash: [/gh\s+issue\s+create/, /SKILL_ACTIVE=1.*gh\s+issue/],
    tools: []
  },
  build: {
    description: 'git checkout, git switch, or git reset to create/move branches',
    bash: [/git\s+checkout/, /git\s+switch/, /git\s+reset/],
    tools: []
  },
  test: {
    description: 'run a test command (pytest, npm test, go test, cargo test, etc.)',
    bash: [/pytest|npm\s+test|npm\s+run\s+test|go\s+test|cargo\s+test|xcodebuild\s+test/],
    tools: []
  },
  research: {
    description: 'external inquiry (WebSearch, WebFetch, context7) or codebase search (Grep, Glob)',
    bash: [],
    tools: ['WebSearch', 'WebFetch', 'Grep', 'Glob', 'mcp__context7__query-docs', 'mcp__context7__resolve-library-id']
  },
  dispatch: {
    description: 'node .claude/hooks/lib/dispatch.cjs invocation. Any subcommand counts: spawn, --list, --kill, --synthesize, --cleanup, --dry-run.',
    bash: [/dispatch\.cjs/],
    tools: []
  },
  review: { exempt: true },
  define: { exempt: true },
  ideate: { exempt: true },
  handoff: { exempt: true },
  dream: { exempt: true },
  design: { exempt: true },

  'affordance-audit': { exempt: true },
  'assumption-reframe': { exempt: true },
  'audience-lock': { exempt: true },
  'boring-check': { exempt: true },
  'chesterton-audit': { exempt: true },
  'commitment-close': { exempt: true },
  'competitive-alternatives': { exempt: true },
  'concretize-pass': { exempt: true },
  'counterfactual-check': { exempt: true },
  'curse-check': { exempt: true },
  'decision-owner': { exempt: true },
  'define-the-sample': { exempt: true },
  'delegation-level': { exempt: true },
  'eval-first': { exempt: true },
  'failure-mode-taxonomy': { exempt: true },
  'generalization-check': { exempt: true },
  'heuristic-scan': { exempt: true },
  'hierarchy-squint': { exempt: true },
  'jobs-to-be-done': { exempt: true },
  'lead-with-decision': { exempt: true },
  'leverage-point-scan': { exempt: true },
  learn: { exempt: true },
  'look-at-your-data': { exempt: true },
  'moat-check': { exempt: true },
  'name-the-metric': { exempt: true },
  'name-the-reader': { exempt: true },
  'observable-surface-audit': { exempt: true },
  'pre-mortem': { exempt: true },
  'pre-register-decision': { exempt: true },
  'reference-triangulation': { exempt: true },
  'reversibility-classify': { exempt: true },
  'roi-per-hour': { exempt: true },
  'scope-cut': { exempt: true },
  'second-order-check': { exempt: true },
  'stakeholder-map': { exempt: true },
  'strategy-kernel': { exempt: true },
  'switch-trigger': { exempt: true },
  'symptom-vs-root': { exempt: true },
  'trunk-test': { exempt: true },
  'type-specimen': { exempt: true },
  'value-over-feature': { exempt: true },

  'sync-stack': { exempt: true }
};

function escapeForRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSentinelRegex(skillName) {
  return new RegExp(`SKILL_COMPLETE:\\s*${escapeForRegex(skillName)}(?![\\w-])`);
}

function normalizeSkillName(skill) {
  return String(skill || '')
    .replace(/^\//, '')
    .replace(/^[a-z][a-z0-9-]*:/, '');
}

function getSkillPattern(skill) {
  return skillCompletionPatterns[normalizeSkillName(skill)];
}

function isSkillRegistered(skill) {
  return Boolean(getSkillPattern(skill));
}

function isSkillExempt(skill) {
  const pattern = getSkillPattern(skill);
  return Boolean(pattern && pattern.exempt);
}

function isSkillComplete(skill, bashCommands, usedTools) {
  const pattern = getSkillPattern(skill);
  if (!pattern) {
    return { complete: false, expected: null };
  }
  if (pattern.exempt) {
    return { complete: true, expected: null };
  }

  const bashMatch = (pattern.bash || []).some(rx =>
    bashCommands.some(cmd => rx.test(cmd))
  );
  const toolMatch = (pattern.tools || []).some(name => usedTools.has(name));
  const sentinelRx = buildSentinelRegex(normalizeSkillName(skill));
  const sentinelMatch = bashCommands.some(cmd => sentinelRx.test(cmd));

  return {
    complete: bashMatch || toolMatch || sentinelMatch,
    expected: pattern.description
  };
}

module.exports = {
  skillCompletionPatterns,
  escapeForRegex,
  buildSentinelRegex,
  normalizeSkillName,
  getSkillPattern,
  isSkillRegistered,
  isSkillExempt,
  isSkillComplete
};
