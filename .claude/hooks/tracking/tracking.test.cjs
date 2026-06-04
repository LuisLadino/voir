#!/usr/bin/env node

/**
 * Concurrency test for tracking persistence.
 *
 * Spawns N child workers that each append K events to the same session log.
 * Asserts the final file has exactly N*K parseable lines with no duplicates
 * and no corruption. Verifies the append-only JSONL approach survives the
 * parallel-hook workload that broke the old read-modify-write JSON scheme.
 *
 * Run:
 *   node .claude/hooks/tracking/tracking.test.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');

const {
  appendTrackingEvent,
  readTrackingEvents,
  readTrackingState,
  readPromptScopedState,
  readSessionScopedSpecState,
  readPromptScopedTrackingState,
  readSkillTelemetryState,
  getRecentTrackingState,
  getRecentPromptScopedTrackingState,
  getRecentSkillTelemetryState,
  getSessionTrackingPath,
  _resetRecentStateCache
} = require('../lib/session-utils.cjs');

const WORKERS = 8;
const EVENTS_PER_WORKER = 100;

function runWorker() {
  const { mode, sessionId, workspacePath, workerId, count } = JSON.parse(process.argv[2]);
  if (mode === 'enforcement') {
    for (let i = 0; i < count; i++) {
      appendTrackingEvent(sessionId, {
        type: 'spec_read',
        name: `spec-${workerId}-${i}`,
        filePath: `.claude/specs/fake/${workerId}-${i}.md`
      }, workspacePath);
    }
    if (workerId === 0) {
      appendTrackingEvent(sessionId, { type: 'plan_skill_read' }, workspacePath);
      appendTrackingEvent(sessionId, { type: 'voice_blocked', hash: 'abcdef1234567890' }, workspacePath);
    }
    process.exit(0);
  }
  for (let i = 0; i < count; i++) {
    appendTrackingEvent(sessionId, {
      type: 'tool',
      tool: 'Bash',
      worker: workerId,
      index: i,
      command: `cmd-${workerId}-${i}`
    }, workspacePath);
  }
  process.exit(0);
}

function runEnforcementWorkers(sessionId, workspacePath, workers, specReads) {
  const children = [];
  for (let w = 0; w < workers; w++) {
    const payload = JSON.stringify({
      mode: 'enforcement',
      sessionId,
      workspacePath,
      workerId: w,
      count: specReads
    });
    children.push(new Promise((res, rej) => {
      const child = fork(__filename, [payload], { stdio: 'inherit' });
      child.on('exit', code => code === 0 ? res() : rej(new Error(`enforcement worker ${w} exited ${code}`)));
    }));
  }
  return Promise.all(children);
}

function runTests() {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'tracking-test-'));
  const sessionId = `test-${Date.now()}`;

  let pass = 0;
  let fail = 0;
  const report = (name, ok, detail) => {
    if (ok) { pass++; console.log(`PASS  ${name}`); }
    else    { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
  };

  console.log(`Test workspace: ${workspacePath}`);
  console.log(`Session: ${sessionId}`);

  // classifyFailure: pure-function tests for the failureKind discriminator.
  // Establishes that grep no-match and friends classify as nonzero_exit while
  // genuine errors classify as tool_error.
  const { classifyFailure } = require('./classify-failure.cjs');

  const cf = (tool, command) => classifyFailure(tool, { command });

  report('classifyFailure: non-Bash tool always tool_error',
    classifyFailure('Read', { file_path: '/tmp/missing' }) === 'tool_error');
  report('classifyFailure: MCP tool always tool_error',
    classifyFailure('mcp__claude_ai_Gmail__search_threads', {}) === 'tool_error');
  report('classifyFailure: empty command tool_error',
    cf('Bash', '') === 'tool_error');
  report('classifyFailure: missing tool_input tool_error',
    classifyFailure('Bash', undefined) === 'tool_error');

  // Allowlisted bins
  report('classifyFailure: grep no-match nonzero_exit',
    cf('Bash', 'grep -r "needle" haystack/') === 'nonzero_exit');
  report('classifyFailure: rg no-match nonzero_exit',
    cf('Bash', 'rg --files-with-matches foo .') === 'nonzero_exit');
  report('classifyFailure: diff with differences nonzero_exit',
    cf('Bash', 'diff a.txt b.txt') === 'nonzero_exit');

  // Last-segment-of-pipeline rule
  report('classifyFailure: pipeline ending in grep nonzero_exit',
    cf('Bash', 'cat file.txt | grep needle') === 'nonzero_exit');
  report('classifyFailure: pipeline ending in non-allowlisted bin tool_error',
    cf('Bash', 'grep needle file.txt | wc -l') === 'tool_error');

  // Genuine errors
  report('classifyFailure: gh CLI failure tool_error',
    cf('Bash', 'gh pr create --title "x" --body-file /tmp/') === 'tool_error');
  report('classifyFailure: dispatch dry-run constraint tool_error',
    cf('Bash', 'node .claude/hooks/lib/dispatch.cjs --dry-run 1 2 3 4 5 6') === 'tool_error');
  report('classifyFailure: missing-file Read tool_error',
    classifyFailure('Read', { file_path: '/tmp/missing-file.md' }) === 'tool_error');

  // VAR=val prefixes ignored
  report('classifyFailure: VAR=val grep nonzero_exit',
    cf('Bash', 'GREP_OPTIONS= grep needle file.txt') === 'nonzero_exit');

  // Path-stripped binary
  report('classifyFailure: /usr/bin/grep nonzero_exit',
    cf('Bash', '/usr/bin/grep -E foo file.txt') === 'nonzero_exit');

  console.log(`Spawning ${WORKERS} workers x ${EVENTS_PER_WORKER} events = ${WORKERS * EVENTS_PER_WORKER} total events\n`);

  const children = [];
  for (let w = 0; w < WORKERS; w++) {
    const payload = JSON.stringify({
      sessionId,
      workspacePath,
      workerId: w,
      count: EVENTS_PER_WORKER
    });
    children.push(new Promise((resolve, reject) => {
      const child = fork(__filename, [payload], { stdio: 'inherit' });
      child.on('exit', code => code === 0 ? resolve() : reject(new Error(`worker ${w} exited ${code}`)));
    }));
  }

  return Promise.all(children).then(() => {
    const trackingPath = getSessionTrackingPath(sessionId, workspacePath);
    const rawBytes = fs.readFileSync(trackingPath, 'utf8');
    const nonEmptyLines = rawBytes.split('\n').filter(l => l.trim().length > 0);
    const events = readTrackingEvents(sessionId, workspacePath);

    report('file exists', fs.existsSync(trackingPath));
    report(
      `line count = ${WORKERS * EVENTS_PER_WORKER}`,
      nonEmptyLines.length === WORKERS * EVENTS_PER_WORKER,
      `got ${nonEmptyLines.length}`
    );
    report(
      `all lines parse as JSON`,
      events.length === nonEmptyLines.length,
      `parsed ${events.length} of ${nonEmptyLines.length}`
    );

    // Range-validate worker/index so a partial overwrite that happens to
    // produce valid JSON with `worker: undefined` fails loudly instead of
    // masquerading as a unique event.
    const seen = new Set();
    let duplicates = 0;
    let outOfRange = 0;
    for (const ev of events) {
      if (
        typeof ev.worker !== 'number' || ev.worker < 0 || ev.worker >= WORKERS ||
        typeof ev.index !== 'number' || ev.index < 0 || ev.index >= EVENTS_PER_WORKER
      ) {
        outOfRange++;
        continue;
      }
      const key = `${ev.worker}-${ev.index}`;
      if (seen.has(key)) duplicates++;
      else seen.add(key);
    }
    report(`all events have valid worker/index`, outOfRange === 0, `${outOfRange} out-of-range`);
    report(`no duplicate events`, duplicates === 0, `found ${duplicates} duplicates`);

    let missing = 0;
    for (let w = 0; w < WORKERS; w++) {
      for (let i = 0; i < EVENTS_PER_WORKER; i++) {
        if (!seen.has(`${w}-${i}`)) missing++;
      }
    }
    report(`no missing events`, missing === 0, `${missing} events missing`);

    const state = readTrackingState(sessionId, workspacePath);
    report(
      `readTrackingState reconstructs tools[]`,
      state.tools.length === WORKERS * EVENTS_PER_WORKER,
      `got ${state.tools.length}`
    );

    // getRecentTrackingState is what verify-before-stop actually calls.
    // Its selection logic must also reconstruct the session we just wrote.
    const recent = getRecentTrackingState(workspacePath);
    report(
      `getRecentTrackingState finds this session`,
      recent !== null && recent.tools.length === WORKERS * EVENTS_PER_WORKER,
      recent === null ? 'returned null' : `got ${recent.tools.length} tools`
    );

    // Enforcement state coverage (#102): verify spec_read, plan_skill_read,
    // and voice_blocked events survive the same concurrent workload, and
    // that readPromptScopedState reconstructs them correctly.
    appendTrackingEvent(sessionId, { type: 'prompt_start' }, workspacePath);

    const ENFORCE_WORKERS = 8;
    const SPEC_READS = 50;
    runEnforcementWorkers(sessionId, workspacePath, ENFORCE_WORKERS, SPEC_READS).then(() => {
      const scoped = readPromptScopedState(sessionId, workspacePath);
      const expectedSpecs = ENFORCE_WORKERS * SPEC_READS;
      report(
        `readPromptScopedState: spec_read count (unique names)`,
        scoped.specsRead.length === expectedSpecs,
        `got ${scoped.specsRead.length}/${expectedSpecs}`
      );
      report(`readPromptScopedState: plan_skill_read latched`, scoped.planSkillRead === true);
      report(
        `readPromptScopedState: lastVoiceBlockedHash present`,
        typeof scoped.lastVoiceBlockedHash === 'string' && scoped.lastVoiceBlockedHash.length > 0,
        `got ${scoped.lastVoiceBlockedHash}`
      );

      // Explicit dedup test: same spec name appended 20 times collapses to one.
      const dupSid = sessionId + '-dup';
      appendTrackingEvent(dupSid, { type: 'prompt_start' }, workspacePath);
      for (let i = 0; i < 20; i++) {
        appendTrackingEvent(dupSid, { type: 'spec_read', name: 'same-name' }, workspacePath);
      }
      const dupScoped = readPromptScopedState(dupSid, workspacePath);
      report(
        `readPromptScopedState: spec_read dedup (same name → single entry)`,
        dupScoped.specsRead.length === 1 && dupScoped.specsRead[0] === 'same-name',
        `got ${JSON.stringify(dupScoped.specsRead)}`
      );

      // Verify prompt scoping: a new prompt_start should reset state.
      appendTrackingEvent(sessionId, { type: 'prompt_start' }, workspacePath);
      const scopedAfterReset = readPromptScopedState(sessionId, workspacePath);
      report(
        `prompt_start resets scope`,
        scopedAfterReset.specsRead.length === 0 &&
        scopedAfterReset.planSkillRead === false &&
        scopedAfterReset.lastVoiceBlockedHash === null,
        `got ${JSON.stringify(scopedAfterReset)}`
      );

      // Subagent enforcement path (#143): subagents never fire
      // UserPromptSubmit so no `prompt_start` is written. The session-
      // scoped reader must count `spec_read` events without that boundary.
      const subSid = sessionId + '-subagent';
      appendTrackingEvent(subSid, { type: 'spec_read', name: 'hooks' }, workspacePath);
      appendTrackingEvent(subSid, { type: 'spec_read', name: 'tracking-persistence' }, workspacePath);
      appendTrackingEvent(subSid, { type: 'plan_skill_read' }, workspacePath);

      const subScoped = readSessionScopedSpecState(subSid, workspacePath);
      report(
        `subagent: session-scoped reader counts spec_read without prompt_start`,
        subScoped.specsRead.length === 2 &&
        subScoped.specsRead.includes('hooks') &&
        subScoped.specsRead.includes('tracking-persistence'),
        `got ${JSON.stringify(subScoped.specsRead)}`
      );
      report(
        `subagent: session-scoped reader latches plan_skill_read without prompt_start`,
        subScoped.planSkillRead === true
      );

      // Empty subagent tracking = fail closed (no spec_read events).
      const emptySid = sessionId + '-empty-subagent';
      appendTrackingEvent(emptySid, { type: 'tool', tool: 'Bash' }, workspacePath);
      const emptyScoped = readSessionScopedSpecState(emptySid, workspacePath);
      report(
        `subagent: session-scoped reader returns empty specsRead when no spec_read events`,
        emptyScoped.specsRead.length === 0,
        `got ${JSON.stringify(emptyScoped.specsRead)}`
      );

      // Main-session regression: prompt-scoped reader still fails closed
      // when only spec_read events exist without a prompt_start boundary.
      const mainSid = sessionId + '-main-no-prompt-start';
      appendTrackingEvent(mainSid, { type: 'spec_read', name: 'hooks' }, workspacePath);
      const mainScoped = readPromptScopedState(mainSid, workspacePath);
      report(
        `main session: prompt-scoped reader still fails closed without prompt_start`,
        mainScoped.specsRead.length === 0,
        `got ${JSON.stringify(mainScoped.specsRead)}`
      );

      // #231: readPromptScopedTrackingState drops events from prior prompts.
      // Simulates the bug. Skill invoked + completed in turn 1, user sends
      // turn 2 with only non-skill activity. Pre-fix, Stop at turn 2 re-read
      // the turn-1 Skill event and the turn-1 bash completion, flagging and
      // un-flagging correctly but burning cycles. More importantly, an
      // unregistered skill invoked in turn 1 would tripwire at every later
      // turn's Stop forever.
      const scopeSid = sessionId + '-scope-231';
      // Turn 1: prompt, skill invocation, bash completion, more activity.
      appendTrackingEvent(scopeSid, { type: 'prompt_start' }, workspacePath);
      appendTrackingEvent(scopeSid, { type: 'tool', tool: 'Skill', skill: 'dispatch' }, workspacePath);
      appendTrackingEvent(scopeSid, { type: 'tool', tool: 'Bash', command: 'node .claude/hooks/lib/dispatch.cjs --list' }, workspacePath);
      appendTrackingEvent(scopeSid, { type: 'tool', tool: 'Skill', skill: 'novel-unregistered-skill' }, workspacePath);
      // Turn 2: new prompt, only non-skill Bash activity.
      appendTrackingEvent(scopeSid, { type: 'prompt_start' }, workspacePath);
      appendTrackingEvent(scopeSid, { type: 'tool', tool: 'Bash', command: 'ls' }, workspacePath);

      const turn2Scope = readPromptScopedTrackingState(scopeSid, workspacePath);
      report(
        '#231: prompt-scoped tracking after new prompt_start drops turn-1 tools',
        turn2Scope.tools.length === 1 &&
        turn2Scope.tools[0].tool === 'Bash' &&
        turn2Scope.tools[0].command === 'ls',
        `got ${JSON.stringify(turn2Scope.tools)}`
      );
      report(
        '#231: prompt-scoped tracking after new prompt_start has no Skill invocations',
        !turn2Scope.tools.some(t => t.tool === 'Skill'),
        `got ${JSON.stringify(turn2Scope.tools)}`
      );

      // #231: within a single prompt, all events post-prompt_start are in scope.
      const turn1Sid = sessionId + '-scope-231-singleturn';
      appendTrackingEvent(turn1Sid, { type: 'prompt_start' }, workspacePath);
      appendTrackingEvent(turn1Sid, { type: 'tool', tool: 'Skill', skill: 'dispatch' }, workspacePath);
      appendTrackingEvent(turn1Sid, { type: 'tool', tool: 'Bash', command: 'node .claude/hooks/lib/dispatch.cjs --list' }, workspacePath);

      const turn1Scope = readPromptScopedTrackingState(turn1Sid, workspacePath);
      report(
        '#231: prompt-scoped tracking within a single prompt includes all post-prompt_start tools',
        turn1Scope.tools.length === 2,
        `got ${JSON.stringify(turn1Scope.tools)}`
      );

      // #231: no prompt_start at all returns empty collections, benign for Stop.
      const noPromptSid = sessionId + '-scope-231-noprompt';
      appendTrackingEvent(noPromptSid, { type: 'tool', tool: 'Skill', skill: 'dispatch' }, workspacePath);
      appendTrackingEvent(noPromptSid, { type: 'tool', tool: 'Bash', command: 'echo x' }, workspacePath);

      const noPromptScope = readPromptScopedTrackingState(noPromptSid, workspacePath);
      report(
        '#231: no prompt_start returns empty tools, fail-open for Stop check',
        noPromptScope.tools.length === 0,
        `got ${JSON.stringify(noPromptScope.tools)}`
      );

      // #231: getRecentPromptScopedTrackingState uses the session-id resolver
      // and the same reducer. Use an isolated workspace so findRecentSessionId
      // picks up our session by mtime, not a sibling from the concurrency run.
      _resetRecentStateCache();
      const scopeWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tracking-scope-'));
      const recentSid = `scope-recent-${Date.now()}`;
      appendTrackingEvent(recentSid, { type: 'prompt_start' }, scopeWorkspace);
      appendTrackingEvent(recentSid, { type: 'tool', tool: 'Bash', command: 'echo scoped' }, scopeWorkspace);
      const recentScoped = getRecentPromptScopedTrackingState(scopeWorkspace);
      report(
        '#231: getRecentPromptScopedTrackingState resolves the most recent session',
        recentScoped !== null && recentScoped.tools.some(t => t.command === 'echo scoped'),
        recentScoped === null ? 'returned null' : `got ${JSON.stringify(recentScoped.tools)}`
      );

      // getRecentTrackingState memoization: three inject-context modules call
      // this in one UserPromptSubmit hook run. Use an isolated workspace so
      // cleanup doesn't collide with the other files in the concurrency
      // workspace above.
      _resetRecentStateCache();
      const cacheWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tracking-cache-'));
      const cacheSessionId = `cache-${Date.now()}`;
      appendTrackingEvent(cacheSessionId, { type: 'tool', tool: 'Bash' }, cacheWorkspace);

      const first = getRecentTrackingState(cacheWorkspace);
      const second = getRecentTrackingState(cacheWorkspace);
      report(
        `getRecentTrackingState returns same object reference on second call (cache hit)`,
        first !== null && first === second,
        first === null ? 'first call returned null' : `first === second: ${first === second}`
      );

      // Stronger proof: delete the backing file. A cache-miss would now
      // return null (empty tracking dir). A cache-hit returns the same
      // state we got on the first call.
      const cacheFile = getSessionTrackingPath(cacheSessionId, cacheWorkspace);
      fs.unlinkSync(cacheFile);
      const third = getRecentTrackingState(cacheWorkspace);
      report(
        `getRecentTrackingState serves cached state after backing file deleted`,
        third !== null && third === first,
        third === null ? 'returned null (cache did not serve)' : 'ok'
      );

      // After reset, a fresh call must actually re-resolve. With no tracking
      // file left, that means null.
      _resetRecentStateCache();
      const fourth = getRecentTrackingState(cacheWorkspace);
      report(
        `_resetRecentStateCache clears the cache`,
        fourth === null,
        `expected null, got ${fourth === null ? 'null' : 'non-null'}`
      );

      // #347: per-skill telemetry rollup (OpenSpace shape).
      const stA = sessionId + '-skill-a';
      appendTrackingEvent(stA, { type: 'prompt_start' }, workspacePath);
      appendTrackingEvent(stA, { type: 'skill_invocation', skill: 'research', source: 'slash_command' }, workspacePath);
      appendTrackingEvent(stA, { type: 'tool', tool: 'WebSearch', query: 'x' }, workspacePath);
      appendTrackingEvent(stA, { type: 'tool', tool: 'Read', file: 'foo.md' }, workspacePath);
      const recA = readSkillTelemetryState(stA, workspacePath);
      report(
        '#347 A: research+WebSearch is completed, applied, no fallback, 2 tool successes',
        recA.length === 1 &&
        recA[0].skill_name === 'research' &&
        recA[0].completed === true &&
        recA[0].fallback_used === false &&
        recA[0].tool_success_count === 2 &&
        recA[0].source === 'slash_command' &&
        recA[0].registered === true &&
        recA[0].exempt === false,
        `got ${JSON.stringify(recA)}`
      );

      const stB = sessionId + '-skill-b';
      appendTrackingEvent(stB, { type: 'prompt_start' }, workspacePath);
      appendTrackingEvent(stB, { type: 'skill_invocation', skill: 'research', source: 'slash_command' }, workspacePath);
      appendTrackingEvent(stB, { type: 'tool', tool: 'Read', file: 'a.md' }, workspacePath);
      appendTrackingEvent(stB, { type: 'skill_invocation', skill: 'commit', source: 'slash_command' }, workspacePath);
      appendTrackingEvent(stB, { type: 'tool', tool: 'Bash', command: 'git push origin main' }, workspacePath);
      const recB = readSkillTelemetryState(stB, workspacePath);
      report(
        '#347 B: research incomplete + commit complete → research.fallback_used',
        recB.length === 2 &&
        recB[0].skill_name === 'research' &&
        recB[0].completed === false &&
        recB[0].fallback_used === true &&
        recB[1].skill_name === 'commit' &&
        recB[1].completed === true,
        `got ${JSON.stringify(recB)}`
      );

      const stC = sessionId + '-skill-c';
      appendTrackingEvent(stC, { type: 'prompt_start' }, workspacePath);
      appendTrackingEvent(stC, { type: 'skill_invocation', skill: 'define', source: 'slash_command' }, workspacePath);
      const recC = readSkillTelemetryState(stC, workspacePath);
      report(
        '#347 C: exempt skill (define) is completed with no tools',
        recC.length === 1 && recC[0].completed === true && recC[0].exempt === true && recC[0].tool_success_count === 0,
        `got ${JSON.stringify(recC)}`
      );

      const stD = sessionId + '-skill-d';
      appendTrackingEvent(stD, { type: 'prompt_start' }, workspacePath);
      appendTrackingEvent(stD, { type: 'skill_invocation', skill: 'novel-unregistered', source: 'slash_command' }, workspacePath);
      appendTrackingEvent(stD, { type: 'tool', tool: 'Bash', command: 'git push' }, workspacePath);
      const recD = readSkillTelemetryState(stD, workspacePath);
      report(
        '#347 D: unknown skill registered=false, completed=false (tripwire)',
        recD.length === 1 && recD[0].registered === false && recD[0].completed === false,
        `got ${JSON.stringify(recD)}`
      );

      const stE = sessionId + '-skill-e';
      appendTrackingEvent(stE, { type: 'prompt_start' }, workspacePath);
      appendTrackingEvent(stE, { type: 'skill_invocation', skill: 'research', source: 'slash_command' }, workspacePath);
      appendTrackingEvent(stE, { type: 'tool', tool: 'WebSearch', query: 'x' }, workspacePath);
      appendTrackingEvent(stE, { type: 'failure', tool: 'WebFetch', error: 'timeout' }, workspacePath);
      appendTrackingEvent(stE, { type: 'failure', tool: 'Bash', error: 'exit 1' }, workspacePath);
      const recE = readSkillTelemetryState(stE, workspacePath);
      report(
        '#347 E: failures count as tool_failure_count, successes separate',
        recE.length === 1 && recE[0].tool_success_count === 1 && recE[0].tool_failure_count === 2 && recE[0].completed === true,
        `got ${JSON.stringify(recE)}`
      );

      const stF = sessionId + '-skill-f';
      appendTrackingEvent(stF, { type: 'prompt_start' }, workspacePath);
      appendTrackingEvent(stF, { type: 'tool', tool: 'Skill', skill: 'commit' }, workspacePath);
      appendTrackingEvent(stF, { type: 'tool', tool: 'Bash', command: 'git push origin main' }, workspacePath);
      const recF = readSkillTelemetryState(stF, workspacePath);
      report(
        '#347 F: Skill-tool window has source=skill_tool, opener not counted',
        recF.length === 1 && recF[0].source === 'skill_tool' && recF[0].skill_name === 'commit' && recF[0].tool_success_count === 1,
        `got ${JSON.stringify(recF)}`
      );

      const stG = sessionId + '-skill-g';
      appendTrackingEvent(stG, { type: 'prompt_start' }, workspacePath);
      appendTrackingEvent(stG, { type: 'skill_invocation', skill: 'research', source: 'slash_command' }, workspacePath);
      appendTrackingEvent(stG, { type: 'tool', tool: 'WebSearch', query: 'turn-1' }, workspacePath);
      appendTrackingEvent(stG, { type: 'prompt_start' }, workspacePath);
      appendTrackingEvent(stG, { type: 'skill_invocation', skill: 'commit', source: 'slash_command' }, workspacePath);
      appendTrackingEvent(stG, { type: 'tool', tool: 'Bash', command: 'git push origin main' }, workspacePath);
      const recG = readSkillTelemetryState(stG, workspacePath);
      report(
        '#347 G: prompt_start resets scope — only current-prompt records',
        recG.length === 1 && recG[0].skill_name === 'commit',
        `got ${JSON.stringify(recG)}`
      );

      const stH = sessionId + '-skill-h';
      appendTrackingEvent(stH, { type: 'prompt_start' }, workspacePath);
      appendTrackingEvent(stH, { type: 'skill_invocation', skill: 'project-management:sync-stack', source: 'slash_command' }, workspacePath);
      const recH = readSkillTelemetryState(stH, workspacePath);
      report(
        '#347 H: namespaced skill normalizes to bare name, exempt',
        recH.length === 1 && recH[0].skill_name === 'sync-stack' && recH[0].completed === true && recH[0].exempt === true,
        `got ${JSON.stringify(recH)}`
      );

      const stI = sessionId + '-skill-i';
      appendTrackingEvent(stI, { type: 'skill_invocation', skill: 'research', source: 'slash_command' }, workspacePath);
      appendTrackingEvent(stI, { type: 'tool', tool: 'WebSearch', query: 'x' }, workspacePath);
      const recI = readSkillTelemetryState(stI, workspacePath);
      report(
        '#347 I: no prompt_start returns empty array (no scope)',
        Array.isArray(recI) && recI.length === 0,
        `got ${JSON.stringify(recI)}`
      );

      _resetRecentStateCache();
      const skillCacheWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-tel-'));
      const skillCacheSid = `skill-recent-${Date.now()}`;
      appendTrackingEvent(skillCacheSid, { type: 'prompt_start' }, skillCacheWorkspace);
      appendTrackingEvent(skillCacheSid, { type: 'skill_invocation', skill: 'research', source: 'slash_command' }, skillCacheWorkspace);
      appendTrackingEvent(skillCacheSid, { type: 'tool', tool: 'WebSearch', query: 'recent' }, skillCacheWorkspace);
      const recentSkill = getRecentSkillTelemetryState(skillCacheWorkspace);
      report(
        '#347 J: getRecentSkillTelemetryState resolves and reduces',
        recentSkill !== null && recentSkill.length === 1 && recentSkill[0].skill_name === 'research',
        recentSkill === null ? 'returned null' : `got ${JSON.stringify(recentSkill)}`
      );
      const recentSkill2 = getRecentSkillTelemetryState(skillCacheWorkspace);
      report('#347 J: getRecentSkillTelemetryState cache returns same reference', recentSkill === recentSkill2);
      fs.rmSync(skillCacheWorkspace, { recursive: true, force: true });

      fs.rmSync(cacheWorkspace, { recursive: true, force: true });
      fs.rmSync(workspacePath, { recursive: true, force: true });

      console.log(`\n${pass} passed, ${fail} failed`);
      process.exit(fail > 0 ? 1 : 0);
    });
  });
}

if (process.argv[2] && process.argv[2].startsWith('{')) {
  runWorker();
} else {
  runTests();
}
