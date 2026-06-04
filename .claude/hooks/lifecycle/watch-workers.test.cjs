#!/usr/bin/env node

/**
 * watch-workers.cjs tests.
 *
 * Every pure decision exported from watch-workers.cjs is exercised here with
 * scripted inputs: label building, event-line parsing/formatting, jsonl
 * tail-aggregators, prior-session skip-marker timing, and the per-tick
 * lifecycle classifier. This is the regression coverage #560 asked for —
 * watch-workers historically had production bugs in label resolution (#449),
 * spurious idle/crashed on prior-session files (#483), and the awk filter
 * for new event types.
 *
 * Run: node .claude/hooks/lifecycle/watch-workers.test.cjs
 */

const {
  findWorker,
  buildWorkerLabel,
  parseEventLine,
  formatEventLine,
  shouldStreamEvent,
  hasResultEvent,
  lastResultSubtype,
  lastToolName,
  shouldStampSkipOnDiscovery,
  classifyLifecycle,
  formatLifecycleNotification,
  formatLifecycleStreamLine,
  ghIssueViewArgs,
} = require('./watch-workers.cjs');

let pass = 0;
let fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else    { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

// parseActiveJson was removed when the watcher moved to active.jsonl; its
// tolerance logic now lives in dispatch-registry.cjs's reducer. See
// dispatch-registry.test.cjs for the malformed-line / empty / migration cases.

// ── findWorker ──
const entries = [
  { sessionId: '6445d2b80123456789abcdef', pid: 100, repo: 'LuisLadino/claude-kit', target: { type: 'issue', value: '445' } },
  { sessionId: 'aaaabbbbccccdddd11112222', pid: 200, cwd: '/Users/x/proj', target: { type: 'adhoc', value: 'refactor button' } },
  { sessionId: 'ffff0000ffff0000ffff0000', pid: 300, repo: 'LuisLadino/web-next' },
];
report('findWorker: exact sid match',
  findWorker(entries, '6445d2b80123456789abcdef').pid === 100);
report('findWorker: prefix match (short sid)',
  findWorker(entries, '6445d2b8').pid === 100);
report('findWorker: not found -> null',
  findWorker(entries, 'nomatch') === null);
report('findWorker: empty entries',
  findWorker([], 'abc') === null);
report('findWorker: missing sid',
  findWorker(entries, '') === null);

// ── buildWorkerLabel ──
report('buildWorkerLabel: issue + title',
  buildWorkerLabel({ worker: entries[0], title: 'fix the thing', sid: '6445d2b8' }) === 'claude-kit#445 (fix the thing)');
report('buildWorkerLabel: issue, no title',
  buildWorkerLabel({ worker: entries[0], title: '', sid: '6445d2b8' }) === 'claude-kit#445');
report('buildWorkerLabel: adhoc',
  buildWorkerLabel({ worker: entries[1], title: '', sid: 'aaaabbbb' }) === 'proj/adhoc: refactor button');
report('buildWorkerLabel: title capped at 50',
  buildWorkerLabel({ worker: entries[0], title: 'x'.repeat(60), sid: '6445d2b8' })
  === `claude-kit#445 (${'x'.repeat(47)}...)`);
report('buildWorkerLabel: no worker -> short sid',
  buildWorkerLabel({ worker: null, title: '', sid: '6445d2b80123456789' }) === '6445d2b8');
report('buildWorkerLabel: worker missing target -> short sid fallback',
  buildWorkerLabel({ worker: entries[2], title: '', sid: 'ffff0000ffff' }) === 'ffff0000');

// ── parseEventLine ──
report('parseEventLine: tool_use',
  JSON.stringify(parseEventLine('foo "type":"tool_use","id":"abc","name":"Bash" bar'))
  === JSON.stringify({ kind: 'tool_use', name: 'Bash' }));
report('parseEventLine: result with cost',
  JSON.stringify(parseEventLine('"type":"result","subtype":"success","total_cost_usd":1.23'))
  === JSON.stringify({ kind: 'result', subtype: 'success', cost: '1.23' }));
report('parseEventLine: result without cost',
  JSON.stringify(parseEventLine('"type":"result","subtype":"error_during_execution"'))
  === JSON.stringify({ kind: 'result', subtype: 'error_during_execution', cost: '?' }));
report('parseEventLine: tool_error',
  JSON.stringify(parseEventLine('{"is_error":true,"message":"boom"}'))
  === JSON.stringify({ kind: 'tool_error' }));
report('parseEventLine: PR URL',
  JSON.stringify(parseEventLine('something https://github.com/foo/bar/pull/42 created'))
  === JSON.stringify({ kind: 'pr_url', url: 'github.com/foo/bar/pull/42' }));
report('parseEventLine: unrecognized -> null',
  parseEventLine('{"type":"assistant","content":"hi"}') === null);
report('parseEventLine: empty -> null',
  parseEventLine('') === null);
report('parseEventLine: non-string -> null',
  parseEventLine(null) === null);
report('parseEventLine: tool_use wins when line has both tool_use and is_error',
  parseEventLine('"type":"tool_use","id":"x","name":"Bash" "is_error":true').kind === 'tool_use');
report('parseEventLine: assistant-message line skipped via prefilter (perf)',
  parseEventLine('{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}') === null);
report('parseEventLine: line mentioning github.com but not a PR URL -> null',
  parseEventLine('something about github.com/foo/bar (no pull number)') === null);
report('parseEventLine: line with "result" word but no result event -> null',
  parseEventLine('{"type":"assistant","content":"the result was good"}') === null);

// ── formatEventLine ──
report('formatEventLine: tool_use',
  formatEventLine('6445d2b8', { kind: 'tool_use', name: 'Bash' }) === '[6445d2b8] tool_use:Bash');
report('formatEventLine: tool_error',
  formatEventLine('6445d2b8', { kind: 'tool_error' }) === '[6445d2b8] tool error');
report('formatEventLine: pr_url',
  formatEventLine('6445d2b8', { kind: 'pr_url', url: 'github.com/foo/bar/pull/42' })
  === '[6445d2b8] PR: github.com/foo/bar/pull/42');
report('formatEventLine: result',
  formatEventLine('6445d2b8', { kind: 'result', subtype: 'success', cost: '1.23' })
  === '[6445d2b8] done status=success cost=$1.23');
report('formatEventLine: null event -> null',
  formatEventLine('6445d2b8', null) === null);

// ── shouldStreamEvent ──
report('shouldStreamEvent: result streams by default',
  shouldStreamEvent('result', false) === true);
report('shouldStreamEvent: pr_url streams by default',
  shouldStreamEvent('pr_url', false) === true);
report('shouldStreamEvent: tool_use suppressed by default (#634 flood guard)',
  shouldStreamEvent('tool_use', false) === false);
report('shouldStreamEvent: tool_error suppressed by default (#634 flood guard)',
  shouldStreamEvent('tool_error', false) === false);
report('shouldStreamEvent: verbose streams tool_use',
  shouldStreamEvent('tool_use', true) === true);
report('shouldStreamEvent: verbose streams tool_error',
  shouldStreamEvent('tool_error', true) === true);
report('shouldStreamEvent: verbose streams result',
  shouldStreamEvent('result', true) === true);
report('shouldStreamEvent: verbose streams pr_url',
  shouldStreamEvent('pr_url', true) === true);
report('shouldStreamEvent: unknown kind suppressed by default',
  shouldStreamEvent('mystery', false) === false);
report('shouldStreamEvent: undefined kind suppressed by default',
  shouldStreamEvent(undefined, false) === false);

// ── hasResultEvent / lastResultSubtype / lastToolName ──
const sampleJsonl = [
  '{"type":"tool_use","id":"a","name":"Bash"}',
  '{"type":"tool_use","id":"b","name":"Edit"}',
  '{"type":"result","subtype":"success","total_cost_usd":0.5}'
].join('\n');
report('hasResultEvent: present',
  hasResultEvent(sampleJsonl) === true);
report('hasResultEvent: absent',
  hasResultEvent('{"type":"tool_use","name":"Bash"}') === false);
report('hasResultEvent: empty',
  hasResultEvent('') === false);
report('lastResultSubtype: latest wins',
  lastResultSubtype('"type":"result","subtype":"success"\n"type":"result","subtype":"error_during_execution"')
  === 'error_during_execution');
report('lastResultSubtype: none -> empty',
  lastResultSubtype('nothing') === '');
report('lastToolName: latest wins',
  lastToolName(sampleJsonl) === 'Edit');
report('lastToolName: none -> empty',
  lastToolName('no tools') === '');

// ── shouldStampSkipOnDiscovery ──
report('shouldStampSkipOnDiscovery: file older than threshold -> true (#483 guard)',
  shouldStampSkipOnDiscovery({ mtimeSecs: 1000, nowSecs: 1000 + 400 }) === true);
report('shouldStampSkipOnDiscovery: file newer than threshold -> false',
  shouldStampSkipOnDiscovery({ mtimeSecs: 1000, nowSecs: 1000 + 100 }) === false);
report('shouldStampSkipOnDiscovery: zero mtime -> false (stat failure)',
  shouldStampSkipOnDiscovery({ mtimeSecs: 0, nowSecs: 1000 }) === false);
report('shouldStampSkipOnDiscovery: exactly at threshold -> true',
  shouldStampSkipOnDiscovery({ mtimeSecs: 1000, nowSecs: 1300 }) === true);
report('shouldStampSkipOnDiscovery: custom threshold',
  shouldStampSkipOnDiscovery({ mtimeSecs: 1000, nowSecs: 1050, threshold: 30 }) === true);

// ── classifyLifecycle ──
report('classifyLifecycle: result present + not done -> done',
  classifyLifecycle({ hasResult: true, ageSecs: 0 }).action === 'done');
report('classifyLifecycle: result present + already done -> none',
  classifyLifecycle({ hasResult: true, doneAlready: true, ageSecs: 0 }).action === 'none');
report('classifyLifecycle: idle threshold reached -> idle',
  classifyLifecycle({ hasResult: false, ageSecs: 400 }).action === 'idle');
report('classifyLifecycle: idle but skipIdle -> none',
  classifyLifecycle({ hasResult: false, ageSecs: 400, skipIdle: true }).action === 'none');
report('classifyLifecycle: idle but idleAlready -> none',
  classifyLifecycle({ hasResult: false, ageSecs: 400, idleAlready: true }).action === 'none');
report('classifyLifecycle: under threshold + alive -> none',
  classifyLifecycle({ hasResult: false, ageSecs: 50, pid: 100, pidAlive: true }).action === 'none');
report('classifyLifecycle: pid dead, no result -> crashed',
  classifyLifecycle({ hasResult: false, ageSecs: 0, pid: 100, pidAlive: false }).action === 'crashed');
report('classifyLifecycle: pid dead but skipCrashed -> none',
  classifyLifecycle({ hasResult: false, ageSecs: 0, pid: 100, pidAlive: false, skipCrashed: true }).action === 'none');
report('classifyLifecycle: pid dead but crashedAlready -> none',
  classifyLifecycle({ hasResult: false, ageSecs: 0, pid: 100, pidAlive: false, crashedAlready: true }).action === 'none');
report('classifyLifecycle: no pid -> none',
  classifyLifecycle({ hasResult: false, ageSecs: 0, pid: null, pidAlive: false }).action === 'none');
report('classifyLifecycle: done wins over idle (result on a stale file)',
  classifyLifecycle({ hasResult: true, ageSecs: 1000 }).action === 'done');
report('classifyLifecycle: idle wins over crashed when both true this tick',
  classifyLifecycle({ hasResult: false, ageSecs: 400, pid: 100, pidAlive: false }).action === 'idle');
report('classifyLifecycle: combined skipIdle + skipCrashed on stale prior-session file -> none (#483 guard)',
  classifyLifecycle({ hasResult: false, ageSecs: 9999, pid: 100, pidAlive: false, skipIdle: true, skipCrashed: true }).action === 'none');

// ── formatLifecycleNotification ──
report('formatLifecycleNotification: done',
  formatLifecycleNotification({ action: 'done', label: 'claude-kit#445', subtype: 'success' })
  === 'claude-kit#445: done success');
report('formatLifecycleNotification: done with no subtype',
  formatLifecycleNotification({ action: 'done', label: 'claude-kit#445' })
  === 'claude-kit#445: done unknown');
report('formatLifecycleNotification: idle',
  formatLifecycleNotification({ action: 'idle', label: 'claude-kit#445', tool: 'Bash' })
  === 'claude-kit#445: idle>5m on Bash');
report('formatLifecycleNotification: idle with no tool',
  formatLifecycleNotification({ action: 'idle', label: 'claude-kit#445' })
  === 'claude-kit#445: idle>5m on (no tool yet)');
report('formatLifecycleNotification: crashed with pid',
  formatLifecycleNotification({ action: 'crashed', label: 'claude-kit#445', pid: 12345 })
  === 'claude-kit#445: crashed (pid 12345 gone)');
report('formatLifecycleNotification: crashed without pid',
  formatLifecycleNotification({ action: 'crashed', label: 'claude-kit#445' })
  === 'claude-kit#445: crashed');

// ── formatLifecycleStreamLine ──
report('formatLifecycleStreamLine: done -> null (live tail already announced)',
  formatLifecycleStreamLine({ action: 'done', label: 'claude-kit#445' }) === null);
report('formatLifecycleStreamLine: idle',
  formatLifecycleStreamLine({ action: 'idle', label: 'claude-kit#445', tool: 'Bash' })
  === '[claude-kit#445] idle>5m on Bash');
report('formatLifecycleStreamLine: crashed',
  formatLifecycleStreamLine({ action: 'crashed', label: 'claude-kit#445' })
  === '[claude-kit#445] crashed');

// ── ghIssueViewArgs ──
report('ghIssueViewArgs: with repo',
  JSON.stringify(ghIssueViewArgs({ value: '445', repo: 'LuisLadino/claude-kit' }))
  === JSON.stringify(['issue', 'view', '445', '--repo', 'LuisLadino/claude-kit', '--json', 'title', '--jq', '.title']));
report('ghIssueViewArgs: without repo',
  JSON.stringify(ghIssueViewArgs({ value: '445', repo: '' }))
  === JSON.stringify(['issue', 'view', '445', '--json', 'title', '--jq', '.title']));
report('ghIssueViewArgs: numeric value -> stringified',
  JSON.stringify(ghIssueViewArgs({ value: 445, repo: '' }))
  === JSON.stringify(['issue', 'view', '445', '--json', 'title', '--jq', '.title']));
report('ghIssueViewArgs: non-numeric value -> null (flag-injection guard)',
  ghIssueViewArgs({ value: '-R victim/repo', repo: '' }) === null);
report('ghIssueViewArgs: malicious repo with leading dash -> null',
  ghIssueViewArgs({ value: '445', repo: '-flag' }) === null);
report('ghIssueViewArgs: malicious repo with whitespace -> null',
  ghIssueViewArgs({ value: '445', repo: 'foo bar/baz' }) === null);
report('ghIssueViewArgs: null value -> null',
  ghIssueViewArgs({ value: null, repo: '' }) === null);
report('ghIssueViewArgs: empty value -> null',
  ghIssueViewArgs({ value: '', repo: '' }) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
