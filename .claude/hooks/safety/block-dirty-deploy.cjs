#!/usr/bin/env node

/**
 * Block Dirty Deploy Hook
 *
 * Event: PreToolUse (Bash)
 * Purpose: Refuse unsafe deploy commands (vercel, netlify, firebase,
 *   wrangler). Two rules:
 *
 *   1. Dispatch workers must never deploy (#472). A worker's cwd is a
 *      `.claude/worktrees/dispatch-*` worktree; deploy is the orchestrator's
 *      job, run from the main checkout after merge. Hard block, no override.
 *
 *   2. Refuse a deploy when the working tree has uncommitted files this
 *      session did not edit (#451) — one session's deploy would ship another
 *      session's work to production. The check: git status --porcelain dirty
 *      paths compared against file_change events in the session tracking log;
 *      files dirty but not in the edit log are "foreign". Override:
 *      ALLOW_DIRTY_DEPLOY=1 in the command env or process env.
 */

const { spawnSync } = require('child_process');

const {
  getSessionId,
  readTrackingEvents,
} = require('../lib/session-utils.cjs');

const DEPLOY_PATTERNS = [
  /\bvercel\s+(deploy|--prod|--production)\b/i,
  /\bvercel\b(?!\s+(env|login|link|switch|inspect|logs|projects|teams|whoami|--version|-v|--help|-h))/i,
  /\bnetlify\s+deploy\b/i,
  /\bfirebase\s+deploy\b/i,
  /\bwrangler\s+(deploy|publish)\b/i,
];

function matchesDeploy(command) {
  if (!command) return false;
  return DEPLOY_PATTERNS.some(rx => rx.test(command));
}

// A dispatch worker runs with cwd inside its own git worktree at
// <repo>/.claude/worktrees/dispatch-<sessionId>/. That path is structural —
// only dispatch creates `dispatch-` worktrees — so cwd is a reliable signal
// that the current session is a non-interactive worker. #472
function isDispatchWorker(cwd) {
  return typeof cwd === 'string' &&
    /\/\.claude\/worktrees\/dispatch-[0-9a-f]+(\/|$)/.test(cwd);
}

function getDirtyFiles(cwd) {
  const r = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
  if (r.status !== 0) return [];
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const trimmed = line.slice(3);
      const renamed = trimmed.split(' -> ');
      return renamed[renamed.length - 1].trim().replace(/^"|"$/g, '');
    });
}

function getSessionEditedFiles(sessionId, cwd) {
  const events = readTrackingEvents(sessionId, cwd);
  const files = new Set();
  for (const ev of events) {
    if (ev.type === 'file_change' && ev.file) {
      files.add(ev.file);
    }
  }
  return files;
}

function findForeignDirty(dirtyFiles, editedFiles) {
  const foreign = [];
  for (const f of dirtyFiles) {
    if (!editedFiles.has(f)) foreign.push(f);
  }
  return foreign;
}

function handleHook(data) {
  const tool_input = data && data.tool_input;
  const command = tool_input && tool_input.command;
  if (!command) process.exit(0);

  if (!matchesDeploy(command)) process.exit(0);

  // #472: dispatch workers must never deploy. Hard block, no override — a
  // worker is non-interactive and cannot meaningfully confirm. This fires
  // before the ALLOW_DIRTY_DEPLOY override below, which is for humans only.
  const sessionCwd = (data && data.cwd) || process.cwd();
  if (isDispatchWorker(sessionCwd)) {
    console.error('[BLOCKED] Dispatch workers must not run deploy commands.');
    console.error('');
    console.error(`Command: ${command.slice(0, 80)}`);
    console.error('');
    console.error('This session is a dispatch worker — its cwd is a dispatch');
    console.error('worktree. Deploy is the orchestrator\'s job, run from the main');
    console.error('checkout after merge. A worker deploy ships throwaway worktree');
    console.error('state to production. There is no override. See #472, #463.');
    process.exit(2);
  }

  if (/ALLOW_DIRTY_DEPLOY=1\b/.test(command)) process.exit(0);
  if (process.env.ALLOW_DIRTY_DEPLOY === '1') process.exit(0);

  const cwd = process.cwd();
  const dirty = getDirtyFiles(cwd);
  if (dirty.length === 0) process.exit(0);

  const sessionId = getSessionId(data && data.session_id);
  const edited = getSessionEditedFiles(sessionId, cwd);
  const foreign = findForeignDirty(dirty, edited);

  if (foreign.length === 0) process.exit(0);

  console.error('[BLOCKED] Refusing deploy: working tree contains files this session did not edit.');
  console.error('');
  console.error('Files in the tree but not in this session\'s edit log:');
  for (const f of foreign.slice(0, 20)) console.error(`  ${f}`);
  if (foreign.length > 20) console.error(`  ... and ${foreign.length - 20} more`);
  console.error('');
  console.error('Why this matters: vercel deploy ships the working tree, including');
  console.error('uncommitted files from other sessions. The deploy could carry');
  console.error('half-finished work to production.');
  console.error('');
  console.error('Fix options:');
  console.error('  1. Commit or stash the foreign files first.');
  console.error('  2. Run the deploy from an isolated worktree:');
  console.error('     claude -w deploy');
  console.error('  3. Override after confirming the risk: ALLOW_DIRTY_DEPLOY=1 ' + command.slice(0, 60));
  process.exit(2);
}

if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook(handleHook, { mode: 'gating' });
}

module.exports = {
  matchesDeploy,
  isDispatchWorker,
  getDirtyFiles,
  getSessionEditedFiles,
  findForeignDirty,
  DEPLOY_PATTERNS,
};
