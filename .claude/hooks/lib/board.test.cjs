#!/usr/bin/env node

/**
 * Tests for board.cjs (#735). Pure decision logic plus injectable IO.
 * Run: node .claude/hooks/lib/board.test.cjs
 */

const assert = require('assert');
const B = require('./board.cjs');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}\n  ${e.message}`); }
}

const WS = [
  { slug: 'workflow', tag: 1, name: 'Workflow', keywords: ['skill', 'hook', 'dispatch', 'phase'] },
  { slug: 'context', tag: 2, name: 'Context', keywords: ['context', 'session', 'tracking'] },
  { slug: 'safety', tag: 3, name: 'Safety', keywords: ['safety', 'block', 'credential'] },
];

// ── label parsing ──
test('labelForWorkstream prefixes', () => {
  assert.strictEqual(B.labelForWorkstream('workflow'), 'workstream/workflow');
});

test('workstreamSlug reads string labels', () => {
  assert.strictEqual(B.workstreamSlug(['type/feature', 'workstream/safety']), 'safety');
});

test('workstreamSlug reads object labels ({name})', () => {
  assert.strictEqual(B.workstreamSlug([{ name: 'workstream/context' }, { name: 'priority/high' }]), 'context');
});

test('workstreamSlug null when none', () => {
  assert.strictEqual(B.workstreamSlug(['type/bug', 'priority/low']), null);
});

test('stageFromLabels + priorityFromLabels', () => {
  const labels = ['status/ready', 'priority/high', 'workstream/workflow'];
  assert.strictEqual(B.stageFromLabels(labels), 'ready');
  assert.strictEqual(B.priorityFromLabels(labels), 'high');
});

test('isLaned reflects workstream presence', () => {
  assert.strictEqual(B.isLaned(['workstream/x']), true);
  assert.strictEqual(B.isLaned(['type/feature']), false);
  assert.strictEqual(B.isLaned([]), false);
});

// ── classification ──
test('classifyByHeuristic confident single match', () => {
  const r = B.classifyByHeuristic('Add a new dispatch hook for workers', WS);
  assert.strictEqual(r.slug, 'workflow');
  assert.strictEqual(r.confident, true);
});

test('classifyByHeuristic tie is not confident', () => {
  // one hit for workflow ("skill") and one for context ("session") → tie
  const r = B.classifyByHeuristic('the skill needs session state', WS);
  assert.strictEqual(r.confident, false);
});

test('classifyByHeuristic no keyword match', () => {
  const r = B.classifyByHeuristic('refactor the readme prose', WS);
  assert.strictEqual(r.slug, null);
  assert.strictEqual(r.confident, false);
});

test('classifyByHeuristic respects word boundaries', () => {
  const r = B.classifyByHeuristic('the block list grew', WS);
  assert.strictEqual(r.slug, 'safety');
});

test('classifyByHeuristic empty workstreams → null', () => {
  assert.strictEqual(B.classifyByHeuristic('anything', []), null);
});

// ── lane resolution (#777) ──
test('resolveLane: numeric tag resolves to slug', () => {
  assert.strictEqual(B.resolveLane('2', WS), 'context');
  assert.strictEqual(B.resolveLane(2, WS), 'context');
});

test('resolveLane: string tag (yaml-mini form) resolves', () => {
  const ws = [{ slug: 'context', tag: '2', name: 'Context' }];
  assert.strictEqual(B.resolveLane('2', ws), 'context');
});

test('resolveLane: exact slug resolves, case-insensitive', () => {
  assert.strictEqual(B.resolveLane('safety', WS), 'safety');
  assert.strictEqual(B.resolveLane('SAFETY', WS), 'safety');
});

test('resolveLane: exact display name resolves, case-insensitive', () => {
  assert.strictEqual(B.resolveLane('Context', WS), 'context');
  assert.strictEqual(B.resolveLane('workflow', WS), 'workflow');
});

test('resolveLane: unknown token returns null (caller shows the menu)', () => {
  assert.strictEqual(B.resolveLane('operations', WS), null); // the cross-session miss
  assert.strictEqual(B.resolveLane('99', WS), null);
  assert.strictEqual(B.resolveLane(null, WS), null);
  assert.strictEqual(B.resolveLane('   ', WS), null);
});

test('laneSummary carries the numeric tag onto each lane', () => {
  const { lanes } = B.laneSummary([issue(1, 'context', 'ready', 'high')], WS);
  const ctx = lanes.find(l => l.slug === 'context');
  assert.strictEqual(ctx.tag, 2);
});

// ── decorate + launchable ──
test('decorate extracts axes', () => {
  const d = B.decorate({ number: 5, title: 'X', labels: ['workstream/safety', 'status/ready', 'priority/high'] });
  assert.deepStrictEqual(
    { ws: d.workstream, st: d.stage, pr: d.priority },
    { ws: 'safety', st: 'ready', pr: 'high' }
  );
});

test('isLaunchable: ready is launchable', () => {
  assert.strictEqual(B.isLaunchable({ stage: 'ready', priority: 'low' }), true);
});
test('isLaunchable: high-priority backlog is launchable', () => {
  assert.strictEqual(B.isLaunchable({ stage: 'backlog', priority: 'high' }), true);
});
test('isLaunchable: blocked is never launchable', () => {
  assert.strictEqual(B.isLaunchable({ stage: 'blocked', priority: 'high' }), false);
});
test('isLaunchable: in-progress is not launchable', () => {
  assert.strictEqual(B.isLaunchable({ stage: 'in-progress', priority: 'high' }), false);
});
test('isLaunchable: deferred is never launchable, even at high priority', () => {
  assert.strictEqual(B.isLaunchable({ stage: 'deferred', priority: 'high' }), false);
  assert.strictEqual(B.isLaunchable({ stage: 'deferred', priority: 'low' }), false);
});
test('isLaunchable: plain backlog medium is not launchable', () => {
  assert.strictEqual(B.isLaunchable({ stage: 'backlog', priority: 'medium' }), false);
});

// ── ordering ──
test('sortIssues: launchable before non, then priority, then number', () => {
  const issues = [
    { number: 3, stage: 'backlog', priority: 'low' },       // not launchable
    { number: 2, stage: 'ready', priority: 'low' },         // launchable
    { number: 1, stage: 'backlog', priority: 'high' },      // launchable, high
  ];
  const sorted = B.sortIssues(issues);
  assert.deepStrictEqual(sorted.map(i => i.number), [1, 2, 3]);
});

// ── laneSummary ──
function issue(number, ws, stage, priority) {
  const labels = [];
  if (ws) labels.push(`workstream/${ws}`);
  if (stage) labels.push(`status/${stage}`);
  if (priority) labels.push(`priority/${priority}`);
  return { number, title: `issue ${number}`, labels };
}

test('laneSummary groups, counts, picks top launchable', () => {
  const issues = [
    issue(1, 'workflow', 'ready', 'high'),
    issue(2, 'workflow', 'blocked', 'high'),
    issue(3, 'context', 'backlog', 'medium'),
    issue(4, null, null, null), // unlaned
  ];
  const { lanes, unlaned } = B.laneSummary(issues, WS);
  const wf = lanes.find(l => l.slug === 'workflow');
  assert.strictEqual(wf.total, 2);
  assert.strictEqual(wf.launchable, 1);
  assert.strictEqual(wf.blocked, 1);
  assert.strictEqual(wf.top.number, 1);
  assert.strictEqual(unlaned.length, 1);
  assert.strictEqual(unlaned[0].number, 4);
});

test('laneSummary keeps a legacy/renamed workstream visible', () => {
  const issues = [issue(9, 'legacy-lane', 'ready', 'high')];
  const { lanes } = B.laneSummary(issues, WS);
  const legacy = lanes.find(l => l.slug === 'legacy-lane');
  assert.ok(legacy, 'legacy lane should appear even though not in config');
  assert.strictEqual(legacy.total, 1);
});

test('laneSummary counts deferred and keeps it off launchable + lane top', () => {
  const issues = [
    issue(1, 'workflow', 'ready', 'high'),
    issue(2, 'workflow', 'deferred', 'high'),   // deliberate set-aside, high priority
  ];
  const { lanes } = B.laneSummary(issues, WS);
  const wf = lanes.find(l => l.slug === 'workflow');
  assert.strictEqual(wf.total, 2);
  assert.strictEqual(wf.launchable, 1);          // only #1
  assert.strictEqual(wf.deferred, 1);            // #2 broken out
  assert.strictEqual(wf.top.number, 1);          // deferred never tops the lane
});

// ── rankLanes / parallelSafe / directive ──
test('rankLanes orders by launchable then highPriority', () => {
  const lanes = [
    { slug: 'a', launchable: 1, highPriority: 1, total: 5 },
    { slug: 'b', launchable: 3, highPriority: 0, total: 3 },
    { slug: 'c', launchable: 1, highPriority: 3, total: 9 },
  ];
  assert.deepStrictEqual(B.rankLanes(lanes).map(l => l.slug), ['b', 'c', 'a']);
});

test('parallelSafeLanes drops zero-launchable lanes', () => {
  const lanes = [
    { slug: 'a', launchable: 0, highPriority: 2, total: 4 },
    { slug: 'b', launchable: 2, highPriority: 0, total: 2 },
  ];
  assert.deepStrictEqual(B.parallelSafeLanes(lanes).map(l => l.slug), ['b']);
});

test('buildDirective recommends most-launchable lane + lists parallel-safe + unlaned', () => {
  const issues = [
    issue(1, 'workflow', 'ready', 'high'),
    issue(2, 'workflow', 'ready', 'medium'),
    issue(3, 'context', 'ready', 'low'),
    issue(4, 'safety', 'blocked', 'high'),
    issue(5, null, null, null),
  ];
  const d = B.buildDirective(issues, WS);
  assert.strictEqual(d.recommended.slug, 'workflow'); // 2 launchable
  const safeSlugs = d.parallelSafe.map(l => l.slug);
  assert.ok(safeSlugs.includes('workflow') && safeSlugs.includes('context'));
  assert.ok(!safeSlugs.includes('safety')); // only a blocked issue, 0 launchable
  assert.strictEqual(d.unlaned.length, 1);
});

test('buildDirective drops a deferred-only lane from parallelSafe but keeps it visible', () => {
  const issues = [
    issue(1, 'workflow', 'ready', 'high'),
    issue(2, 'context', 'deferred', 'high'),   // deferred, not a dependency block
  ];
  const d = B.buildDirective(issues, WS);
  const safeSlugs = d.parallelSafe.map(l => l.slug);
  assert.ok(safeSlugs.includes('workflow'));
  assert.ok(!safeSlugs.includes('context'));   // 0 launchable → not parallel-safe
  const ctx = d.lanes.find(l => l.slug === 'context');
  assert.strictEqual(ctx.deferred, 1);         // still in the breakdown
});

// ── IO edge (injected) ──
test('readConfig parses board.yaml via injected readFile', () => {
  const yaml = [
    'project:',
    '  number: 13',
    'workstreams:',
    '  - slug: workflow',
    '    name: Workflow',
    '    keywords: [skill, hook]',
  ].join('\n');
  const cfg = B.readConfig('/fake', { readFile: () => yaml });
  // yaml-mini returns scalars as strings; project.number only feeds `gh project` CLI args.
  assert.strictEqual(String(cfg.project.number), '13');
  assert.strictEqual(cfg.workstreams[0].slug, 'workflow');
});

test('readConfig returns null when file missing', () => {
  const cfg = B.readConfig('/fake', { readFile: () => { throw new Error('ENOENT'); } });
  assert.strictEqual(cfg, null);
});

test('listOpenIssues parses gh json, [] on failure', () => {
  const issues = B.listOpenIssues({ run: () => JSON.stringify([{ number: 1, title: 't', labels: [] }]) });
  assert.strictEqual(issues.length, 1);
  assert.deepStrictEqual(B.listOpenIssues({ run: () => null }), []);
  assert.deepStrictEqual(B.listOpenIssues({ run: () => 'not json' }), []);
});

console.log(`\n${'='.repeat(48)}`);
if (fail > 0) { console.error(`FAILED — ${fail} of ${pass + fail} assertions failed.`); process.exit(1); }
console.log(`PASSED — all ${pass} assertions green.`);
process.exit(0);
