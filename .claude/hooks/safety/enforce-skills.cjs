#!/usr/bin/env node

/**
 * Enforce Skills Hook
 *
 * Event: PreToolUse (Bash)
 * Purpose: Block direct execution of commands that have skill workflows
 *
 * Problem: Skills trigger via LLM judgment, which undertriggers ~80% of the time.
 * Solution: Block the underlying action and force proper skill invocation.
 *
 * This is a "paved road" pattern - make the right thing easy and the wrong thing hard.
 * The skill handles pre-checks, documentation updates, and proper formatting.
 */

const {
  stripCommandContent,
  getSessionId,
  readTrackingEvents
} = require('../lib/session-utils.cjs');
const { spawnSync } = require('child_process');
const { atCommandPosition } = require('../lib/command-position.cjs');

// `git commit` at a command position: start, after a separator, after VAR=
// assignments, or inside `$(...)`/backticks — but NOT the phrase buried in a
// quoted argument (`node -e 'git commit'`, `echo "git commit"`). The settings
// matcher `Bash(*git commit*)` is a coarse substring pre-filter; the precision
// is here (#642).
const GIT_COMMIT_CORE = String.raw`git\s+commit\b`;

const SKILL_COMMANDS = [
  {
    core: GIT_COMMIT_CORE,
    skill: 'commit',
    reason: 'Use the commit skill for proper workflow (version-control.md, CHANGELOG, push, PR)',
    instruction: 'Invoke: Skill(skill: "commit")'
  }
  // Note: gh pr create is NOT blocked because the commit skill runs it internally.
  // Blocking git commit is sufficient - it's the entry point to the workflow.
];

// True when the (content-stripped) command actually runs `git commit` at a
// command position, not merely mentions it in an argument.
function isCommitCommand(command) {
  return atCommandPosition(stripCommandContent(command), GIT_COMMIT_CORE, 'i');
}

// Branch-shift guard (#451 Phase 4). The branch a commit lands on must be
// the branch the session started on, unless this session explicitly checked
// out the current branch. Catches a concurrent session switching branches in
// a shared checkout, which would otherwise land a commit on the wrong branch.

function currentBranch(cwd) {
  try {
    const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8' });
    if (r.status === 0) return r.stdout.trim();
  } catch {}
  return null;
}

function getStartingBranch(sessionId, cwd) {
  try {
    const events = readTrackingEvents(sessionId, cwd);
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === 'session_branch_baseline') return events[i].branch;
    }
  } catch {}
  return null;
}

function sessionCheckedOutNewBranch(sessionId, cwd, targetBranch) {
  try {
    const events = readTrackingEvents(sessionId, cwd);
    const escapedBranch = targetBranch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`git\\s+(?:checkout(?:\\s+-b)?|switch(?:\\s+-c)?)\\s+(?:--\\s+)?(${escapedBranch})\\b`);
    for (const ev of events) {
      const cmd = ev.command || (ev.tool_input && ev.tool_input.command) || '';
      if (re.test(cmd)) return true;
    }
  } catch {}
  return false;
}

function checkBranchShift(command, cwd, sessionId) {
  if (process.env.BRANCH_VERIFIED === '1') return { ok: true };
  if (/BRANCH_VERIFIED=1\b/.test(command)) return { ok: true };

  const starting = getStartingBranch(sessionId, cwd);
  const current = currentBranch(cwd);
  if (!starting || !current) return { ok: true };
  if (starting === current) return { ok: true };
  if (sessionCheckedOutNewBranch(sessionId, cwd, current)) return { ok: true };

  return { ok: false, starting, current };
}

if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook(handleHook, { mode: 'gating' });
}

function handleHook(data) {
  const { tool_input } = data;
  const command = tool_input?.command;

  if (!command) {
    process.exit(0);
  }

  const commandToCheck = stripCommandContent(command);

  // Allow commands with SKILL_ACTIVE marker (set by skills to bypass enforcement)
  if (command.includes('SKILL_ACTIVE=1')) {
    if (isCommitCommand(command)) {
      // Check if documentation was verified (DOCS_CHECKED marker)
      if (!command.includes('DOCS_CHECKED=1')) {
        console.error('[DOCUMENTATION CHECK REQUIRED] You are committing via the commit skill but skipped the documentation check.');
        console.error('');
        console.error('Go back to Step 3 of the commit skill:');
        console.error('1. Read CHANGELOG.md and README.md (if they exist)');
        console.error('2. Update what is stale');
        console.error('3. Output a DOCUMENTATION CHECK report');
        console.error('4. Then commit with: SKILL_ACTIVE=1 DOCS_CHECKED=1 git commit ...');
        process.exit(2);
      }
      // Check the commit lands on the session's branch (#451 Phase 4)
      const sessionId = getSessionId(data && data.session_id);
      const cwd = process.cwd();
      const shift = checkBranchShift(command, cwd, sessionId);
      if (!shift.ok) {
        console.error('[BRANCH SHIFTED] The current branch is not the branch this session started on.');
        console.error('');
        console.error(`  Started on:  ${shift.starting}`);
        console.error(`  Currently:   ${shift.current}`);
        console.error('');
        console.error('This session did not explicitly check out the current branch.');
        console.error('Another concurrent session may have switched branches in this checkout.');
        console.error('A commit here would land on the wrong branch.');
        console.error('');
        console.error('Fix options:');
        console.error(`  1. Switch back: git checkout ${shift.starting}`);
        console.error('  2. Confirm the new branch is intentional and re-commit with:');
        console.error('     SKILL_ACTIVE=1 DOCS_CHECKED=1 BRANCH_VERIFIED=1 git commit ...');
        console.error('  3. Move to an isolated worktree:');
        console.error(`     claude -w ${shift.current}`);
        process.exit(2);
      }
    }
    process.exit(0);
  }

  // Check if this command should use a skill instead
  for (const { core, skill, reason, instruction } of SKILL_COMMANDS) {
    if (atCommandPosition(commandToCheck, core, 'i')) {
      // Output denial message
      console.error(`[WORKFLOW REQUIRED] ${reason}`);
      console.error(`Blocked command: ${command}`);
      console.error('');
      console.error(instruction);
      console.error('');
      console.error('The skill handles:');
      console.error('- Reading version-control.md for commit format');
      console.error('- Updating CHANGELOG and related docs');
      console.error('- Push to remote');
      console.error('- Create PR with proper format');

      // Exit code 2 = deny the tool call
      process.exit(2);
    }
  }

  // Command is allowed, let it through
  process.exit(0);
}

module.exports = {
  checkBranchShift,
  currentBranch,
  getStartingBranch,
  sessionCheckedOutNewBranch,
  isCommitCommand,
};
