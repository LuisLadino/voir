#!/usr/bin/env node

/**
 * Unit tests for the shared skill-telemetry windowing core (#614).
 * Run: node .claude/hooks/lib/skill-telemetry.test.cjs
 *
 * Covers reduceSkillWindows (pure per-segment builder) and both segmentation
 * modes of reduceSkillTelemetry. The prompt-scoped mode is what
 * session-utils.readSkillTelemetryState delegates to; the 'all' mode is what
 * the /analyze collector consumes. The I/O-bound integration (readTrackingEvents
 * + cache wrappers) stays in .claude/hooks/tracking/tracking.test.cjs and
 * scripts/collect-analyze-data.test.cjs.
 */

const { reduceSkillWindows, reduceSkillTelemetry } = require('./skill-telemetry.cjs');

let pass = 0;
let fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else    { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

const w1 = reduceSkillWindows([
  { type: 'skill_invocation', skill: 'build', source: 'slash_command', timestamp: '2026-05-01T10:00:01Z' },
  { type: 'tool', tool: 'Bash', command: 'git checkout -b feature/x', timestamp: '2026-05-01T10:00:02Z' },
  { type: 'tool', tool: 'Edit', file: 'a.cjs', timestamp: '2026-05-01T10:00:03Z' },
  { type: 'failure', timestamp: '2026-05-01T10:00:04Z' },
], null);
report(
  'reduceSkillWindows: bash-completed window, tool/failure counts, source',
  w1.length === 1 &&
    w1[0].skill_name === 'build' &&
    w1[0].applied === true &&
    w1[0].completed === true &&
    w1[0].fallback_used === false &&
    w1[0].tool_success_count === 2 &&
    w1[0].tool_failure_count === 1 &&
    w1[0].source === 'slash_command' &&
    w1[0].registered === true &&
    w1[0].exempt === false,
  JSON.stringify(w1)
);

const w2 = reduceSkillWindows([
  { type: 'skill_invocation', skill: 'define', source: 'slash_command', timestamp: '2026-05-01T10:00:01Z' },
  { type: 'skill_invocation', skill: 'build', source: 'slash_command', timestamp: '2026-05-01T10:00:02Z' },
], null);
const define = w2.find((r) => r.skill_name === 'define');
report(
  'reduceSkillWindows: exempt skill always completes, no fallback',
  Boolean(define) && define.exempt === true && define.completed === true && define.fallback_used === false,
  JSON.stringify(w2)
);

const w3 = reduceSkillWindows([
  { type: 'skill_invocation', skill: 'novel-unregistered', source: 'slash_command', timestamp: '2026-05-01T10:00:01Z' },
  { type: 'tool', tool: 'Bash', command: 'git push', timestamp: '2026-05-01T10:00:02Z' },
], null);
report(
  'reduceSkillWindows: unregistered skill is registered=false, completed=false (tripwire)',
  w3.length === 1 && w3[0].registered === false && w3[0].completed === false,
  JSON.stringify(w3)
);

const w4 = reduceSkillWindows([
  { type: 'skill_invocation', skill: 'research', source: 'slash_command', timestamp: '2026-05-01T10:00:01Z' },
  { type: 'tool', tool: 'Edit', file: 'x', timestamp: '2026-05-01T10:00:02Z' },
  { type: 'skill_invocation', skill: 'build', source: 'slash_command', timestamp: '2026-05-01T10:00:03Z' },
], null);
const w4research = w4.find((r) => r.skill_name === 'research');
report(
  'reduceSkillWindows: incomplete skill before a different skill is a fallback',
  Boolean(w4research) && w4research.completed === false && w4research.fallback_used === true,
  JSON.stringify(w4)
);

const w5 = reduceSkillWindows([
  { type: 'tool', tool: 'Skill', skill: 'commit', timestamp: '2026-05-01T10:00:01Z' },
  { type: 'tool', tool: 'Bash', command: 'git push origin main', timestamp: '2026-05-01T10:00:02Z' },
], null);
report(
  'reduceSkillWindows: Skill-tool opener sets source=skill_tool, opener not counted',
  w5.length === 1 && w5[0].source === 'skill_tool' && w5[0].skill_name === 'commit' && w5[0].tool_success_count === 1,
  JSON.stringify(w5)
);

const a1 = reduceSkillTelemetry([
  { type: 'tool', tool: 'Skill', skill: 'research', timestamp: '2026-05-01T09:59:00Z' },
  { type: 'tool', tool: 'Grep', pattern: 'x', timestamp: '2026-05-01T09:59:01Z' },
  { type: 'prompt_start', timestamp: '2026-05-01T10:00:00Z' },
  { type: 'skill_invocation', skill: 'build', source: 'slash_command', timestamp: '2026-05-01T10:00:01Z' },
  { type: 'tool', tool: 'Bash', command: 'git checkout -b a', timestamp: '2026-05-01T10:00:02Z' },
]);
report(
  'all mode: keeps both pre- and post-prompt_start segments',
  a1.length === 2 &&
    a1[0].skill_name === 'research' && a1[0].completed === true &&
    a1[1].skill_name === 'build' && a1[1].completed === true,
  JSON.stringify(a1)
);

const a2 = reduceSkillTelemetry([
  { type: 'session_init', workspace: '/tmp/x', timestamp: '2026-05-01T10:00:00Z' },
  { type: 'tool', tool: 'Skill', skill: 'research', timestamp: '2026-05-01T10:00:01Z' },
  { type: 'tool', tool: 'WebSearch', query: 'foo', timestamp: '2026-05-01T10:00:02Z' },
]);
report(
  'all mode: captures windows with no prompt_start (subagent session)',
  a2.length === 1 && a2[0].skill_name === 'research' && a2[0].completed === true,
  JSON.stringify(a2)
);

const a3 = reduceSkillTelemetry([
  { type: 'prompt_start', timestamp: '2026-05-01T10:00:00Z' },
  { type: 'skill_invocation', skill: 'research', source: 'slash_command', timestamp: '2026-05-01T10:00:01Z' },
  { type: 'tool', tool: 'Edit', file: 'x', timestamp: '2026-05-01T10:00:02Z' },
  { type: 'prompt_start', timestamp: '2026-05-01T10:05:00Z' },
  { type: 'skill_invocation', skill: 'build', source: 'slash_command', timestamp: '2026-05-01T10:05:01Z' },
]);
const a3research = a3.find((r) => r.skill_name === 'research');
report(
  'all mode: fallback attribution is scoped per prompt segment',
  Boolean(a3research) && a3research.fallback_used === false,
  JSON.stringify(a3)
);

const p1 = reduceSkillTelemetry([
  { type: 'prompt_start', timestamp: '2026-05-01T10:00:00Z' },
  { type: 'skill_invocation', skill: 'research', source: 'slash_command', timestamp: '2026-05-01T10:00:01Z' },
  { type: 'tool', tool: 'WebSearch', query: 'x', timestamp: '2026-05-01T10:00:02Z' },
  { type: 'prompt_start', timestamp: '2026-05-01T10:05:00Z' },
  { type: 'skill_invocation', skill: 'commit', source: 'slash_command', timestamp: '2026-05-01T10:05:01Z' },
  { type: 'tool', tool: 'Bash', command: 'git push origin main', timestamp: '2026-05-01T10:05:02Z' },
], { mode: 'prompt-scoped' });
report(
  'prompt-scoped: resets at prompt_start, returns only the last prompt window',
  p1.length === 1 && p1[0].skill_name === 'commit' && p1[0].completed === true,
  JSON.stringify(p1)
);

const p2 = reduceSkillTelemetry([
  { type: 'skill_invocation', skill: 'research', source: 'slash_command', timestamp: '2026-05-01T10:00:01Z' },
  { type: 'tool', tool: 'WebSearch', query: 'x', timestamp: '2026-05-01T10:00:02Z' },
], { mode: 'prompt-scoped' });
report(
  'prompt-scoped: no prompt_start fails closed (empty array)',
  Array.isArray(p2) && p2.length === 0,
  JSON.stringify(p2)
);

const p3 = reduceSkillTelemetry([
  { type: 'tool', tool: 'Skill', skill: 'research', timestamp: '2026-05-01T09:59:00Z' },
  { type: 'tool', tool: 'Grep', pattern: 'x', timestamp: '2026-05-01T09:59:01Z' },
  { type: 'prompt_start', timestamp: '2026-05-01T10:00:00Z' },
  { type: 'skill_invocation', skill: 'build', source: 'slash_command', timestamp: '2026-05-01T10:00:01Z' },
  { type: 'tool', tool: 'Bash', command: 'git checkout -b a', timestamp: '2026-05-01T10:00:02Z' },
], { mode: 'prompt-scoped' });
report(
  'prompt-scoped: drops pre-first-prompt_start segment, keeps only current prompt',
  p3.length === 1 && p3[0].skill_name === 'build',
  JSON.stringify(p3)
);

const p4 = reduceSkillTelemetry([
  { type: 'prompt_start', timestamp: '2026-05-01T10:00:00Z' },
  { type: 'skill_invocation', skill: 'research', source: 'slash_command', timestamp: '2026-05-01T10:00:01Z' },
  { type: 'tool', tool: 'Edit', file: 'x', timestamp: '2026-05-01T10:00:02Z' },
  { type: 'prompt_start', timestamp: '2026-05-01T10:05:00Z' },
  { type: 'skill_invocation', skill: 'build', source: 'slash_command', timestamp: '2026-05-01T10:05:01Z' },
  { type: 'tool', tool: 'Bash', command: 'git checkout -b a', timestamp: '2026-05-01T10:05:02Z' },
], { mode: 'prompt-scoped' });
report(
  'prompt-scoped: prior-prompt incomplete skill is neither returned nor a fallback',
  p4.length === 1 && p4[0].skill_name === 'build' && p4[0].fallback_used === false,
  JSON.stringify(p4)
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
