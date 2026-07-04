#!/usr/bin/env node

/**
 * Shared git-worktree mechanics (#809).
 *
 * The pure `git worktree add / remove / prune` + `branch -D` dance, used by both
 * dispatch.cjs (autonomous workers) and kit-fleet.cjs (#759 fleet rollout). #759
 * deliberately copied dispatch's pattern rather than refactor the just-hardened
 * dispatch chokepoint mid-feature (#793/#798/#805); this collapses the two copies
 * now that gate has cleared.
 *
 * NOT the retired interactive worktree CLI (`.claude/scripts/worktree.cjs` + the
 * /worktree skill, retired in #714 for native `claude -w` + Conductor). Same word,
 * different thing: this is a pure library of git mechanics — no CLI, no interactive
 * posture, no skill.
 *
 * Every function returns a normalized result and NEVER throws or prints. Callers
 * keep their own error policy (dispatch throws / logs; kit-fleet shapes result
 * objects). Defaults reproduce dispatch's behavior exactly — `-b` create-fail-if-
 * exists, existence-guarded remove, branch delete only on a clean remove, no prune.
 * kit-fleet opts into its variations explicitly (`-B` reset, unconditional remove,
 * prune).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Normalized command runner: {status, stdout, stderr}, null status coerced to 1,
// string fields defaulted. spawnSync's native return already has this shape, so
// wrapping an injected raw spawnSync (dispatch's test seam) is idempotent.
function makeRunner(spawnImpl = spawnSync) {
  return (cmd, args, opts = {}) => {
    const r = spawnImpl(cmd, args, { encoding: 'utf8', ...opts });
    return {
      status: r && r.status != null ? r.status : 1,
      stdout: (r && r.stdout) || '',
      stderr: (r && r.stderr) || ''
    };
  };
}

// git worktree add. reset=false → -b (create, fail if the branch exists; dispatch's
// safety). reset=true → -B (create or reset; kit-fleet regenerates a bot-owned
// branch off fresh origin each run). Ensures the parent dir exists, then adds.
// Returns the normalized add result; the caller decides throw-vs-report.
function add({ repo, path: wtPath, branch, base, reset = false, run }) {
  const r = run || makeRunner();
  fs.mkdirSync(path.dirname(wtPath), { recursive: true });
  const flag = reset ? '-B' : '-b';
  return r('git', ['worktree', 'add', flag, branch, wtPath, base], { cwd: repo });
}

// git worktree remove --force, plus optional prune and branch delete.
//   pidGuard {pid, isAlive}: when the worker pid is still alive, refuse to reap and
//     return {skipped:true} — the #791 defense that a still-writing worker's
//     worktree is never deleted out from under it.
//   requireExists (default true, dispatch's behavior): skip the remove when the
//     worktree dir is gone. kit-fleet passes false so its unconditional teardown and
//     pre-add clear still prune a registration whose dir was manually deleted.
//   prune: run `git worktree prune` after the remove (regardless of its status, so a
//     stale registration is cleared even when the dir was already gone).
//   branch: best-effort `git branch -D` only after a clean remove — never delete a
//     branch whose worktree we failed to remove (git refuses it anyway).
// Returns {removed, skipped, reason}; the caller does its own logging.
function safeRemove({ repo, path: wtPath, branch, pidGuard, prune = false, requireExists = true, run }) {
  const r = run || makeRunner();
  if (pidGuard && typeof pidGuard.pid === 'number' && pidGuard.isAlive(pidGuard.pid)) {
    return { removed: false, skipped: true };
  }
  if (requireExists && !fs.existsSync(wtPath)) {
    return { removed: false, skipped: false, missing: true };
  }
  const res = r('git', ['worktree', 'remove', wtPath, '--force'], { cwd: repo });
  if (prune) r('git', ['worktree', 'prune'], { cwd: repo });
  if (res.status !== 0) {
    return { removed: false, skipped: false, reason: (res.stderr || res.stdout || '').trim() };
  }
  if (branch) {
    try { r('git', ['branch', '-D', branch], { cwd: repo }); } catch { /* best effort */ }
  }
  return { removed: true, skipped: false };
}

// git worktree prune for one repo. Best-effort: a failure never propagates.
function prune({ repo, run }) {
  const r = run || makeRunner();
  try { return r('git', ['worktree', 'prune'], { cwd: repo }); }
  catch { return { status: 1, stdout: '', stderr: '' }; }
}

module.exports = { makeRunner, add, safeRemove, prune };
