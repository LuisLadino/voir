#!/usr/bin/env node

/**
 * clear-pending unit tests.
 *
 * Covers the slash-command parser that emits skill_invocation events:
 *   - Plain `/name` invocations
 *   - Plugin-namespaced `/plugin:name` invocations (#612)
 *   - Arguments, leading whitespace, casing
 *   - Non-command, path-like, and malformed input return null
 * Plus an end-to-end handleHook check that the skill_invocation event lands
 * with the namespaced skill recorded verbatim.
 *
 * Run:
 *   node .claude/hooks/context/clear-pending.test.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseSlashCommandSkill, handleHook } = require('./clear-pending.cjs');
const { readTrackingEvents, getProjectDir } = require('../lib/session-utils.cjs');

let pass = 0;
let fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else    { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

// ── parseSlashCommandSkill: pure regex behavior ─────────────────────────────
const eq = (input, expected) =>
  report(
    `parse ${JSON.stringify(input)} -> ${JSON.stringify(expected)}`,
    parseSlashCommandSkill(input) === expected,
    `got ${JSON.stringify(parseSlashCommandSkill(input))}`
  );

// Plain commands still work after the regex change.
eq('/research', 'research');
eq('/research arg1 arg2', 'research');
eq('  /commit', 'commit');
eq('/Research', 'research');
eq('/a', 'a');

// Plugin-namespaced commands are now captured verbatim (#612). The colon used
// to break the trailing `\s|$` anchor and these recorded nothing.
eq('/project-management:plan', 'project-management:plan');
eq('/project-management:research with args', 'project-management:research');
eq('/skill-creator:skill-creator', 'skill-creator:skill-creator');
eq('/project-management:plan\n', 'project-management:plan');

// Non-commands, path-like input, and malformed tokens return null.
eq('hello world', null);
eq('do /research later', null);
eq('/usr/bin', null);
eq('/foo:', null);
eq('/:plan', null);
eq('', null);
eq(undefined, null);
eq(null, null);
eq(42, null);

// ── handleHook: end-to-end event emission ───────────────────────────────────
// Isolate by running inside a throwaway non-git workspace. Both the write
// (handleHook, which resolves the workspace from cwd) and the readback resolve
// against process.cwd() while chdir'd in, so the workspace key matches even
// where os.tmpdir() is symlinked (macOS /var -> /private/var).
(function testHandleHook() {
  const origCwd = process.cwd();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'clear-pending-test-'));
  process.chdir(workspace);
  let projectDir = null;
  try {
    projectDir = getProjectDir();

    const sessionId = 'clearpending-test-session';
    handleHook({ session_id: sessionId, prompt: '/project-management:plan' });
    const events = readTrackingEvents(sessionId);
    const invocations = events.filter((e) => e.type === 'skill_invocation');

    report('handleHook emits exactly one prompt_start',
      events.filter((e) => e.type === 'prompt_start').length === 1);
    report('handleHook emits one skill_invocation for a namespaced command',
      invocations.length === 1,
      `got ${invocations.length}`);
    report('handleHook records the namespaced skill verbatim',
      invocations[0] && invocations[0].skill === 'project-management:plan',
      `got ${invocations[0] && JSON.stringify(invocations[0].skill)}`);
    report('handleHook tags source as slash_command',
      Boolean(invocations[0]) && invocations[0].source === 'slash_command');

    const sessionId2 = 'clearpending-test-session-2';
    handleHook({ session_id: sessionId2, prompt: 'just a normal message' });
    const events2 = readTrackingEvents(sessionId2);
    report('handleHook on a plain prompt emits prompt_start but no skill_invocation',
      events2.filter((e) => e.type === 'prompt_start').length === 1 &&
      events2.filter((e) => e.type === 'skill_invocation').length === 0);
  } finally {
    process.chdir(origCwd);
    if (projectDir) {
      try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch {}
    }
    try { fs.rmSync(workspace, { recursive: true, force: true }); } catch {}
  }
})();

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
