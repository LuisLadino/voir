/**
 * Deploy-currency evaluator. Shared core for the deploy-guard CLI
 * (.claude/scripts/deploy-guard.cjs) and the deploy-drift SessionStart warning
 * (.claude/hooks/context/deploy-drift-warning.cjs).
 *
 * Parallel Conductor sessions merge to origin/<deployBranch> from isolated
 * worktrees that never touch the deploy checkout. A long-lived deploy worktree
 * therefore drifts behind origin and accumulates uncommitted edits that block
 * even a fast-forward, so a scheduled runtime runs stale code with no signal.
 * See #722 and specs/kit/session-isolation.md (Layer 5).
 *
 * Split per engineering-principles: `classify` is a pure function of git facts;
 * `gitFacts` and `fetchDeploy` are the IO edge that gathers those facts. The
 * guard fetches first (authoritative); the warning reads local refs only (no
 * per-session network tax).
 */

const { spawnSync } = require('child_process');

const DEFAULT_DEPLOY_BRANCH = 'main';
const DEFAULT_REMOTE = 'origin';
const DEFAULT_FETCH_TIMEOUT_MS = 5000;

function git(cwd, args, opts = {}) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', ...opts });
}

// A branch name passed as a bare positional git argument (e.g. `git fetch
// origin <branch>`) is parsed as an option when it starts with `-`. A value
// like `--upload-pack=<cmd>` then executes against a local-path remote. Reject
// anything that is not a plain ref token before it reaches a git invocation.
function isSafeBranch(name) {
  return typeof name === 'string' &&
    /^[A-Za-z0-9._][A-Za-z0-9._/+-]*$/.test(name) &&
    !name.includes('..'); // git refname format forbids '..'
}

// The remote ref the deploy tree tracks for currency, decoupled from the local
// branch it sits on (#726). The local branch can't always be the deploy branch:
// the primary checkout already holds `main`, and git refuses to check out one
// branch in two worktrees. So a deploy worktree lives on its own branch (e.g.
// `deploy`) while still tracking `origin/main`. Default keeps the old behavior:
// origin/<deployBranch>.
function defaultRemoteRef(deployBranch = DEFAULT_DEPLOY_BRANCH) {
  return `${DEFAULT_REMOTE}/${deployBranch}`;
}

// "origin/main" -> { remote: "origin", branch: "main" }. Splits on the first
// slash so branch names with slashes (release/1.2) survive.
function parseRemoteRef(ref) {
  if (typeof ref !== 'string') return null;
  const i = ref.indexOf('/');
  if (i <= 0 || i === ref.length - 1) return null;
  return { remote: ref.slice(0, i), branch: ref.slice(i + 1) };
}

function isSafeRemoteRef(ref) {
  const p = parseRemoteRef(ref);
  return !!p && isSafeBranch(p.remote) && isSafeBranch(p.branch);
}

// Best-effort fetch of the tracked remote branch. The guard calls this before
// gathering facts so behind/ahead are authoritative. Bounded by a hard timeout
// so an offline or hung remote can never wedge the caller. Returns the outcome
// rather than throwing — the guard decides policy (fail-safe: refuse to run
// when currency cannot be verified).
function fetchDeploy(cwd, remoteRef = defaultRemoteRef(), timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const p = parseRemoteRef(remoteRef);
  if (!p || !isSafeRemoteRef(remoteRef)) return { ok: false, reason: 'unsafe remote ref' };
  const r = git(cwd, ['fetch', p.remote, p.branch], { timeout: timeoutMs });
  if (r.error && r.error.code === 'ETIMEDOUT') return { ok: false, reason: 'timeout' };
  if (r.status !== 0) return { ok: false, reason: 'error', stderr: (r.stderr || '').trim() };
  return { ok: true };
}

function isGitRepo(cwd) {
  const r = git(cwd, ['rev-parse', '--is-inside-work-tree']);
  return r.status === 0 && /true/.test(r.stdout || '');
}

function currentBranch(cwd) {
  const r = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (r.status !== 0) return null;
  const b = (r.stdout || '').trim();
  return b === 'HEAD' ? null : b; // 'HEAD' means detached
}

function originRefExists(cwd, remoteRef) {
  const r = git(cwd, ['rev-parse', '--verify', '--quiet', `refs/remotes/${remoteRef}`]);
  return r.status === 0;
}

function dirtyFiles(cwd) {
  const r = git(cwd, ['status', '--porcelain']);
  if (r.status !== 0) return [];
  return (r.stdout || '')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const trimmed = line.slice(3);
      const renamed = trimmed.split(' -> ');
      return renamed[renamed.length - 1].trim().replace(/^"|"$/g, '');
    });
}

// `git rev-list --left-right --count <remoteRef>...HEAD` prints "behind\tahead":
// left side (remote-only) = how far HEAD is behind; right side (HEAD-only) = ahead.
function aheadBehind(cwd, remoteRef) {
  const r = git(cwd, ['rev-list', '--left-right', '--count', `${remoteRef}...HEAD`]);
  if (r.status !== 0) return { behind: 0, ahead: 0, known: false };
  const m = (r.stdout || '').trim().split(/\s+/);
  const behind = Number(m[0]);
  const ahead = Number(m[1]);
  if (!Number.isFinite(behind) || !Number.isFinite(ahead)) return { behind: 0, ahead: 0, known: false };
  return { behind, ahead, known: true };
}

// IO edge. Gathers everything `classify` needs. No fetch — call `fetchDeploy`
// first when you need authoritative remote state. `deployBranch` is the LOCAL
// branch the tree must be on; `remoteRef` is the origin ref tracked for
// currency (default origin/<deployBranch>, decoupled per #726).
function gitFacts(cwd, deployBranch = DEFAULT_DEPLOY_BRANCH, remoteRef = defaultRemoteRef(deployBranch)) {
  if (!isGitRepo(cwd)) {
    return { isGit: false, deployBranch, remoteRef, branch: null, hasOriginRef: false, dirtyFiles: [], behind: 0, ahead: 0, aheadBehindKnown: false };
  }
  const branch = currentBranch(cwd);
  const hasOriginRef = originRefExists(cwd, remoteRef);
  const dirty = dirtyFiles(cwd);
  const ab = hasOriginRef ? aheadBehind(cwd, remoteRef) : { behind: 0, ahead: 0, known: false };
  return {
    isGit: true,
    deployBranch,
    remoteRef,
    branch,
    hasOriginRef,
    dirtyFiles: dirty,
    behind: ab.behind,
    ahead: ab.ahead,
    aheadBehindKnown: ab.known,
  };
}

// Pure core. Maps git facts to a verdict both consumers interpret.
function classify(facts) {
  const deployBranch = facts.deployBranch || DEFAULT_DEPLOY_BRANCH;
  const remoteRef = facts.remoteRef || defaultRemoteRef(deployBranch);
  const applicable = !!facts.isGit;
  const detached = applicable && facts.branch === null;
  const onDeployBranch = applicable && facts.branch === deployBranch;
  const dirtyList = facts.dirtyFiles || [];
  const dirty = dirtyList.length > 0;
  const behind = facts.behind || 0;
  const ahead = facts.ahead || 0;
  const diverged = behind > 0 && ahead > 0;
  const current = behind === 0 && ahead === 0;
  // remote ref exists but `git rev-list` could not compute ahead/behind: the
  // counts are a zeroed fallback, not a verified "current". Treat as unverified
  // so a rev-list failure can never flip refuse into run. Fail-safe.
  const aheadBehindUnknown = !!facts.hasOriginRef && facts.aheadBehindKnown === false;

  const reasons = [];
  if (!applicable) reasons.push('not a git repository');
  else {
    if (detached) reasons.push(`HEAD is detached, not on deploy branch ${deployBranch}`);
    else if (!onDeployBranch) reasons.push(`on branch ${facts.branch}, expected deploy branch ${deployBranch}`);
    if (dirty) reasons.push(`working tree has ${dirtyList.length} uncommitted/untracked file(s)`);
    if (!facts.hasOriginRef) reasons.push(`${remoteRef} not found locally (fetch required to verify currency)`);
    else if (aheadBehindUnknown) reasons.push(`could not compute ahead/behind vs ${remoteRef} (currency unverified)`);
    else if (diverged) reasons.push(`diverged from ${remoteRef}: ${behind} behind, ${ahead} ahead (cannot fast-forward)`);
    else if (ahead > 0) reasons.push(`ahead of ${remoteRef} by ${ahead} local commit(s) not pushed`);
    else if (behind > 0) reasons.push(`behind ${remoteRef} by ${behind} commit(s)`);
  }

  const runnable = applicable && onDeployBranch && !dirty && facts.hasOriginRef && !aheadBehindUnknown && current;
  const fastForwardable = applicable && onDeployBranch && !dirty && facts.hasOriginRef && !aheadBehindUnknown && behind > 0 && ahead === 0;

  return {
    applicable,
    deployBranch,
    remoteRef,
    branch: facts.branch,
    detached,
    onDeployBranch,
    hasOriginRef: !!facts.hasOriginRef,
    dirty,
    dirtyFiles: dirtyList,
    behind,
    ahead,
    diverged,
    current,
    aheadBehindUnknown,
    runnable,
    fastForwardable,
    reasons,
  };
}

module.exports = {
  classify,
  gitFacts,
  fetchDeploy,
  isGitRepo,
  isSafeBranch,
  isSafeRemoteRef,
  parseRemoteRef,
  defaultRemoteRef,
  currentBranch,
  originRefExists,
  dirtyFiles,
  aheadBehind,
  DEFAULT_DEPLOY_BRANCH,
  DEFAULT_REMOTE,
  DEFAULT_FETCH_TIMEOUT_MS,
};
