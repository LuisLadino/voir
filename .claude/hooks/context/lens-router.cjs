/**
 * Lens Router Module
 *
 * Called by inject-context.cjs on UserPromptSubmit.
 *
 * Reads .claude/specs/lenses/registry.json. For each move in each lens,
 * checks if any trigger pattern matches the user prompt. On match, emits
 * a directive injection that tells Claude to invoke the linked skill before
 * responding.
 *
 * Export shape matches other inject-context modules: { check(prompt) }.
 *
 * See .claude/specs/lenses/README.md for the system overview.
 */

const { escapeRegex } = require('../lib/regex.cjs');
const { inferCurrentPhase, phaseAllowsAttachment } = require('../lib/phase.cjs');
const { loadRegistry: loadLensRegistry } = require('../lib/lens-registry.cjs');

function matchesTrigger(prompt, trigger) {
  if (typeof trigger !== 'string' || trigger.length === 0) return false;
  // Word-boundary match. Matches "let's build it" but not "sabout to builds".
  // Escapes regex metacharacters in the trigger before compilation.
  const re = new RegExp(`\\b${escapeRegex(trigger)}\\b`, 'i');
  return re.test(prompt);
}

function findMatches(prompt, registry, currentPhase) {
  if (!registry || !registry.lenses) return [];

  const matches = [];

  for (const [lensName, lens] of Object.entries(registry.lenses)) {
    const moves = Array.isArray(lens.moves) ? lens.moves : [];
    for (const move of moves) {
      const triggers = Array.isArray(move.triggers) ? move.triggers : [];
      const matched = triggers.some(t => matchesTrigger(prompt, t));
      if (!matched) continue;

      const attachment = move.attachment || 'unspecified';
      // Unspecified attachment keeps trigger-only behavior for backward
      // compat with moves that predate phase gating.
      if (!phaseAllowsAttachment(currentPhase, attachment)) continue;

      matches.push({
        lens: lensName,
        move: move.name,
        skill: move.skill,
        attachment
      });
    }
  }

  return matches;
}

function buildDirective(matches) {
  const lines = ['[LENS DIRECTIVE]'];
  for (const m of matches) {
    lines.push(
      `Before responding, invoke the /${m.skill} skill via the Skill tool. ` +
      `This is a ${m.lens} lens move attached at ${m.attachment}. ` +
      `Run the move, then continue with the user's request. ` +
      `If the move surfaces a blocker, route back to the appropriate workflow phase instead of proceeding.`
    );
  }
  return lines.join('\n\n');
}

function check(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    return { content: null, fired: [] };
  }

  const registry = loadLensRegistry('lens-router');
  if (!registry) {
    return { content: null, fired: [] };
  }

  const currentPhase = inferCurrentPhase();
  const matches = findMatches(prompt, registry, currentPhase);
  if (matches.length === 0) {
    return { content: null, fired: [], phase: currentPhase };
  }

  return {
    content: buildDirective(matches),
    fired: matches.map(m => `${m.lens}:${m.move}`),
    phase: currentPhase
  };
}

module.exports = { check };

// Support direct invocation for testing:
// echo '{"prompt":"lets build it"}' | node .claude/hooks/context/lens-router.cjs
if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook((data) => {
    const result = check(data.prompt || '');
    if (result.content) {
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: result.content
        },
        fired: result.fired
      }, null, 2));
    } else {
      console.log(JSON.stringify({ fired: [] }, null, 2));
    }
  }, { mode: 'observability' });
}
