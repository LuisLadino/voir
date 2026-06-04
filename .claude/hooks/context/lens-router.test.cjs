#!/usr/bin/env node

/**
 * lens-router unit tests.
 *
 * Covers:
 *   - Phase-aware gating on `during_X` and `X_to_Y` attachments
 *   - Backward compat: unspecified attachment falls back to trigger-only
 *   - Default phase `session_start` when no workflow skill has run
 *   - Registry schema validation diagnostics
 *
 * Run:
 *   node .claude/hooks/context/lens-router.test.cjs
 */

const fs = require('fs');
const path = require('path');

const { phaseAllowsAttachment } = require('../lib/phase.cjs');

let pass = 0;
let fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else    { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

report(
  'during_ideate allows ideate_to_build',
  phaseAllowsAttachment('during_ideate', 'ideate_to_build') === true
);
report(
  'during_build blocks ideate_to_build',
  phaseAllowsAttachment('during_build', 'ideate_to_build') === false
);
report(
  'during_build allows build_to_test',
  phaseAllowsAttachment('during_build', 'build_to_test') === true
);
report(
  'during_review allows during_review',
  phaseAllowsAttachment('during_review', 'during_review') === true
);
report(
  'during_test blocks during_review',
  phaseAllowsAttachment('during_test', 'during_review') === false
);
report(
  'unspecified attachment is always allowed (v1 fallback)',
  phaseAllowsAttachment('during_build', 'unspecified') === true &&
  phaseAllowsAttachment('session_start', 'unspecified') === true
);
report(
  'missing attachment is always allowed (v1 fallback)',
  phaseAllowsAttachment('during_build', undefined) === true &&
  phaseAllowsAttachment('during_build', null) === true
);
report(
  'session_start allows session_start',
  phaseAllowsAttachment('session_start', 'session_start') === true
);

// inferCurrentPhase with slash-command signal
{
  const { inferCurrentPhase } = require('../lib/phase.cjs');
  const os = require('os');
  const { appendTrackingEvent } = require('../lib/session-utils.cjs');

  // Sandbox: put tracking into a fresh temp workspace path so host-session
  // events don't leak into the test.
  const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-'));

  // Case: only a slash_command-derived skill_invocation event → phase
  // should reflect that skill, not the default.
  appendTrackingEvent('phase-slash-1', { type: 'session_init' }, tmpWs);
  appendTrackingEvent('phase-slash-1', { type: 'skill_invocation', skill: 'build', source: 'slash_command' }, tmpWs);
  // Force this session to be the 'recent' one by mtime.
  const p = inferCurrentPhase(tmpWs);
  report(
    'inferCurrentPhase uses skill_invocation events when no Skill tool events exist',
    p === 'during_build',
    `got ${p}`
  );

  // Case: Skill tool event AND skill_invocation event; most recent wins.
  const tmpWs2 = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-'));
  appendTrackingEvent('phase-mix-1', { type: 'session_init' }, tmpWs2);
  appendTrackingEvent('phase-mix-1', {
    type: 'tool', tool: 'Skill', skill: 'research', timestamp: '2026-04-20T00:00:00.000Z'
  }, tmpWs2);
  appendTrackingEvent('phase-mix-1', {
    type: 'skill_invocation', skill: 'ideate', source: 'slash_command', timestamp: '2026-04-20T01:00:00.000Z'
  }, tmpWs2);
  const p2 = inferCurrentPhase(tmpWs2);
  report(
    'inferCurrentPhase picks most-recent across Skill tool + skill_invocation',
    p2 === 'during_ideate',
    `got ${p2}`
  );

  // Case: non-workflow skill_invocation (e.g. /pre-mortem) does not change phase.
  const tmpWs3 = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-'));
  appendTrackingEvent('phase-nonwf-1', { type: 'session_init' }, tmpWs3);
  appendTrackingEvent('phase-nonwf-1', {
    type: 'skill_invocation', skill: 'pre-mortem', source: 'slash_command'
  }, tmpWs3);
  const p3 = inferCurrentPhase(tmpWs3);
  report(
    'inferCurrentPhase ignores non-workflow skills (falls to default)',
    p3 === 'session_start',
    `got ${p3}`
  );

  [tmpWs, tmpWs2, tmpWs3].forEach(d => fs.rmSync(d, { recursive: true, force: true }));

  // #292 parallel-session: inferCurrentPhase routes by sessionId.
  // Two sessions in the same workspace, B writes last so B's mtime > A's.
  // Without sessionId, picks B by mtime; with sessionId, picks the right one.
  {
    const tmpWsP = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-292-'));
    appendTrackingEvent('lens-292-A', { type: 'session_init' }, tmpWsP);
    appendTrackingEvent('lens-292-A', {
      type: 'skill_invocation', skill: 'research', source: 'slash_command'
    }, tmpWsP);
    appendTrackingEvent('lens-292-B', { type: 'session_init' }, tmpWsP);
    appendTrackingEvent('lens-292-B', {
      type: 'skill_invocation', skill: 'build', source: 'slash_command'
    }, tmpWsP);
    const phaseA = inferCurrentPhase(tmpWsP, 'lens-292-A');
    const phaseB = inferCurrentPhase(tmpWsP, 'lens-292-B');
    report(
      '#292 inferCurrentPhase: sessionId=A returns during_research',
      phaseA === 'during_research',
      `got ${phaseA}`
    );
    report(
      '#292 inferCurrentPhase: sessionId=B returns during_build',
      phaseB === 'during_build',
      `got ${phaseB}`
    );
    fs.rmSync(tmpWsP, { recursive: true, force: true });
  }
}

// Registry validation + end-to-end lens-router.check
const realPath = path.resolve(__dirname, '../../specs/lenses/registry.json');
const backupPath = realPath + '.test-backup';
const hadRegistry = fs.existsSync(realPath);
if (hadRegistry) fs.renameSync(realPath, backupPath);

const LENS_ROUTER_PATH = require.resolve('./lens-router.cjs');
function freshLensRouter() {
  delete require.cache[LENS_ROUTER_PATH];
  return require('./lens-router.cjs');
}

function writeRegistry(obj) {
  fs.mkdirSync(path.dirname(realPath), { recursive: true });
  fs.writeFileSync(realPath, JSON.stringify(obj, null, 2));
}

function captureStderr(fn) {
  let captured = '';
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { captured += chunk; return true; };
  try { return { result: fn(), stderr: captured }; }
  finally { process.stderr.write = orig; }
}

try {
  const BASE_REGISTRY = {
    $schema_version: 1,
    attachment_points: [
      'session_start', 'during_research', 'during_define', 'during_ideate',
      'ideate_to_build', 'during_build', 'build_to_test', 'during_test',
      'during_review', 'review_to_commit'
    ],
    lenses: {
      pm: {
        moves: [
          {
            name: 'pre-mortem',
            attachment: 'ideate_to_build',
            triggers: ['locking this in'],
            skill: 'pre-mortem'
          }
        ]
      },
      ux: {
        moves: [
          {
            name: 'heuristic-scan',
            attachment: 'during_review',
            triggers: ['looks good to me'],
            skill: 'heuristic-scan'
          }
        ]
      },
      legacy: {
        moves: [
          {
            name: 'no-attach-move',
            triggers: ['legacy phrase'],
            skill: 'no-attach-move'
          }
        ]
      }
    }
  };

  writeRegistry(BASE_REGISTRY);
  let lr = freshLensRouter();

  report(
    'legacy move with no attachment fires on its trigger (v1 fallback)',
    (() => {
      lr = freshLensRouter();
      const r = lr.check('legacy phrase');
      return r.fired.includes('legacy:no-attach-move');
    })()
  );

  const preMortem = BASE_REGISTRY.lenses.pm.moves[0];
  const heuristic = BASE_REGISTRY.lenses.ux.moves[0];
  report(
    'pre-mortem blocked when phase is during_build',
    phaseAllowsAttachment('during_build', preMortem.attachment) === false
  );
  report(
    'pre-mortem allowed when phase is during_ideate',
    phaseAllowsAttachment('during_ideate', preMortem.attachment) === true
  );
  report(
    'heuristic-scan blocked when phase is during_test',
    phaseAllowsAttachment('during_test', heuristic.attachment) === false
  );
  report(
    'heuristic-scan allowed when phase is during_review',
    phaseAllowsAttachment('during_review', heuristic.attachment) === true
  );

  fs.writeFileSync(realPath, '{ this is not json }');
  {
    const { result, stderr } = captureStderr(() => {
      lr = freshLensRouter();
      return lr.check('x');
    });
    report(
      'malformed JSON emits diagnostic and returns clean no-op',
      result.content === null && /JSON parse error/.test(stderr)
    );
  }

  writeRegistry({
    $schema_version: 1,
    attachment_points: ['session_start'],
    lenses: {
      pm: { moves: [{ name: 'x', triggers: ['y'] }] }
    }
  });
  {
    const { result, stderr } = captureStderr(() => {
      lr = freshLensRouter();
      return lr.check('y');
    });
    report(
      'missing skill field emits diagnostic with JSON pointer',
      result.content === null && /\/lenses\/pm\/moves\/0\/skill/.test(stderr)
    );
  }

  writeRegistry(BASE_REGISTRY);
  {
    const { stderr } = captureStderr(() => {
      lr = freshLensRouter();
      return lr.check('unrelated prompt');
    });
    report(
      'valid registry produces no stderr noise',
      stderr === ''
    );
  }

  fs.writeFileSync(realPath, '[]');
  {
    const { result, stderr } = captureStderr(() => {
      lr = freshLensRouter();
      return lr.check('x');
    });
    report(
      'array at root emits diagnostic',
      result.content === null && /root must be an object/.test(stderr)
    );
  }

  writeRegistry({
    $schema_version: 1,
    attachment_points: ['session_start', 'during_ideate'],
    lenses: {
      pm: { moves: [{ name: 'x', triggers: ['y'], skill: 'z', attachment: 'during_made_up' }] }
    }
  });
  {
    const { result, stderr } = captureStderr(() => {
      lr = freshLensRouter();
      return lr.check('y');
    });
    report(
      'bad attachment value surfaces diagnostic (not silent disable)',
      result.content === null && /not in \/attachment_points/.test(stderr)
    );
  }

  writeRegistry({
    attachment_points: ['session_start'],
    lenses: { pm: { moves: [{ name: 'x', triggers: ['y'], skill: 'z' }] } }
  });
  {
    const { result, stderr } = captureStderr(() => {
      lr = freshLensRouter();
      return lr.check('y');
    });
    report(
      'missing $schema_version surfaces diagnostic',
      result.content === null && /\/\$schema_version/.test(stderr)
    );
  }

  writeRegistry({
    $schema_version: 1,
    attachment_points: [],
    lenses: { pm: { moves: [{ name: 'x', triggers: ['y'], skill: 'z' }] } }
  });
  {
    const { result, stderr } = captureStderr(() => {
      lr = freshLensRouter();
      return lr.check('y');
    });
    report(
      'empty attachment_points surfaces diagnostic',
      result.content === null && /attachment_points must be a non-empty array/.test(stderr)
    );
  }
} finally {
  fs.rmSync(realPath, { force: true });
  if (hadRegistry) fs.renameSync(backupPath, realPath);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
