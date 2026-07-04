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
  getIncompleteSkills,
  buildSentinelRegex,
  getRepoRoot,
  isInsideRepo,
  isDebugScanExempt,
  checkForDebugStatements
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

  // #256: explicit SKILL_COMPLETE sentinel completes a gated skill.
  const sentinelPlan = isSkillComplete('/plan', ["echo 'SKILL_COMPLETE: plan'"], new Set());
  report(
    '#256: SKILL_COMPLETE: plan sentinel completes /plan',
    sentinelPlan.complete === true,
    `got ${JSON.stringify(sentinelPlan)}`
  );

  // #256: sentinel inside a compound command, script plus echo, completes.
  const sentinelCompound = isSkillComplete(
    '/plan',
    ['bash /tmp/issues.sh && echo "SKILL_COMPLETE: plan"'],
    new Set()
  );
  report(
    '#256: sentinel in compound command completes /plan',
    sentinelCompound.complete === true,
    `got ${JSON.stringify(sentinelCompound)}`
  );

  // #256: sentinel for the wrong skill does NOT complete a different gated skill.
  const sentinelWrong = isSkillComplete(
    '/commit',
    ["echo 'SKILL_COMPLETE: plan'"],
    new Set()
  );
  report(
    '#256: SKILL_COMPLETE: plan does NOT complete /commit',
    sentinelWrong.complete === false,
    `got ${JSON.stringify(sentinelWrong)}`
  );

  // #256: plugin-namespaced /plan accepts the sentinel after stripping namespace.
  const sentinelNamespaced = isSkillComplete(
    '/project-management:plan',
    ["echo 'SKILL_COMPLETE: plan'"],
    new Set()
  );
  report(
    '#256: namespaced /project-management:plan with sentinel is complete',
    sentinelNamespaced.complete === true,
    `got ${JSON.stringify(sentinelNamespaced)}`
  );

  // #256: hyphenated skill name /dispatch works. Confirms regex escape path.
  const sentinelDispatch = isSkillComplete(
    '/dispatch',
    ["echo 'SKILL_COMPLETE: dispatch'"],
    new Set()
  );
  report(
    '#256: SKILL_COMPLETE: dispatch sentinel completes /dispatch',
    sentinelDispatch.complete === true,
    `got ${JSON.stringify(sentinelDispatch)}`
  );

  // #256: bare SKILL_COMPLETE without a name does NOT complete.
  const sentinelBare = isSkillComplete('/plan', ["echo 'SKILL_COMPLETE'"], new Set());
  report(
    '#256: bare SKILL_COMPLETE without skill name does NOT complete',
    sentinelBare.complete === false,
    `got ${JSON.stringify(sentinelBare)}`
  );

  // #256: sentinel without whitespace after colon also matches.
  const sentinelTight = isSkillComplete('/plan', ["echo 'SKILL_COMPLETE:plan'"], new Set());
  report(
    '#256: SKILL_COMPLETE:plan with no whitespace matches',
    sentinelTight.complete === true,
    `got ${JSON.stringify(sentinelTight)}`
  );

  // #256: prompt-scoped Skill plus script plus sentinel completes /plan.
  const sentinelScoped = {
    tools: [
      { tool: 'Skill', skill: 'plan' },
      { tool: 'Bash', command: 'bash /tmp/issues.sh' },
      { tool: 'Bash', command: "echo 'SKILL_COMPLETE: plan'" }
    ]
  };
  report(
    '#256: scoped Skill + script + sentinel completes /plan',
    getIncompleteSkills(sentinelScoped).length === 0,
    `got ${JSON.stringify(getIncompleteSkills(sentinelScoped))}`
  );

  // #256: prefix-collision guard. SKILL_COMPLETE: plan must NOT match a sentinel
  // built for a hypothetical "plan-foo" skill.
  const planFooRx = buildSentinelRegex('plan-foo');
  report(
    '#256: SKILL_COMPLETE: plan does NOT match plan-foo sentinel regex',
    planFooRx.test('echo SKILL_COMPLETE: plan') === false
  );
  report(
    '#256: SKILL_COMPLETE: plan-foo matches plan-foo sentinel regex',
    planFooRx.test('echo SKILL_COMPLETE: plan-foo') === true
  );

  // #256: regex-escape sanity. Skill name with metachar treats . as literal.
  const planDotRx = buildSentinelRegex('weird.name');
  report(
    '#256: skill name with metachar treats . as literal',
    planDotRx.test('SKILL_COMPLETE: weird.name') === true &&
    planDotRx.test('SKILL_COMPLETE: weirdXname') === false
  );

  // #510: isInsideRepo — files outside the repo root must not be scanned.
  const fakeRoot = '/Users/dev/myrepo';
  report(
    '#510: file nested inside repo root is inside',
    isInsideRepo('/Users/dev/myrepo/src/a.cjs', fakeRoot) === true
  );
  report(
    '#510: the repo root itself is inside',
    isInsideRepo('/Users/dev/myrepo', fakeRoot) === true
  );
  report(
    '#510: /tmp scratch file is outside the repo',
    isInsideRepo('/tmp/apply_phase2.py', fakeRoot) === false
  );
  report(
    '#510: sibling dir sharing a name prefix is outside the repo',
    isInsideRepo('/Users/dev/myrepo-backup/x.cjs', fakeRoot) === false
  );
  report(
    '#510: null repo root preserves prior behavior (treats path as inside)',
    isInsideRepo('/tmp/anything.py', null) === true
  );

  // #510: getRepoRoot resolves the repo from the test process cwd.
  const detectedRoot = getRepoRoot();
  report(
    '#510: getRepoRoot resolves a root that contains this test file',
    typeof detectedRoot === 'string' && isInsideRepo(__dirname, detectedRoot),
    `got ${JSON.stringify(detectedRoot)}`
  );

  // #557: isDebugScanExempt — repo-root scripts/ holds CLI tooling, exempt.
  const exRoot = '/Users/dev/myrepo';
  report(
    '#557: repo-root scripts/ file is exempt from the debug scan',
    isDebugScanExempt('/Users/dev/myrepo/scripts/run-tests.cjs', exRoot) === true
  );
  report(
    '#557: nested file under repo-root scripts/ is exempt',
    isDebugScanExempt('/Users/dev/myrepo/scripts/cognee/install.sh', exRoot) === true
  );
  report(
    '#557: a sibling dir sharing the "scripts" prefix is NOT exempt',
    isDebugScanExempt('/Users/dev/myrepo/scriptsfoo/bar.cjs', exRoot) === false
  );
  report(
    '#557: an ordinary production file is NOT exempt',
    isDebugScanExempt('/Users/dev/myrepo/src/components/Button.tsx', exRoot) === false
  );
  report(
    '#557: .claude/scripts/ still exempt (regression)',
    isDebugScanExempt('/Users/dev/myrepo/.claude/scripts/x.cjs', exRoot) === true
  );
  report(
    '#557: .claude/hooks/ still exempt (regression)',
    isDebugScanExempt('/Users/dev/myrepo/.claude/hooks/foo.cjs', exRoot) === true
  );
  report(
    '#557: test files still exempt (regression)',
    isDebugScanExempt('/Users/dev/myrepo/src/foo.test.cjs', exRoot) === true
  );
  report(
    '#557: with no repo root, repo-root scripts/ cannot be detected as exempt',
    isDebugScanExempt('/Users/dev/myrepo/scripts/run-tests.cjs', null) === false
  );

  // #680: Python package CLI entrypoint — `python -m pkg` prints ARE the output.
  report(
    '#680: __main__.py CLI entrypoint is exempt from the debug scan',
    isDebugScanExempt('/Users/dev/myrepo/services/x/pkg/eval/__main__.py', exRoot) === true
  );
  report(
    '#680: __main__.py is exempt by basename even with no repo root',
    isDebugScanExempt('/anywhere/pkg/__main__.py', null) === true
  );
  report(
    '#680: an ordinary .py module is NOT exempt',
    isDebugScanExempt('/Users/dev/myrepo/src/pkg/service.py', exRoot) === false
  );
  report(
    '#680: a non-entrypoint main.py is NOT exempt (precise to __main__.py)',
    isDebugScanExempt('/Users/dev/myrepo/src/pkg/main.py', exRoot) === false
  );

  // #604: slash-command invocations now tracked. Registered skills with no
  // completion signal trip the gate.
  const scopedSlashResearch = {
    tools: [],
    skillInvocations: [{ skill: 'research', source: 'slash_command' }]
  };
  const slashResearchIncomplete = getIncompleteSkills(scopedSlashResearch);
  report(
    '#604: slash-invoked research without tools is incomplete',
    slashResearchIncomplete.length === 1 && slashResearchIncomplete[0].skill === '/research',
    `got ${JSON.stringify(slashResearchIncomplete)}`
  );

  // #604: slash-invoked research with WebSearch tool is complete.
  const scopedSlashResearchWithTool = {
    tools: [{ tool: 'WebSearch', query: 'test' }],
    skillInvocations: [{ skill: 'research', source: 'slash_command' }]
  };
  const slashResearchComplete = getIncompleteSkills(scopedSlashResearchWithTool);
  report(
    '#604: slash-invoked research with WebSearch is complete',
    slashResearchComplete.length === 0,
    `got ${JSON.stringify(slashResearchComplete)}`
  );

  // #604: slash-invoked exempt skills (e.g., /define) never trip.
  const scopedSlashDefine = {
    tools: [],
    skillInvocations: [{ skill: 'define', source: 'slash_command' }]
  };
  const slashDefineIncomplete = getIncompleteSkills(scopedSlashDefine);
  report(
    '#604: slash-invoked exempt skill /define is complete',
    slashDefineIncomplete.length === 0,
    `got ${JSON.stringify(slashDefineIncomplete)}`
  );

  // #604: unregistered slash commands (like /cost, /help) are silently ignored.
  // They don't trip the drift tripwire because they're built-in CLI, not kit skills.
  const scopedUnregisteredSlash = {
    tools: [],
    skillInvocations: [{ skill: 'cost', source: 'slash_command' }]
  };
  const unregisteredSlashIgnored = getIncompleteSkills(scopedUnregisteredSlash);
  report(
    '#604: unregistered slash command /cost is ignored (no drift tripwire)',
    unregisteredSlashIgnored.length === 0,
    `got ${JSON.stringify(unregisteredSlashIgnored)}`
  );

  // #604: both Skill-tool and slash-command in same scope, each checked.
  const scopedBothPaths = {
    tools: [
      { tool: 'Skill', skill: 'plan' },
      { tool: 'Bash', command: 'gh issue create' }
    ],
    skillInvocations: [{ skill: 'research', source: 'slash_command' }]
  };
  const bothPathsChecked = getIncompleteSkills(scopedBothPaths);
  report(
    '#604: both Skill-tool (plan, complete) and slash (research, incomplete) checked',
    bothPathsChecked.length === 1 && bothPathsChecked[0].skill === '/research',
    `got ${JSON.stringify(bothPathsChecked)}`
  );

  // #604: dedup — same skill from both paths appears once in result.
  const scopedDupedResearch = {
    tools: [{ tool: 'Skill', skill: 'research' }, { tool: 'WebSearch' }],
    skillInvocations: [{ skill: 'research', source: 'slash_command' }]
  };
  const dedupedResult = getIncompleteSkills(scopedDupedResearch);
  report(
    '#604: dedup — same skill via both paths counts once',
    dedupedResult.length === 0,
    `got ${JSON.stringify(dedupedResult)}`
  );

  // #838: the debug-statement detector must not match a keyword that is the
  // tail of a larger identifier. The reported regression: `print(` matched
  // `fingerprint(`. Each keyword pattern is now guarded by `(?<!\w)`.
  const writeSrc = (name, body) => {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, body);
    return p;
  };

  // Python: fingerprint/footprint/blueprint calls (all end in `print(`) clean.
  const pyClean = writeSrc('breaker.py', [
    'def fingerprint(name, args):',
    '    keys = [fingerprint(c["name"], c["args"]) for c in calls]',
    '    return footprint(keys) + blueprint(keys)',
  ].join('\n'));
  report(
    '#838: fingerprint/footprint/blueprint( do NOT match the print detector',
    checkForDebugStatements(pyClean, null).length === 0,
    `got ${JSON.stringify(checkForDebugStatements(pyClean, null))}`
  );

  // Python: a real print( call is still flagged.
  const pyPrint = writeSrc('service.py', 'def run(x):\n    print("debug", x)\n');
  const pyPrintHits = checkForDebugStatements(pyPrint, null);
  report(
    '#838: a real print( call is still flagged',
    pyPrintHits.length === 1 && pyPrintHits[0].line === 2,
    `got ${JSON.stringify(pyPrintHits)}`
  );

  // Python: print(..., file=...) remains exempt — legit stderr logging.
  const pyPrintFile = writeSrc('logger.py', 'print("err", file=sys.stderr)\n');
  report(
    '#838: print(..., file=...) is not flagged',
    checkForDebugStatements(pyPrintFile, null).length === 0,
    `got ${JSON.stringify(checkForDebugStatements(pyPrintFile, null))}`
  );

  // Ruby: `inputs ` ends in `puts ` but must not match the puts detector.
  const rbClean = writeSrc('form.rb', 'inputs first_name, last_name\n');
  report(
    '#838: Ruby `inputs ` does not match the `puts ` detector',
    checkForDebugStatements(rbClean, null).length === 0,
    `got ${JSON.stringify(checkForDebugStatements(rbClean, null))}`
  );

  // Ruby: a real `puts ` statement is still flagged.
  const rbPuts = writeSrc('debug.rb', 'puts "value is #{x}"\n');
  report(
    '#838: Ruby real `puts ` is still flagged',
    checkForDebugStatements(rbPuts, null).length === 1,
    `got ${JSON.stringify(checkForDebugStatements(rbPuts, null))}`
  );

  // JS: `myconsole.log(` (suffix identifier) clean; real console.log still flagged.
  const jsClean = writeSrc('widget.js', 'const myconsole = mk(); myconsole.log("x");\n');
  report(
    '#838: JS `myconsole.log(` does not match the console.log detector',
    checkForDebugStatements(jsClean, null).length === 0,
    `got ${JSON.stringify(checkForDebugStatements(jsClean, null))}`
  );
  const jsLog = writeSrc('widget2.js', 'function f() { console.log("x"); }\n');
  report(
    '#838: JS real console.log( is still flagged',
    checkForDebugStatements(jsLog, null).length === 1,
    `got ${JSON.stringify(checkForDebugStatements(jsLog, null))}`
  );

  // JS: a method/property access still matches — `this.console.log(` is a real call.
  const jsThis = writeSrc('widget3.js', 'class C { f() { this.console.log("x"); } }\n');
  report(
    '#838: JS `this.console.log(` (non-word char before keyword) is still flagged',
    checkForDebugStatements(jsThis, null).length === 1,
    `got ${JSON.stringify(checkForDebugStatements(jsThis, null))}`
  );

} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
