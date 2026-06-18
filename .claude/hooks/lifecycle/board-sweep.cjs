#!/usr/bin/env node

/**
 * Board-sweep hook (#735).
 *
 * Event: SessionStart.
 * Purpose: the third classification layer. The /plan skill lanes issues at
 * birth and classify-on-create catches the deterministic cases; this sweep is
 * the catch-all that surfaces whatever still has no `workstream/<slug>` label —
 * issues filed on the GitHub web UI, by a dispatch worker, or before the board
 * existed. The board's "no lane" set is a triage inbox; this drains it into the
 * operator's view at session start so nothing piles up unseen.
 *
 * It does NOT auto-apply LLM classification (a hook has no model). It surfaces
 * the lane-less issues with a deterministic suggestion where confident, and the
 * operator (or /board) lanes them. Silent when there's no board, no git, or
 * nothing un-laned.
 *
 * Observability mode, fails open. Short gh timeout to protect session-start
 * latency. Decision logic is pure and unit-tested; gh is injected. See
 * board-sweep.test.cjs.
 */

const { execSync } = require('child_process');
const board = require('../lib/board.cjs');

const GH_TIMEOUT_MS = 4000;
const MAX_LISTED = 8;

// ─────────────────────────── Pure decision logic ───────────────────────────

// From open issues + workstreams, compute the lane-less set with suggestions.
function selectUnlaned(issues, workstreams) {
  return (issues || [])
    .filter(i => !board.isLaned(i.labels))
    .map(i => {
      const guess = board.classifyByHeuristic(`${i.title || ''}`, workstreams);
      return {
        number: i.number,
        title: i.title || '',
        suggestion: guess && guess.confident ? guess.slug : null,
      };
    });
}

function formatReport(unlaned, { max = MAX_LISTED } = {}) {
  if (!Array.isArray(unlaned) || unlaned.length === 0) return '';
  const shown = unlaned.slice(0, max);
  const lines = shown.map(u => {
    const hint = u.suggestion ? `  (suggest: ${u.suggestion})` : '  (needs a lane)';
    return `  - #${u.number}: ${u.title}${hint}`;
  }).join('\n');
  const extra = unlaned.length > shown.length
    ? `\n  …and ${unlaned.length - shown.length} more.`
    : '';
  const plural = unlaned.length > 1 ? 's' : '';
  return `[BOARD] ${unlaned.length} open issue${plural} not yet assigned a lane (workstream):
${lines}${extra}

Lane them so parallel workspaces stay collision-safe: run /board to triage, or add a workstream/<slug> label.`;
}

// ──────────────────────── IO wrappers (injectable) ─────────────────────────

function defaultRun(cmd, timeout = GH_TIMEOUT_MS) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

// ─────────────────────────── Hook entry point ──────────────────────────────

function handleHook(_data, deps = {}) {
  if (process.env.CLAUDE_KIT_NO_BOARD_SWEEP) return;
  const run = deps.run || defaultRun;
  const readConfig = deps.readConfig || board.readConfig;
  const listOpenIssues = deps.listOpenIssues || board.listOpenIssues;
  const log = deps.log || console.log;

  const inRepo = run('git rev-parse --is-inside-work-tree');
  if (inRepo !== 'true') return;

  const config = readConfig();
  if (!config) return; // no board → silent

  const issues = listOpenIssues({ run });
  const unlaned = selectUnlaned(issues, config.workstreams);
  const report = formatReport(unlaned);
  if (report) log(report);
}

if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook(handleHook, { mode: 'observability', parseJson: false });
} else {
  module.exports = {
    handleHook,
    selectUnlaned,
    formatReport,
    MAX_LISTED,
  };
}
