#!/usr/bin/env node

/**
 * Board coordination library (#735).
 *
 * The kit drives parallel agents (Conductor workspaces, dispatch workers) but
 * had no surface answering "which issues are safe to run concurrently, what is
 * launchable, and which lane should this workspace take." This library is the
 * shared core for that surface.
 *
 * Design: GitHub issue LABELS are the source of truth, not the Projects board.
 *   - `workstream/<slug>` is the lane (the file-overlap proxy, cut at the
 *     project's architecture altitude — see board-coordination.md).
 *   - `status/<stage>` is the workflow stage; `priority/<level>` the priority.
 * The Projects v2 board is a DERIVED visual mirror of those labels, kept in
 * sync by the /board command. Every coordination read here runs against
 * `gh issue list`, never the Projects API, so the directive is always current
 * and works even before a board is provisioned. board.yaml only configures the
 * lane axis (slugs/keywords) and records the provisioned board's ids.
 *
 * Layering (why the Projects API lives in the command, not here): the two hooks
 * that consume this lib (classify-on-create, board-sweep) only ever read or set
 * LABELS — fast, robust, no item-id lookups. All Projects-API interaction
 * (create board, fields, mirror, reconcile) lives in the LLM-driven /board
 * command where latency and error handling are acceptable.
 *
 * Pure decision logic is exported and unit-tested. The execSync wrapper and
 * filesystem reads are injectable so the suite runs without gh / git.
 * See board.test.cjs.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { resolveProjectRoot } = require('./project-root.cjs');
const { parse: parseYaml } = require('./yaml-mini.cjs');

const CONFIG_REL = path.join('.claude', 'board.yaml');
const WORKSTREAM_PREFIX = 'workstream/';
const STATUS_PREFIX = 'status/';
const PRIORITY_PREFIX = 'priority/';
const GH_TIMEOUT_MS = 5000;

// ─────────────────────────── Pure: label parsing ───────────────────────────

function labelForWorkstream(slug) {
  return `${WORKSTREAM_PREFIX}${slug}`;
}

function valueForPrefix(labels, prefix) {
  if (!Array.isArray(labels)) return null;
  for (const l of labels) {
    const name = typeof l === 'string' ? l : l && l.name;
    if (typeof name === 'string' && name.startsWith(prefix)) {
      return name.slice(prefix.length);
    }
  }
  return null;
}

function workstreamSlug(labels) {
  return valueForPrefix(labels, WORKSTREAM_PREFIX);
}

function stageFromLabels(labels) {
  return valueForPrefix(labels, STATUS_PREFIX);
}

function priorityFromLabels(labels) {
  return valueForPrefix(labels, PRIORITY_PREFIX);
}

function isLaned(labels) {
  return workstreamSlug(labels) != null;
}

// ───────────────────── Pure: deterministic classification ──────────────────

// Score `text` against each workstream's keyword list. Returns the best match
// with a `confident` flag: confident only when the top score is positive AND
// strictly beats the runner-up (no ambiguous tie). Non-confident matches are
// left for the LLM (the plan skill at issue-birth, or the session sweep).
function classifyByHeuristic(text, workstreams) {
  if (typeof text !== 'string' || !Array.isArray(workstreams) || workstreams.length === 0) {
    return null;
  }
  const haystack = text.toLowerCase();
  const scored = workstreams.map(ws => {
    const keywords = Array.isArray(ws.keywords) ? ws.keywords : [];
    let score = 0;
    for (const kw of keywords) {
      if (typeof kw !== 'string' || !kw) continue;
      // Word-ish boundary so "test" doesn't match "latest".
      const re = new RegExp(`\\b${kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      if (re.test(haystack)) score++;
    }
    return { slug: ws.slug, name: ws.name, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top || top.score === 0) return { slug: null, score: 0, confident: false };
  const runnerUp = scored[1] ? scored[1].score : 0;
  return { slug: top.slug, name: top.name, score: top.score, confident: top.score > runnerUp };
}

// ───────────────────────── Pure: lane resolution ───────────────────────────

// Resolve an operator-typed lane token to a workstream slug. Accepts the
// numeric `tag` (the concise cross-project form — `/board 4`), the exact slug,
// or the exact display name (case-insensitive). yaml-mini returns the tag as a
// string, so the compare is string-based. Returns null when nothing matches so
// the caller can show the available lanes instead of failing silently — the
// cross-session "operations lane" miss this fixes (#777).
function resolveLane(token, workstreams) {
  if (token == null) return null;
  const t = String(token).trim();
  if (!t) return null;
  const list = Array.isArray(workstreams) ? workstreams : [];
  if (/^\d+$/.test(t)) {
    const byTag = list.find(w => w && w.tag != null && String(w.tag) === t);
    if (byTag) return byTag.slug;
  }
  const lower = t.toLowerCase();
  const bySlug = list.find(w => w && typeof w.slug === 'string' && w.slug.toLowerCase() === lower);
  if (bySlug) return bySlug.slug;
  const byName = list.find(w => w && typeof w.name === 'string' && w.name.toLowerCase() === lower);
  if (byName) return byName.slug;
  return null;
}

// ───────────────────────── Pure: directive selectors ───────────────────────

function decorate(issue) {
  const labels = (issue && issue.labels) || [];
  return {
    number: issue && issue.number,
    title: (issue && issue.title) || '',
    workstream: workstreamSlug(labels),
    stage: stageFromLabels(labels),
    priority: priorityFromLabels(labels),
  };
}

// Launchable = ready to fire in a fresh workspace: not blocked, not deferred,
// not already in progress, and either explicitly Ready or High priority.
// Mirrors cosmo's "priority:High stage:Backlog,Ready" launchable view,
// generalized. `deferred` is a deliberate operator set-aside (distinct from
// `blocked`, a dependency wait): excluded unconditionally — even at High
// priority — so a deferred issue drops off the recommendation surface until
// the operator un-defers it. See board-coordination.md.
function isLaunchable(d) {
  if (!d) return false;
  if (d.stage === 'blocked' || d.stage === 'in-progress' || d.stage === 'deferred') return false;
  return d.stage === 'ready' || d.priority === 'high';
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
function priorityRank(d) {
  return d && d.priority != null && PRIORITY_RANK[d.priority] != null ? PRIORITY_RANK[d.priority] : 3;
}

// Order within a lane: launchable first, then by priority, then issue number.
function rankIssue(d) {
  return [isLaunchable(d) ? 0 : 1, priorityRank(d), d ? d.number : Infinity];
}

function sortIssues(decorated) {
  return [...decorated].sort((a, b) => {
    const ra = rankIssue(a), rb = rankIssue(b);
    for (let i = 0; i < ra.length; i++) {
      if (ra[i] !== rb[i]) return ra[i] - rb[i];
    }
    return 0;
  });
}

// Build the per-lane summary used by both the global directive and `lane`.
function laneSummary(issues, workstreams) {
  const decorated = (issues || []).map(decorate);
  const order = (workstreams || []).map(w => w.slug);
  const byName = new Map((workstreams || []).map(w => [w.slug, w.name || w.slug]));
  const byTag = new Map((workstreams || []).map(w => [w.slug, w.tag != null ? w.tag : null]));
  const groups = new Map();
  for (const slug of order) groups.set(slug, []);
  const unlaned = [];
  for (const d of decorated) {
    if (d.workstream && groups.has(d.workstream)) groups.get(d.workstream).push(d);
    else if (d.workstream) {
      // labelled with a workstream not in config (renamed/legacy) — keep visible
      if (!groups.has(d.workstream)) groups.set(d.workstream, []);
      groups.get(d.workstream).push(d);
    } else unlaned.push(d);
  }
  const lanes = [];
  for (const [slug, items] of groups) {
    const sorted = sortIssues(items);
    const launchable = sorted.filter(isLaunchable);
    lanes.push({
      slug,
      tag: byTag.has(slug) ? byTag.get(slug) : null,
      name: byName.get(slug) || slug,
      total: sorted.length,
      launchable: launchable.length,
      blocked: sorted.filter(d => d.stage === 'blocked').length,
      deferred: sorted.filter(d => d.stage === 'deferred').length,
      inProgress: sorted.filter(d => d.stage === 'in-progress').length,
      highPriority: sorted.filter(d => d.priority === 'high').length,
      top: launchable[0] || sorted[0] || null,
      issues: sorted,
    });
  }
  return { lanes, unlaned: sortIssues(unlaned) };
}

// Rank lanes for the "open a workspace for X" recommendation: most launchable
// work first, then most high-priority, then most total. Lanes with zero
// launchable work sink to the bottom.
function rankLanes(lanes) {
  return [...(lanes || [])].sort((a, b) => {
    if (b.launchable !== a.launchable) return b.launchable - a.launchable;
    if (b.highPriority !== a.highPriority) return b.highPriority - a.highPriority;
    return b.total - a.total;
  });
}

// All lanes with launchable work are mutually parallel-safe (different
// workstreams ≈ disjoint files). The chokepoint exceptions (files many lanes
// touch) are documented in board.yaml `chokepoints` and surfaced as prose by
// the command — they cannot be computed from labels alone.
function parallelSafeLanes(lanes) {
  return rankLanes((lanes || []).filter(l => l.launchable > 0));
}

function buildDirective(issues, workstreams) {
  const { lanes, unlaned } = laneSummary(issues, workstreams);
  const ranked = rankLanes(lanes);
  const safe = parallelSafeLanes(lanes);
  return {
    recommended: safe[0] || ranked[0] || null,
    parallelSafe: safe.map(l => ({ tag: l.tag, slug: l.slug, name: l.name, launchable: l.launchable, top: l.top })),
    lanes: ranked,
    unlaned,
  };
}

// ──────────────────────── IO edge (injectable) ─────────────────────────────

function defaultRun(cmd, timeout = GH_TIMEOUT_MS) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function configPath(projectRoot) {
  return path.join(projectRoot || resolveProjectRoot() || '.', CONFIG_REL);
}

function readConfig(projectRoot, { readFile = fs.readFileSync } = {}) {
  const p = configPath(projectRoot);
  let raw;
  try {
    raw = readFile(p, 'utf8');
  } catch {
    return null;
  }
  try {
    const cfg = parseYaml(raw) || {};
    if (!Array.isArray(cfg.workstreams)) cfg.workstreams = [];
    return cfg;
  } catch {
    return null;
  }
}

function listOpenIssues({ run = defaultRun } = {}) {
  const json = run(
    'gh issue list --state open --limit 300 --json number,title,labels',
    GH_TIMEOUT_MS
  );
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function fetchIssueText(number, { run = defaultRun } = {}) {
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) return null;
  const json = run(`gh issue view ${n} --json number,title,body,labels`, GH_TIMEOUT_MS);
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ─────────────────────────────── CLI ───────────────────────────────────────
// Powers the /board command: the agent shells out for deterministic data, then
// narrates a recommendation-first directive. All output is JSON on stdout.

function cli(argv, { run = defaultRun, log = console.log } = {}) {
  const sub = argv[2];
  const cfg = readConfig(null, {});
  const workstreams = cfg ? cfg.workstreams : [];

  switch (sub) {
    case 'config':
      log(JSON.stringify(cfg || {}, null, 2));
      return 0;
    case 'workstreams':
      log(JSON.stringify(workstreams, null, 2));
      return 0;
    case 'classify': {
      const issue = fetchIssueText(argv[3], { run });
      if (!issue) { log(JSON.stringify({ slug: null, confident: false, error: 'issue not found' })); return 0; }
      const text = `${issue.title || ''}\n${issue.body || ''}`;
      log(JSON.stringify(classifyByHeuristic(text, workstreams)));
      return 0;
    }
    case 'unlaned': {
      const issues = listOpenIssues({ run });
      const out = issues
        .filter(i => !isLaned(i.labels))
        .map(i => {
          const guess = classifyByHeuristic(`${i.title || ''}`, workstreams);
          return { number: i.number, title: i.title, suggestion: guess && guess.confident ? guess.slug : null };
        });
      log(JSON.stringify(out, null, 2));
      return 0;
    }
    case 'lane': {
      const requested = argv[3];
      const slug = resolveLane(requested, workstreams);
      if (!slug) {
        log(JSON.stringify({
          slug: null,
          requested: requested != null ? String(requested) : null,
          error: 'unknown lane',
          available: workstreams.map(w => ({ tag: w.tag != null ? w.tag : null, slug: w.slug, name: w.name })),
        }, null, 2));
        return 0;
      }
      const issues = listOpenIssues({ run });
      const { lanes } = laneSummary(issues, workstreams);
      const lane = lanes.find(l => l.slug === slug) || { slug, tag: null, name: slug, total: 0, launchable: 0, issues: [] };
      log(JSON.stringify(lane, null, 2));
      return 0;
    }
    case 'directive':
    default: {
      const issues = listOpenIssues({ run });
      log(JSON.stringify(buildDirective(issues, workstreams), null, 2));
      return 0;
    }
  }
}

if (require.main === module) {
  process.exit(cli(process.argv));
} else {
  module.exports = {
    // constants
    WORKSTREAM_PREFIX, STATUS_PREFIX, PRIORITY_PREFIX,
    // label parsing
    labelForWorkstream, valueForPrefix, workstreamSlug, stageFromLabels,
    priorityFromLabels, isLaned,
    // classification
    classifyByHeuristic,
    // lane resolution
    resolveLane,
    // directive selectors
    decorate, isLaunchable, priorityRank, rankIssue, sortIssues,
    laneSummary, rankLanes, parallelSafeLanes, buildDirective,
    // IO edge
    defaultRun, configPath, readConfig, listOpenIssues, fetchIssueText,
    // cli
    cli,
  };
}
