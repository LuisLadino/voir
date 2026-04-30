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
  getRecentTrackingState,
  getRecentPromptScopedTrackingState,
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
