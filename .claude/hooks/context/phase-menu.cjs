#!/usr/bin/env node

/**
 * Phase-Entry Menu Module
 *
 * Called by inject-context.cjs on UserPromptSubmit.
 *
 * When the user enters a new design-thinking phase via a workflow slash
 * command (e.g. `/build`), emit a one-time advisory menu listing lens
 * moves attached to that phase. Claude sees the menu alongside the
 * skill's own content and decides which moves fit the current context.
 *
 * Fires once per phase transition. Same-phase re-invocations (e.g.
 * `/research` twice in a row on different issues) don't re-emit.
 *
 * No prompt-text pattern matching happens here; module reads events
 * from tracking. Injection-precision spec applies to trigger modules,
 * not this one.
 */

const fs = require('fs');
const path = require('path');

const {
  getRecentTrackingState,
  getSessionId,
  appendTrackingEvent
} = require('../lib/session-utils.cjs');
const { WORKFLOW_SKILLS } = require('../lib/phase.cjs');
const {
  resolveProjectRoot,
  loadRegistry: loadLensRegistry
} = require('../lib/lens-registry.cjs');

function parseFrontmatterDescription(skillPath) {
  try {
    const raw = fs.readFileSync(skillPath, 'utf8');
    const match = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    const fm = match[1];
    const desc = fm.match(/^description:\s*>?\s*\n?([\s\S]*?)(?=\n[a-z_-]+:|\n---|$)/m);
    if (!desc) return null;
    const raw_text = desc[1].replace(/\n\s*/g, ' ').trim();
    // Strip control chars + replace leading `[` to prevent spoofing the
    // menu's `[PHASE ENTRY: ...]` banner or injecting fake directives.
    const sanitized = raw_text.replace(/[\x00-\x1f]/g, '').replace(/^\[/, '(');
    const firstSentence = sanitized.match(/^([^.!?]+[.!?])/);
    return (firstSentence ? firstSentence[1] : sanitized.slice(0, 160)).trim();
  } catch {
    return null;
  }
}

// Skill names in the registry must be safe filesystem identifiers.
// Block path traversal: a registry value like "../../etc/passwd" would
// otherwise cause readFileSync to read arbitrary files and inject their
// content into Claude's context via the menu.
const SKILL_NAME_RE = /^[a-z][a-z0-9-]*$/i;

function isSafeSkillName(name) {
  return typeof name === 'string' && SKILL_NAME_RE.test(name);
}

function findWorkflowSlashInvocation(state) {
  if (!state || !Array.isArray(state.skillInvocations)) return null;
  for (let i = state.skillInvocations.length - 1; i >= 0; i--) {
    const s = state.skillInvocations[i];
    if (s.source !== 'slash_command') continue;
    const name = typeof s.skill === 'string' ? s.skill.toLowerCase() : '';
    if (Object.prototype.hasOwnProperty.call(WORKFLOW_SKILLS, name)) {
      return { skill: name, phase: WORKFLOW_SKILLS[name], timestamp: s.timestamp };
    }
  }
  return null;
}

function lastEmittedPhase(state) {
  if (!state || !Array.isArray(state.phaseMenuEmitted)) return null;
  const last = state.phaseMenuEmitted[state.phaseMenuEmitted.length - 1];
  return last ? last.phase : null;
}

function buildMenu(enteringPhase, registry, projectRoot) {
  if (!registry || !registry.lenses) return null;

  const skillsDir = path.resolve(projectRoot, '.claude/skills');
  const matched = [];
  for (const [lens, data] of Object.entries(registry.lenses)) {
    for (const move of (data.moves || [])) {
      const att = move.attachment || '';
      const fires = att === enteringPhase || att.endsWith(`_to_${enteringPhase.replace(/^during_/, '')}`);
      if (!fires) continue;
      if (!isSafeSkillName(move.skill)) continue;
      const skillPath = path.resolve(skillsDir, move.skill, 'SKILL.md');
      // Defense in depth: even with the regex check above, confirm the
      // resolved path stays inside the skills directory.
      if (!skillPath.startsWith(skillsDir + path.sep)) continue;
      const desc = parseFrontmatterDescription(skillPath) || '(no description)';
      matched.push({ lens, skill: move.skill, attachment: att, desc });
    }
  }

  if (matched.length === 0) return null;

  const lines = [
    `[PHASE ENTRY: ${enteringPhase}]`,
    '',
    'Lens moves attached to this phase. Invoke whichever fit the current context via the Skill tool. Advisory, not required.',
    ''
  ];
  for (const m of matched) {
    lines.push(`- /${m.skill} (${m.lens}, ${m.attachment}) — ${m.desc}`);
  }
  return lines.join('\n');
}

function check(sessionId) {
  const state = getRecentTrackingState();
  const invocation = findWorkflowSlashInvocation(state);
  if (!invocation) return { content: null, emitted: false };

  const lastEmitted = lastEmittedPhase(state);
  if (lastEmitted === invocation.phase) return { content: null, emitted: false };

  const registry = loadLensRegistry('phase-menu');
  const root = resolveProjectRoot();
  const menu = buildMenu(invocation.phase, registry, root);
  if (!menu) return { content: null, emitted: false };

  try {
    const sid = getSessionId(sessionId);
    appendTrackingEvent(sid, {
      type: 'phase_menu_emitted',
      phase: invocation.phase
    });
  } catch {
    // Tracking is optional. Missing dedup write just means the menu may
    // re-emit on the next prompt. Not a correctness failure.
  }

  return { content: menu, emitted: true, phase: invocation.phase };
}

module.exports = {
  check,
  findWorkflowSlashInvocation,
  lastEmittedPhase,
  buildMenu,
  parseFrontmatterDescription
};
