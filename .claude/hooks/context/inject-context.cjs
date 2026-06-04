#!/usr/bin/env node

/**
 * Inject Context Hook (Orchestrator)
 *
 * Event: UserPromptSubmit
 * Purpose: Auto-injects relevant context based on user prompt
 *
 * Modules:
 * - reasoning-checkpoints.cjs - Reasoning reminders (LOOK IT UP, VERIFY, ROOT CAUSE)
 * - voice-identity.cjs - Short voice reminder when writing content for Luis
 * - capture.cjs - Capture requests → Claude memory system
 * - spec-triggers.cjs - Auto-load specs based on keywords
 * - lens-router.cjs - Lens move directives from .claude/specs/lenses/registry.json
 *
 * Removed:
 * - route-commands.cjs — skills system + gating hooks handle command routing natively
 * - methodology.cjs — CPMAI domains folded into lenses in system-prompt.md
 */

const { loadAndConsumePhaseEvaluation, logInjection } = require('./inject-utils.cjs');
const reasoningCheckpoints = require('./reasoning-checkpoints.cjs');
const voiceIdentity = require('./voice-identity.cjs');
const capture = require('./capture.cjs');
const specTriggers = require('./spec-triggers.cjs');
const lensRouter = require('./lens-router.cjs');
const phaseMenu = require('./phase-menu.cjs');

const { runStdinHook } = require('../lib/stdin-hook.cjs');
runStdinHook(handleHook, { mode: 'observability' });

function handleHook(data) {
  const { prompt, session_id } = data;

  if (!prompt) {
    process.exit(0);
  }

  const contextParts = [];
  const actions = { prompt };

  // 1. Check for Phase Evaluation from recent commit
  const phaseEvalContent = loadAndConsumePhaseEvaluation();
  if (phaseEvalContent) {
    contextParts.push(`[PHASE EVALUATION - From last commit]\n\n${phaseEvalContent}`);
    actions.phaseEvalInjected = true;
  }

  // 2. Check voice reminder (short — full rules are in CLAUDE.md)
  const voiceResult = voiceIdentity.check(prompt);
  if (voiceResult.content) {
    contextParts.push(...voiceResult.content);
    if (voiceResult.voiceProfileLoaded) actions.voiceProfileLoaded = true;
  }

  // 3. Check for capture requests
  const captureResult = capture.check(prompt);
  if (captureResult.content) {
    contextParts.push(captureResult.content);
    actions.captureTriggered = true;
  }

  // 4. Check reasoning checkpoints
  const reasoningResult = reasoningCheckpoints.check(prompt);
  if (reasoningResult.content) {
    contextParts.push(reasoningResult.content);
    actions.reasoningCheckpoints = reasoningResult.checkpoints.length;
  }

  // 5. Check spec triggers
  const specResult = specTriggers.check(prompt, session_id);
  if (specResult.content) {
    contextParts.push(...specResult.content);
    actions.specsLoaded = specResult.specsLoaded;
  }

  // 6. Check phase-entry menu. Runs before lens-router so the menu
  // appears first when both fire.
  const menuResult = phaseMenu.check(session_id);
  if (menuResult.content) {
    contextParts.push(menuResult.content);
    actions.phaseMenuFired = menuResult.phase;
  }

  // 7. Check lens router
  const lensResult = lensRouter.check(prompt, session_id);
  if (lensResult.content) {
    contextParts.push(lensResult.content);
    actions.lensesFired = lensResult.fired;
  }

  // 8. Response format reminder (ALWAYS fires)
  contextParts.push('[RESPONSE FORMAT] Start with: **Lens:** [practitioner perspective(s)] | **Why these apply:** [1-2 sentences max on why these lenses, not others]. Then the actual work. Teaching integrated inline when load-bearing, not as a standalone preamble. No exceptions. Not for small responses, not for technical tasks, not for clarifying questions.');
  actions.formatReminder = true;

  // Log injection (always fires due to format reminder)
  logInjection(session_id, actions);

  // Output context
  const output = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: contextParts.join('\n\n---\n\n')
    }
  };
  console.log(JSON.stringify(output));

  process.exit(0);
}
