#!/usr/bin/env node

/**
 * Resolve which extended skills are active in the current session.
 *
 * Active == invoked via the Skill tool this session. Slash commands route
 * through the Skill tool, which is why this matches verify-before-stop's
 * `tool === 'Skill'` signal. No separate registry.
 */

const path = require('path');
const { loadExtendedSkills, normalizeSkillName } = require('./skill-frontmatter.cjs');

function activeExtendedSkills(projectRoot, sessionId) {
  const extended = loadExtendedSkills(path.join(projectRoot, '.claude', 'skills'));
  if (!Object.keys(extended).length) return [];
  let state;
  try {
    state = require('./session-utils.cjs').getRecentTrackingState(projectRoot, sessionId);
  } catch { return []; }
  const invoked = new Set(
    ((state && state.tools) || [])
      .filter(t => t.tool === 'Skill' && t.skill)
      .map(t => normalizeSkillName(t.skill))
  );
  return Object.values(extended).filter(s => invoked.has(s.skillName));
}

function resolveScope(ext) {
  return (ext.filesystem && ext.filesystem.scope)
    || (ext.planning && ext.planning.scope)
    || 'session';
}

module.exports = { activeExtendedSkills, resolveScope };
