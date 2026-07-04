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

const { logInjection, isBackgroundNotification } = require('./inject-utils.cjs');
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

  // A background-agent completion / Monitor event reaches UserPromptSubmit as a
  // task-notification, not user input (#824). Skip the prompt-content matchers on
  // those turns so incidental text in an agent result is not read as a user
  // directive — the root behind the #817 capture false-fire.
  const userDriven = !isBackgroundNotification(prompt);
  if (!userDriven) actions.backgroundNotification = true;

  if (userDriven) {
    // 1. Check voice reminder (short — full rules are in CLAUDE.md)
    const voiceResult = voiceIdentity.check(prompt);
    if (voiceResult.content) {
      contextParts.push(...voiceResult.content);
      if (voiceResult.voiceProfileLoaded) actions.voiceProfileLoaded = true;
    }

    // 2. Check for capture requests
    const captureResult = capture.check(prompt);
    if (captureResult.content) {
      contextParts.push(captureResult.content);
      actions.captureTriggered = true;
    }

    // 3. Check reasoning checkpoints
    const reasoningResult = reasoningCheckpoints.check(prompt);
    if (reasoningResult.content) {
      contextParts.push(reasoningResult.content);
      actions.reasoningCheckpoints = reasoningResult.checkpoints.length;
    }

    // 4. Check spec triggers
    const specResult = specTriggers.check(prompt, session_id);
    if (specResult.content) {
      contextParts.push(...specResult.content);
      actions.specsLoaded = specResult.specsLoaded;
    }
  }

  // 5. Check phase-entry menu. Session-driven (fires on a phase transition, not on
  // prompt text), so it runs regardless of turn source. Before lens-router so the
  // menu appears first when both fire.
  const menuResult = phaseMenu.check(session_id);
  if (menuResult.content) {
    contextParts.push(menuResult.content);
    actions.phaseMenuFired = menuResult.phase;
  }

  // 6. Check lens router
  if (userDriven) {
    const lensResult = lensRouter.check(prompt, session_id);
    if (lensResult.content) {
      contextParts.push(lensResult.content);
      actions.lensesFired = lensResult.fired;
    }
  }

  // 7. Response format reminder (ALWAYS fires)
  contextParts.push('[RESPONSE FORMAT] Start with: **Lens:** [practitioner perspective(s)] | **The move:** [the concrete call that lens makes on THIS task — a verdict/decision/angle you can act on, in 1-2 sentences. Not why the lens was picked, not how you will apply it]. Then the actual work. Teaching integrated inline when load-bearing, not as a standalone preamble. No exceptions. Not for small responses, not for technical tasks, not for clarifying questions.');
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
