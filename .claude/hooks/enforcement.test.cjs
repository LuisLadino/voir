#!/usr/bin/env node

/**
 * Enforcement hook integration tests.
 *
 * Spawns enforce-specs, enforce-plan, and enforce-voice as subprocesses
 * with fabricated hook payloads and asserts the exit code. Covers the
 * subagent branching pattern from #143/#146: hooks branch on `agent_id`
 * to pick the session-scoped reader so enforcement works in subagent
 * contexts where no `prompt_start` event is ever written.
 *
 * Run:
 *   node .claude/hooks/enforcement.test.cjs
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '../..');

const { appendTrackingEvent, readTrackingEvents, getTrackingDir } = require('./lib/session-utils.cjs');

// Derive the tracking dir from session-utils so this test works in any
// project, not just the kit author's workspace.
const TRACKING_DIR = getTrackingDir();

// Sandbox: move the active tracking dir aside so fabricated sessions are
// the only sessions the enforcement hooks can see during this run.
const BACKUP_DIR = TRACKING_DIR + '.test-backup';
if (fs.existsSync(TRACKING_DIR)) fs.renameSync(TRACKING_DIR, BACKUP_DIR);
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

  resetSession();
  const sid3 = 'specs-main-' + Date.now();
  appendTrackingEvent(sid3, { type: 'spec_read', name: 'hooks' });
  appendTrackingEvent(sid3, { type: 'spec_read', name: 'tracking-persistence' });
  report(
    'enforce-specs: main session without prompt_start is DENIED (regression)',
    runHook('.claude/hooks/context/enforce-specs.cjs', {
      tool_input: { file_path: EDIT_TARGET, old_string: 'x', new_string: 'y' }
    }) === 2
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

  resetSession();
  const sid6 = 'plan-main-' + Date.now();
  appendTrackingEvent(sid6, { type: 'plan_skill_read' });
  report(
    'enforce-plan: main session without prompt_start is DENIED (regression)',
    runHook('.claude/hooks/safety/enforce-plan.cjs', {
      tool_input: { command: PLAN_CMD }
    }) === 2
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
  fs.rmSync(TRACKING_DIR, { recursive: true, force: true });
  if (fs.existsSync(BACKUP_DIR)) fs.renameSync(BACKUP_DIR, TRACKING_DIR);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
