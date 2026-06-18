#!/usr/bin/env node

/**
 * deploy-guard — ensure a deploy worktree runs current, clean code.
 *
 * A scheduled runtime (launchd, cron) calls this before it runs, so merged work
 * actually reaches what executes it. It fetches the tracked remote ref, then:
 *   - clean + current        -> proceed (run the wrapped command, or exit 0)
 *   - clean + behind only    -> fast-forward to the remote ref, then proceed
 *   - dirty / diverged / ahead / wrong-branch / detached -> refuse loudly, exit 1
 *   - fetch failed           -> refuse (currency cannot be verified)
 *
 * The stale command never fires on a refusal. Pull-based by design: the runtime
 * pulls currency before acting, since merges land on origin (the cloud) and
 * nothing local is notified. See #722 and specs/kit/session-isolation.md.
 *
 * `--branch` is the LOCAL branch the deploy tree sits on; `--remote-ref` is the
 * origin ref it tracks for currency (default origin/<branch>). They're decoupled
 * (#726) because the primary checkout already holds `main`, so a deploy worktree
 * lives on its own branch (e.g. `deploy`) while still tracking `origin/main`.
 *
 * Usage:
 *   node deploy-guard.cjs [--branch main] [--remote-ref origin/main] [--cwd <path>] \
 *        [--notify] [--fetch-timeout <ms>] [-- <command> [args...]]
 *
 *   # check-only (compose with &&):
 *   node deploy-guard.cjs --branch main && ./run.sh
 *   # gate-then-exec (no check->run gap):
 *   node deploy-guard.cjs --branch main --notify -- ./run.sh
 *   # deploy worktree on its own branch tracking origin/main:
 *   node deploy-guard.cjs --branch deploy --remote-ref origin/main -- ./run.sh
 *
 * Guarantee boundary: this makes the git checkout current. It does NOT rebuild
 * your environment. If a merge changed dependencies, your runner must re-sync
 * (e.g. `uv sync`, `npm ci`) after the guard passes.
 */

const { spawn, spawnSync } = require('child_process');
const path = require('path');

const {
  classify,
  gitFacts,
  fetchDeploy,
  isSafeBranch,
  isSafeRemoteRef,
  defaultRemoteRef,
  DEFAULT_DEPLOY_BRANCH,
  DEFAULT_FETCH_TIMEOUT_MS,
} = require(path.join(__dirname, '..', 'hooks', 'lib', 'deploy-currency.cjs'));

function parseArgs(argv) {
  const opts = {
    branch: DEFAULT_DEPLOY_BRANCH,
    remoteRef: null,
    cwd: process.cwd(),
    notify: false,
    fetchTimeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
    command: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { opts.command = argv.slice(i + 1); break; }
    else if (a === '--branch') {
      opts.branch = argv[++i];
      if (opts.branch === undefined) throw new Error('--branch requires a value');
      if (!isSafeBranch(opts.branch)) throw new Error(`unsafe branch name: ${opts.branch}`);
    }
    else if (a === '--remote-ref') {
      opts.remoteRef = argv[++i];
      if (opts.remoteRef === undefined) throw new Error('--remote-ref requires a value');
      if (!isSafeRemoteRef(opts.remoteRef)) throw new Error(`unsafe remote ref: ${opts.remoteRef}`);
    }
    else if (a === '--cwd') {
      opts.cwd = argv[++i];
      if (opts.cwd === undefined) throw new Error('--cwd requires a value');
    }
    else if (a === '--notify') opts.notify = true;
    else if (a === '--fetch-timeout') {
      const v = argv[++i];
      if (v === undefined) throw new Error('--fetch-timeout requires a value');
      opts.fetchTimeoutMs = Number(v) || DEFAULT_FETCH_TIMEOUT_MS;
    }
    else throw new Error(`unknown argument: ${a}`);
  }
  if (opts.remoteRef === null) opts.remoteRef = defaultRemoteRef(opts.branch);
  return opts;
}

// Pure decision over a classified verdict. Facts are assumed post-fetch.
function decide(verdict) {
  if (verdict.runnable) return 'run';
  if (verdict.fastForwardable) return 'fast-forward';
  return 'refuse';
}

function refusalText(reasons, { branch, remoteRef, cwd }) {
  const lines = [
    '',
    '========================================',
    'DEPLOY GUARD: REFUSING TO RUN — deploy checkout is not safe',
    '========================================',
    '',
    `Checkout: ${cwd}`,
    `Deploy branch: ${branch}`,
    `Tracking: ${remoteRef || defaultRemoteRef(branch)}`,
    '',
    'Why:',
  ];
  for (const r of reasons) lines.push(`  - ${r}`);
  lines.push('');
  lines.push('The wrapped command did NOT run, so it cannot execute stale or');
  lines.push('half-merged code. Fix the deploy checkout, then it runs on the');
  lines.push('next trigger:');
  lines.push('');
  lines.push('  - dirty:     commit/stash/discard the foreign edits, or deploy');
  lines.push('               from a dedicated worktree that is never hand-edited');
  lines.push('  - diverged:  the deploy worktree has local commits; reset it to');
  lines.push('               origin (it should only ever fast-forward)');
  lines.push('  - behind:    re-run; the guard fast-forwards a clean tree itself');
  lines.push('========================================');
  lines.push('');
  return lines.join('\n');
}

function notify(message) {
  try {
    const script = `display notification "${String(message).replace(/["\\]/g, '\\$&')}" with title "Deploy Guard"`;
    const child = spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {}
}

function fastForward(cwd, remoteRef) {
  const r = spawnSync('git', ['merge', '--ff-only', remoteRef], { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, stderr: (r.stderr || '').trim() };
}

function refuse(reasons, opts) {
  process.stderr.write(refusalText(reasons, opts));
  if (opts.notify) notify(`Refused: ${reasons[0] || 'deploy checkout not safe'}`);
  process.exit(1);
}

function proceed(opts) {
  if (opts.command.length === 0) process.exit(0);
  const r = spawnSync(opts.command[0], opts.command.slice(1), { cwd: opts.cwd, stdio: 'inherit' });
  if (r.error) {
    process.stderr.write(`deploy-guard: failed to exec ${opts.command[0]}: ${r.error.message}\n`);
    process.exit(127);
  }
  process.exit(r.status === null ? 1 : r.status);
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`deploy-guard: ${e.message}\n`);
    process.exit(2);
  }

  const fetched = fetchDeploy(opts.cwd, opts.remoteRef, opts.fetchTimeoutMs);
  if (!fetched.ok) {
    refuse([`could not fetch ${opts.remoteRef} to verify currency (${fetched.reason}${fetched.stderr ? ': ' + fetched.stderr : ''})`], opts);
    return;
  }

  let verdict = classify(gitFacts(opts.cwd, opts.branch, opts.remoteRef));
  let action = decide(verdict);

  if (action === 'fast-forward') {
    const ff = fastForward(opts.cwd, opts.remoteRef);
    if (!ff.ok) {
      refuse([`fast-forward to ${opts.remoteRef} failed${ff.stderr ? ': ' + ff.stderr : ''}`], opts);
      return;
    }
    verdict = classify(gitFacts(opts.cwd, opts.branch, opts.remoteRef));
    action = decide(verdict);
  }

  if (action === 'run') {
    proceed(opts);
    return;
  }
  refuse(verdict.reasons, opts);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { parseArgs, decide, refusalText, fastForward };
