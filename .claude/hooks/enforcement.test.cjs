#!/usr/bin/env node

/**
 * Enforcement hook integration tests.
 *
 * Spawns enforce-specs, enforce-plan, and enforce-voice as subprocesses
 * with fabricated hook payloads and asserts the exit code. enforce-specs
 * and enforce-plan both read state session-scoped in every context
 * (#459, #452, #552). enforce-voice still branches on `agent_id` to pick
 * the session-scoped reader for subagent contexts: its `lastVoiceBlockedHash`
 * mechanism is content-specific, so per-prompt scoping in the main session
 * stays correct.
 *
 * Run:
 *   node .claude/hooks/enforcement.test.cjs
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const os = require('os');

const REPO = path.resolve(__dirname, '../..');

// Isolate from the operator's live tracking tree BEFORE session-utils loads.
// The #263 mtime-fallback cases resolve enforcement state from the
// most-recently-modified file in the tracking dir. Run against the real
// ~/.claude/projects tree, the ambient session — which appends tracking events
// continuously — races the fixtures and flips the fallback result, so the suite
// flaked under an active session (#648). Point HOME at a throwaway dir before
// requiring session-utils, whose PROJECTS_DIR is computed from process.env.HOME
// at module load; runHook's spawned hooks inherit this HOME, so fixtures and
// hooks share one sandbox the ambient session never writes to.
const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'enforce-test-home-'));
process.env.HOME = SANDBOX_HOME;
delete process.env.USERPROFILE;

const { appendTrackingEvent, readTrackingEvents, getTrackingDir } = require('./lib/session-utils.cjs');

// Derive the tracking dir from session-utils so this test works in any
// project, not just the kit author's workspace. Resolves under SANDBOX_HOME.
const TRACKING_DIR = getTrackingDir();

// TRACKING_DIR lives under SANDBOX_HOME, a fresh tree the ambient session never
// touches, so there is nothing to move aside — just create it.
fs.mkdirSync(TRACKING_DIR, { recursive: true });

let pass = 0;
let fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else    { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

function runHook(relPath, payload) {
  const r = spawnSync('node', [relPath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd: REPO
  });
  return r.status;
}

function resetSession() {
  for (const f of fs.readdirSync(TRACKING_DIR)) {
    fs.unlinkSync(path.join(TRACKING_DIR, f));
  }
}

// Target paths must match the applies_to of a real spec so enforce-specs
// actually needs the specs to be read. `session-utils.cjs` matches both
// hooks.md and tracking-persistence.md.
const EDIT_TARGET = '.claude/hooks/lib/session-utils.cjs';
const PLAN_CMD = 'gh ' + 'issue ' + 'create --title test';
const PBCOPY_CMD = 'echo "hello" | pbcopy';

try {
  // enforce-specs.cjs
  resetSession();
  const sid1 = 'specs-sub-' + Date.now();
  appendTrackingEvent(sid1, { type: 'spec_read', name: 'hooks' });
  appendTrackingEvent(sid1, { type: 'spec_read', name: 'tracking-persistence' });
  report(
    'enforce-specs: subagent with required spec_reads is ALLOWED',
    runHook('.claude/hooks/context/enforce-specs.cjs', {
      tool_input: { file_path: EDIT_TARGET, old_string: 'x', new_string: 'y' },
      agent_id: 'sub-specs-1'
    }) === 0
  );

  resetSession();
  const sid2 = 'specs-sub-empty-' + Date.now();
  appendTrackingEvent(sid2, { type: 'tool', tool: 'Bash' });
  report(
    'enforce-specs: subagent without spec_reads is DENIED',
    runHook('.claude/hooks/context/enforce-specs.cjs', {
      tool_input: { file_path: EDIT_TARGET, old_string: 'x', new_string: 'y' },
      agent_id: 'sub-specs-2'
    }) === 2
  );

  // #459/#452: enforce-specs reads spec state session-scoped. A spec read
  // earlier in the session stays satisfied — no prompt_start boundary needed.
  resetSession();
  const sid3 = 'specs-main-' + Date.now();
  appendTrackingEvent(sid3, { type: 'spec_read', name: 'hooks' });
  appendTrackingEvent(sid3, { type: 'spec_read', name: 'tracking-persistence' });
  report(
    'enforce-specs #459: main session with required spec_reads is ALLOWED (session-scoped)',
    runHook('.claude/hooks/context/enforce-specs.cjs', {
      tool_input: { file_path: EDIT_TARGET, old_string: 'x', new_string: 'y' },
      session_id: sid3
    }) === 0
  );

  resetSession();
  const sid3b = 'specs-main-empty-' + Date.now();
  appendTrackingEvent(sid3b, { type: 'tool', tool: 'Bash' });
  report(
    'enforce-specs: main session with no spec_reads is DENIED',
    runHook('.claude/hooks/context/enforce-specs.cjs', {
      tool_input: { file_path: EDIT_TARGET, old_string: 'x', new_string: 'y' },
      session_id: sid3b
    }) === 2
  );

  // #459/#452: the exact friction the fix removes — a prompt_start mid-session
  // (a new /build branch) must NOT re-require specs read before it.
  resetSession();
  const sid3c = 'specs-main-multiprompt-' + Date.now();
  appendTrackingEvent(sid3c, { type: 'prompt_start' });
  appendTrackingEvent(sid3c, { type: 'spec_read', name: 'hooks' });
  appendTrackingEvent(sid3c, { type: 'spec_read', name: 'tracking-persistence' });
  appendTrackingEvent(sid3c, { type: 'prompt_start' });
  report(
    'enforce-specs #459: spec reads survive a later prompt_start (no per-prompt re-read)',
    runHook('.claude/hooks/context/enforce-specs.cjs', {
      tool_input: { file_path: EDIT_TARGET, old_string: 'x', new_string: 'y' },
      session_id: sid3c
    }) === 0
  );

  // enforce-plan.cjs
  resetSession();
  const sid4 = 'plan-sub-' + Date.now();
  appendTrackingEvent(sid4, { type: 'plan_skill_read' });
  report(
    'enforce-plan: subagent with plan_skill_read is ALLOWED',
    runHook('.claude/hooks/safety/enforce-plan.cjs', {
      tool_input: { command: PLAN_CMD },
      agent_id: 'sub-plan-1'
    }) === 0
  );

  resetSession();
  const sid5 = 'plan-sub-empty-' + Date.now();
  appendTrackingEvent(sid5, { type: 'tool', tool: 'Bash' });
  report(
    'enforce-plan: subagent without plan_skill_read is DENIED',
    runHook('.claude/hooks/safety/enforce-plan.cjs', {
      tool_input: { command: PLAN_CMD },
      agent_id: 'sub-plan-2'
    }) === 2
  );

  // #552: enforce-plan reads plan-skill-read state session-scoped. A
  // plan_skill_read earlier in the session stays satisfied — no
  // prompt_start boundary needed.
  resetSession();
  const sid6 = 'plan-main-' + Date.now();
  appendTrackingEvent(sid6, { type: 'plan_skill_read' });
  report(
    'enforce-plan #552: main session with plan_skill_read is ALLOWED (session-scoped)',
    runHook('.claude/hooks/safety/enforce-plan.cjs', {
      tool_input: { command: PLAN_CMD },
      session_id: sid6
    }) === 0
  );

  resetSession();
  const sid6b = 'plan-main-empty-' + Date.now();
  appendTrackingEvent(sid6b, { type: 'tool', tool: 'Bash' });
  report(
    'enforce-plan: main session with no plan_skill_read is DENIED',
    runHook('.claude/hooks/safety/enforce-plan.cjs', {
      tool_input: { command: PLAN_CMD },
      session_id: sid6b
    }) === 2
  );

  // #552: the exact friction the fix removes — a prompt_start mid-session
  // must NOT re-require /plan to be read before it.
  resetSession();
  const sid6c = 'plan-main-multiprompt-' + Date.now();
  appendTrackingEvent(sid6c, { type: 'prompt_start' });
  appendTrackingEvent(sid6c, { type: 'plan_skill_read' });
  appendTrackingEvent(sid6c, { type: 'prompt_start' });
  report(
    'enforce-plan #552: plan_skill_read survives a later prompt_start (no per-prompt re-read)',
    runHook('.claude/hooks/safety/enforce-plan.cjs', {
      tool_input: { command: PLAN_CMD },
      session_id: sid6c
    }) === 0
  );

  // enforce-voice.cjs
  resetSession();
  const hash = crypto.createHash('md5').update(PBCOPY_CMD).digest('hex');
  const sid7 = 'voice-sub-' + Date.now();
  appendTrackingEvent(sid7, { type: 'voice_blocked', hash });
  report(
    'enforce-voice: subagent retry with unchanged content is DENIED',
    runHook('.claude/hooks/context/enforce-voice.cjs', {
      tool_name: 'Bash',
      tool_input: { command: 'VOICE_CHECKED=1 ' + PBCOPY_CMD },
      agent_id: 'sub-voice-1',
      session_id: sid7
    }) === 2
  );

  report(
    'enforce-voice: subagent retry with revised content is ALLOWED',
    runHook('.claude/hooks/context/enforce-voice.cjs', {
      tool_name: 'Bash',
      tool_input: { command: 'VOICE_CHECKED=1 echo "revised" | pbcopy' },
      agent_id: 'sub-voice-1',
      session_id: sid7
    }) === 0
  );

  // Parallel-session regression (#263): a sibling CC session writing a
  // tool event to its own tracking file must not steal the read from the
  // invoking session. Enforcement reads must open THIS session's file,
  // keyed by the session_id from the hook payload, not the most-recently-
  // modified file in the tracking directory.
  //
  // Shape:
  //   Session A: prompt_start + all required spec_reads (satisfied state)
  //   Session B: prompt_start + a tool event, written LATER so mtime wins
  // Payload with session_id='A' must allow. Payload with session_id='B'
  // must deny (B never read the specs). Payload with no session_id falls
  // back to mtime and picks B (existing behavior, preserved).
  {
    resetSession();
    const sidA = 'par-specs-a-' + Date.now();
    const sidB = 'par-specs-b-' + Date.now();
    appendTrackingEvent(sidA, { type: 'prompt_start' });
    appendTrackingEvent(sidA, { type: 'spec_read', name: 'hooks' });
    appendTrackingEvent(sidA, { type: 'spec_read', name: 'tracking-persistence' });
    const fileA = path.join(TRACKING_DIR, sidA + '.jsonl');
    const fileB = path.join(TRACKING_DIR, sidB + '.jsonl');
    const aTime = fs.statSync(fileA).mtime.getTime();
    appendTrackingEvent(sidB, { type: 'prompt_start' });
    appendTrackingEvent(sidB, { type: 'tool', tool: 'Bash' });
    const future = new Date(aTime + 5000);
    fs.utimesSync(fileB, future, future);

    report(
      'enforce-specs #263: session_id=A in payload -> ALLOWED (reads A specs)',
      runHook('.claude/hooks/context/enforce-specs.cjs', {
        tool_input: { file_path: EDIT_TARGET, old_string: 'x', new_string: 'y' },
        session_id: sidA
      }) === 0
    );

    report(
      'enforce-specs #263: session_id=B in payload -> DENIED (B never read specs)',
      runHook('.claude/hooks/context/enforce-specs.cjs', {
        tool_input: { file_path: EDIT_TARGET, old_string: 'x', new_string: 'y' },
        session_id: sidB
      }) === 2
    );

    report(
      'enforce-specs #263: no session_id falls back to mtime (picks B, DENIED)',
      runHook('.claude/hooks/context/enforce-specs.cjs', {
        tool_input: { file_path: EDIT_TARGET, old_string: 'x', new_string: 'y' }
      }) === 2
    );
  }

  {
    resetSession();
    const sidA = 'par-plan-a-' + Date.now();
    const sidB = 'par-plan-b-' + Date.now();
    appendTrackingEvent(sidA, { type: 'prompt_start' });
    appendTrackingEvent(sidA, { type: 'plan_skill_read' });
    const fileA = path.join(TRACKING_DIR, sidA + '.jsonl');
    const fileB = path.join(TRACKING_DIR, sidB + '.jsonl');
    const aTime = fs.statSync(fileA).mtime.getTime();
    appendTrackingEvent(sidB, { type: 'prompt_start' });
    appendTrackingEvent(sidB, { type: 'tool', tool: 'Bash' });
    const future = new Date(aTime + 5000);
    fs.utimesSync(fileB, future, future);

    report(
      'enforce-plan #263: session_id=A in payload -> ALLOWED',
      runHook('.claude/hooks/safety/enforce-plan.cjs', {
        tool_input: { command: PLAN_CMD },
        session_id: sidA
      }) === 0
    );

    report(
      'enforce-plan #263: session_id=B in payload -> DENIED',
      runHook('.claude/hooks/safety/enforce-plan.cjs', {
        tool_input: { command: PLAN_CMD },
        session_id: sidB
      }) === 2
    );
  }

  {
    resetSession();
    const sidA = 'par-voice-a-' + Date.now();
    const sidB = 'par-voice-b-' + Date.now();
    const vHash = crypto.createHash('md5').update(PBCOPY_CMD).digest('hex');
    appendTrackingEvent(sidA, { type: 'prompt_start' });
    appendTrackingEvent(sidA, { type: 'voice_blocked', hash: vHash });
    const fileA = path.join(TRACKING_DIR, sidA + '.jsonl');
    const fileB = path.join(TRACKING_DIR, sidB + '.jsonl');
    const aTime = fs.statSync(fileA).mtime.getTime();
    appendTrackingEvent(sidB, { type: 'prompt_start' });
    appendTrackingEvent(sidB, { type: 'tool', tool: 'Bash' });
    const future = new Date(aTime + 5000);
    fs.utimesSync(fileB, future, future);

    // session_id=A: hook sees A's voice_blocked hash, treats unchanged
    // VOICE_CHECKED=1 retry as a bypass attempt, exit 2 with the
    // "unchanged from the blocked version" stderr.
    const rA = spawnSync('node', ['.claude/hooks/context/enforce-voice.cjs'], {
      input: JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'VOICE_CHECKED=1 ' + PBCOPY_CMD },
        session_id: sidA
      }),
      encoding: 'utf8',
      cwd: REPO
    });
    report(
      'enforce-voice #263: session_id=A sees A voice_blocked hash -> DENIED unchanged',
      rA.status === 2 && /unchanged from the blocked version/.test(rA.stderr),
      `status=${rA.status} stderr=${JSON.stringify(rA.stderr)}`
    );

    // session_id=B: no prior voice_blocked event, VOICE_CHECKED=1 ALLOWS.
    report(
      'enforce-voice #263: session_id=B no prior block -> VOICE_CHECKED=1 ALLOWS',
      runHook('.claude/hooks/context/enforce-voice.cjs', {
        tool_name: 'Bash',
        tool_input: { command: 'VOICE_CHECKED=1 ' + PBCOPY_CMD },
        session_id: sidB
      }) === 0
    );
  }

  // Un-synced project path (#183): when stack-config.yaml is missing, the
  // basename fallback in track-spec-reads must still emit spec_read events,
  // and enforce-specs must point users at /sync-stack when it blocks.
  const CONFIG_PATH = path.join(REPO, '.claude/specs/stack-config.yaml');
  const CONFIG_BACKUP = CONFIG_PATH + '.test-backup-183';
  const configExisted = fs.existsSync(CONFIG_PATH);
  if (configExisted) fs.renameSync(CONFIG_PATH, CONFIG_BACKUP);
  try {
    resetSession();
    const sidU = 'unsync-main-' + Date.now();
    appendTrackingEvent(sidU, { type: 'prompt_start' });

    const rRead1 = runHook('.claude/hooks/tracking/track-spec-reads.cjs', {
      tool_input: { file_path: '.claude/specs/claude-code/hooks.md' },
      session_id: sidU
    });
    const rRead2 = runHook('.claude/hooks/tracking/track-spec-reads.cjs', {
      tool_input: { file_path: '.claude/specs/kit/tracking-persistence.md' },
      session_id: sidU
    });

    const events = readTrackingEvents(sidU);
    const specReads = events.filter(e => e.type === 'spec_read').map(e => e.name);
    report(
      'track-spec-reads: emits spec_read via basename fallback when stack-config.yaml missing',
      rRead1 === 0 && rRead2 === 0 &&
      specReads.includes('hooks') && specReads.includes('tracking-persistence'),
      `reads=${rRead1},${rRead2} specReads=${JSON.stringify(specReads)}`
    );

    report(
      'enforce-specs: ALLOWS edit after fallback-tracked reads when stack-config.yaml missing',
      runHook('.claude/hooks/context/enforce-specs.cjs', {
        tool_input: { file_path: EDIT_TARGET, old_string: 'x', new_string: 'y' }
      }) === 0
    );

    resetSession();
    const sidE = 'unsync-empty-' + Date.now();
    appendTrackingEvent(sidE, { type: 'prompt_start' });
    const rBlock = spawnSync('node', ['.claude/hooks/context/enforce-specs.cjs'], {
      input: JSON.stringify({
        tool_input: { file_path: EDIT_TARGET, old_string: 'x', new_string: 'y' }
      }),
      encoding: 'utf8',
      cwd: REPO
    });
    report(
      'enforce-specs: block message mentions /sync-stack when stack-config.yaml missing',
      rBlock.status === 2 &&
      /stack-config\.yaml is missing/.test(rBlock.stderr) &&
      /\/sync-stack/.test(rBlock.stderr),
      `status=${rBlock.status} stderr=${JSON.stringify(rBlock.stderr)}`
    );
  } finally {
    if (configExisted && fs.existsSync(CONFIG_BACKUP)) fs.renameSync(CONFIG_BACKUP, CONFIG_PATH);
  }
} finally {
  fs.rmSync(SANDBOX_HOME, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
