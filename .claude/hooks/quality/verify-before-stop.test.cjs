#!/usr/bin/env node

/**
 * verify-before-stop integration tests.
 *
 * Covers the stopping-suggestion detector (#111). Writes throwaway
 * transcript JSONL files and asserts the detector returns the expected
 * hits. No subprocess spawn needed — the module exports the function
 * for direct testing.
 *
 * Run:
 *   node .claude/hooks/quality/verify-before-stop.test.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  checkForStoppingSuggestions,
  extractLastAssistantText,
  isSkillComplete,
  getIncompleteSkills
} = require('./verify-before-stop.cjs');

let pass = 0;
let fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else    { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

function writeTranscript(dir, messages) {
  const p = path.join(dir, `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`);
  const lines = messages.map(m => JSON.stringify(m)).join('\n') + '\n';
  fs.writeFileSync(p, lines);
  return p;
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-test-'));

try {
  // Positive cases: each forbidden phrase flagged
  const positives = [
    'Stopping here is a reasonable place.',
    'This might be a natural pause.',
    'That attack path may not be feasible.',
    'Might be worth moving on from this.',
    'Want to pause?',
    "Let's take a break.",
    'We could stop here.',
    "I'll pause here for now.",
    'Good point to wrap up.'
  ];
  for (const text of positives) {
    const p = writeTranscript(tmpDir, [
      { type: 'user', message: { role: 'user', content: 'hi' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } }
    ]);
    const hits = checkForStoppingSuggestions(p);
    report(`flags: "${text}"`, hits.length > 0, `got ${JSON.stringify(hits)}`);
  }

  // Negative cases: should NOT flag
  const negatives = [
    'I stopped the dev server because it was crashing.',
    'The script stopped working after the update.',
    'Here is a stop list I built.',
    'Pausing the container is safe.',
    'Press pause to continue later.',
    'Ready for your next instruction.',
    'Done. All 17 tests pass.'
  ];
  for (const text of negatives) {
    const p = writeTranscript(tmpDir, [
      { type: 'user', message: { role: 'user', content: 'hi' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } }
    ]);
    const hits = checkForStoppingSuggestions(p);
    report(`no flag: "${text}"`, hits.length === 0, `got ${JSON.stringify(hits)}`);
  }

  // Uses last assistant message only
  const multi = writeTranscript(tmpDir, [
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Stopping here.' }] } },
    { type: 'user', message: { role: 'user', content: 'ok' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'On to the next thing.' }] } }
  ]);
  report(
    'scans last assistant message only, not earlier ones',
    checkForStoppingSuggestions(multi).length === 0,
    `got ${JSON.stringify(checkForStoppingSuggestions(multi))}`
  );

  // Missing transcript path returns empty
  report('missing transcript_path returns []', checkForStoppingSuggestions(undefined).length === 0);
  report('nonexistent transcript path returns []', checkForStoppingSuggestions('/tmp/does-not-exist-xyz').length === 0);

  // String content form also handled
  const stringForm = writeTranscript(tmpDir, [
    { type: 'assistant', message: { role: 'assistant', content: 'Let us pause here for a moment.' } }
  ]);
  report(
    'handles string content form',
    checkForStoppingSuggestions(stringForm).length > 0
  );

  // extractLastAssistantText sanity
  const extract = writeTranscript(tmpDir, [
    { type: 'user', message: { role: 'user', content: 'q' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] } }
  ]);
  report(
    'extractLastAssistantText concatenates text blocks',
    extractLastAssistantText(extract).includes('A') && extractLastAssistantText(extract).includes('B')
  );

  // #237: sync-stack is registered as exempt (no terminal bash/tool signal available)
  const syncBare = isSkillComplete('/sync-stack', [], new Set());
  report(
    'sync-stack (bare) is complete via exempt',
    syncBare.complete === true,
    `got ${JSON.stringify(syncBare)}`
  );

  // #237: plugin-namespaced invocation strips `project-management:` prefix and matches exempt sync-stack
  const syncNamespaced = isSkillComplete('/project-management:sync-stack', [], new Set());
  report(
    'project-management:sync-stack (plugin-namespaced) is complete via exempt',
    syncNamespaced.complete === true,
    `got ${JSON.stringify(syncNamespaced)}`
  );

  // #237: plugin-namespaced maps to commit pattern, still requires bash signal
  const commitNamespaced = isSkillComplete('/some-plugin:commit', [], new Set());
  report(
    'plugin-namespaced commit without git push is incomplete',
    commitNamespaced.complete === false,
    `got ${JSON.stringify(commitNamespaced)}`
  );
  const commitNamespacedWithPush = isSkillComplete('/some-plugin:commit', ['git push origin main'], new Set());
  report(
    'plugin-namespaced commit with git push is complete',
    commitNamespacedWithPush.complete === true,
    `got ${JSON.stringify(commitNamespacedWithPush)}`
  );

  // #237: unknown skill still hits drift tripwire
  const unknown = isSkillComplete('/totally-unknown-skill', [], new Set());
  report(
    'unknown skill falls through to tripwire (complete: false)',
    unknown.complete === false,
    `got ${JSON.stringify(unknown)}`
  );

  // #237: unknown namespace-stripped skill also hits tripwire
  const unknownNamespaced = isSkillComplete('/made-up-plugin:made-up-skill', [], new Set());
  report(
    'unknown plugin-namespaced skill falls through to tripwire',
    unknownNamespaced.complete === false,
    `got ${JSON.stringify(unknownNamespaced)}`
  );

  // #231: dispatch is now a registered skill with a dispatch.cjs bash signal.
  const dispatchNoBash = isSkillComplete('/dispatch', [], new Set());
  report(
    '#231: dispatch without dispatch.cjs bash is incomplete',
    dispatchNoBash.complete === false,
    `got ${JSON.stringify(dispatchNoBash)}`
  );
  const dispatchWithBash = isSkillComplete('/dispatch', ['node .claude/hooks/lib/dispatch.cjs --list'], new Set());
  report(
    '#231: dispatch with dispatch.cjs bash is complete',
    dispatchWithBash.complete === true,
    `got ${JSON.stringify(dispatchWithBash)}`
  );

  // #231: plugin-namespaced dispatch invocation also matches.
  const dispatchNamespaced = isSkillComplete('/some-plugin:dispatch', ['bash -c "node .claude/hooks/lib/dispatch.cjs 42"'], new Set());
  report(
    '#231: plugin-namespaced dispatch with dispatch.cjs bash is complete',
    dispatchNamespaced.complete === true,
    `got ${JSON.stringify(dispatchNamespaced)}`
  );

  // #231: learn is exempt. Cognitive explanation skill, surfaces in response.
  const learnBare = isSkillComplete('/learn', [], new Set());
  report(
    '#231: learn bare is complete via exempt',
    learnBare.complete === true,
    `got ${JSON.stringify(learnBare)}`
  );
  const learnNamespaced = isSkillComplete('/utilities:learn', [], new Set());
  report(
    '#231: utilities:learn plugin-namespaced is complete via exempt',
    learnNamespaced.complete === true,
    `got ${JSON.stringify(learnNamespaced)}`
  );

  // #231: getIncompleteSkills on a scope with no Skill invocations returns [].
  // Simulates post-invocation turns where the old behavior would keep
  // tripwiring. Current prompt has Bash activity but no Skill invocation.
  const emptyScopeBashOnly = { tools: [{ tool: 'Bash', command: 'ls' }] };
  report(
    '#231: empty-of-skills scope produces no incomplete flags',
    getIncompleteSkills(emptyScopeBashOnly).length === 0,
    `got ${JSON.stringify(getIncompleteSkills(emptyScopeBashOnly))}`
  );

  // #231: dispatch invoked + dispatch.cjs bash in same scope is complete.
  const scopedCompleteDispatch = {
    tools: [
      { tool: 'Skill', skill: 'dispatch' },
      { tool: 'Bash', command: 'node .claude/hooks/lib/dispatch.cjs --list' }
    ]
  };
  report(
    '#231: dispatch invoked + dispatch.cjs bash in same scope is complete',
    getIncompleteSkills(scopedCompleteDispatch).length === 0,
    `got ${JSON.stringify(getIncompleteSkills(scopedCompleteDispatch))}`
  );

  // #231: unregistered skill in current scope still tripwires once.
  const scopedDrift = { tools: [{ tool: 'Skill', skill: 'novel-skill' }] };
  const drift = getIncompleteSkills(scopedDrift);
  report(
    '#231: unregistered skill in current scope still tripwires once',
    drift.length === 1 && drift[0].skill === '/novel-skill',
    `got ${JSON.stringify(drift)}`
  );

  // #231: null tracking, no session, returns [] without throwing.
  report(
    '#231: null scoped tracking returns [] incomplete skills',
    getIncompleteSkills(null).length === 0
  );

} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
