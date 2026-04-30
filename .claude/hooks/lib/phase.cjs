#!/usr/bin/env node

/**
 * Design-Thinking Phase Inference
 *
 * Returns the current workflow phase inferred from the session's tracking
 * events. Phase state is not instrumented directly. It's derived from the
 * most recent workflow skill invocation across two signals: Skill tool
 * events (from tool-tracker) and slash-command events (from clear-pending).
 *
 * Used by lens-router.cjs to gate move firing so lens directives only fire
 * when the current phase matches the move's declared `attachment` point.
 *
 * See .claude/specs/lenses/README.md.
 */

const { getRecentTrackingState } = require('./session-utils.cjs');

const DEFAULT_PHASE = 'session_start';

// Skill name → phase name. Non-workflow skills (e.g. pre-mortem,
// heuristic-scan, curse-check) don't change phase.
const WORKFLOW_SKILLS = {
  research: 'during_research',
  define: 'during_define',
  ideate: 'during_ideate',
  build: 'during_build',
  test: 'during_test',
  review: 'during_review',
  commit: 'review_to_commit'
};

// Transition attachment → required prior phase. A move attached at
// `ideate_to_build` fires only if the user is currently in `during_ideate`.
// Any other current phase blocks the move.
const TRANSITION_GUARDS = {
  ideate_to_build: 'during_ideate',
  build_to_test: 'during_build',
  review_to_commit: 'during_review'
};

function inferCurrentPhase(workspacePath) {
  const state = getRecentTrackingState(workspacePath);
  if (!state) return DEFAULT_PHASE;

  // Merge signals from Skill tool events and slash-command events, then
  // pick the workflow skill with the highest timestamp. Single pass, no
  // sort, early exit on the first valid candidate not possible because we
  // need the max across two streams — but no allocations beyond a single
  // tracker record.
  let bestTs = '';
  let bestPhase = null;

  const consider = (skill, ts) => {
    if (typeof skill !== 'string') return;
    const name = skill.replace(/^\//, '').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(WORKFLOW_SKILLS, name)) return;
    const t = ts || '';
    if (t >= bestTs) {
      bestTs = t;
      bestPhase = WORKFLOW_SKILLS[name];
    }
  };

  if (Array.isArray(state.tools)) {
    for (const t of state.tools) {
      if (t.tool === 'Skill') consider(t.skill, t.timestamp);
    }
  }
  if (Array.isArray(state.skillInvocations)) {
    for (const s of state.skillInvocations) {
      consider(s.skill, s.timestamp);
    }
  }

  return bestPhase || DEFAULT_PHASE;
}

/**
 * Does `currentPhase` allow a move declared with `attachment` to fire?
 *
 * Rules:
 *   - Unspecified or missing attachment → allow (v1 backward compat).
 *   - `session_start` → fires only when currentPhase === 'session_start'.
 *   - `during_X` → fires when currentPhase === 'during_X'.
 *   - `X_to_Y` → fires when currentPhase matches the TRANSITION_GUARDS entry.
 */
function phaseAllowsAttachment(currentPhase, attachment) {
  if (!attachment || attachment === 'unspecified') return true;
  if (Object.prototype.hasOwnProperty.call(TRANSITION_GUARDS, attachment)) {
    return currentPhase === TRANSITION_GUARDS[attachment];
  }
  return currentPhase === attachment;
}

module.exports = {
  DEFAULT_PHASE,
  WORKFLOW_SKILLS,
  TRANSITION_GUARDS,
  inferCurrentPhase,
  phaseAllowsAttachment
};
