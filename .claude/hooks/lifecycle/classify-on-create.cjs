#!/usr/bin/env node

/**
 * Classify-on-create hook (#735).
 *
 * Event: PostToolUse (Bash, gated to `gh issue create`).
 * Purpose: the deterministic middle layer of board-coordination's three-layer
 * classification. An issue's lane (the `workstream/<slug>` label) is normally
 * set with full judgment by the /plan skill at issue-birth. This hook is the
 * safety net for issues created OUTSIDE that path — a raw `gh issue create`, a
 * dispatch worker, a one-off — so they don't land lane-less and pile up
 * untagged. It applies a `workstream/*` label only when a keyword heuristic is
 * confident; ambiguous issues are left for the session sweep + the operator.
 *
 * It only ever ADDS a label (never overrides). It no-ops when:
 *   - the project has no board (.claude/board.yaml absent)
 *   - the create command already set a workstream/* label (plan skill did it)
 *   - the heuristic is not confident
 *   - the new issue number can't be read from the command output
 *
 * No GitHub Projects API here by design (see board.cjs): hooks touch labels
 * only — fast, robust. The board's visual fields are reconciled by `/board`.
 *
 * Observability mode: fails open, logs handler errors to the tracking log.
 * Decision logic is pure and unit-tested; gh calls are injected. See
 * classify-on-create.test.cjs.
 */

const { execSync } = require('child_process');
const { atCommandPosition } = require('../lib/command-position.cjs');
const board = require('../lib/board.cjs');

// ─────────────────────────── Pure decision logic ───────────────────────────

function isGhIssueCreate(command) {
  return atCommandPosition(command || '', String.raw`gh\s+issue\s+create\b`);
}

// The author already chose a lane if any workstream/* label is on the command.
function commandSetsWorkstream(command) {
  return typeof command === 'string' && command.includes(board.WORKSTREAM_PREFIX);
}

function extractIssueNumbers(stdout) {
  if (typeof stdout !== 'string') return [];
  const out = [];
  const re = /\/issues\/(\d+)\b/g;
  let m;
  while ((m = re.exec(stdout)) !== null) out.push(Number(m[1]));
  return out;
}

// Decide the action from inputs already gathered. Pure. Returns either
// { act: false } or { act: true, number, slug }.
function decide({ command, stdout, config, classifyText }) {
  if (!isGhIssueCreate(command)) return { act: false };
  if (!config || !Array.isArray(config.workstreams) || config.workstreams.length === 0) {
    return { act: false };
  }
  if (commandSetsWorkstream(command)) return { act: false };
  const numbers = extractIssueNumbers(stdout);
  if (numbers.length !== 1) return { act: false }; // multi-create → leave for the sweep
  const result = classifyText(numbers[0]);
  if (!result || !result.confident || !result.slug) return { act: false };
  return { act: true, number: numbers[0], slug: result.slug };
}

// ──────────────────────── IO wrappers (injectable) ─────────────────────────

function defaultRun(cmd, timeout = 5000) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

// ─────────────────────────── Hook entry point ──────────────────────────────

function handleHook(data, deps = {}) {
  const run = deps.run || defaultRun;
  const readConfig = deps.readConfig || board.readConfig;
  const fetchIssueText = deps.fetchIssueText || board.fetchIssueText;
  const classifyByHeuristic = deps.classifyByHeuristic || board.classifyByHeuristic;

  const command = data && data.tool_input && data.tool_input.command;
  const stdout = data && data.tool_response && data.tool_response.stdout;
  const config = readConfig();
  if (!config) return; // no board → nothing to do (fast path)

  const classifyText = (number) => {
    const issue = fetchIssueText(number, { run });
    if (!issue) return null;
    return classifyByHeuristic(`${issue.title || ''}\n${issue.body || ''}`, config.workstreams);
  };

  const action = decide({ command, stdout, config, classifyText });
  if (!action.act) return;

  // Force the number type and validate before it reaches a shell.
  const n = Number(action.number);
  if (!Number.isInteger(n) || n <= 0) return;
  const label = board.labelForWorkstream(action.slug);
  // Label slug comes from our own config; still avoid shell metacharacters.
  if (!/^[a-z0-9][a-z0-9/-]*$/i.test(label)) return;
  run(`gh issue edit ${n} --add-label ${JSON.stringify(label)}`, 8000);
}

if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook(handleHook, { mode: 'observability' });
} else {
  module.exports = {
    handleHook,
    decide,
    isGhIssueCreate,
    commandSetsWorkstream,
    extractIssueNumbers,
  };
}
