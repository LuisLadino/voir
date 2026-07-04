#!/usr/bin/env node

/**
 * Check Spec Conformance Hook
 *
 * Event: PreToolUse (Bash)
 * Matchers: Bash(*git commit*), Bash(*git push*), Bash(*gh pr create*)
 * Purpose: Block content that violates a documented spec rule before it
 *          reaches the remote. Two gates share one script:
 *            commit → scans the staged diff (`git diff --cached`).
 *            push   → scans the commits each pushed ref adds over its base.
 *
 * The push gate catches violations the commit gate never saw: commits
 * made outside Claude Code's Bash tool, `--no-verify` bypasses of git's
 * own hooks, and manual edits after a gated commit. Push is the boundary
 * where content leaves the machine, so it is the last place to catch them.
 *
 * The push gate scans the ref the command actually pushes, not just the
 * checked-out HEAD. `git push origin feature` scans `feature` even when
 * another branch is checked out. Source refs are read from the command's
 * refspecs (`src:dst` → `src`, bare `ref` → `ref`), defaulting to HEAD when
 * none is given. `gh pr create` scans HEAD, the branch the PR is opened for.
 *
 * Command parsing is shell-aware enough to avoid false negatives: the
 * command is split on `&&`/`||`/`;`/`|`/newline, on `(`/`)`/backtick
 * subshell and command-substitution boundaries, and on `#` comments, so a
 * `:token` in a comment, a second push in a chain, or a push wrapped in
 * `$(...)` cannot mislead the scan; surrounding quotes are stripped from
 * refspecs; and value-taking flags (`-o`, `--repo`, etc.) are skipped so
 * their argument is not read as a refspec. A ref that still does not
 * resolve to a commit, a `$BRANCH` shell variable for example, falls back
 * to scanning HEAD rather than scanning nothing. Every real push in a
 * chain is scanned; the command is skipped only when every push it
 * contains carries no file content. A combined `git commit && git push` is
 * scanned on both surfaces, the staged diff and the push range, since each
 * can carry content the other does not.
 *
 * Known limitation: a shell variable cannot be expanded from the command
 * string, so `git push origin $BRANCH` only resolves when $BRANCH is the
 * checked-out branch (the HEAD fallback). A variable that expands to a
 * different, unchecked-out branch is not scanned. The matcher-level gaps
 * the commit gate already has apply equally here: `git -C <dir> push` and
 * `git -c k=v push` do not contain the literal `git push` substring, so
 * neither the settings matcher nor isGitPush fires.
 *
 * Per-ref base resolution, in order:
 *   1. the ref's own upstream (`ref@{upstream}`) when it tracks a remote;
 *   2. the same-named remote-tracking ref (`origin/<ref>`) when it exists;
 *   3. the remote default branch (`origin/HEAD`) for a first push and for
 *      `gh pr create` on an unpushed branch;
 *   4. nothing resolvable → that ref is skipped (fail open).
 * The diff is three-dot (base...ref): it runs from the merge-base to the
 * ref, matches GitHub's PR diff, and collapses to the plain ahead-of-base
 * diff on a fast-forward push.
 *
 * Force-push does not bypass the scan. The ref's content is still diffed
 * against its base and scanned; a force-push can only overwrite remote
 * history, which is auditable through the remote reflog. Pushes that carry
 * no incoming file content are skipped: ref deletions (`--delete`, `-d`,
 * a `:branch` refspec), `--dry-run`, and tag-only pushes.
 *
 * Rules live in spec frontmatter as `conformance_rules: [...]`. Each rule
 * is a regex applied to added lines of the relevant diff. See
 * .claude/specs/claude-code/spec-format.md (Conformance Rules section)
 * for the schema and authoring guidance.
 *
 * Failure modes:
 * - No specs declare rules → exit 0
 * - No diff (nothing staged / nothing pending push) → exit 0
 * - Diff contains no violations → exit 0
 * - One or more violations → exit 2 with a per-file report
 * - Internal error (regex compile failed mid-load, etc) → log, exit 0
 *   The gate fails open on its own bug. A typo in a rule cannot freeze
 *   the workflow. Test coverage in lib/spec-conformance.test.cjs.
 */

const { spawnSync } = require('child_process');

const {
  loadSpecsWithRules,
  parseDiff,
  findViolations,
  formatReport
} = require('../lib/spec-conformance.cjs');
const { runStdinHook } = require('../lib/stdin-hook.cjs');
const { atCommandPosition } = require('../lib/command-position.cjs');

// `git push` flags that consume the following token as their value. The
// value must not be mistaken for the remote or a refspec.
const PUSH_VALUE_FLAGS = new Set([
  '-o', '--push-option', '--repo', '--receive-pack', '--exec'
]);

// Anchored at a command position so the scan fires on a real git/gh command,
// not on the phrase inside a quoted argument (`echo "git commit"`,
// `grep "git push" log`). `$(...)`/backtick command substitution still counts
// as a command position, so a push hidden in `x=$(git push ...)` is scanned —
// matching the refspec parser below, which segments on the same boundaries.
// The settings matchers are coarse substring pre-filters only (#642).
function isGitCommit(command) {
  return atCommandPosition(command, String.raw`git\s+commit\b`, 'i');
}

function isGitPush(command) {
  return atCommandPosition(command, String.raw`git\s+push\b`, 'i');
}

function isPrCreate(command) {
  return atCommandPosition(command, String.raw`gh\s+pr\s+create\b`, 'i');
}

function git(args, cwd) {
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  if (res.status !== 0) return null;
  return res.stdout || '';
}

function getStagedDiff(cwd) {
  return git(['diff', '--cached', '--no-color', '-U0'], cwd) || '';
}

// Token-level dequote: strip one leading and one trailing quote char from an
// already-split refspec token. Deliberately NOT the shared stripQuotedRegions
// in command-position.cjs — that blanks whole quoted REGIONS in a full command
// string, whereas this dequotes a single token after splitting. Different
// operation, kept local on purpose (#769).
function stripQuotes(token) {
  return token.replace(/^['"]/, '').replace(/['"]$/, '');
}

/**
 * Parse the argument string of one `git push` invocation into a plan:
 *   { skip: true }            no file content — dry-run, deletion, tag-only
 *   { refs: [...] }           local source refs to scan
 *   { refs: 'ALL_BRANCHES' }  --all / --mirror, resolved to refs/heads later
 */
function parsePushArgs(argString) {
  const tokens = argString.split(/\s+/).filter(Boolean);
  const flags = new Set();
  const positionals = [];
  let skipNext = false;
  for (const t of tokens) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (t.startsWith('-')) {
      const name = t.split('=')[0];
      flags.add(name);
      if (PUSH_VALUE_FLAGS.has(name) && !t.includes('=')) skipNext = true;
      continue;
    }
    positionals.push(stripQuotes(t));
  }
  if (flags.has('--dry-run') || flags.has('-n')) return { skip: true };
  if (flags.has('--delete') || flags.has('-d')) return { skip: true };
  const refspecs = positionals.slice(1); // positionals[0] is the remote
  const srcs = [];
  for (let r of refspecs) {
    r = r.replace(/^\+/, ''); // strip force prefix
    if (r === '' || r.startsWith(':')) continue; // `:dst` deletes, no source
    srcs.push(r.split(':')[0]);
  }
  if (srcs.length > 0) return { refs: srcs };
  if (refspecs.length > 0) return { skip: true }; // every refspec was a deletion
  if (flags.has('--all') || flags.has('--mirror')) return { refs: 'ALL_BRANCHES' };
  if (flags.has('--tags')) return { skip: true }; // tags carry no new file content
  return { refs: ['HEAD'] };
}

// One plan per `git push` invocation in the command, isolated from chained
// commands and comments so each push is parsed against its own args alone.
function pushPlans(command) {
  if (typeof command !== 'string') return [];
  const plans = [];
  for (let segment of command.split(/&&|\|\||;|\n|\||[()`]/)) {
    segment = segment.split('#')[0];
    const m = segment.match(/\bgit\s+push\b(.*)$/i);
    if (!m) continue;
    plans.push(parsePushArgs(m[1]));
  }
  return plans;
}

function allLocalBranches(cwd) {
  const out = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], cwd);
  return (out || '').split('\n').map(s => s.trim()).filter(Boolean);
}

function refsForCommand(command, cwd) {
  const plans = pushPlans(command);
  if (plans.length === 0) {
    // No `git push` segment (e.g. gh pr create) → scan the current branch.
    return ['HEAD'];
  }
  const nonSkip = plans.filter(p => !p.skip);
  if (nonSkip.length === 0) return null; // every push carries no file content
  const refs = new Set();
  for (const plan of nonSkip) {
    if (plan.refs === 'ALL_BRANCHES') {
      for (const branch of allLocalBranches(cwd)) refs.add(branch);
    } else {
      for (const ref of plan.refs) refs.add(ref);
    }
  }
  return [...refs];
}

function resolveBase(ref, cwd) {
  const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${ref}@{upstream}`], cwd);
  if (upstream && upstream.trim()) return upstream.trim();
  if (ref !== 'HEAD') {
    const tracked = git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${ref}`], cwd);
    if (tracked && tracked.trim()) return `origin/${ref}`;
  }
  const originHead = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd);
  if (originHead && originHead.trim()) return originHead.trim();
  return null;
}

function refExists(ref, cwd) {
  const out = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd);
  return !!(out && out.trim());
}

function diffRefAgainstBase(ref, cwd) {
  const base = resolveBase(ref, cwd);
  if (!base) return null;
  return git(['diff', '--no-color', '-U0', `${base}...${ref}`], cwd);
}

function getPushDiff(cwd, command) {
  const refs = refsForCommand(command, cwd);
  if (!refs) return '';
  const parts = [];
  let scanned = 0;
  for (const ref of refs) {
    if (!refExists(ref, cwd)) continue; // shell var, mangled token, or typo
    scanned++;
    const diff = diffRefAgainstBase(ref, cwd);
    if (diff) parts.push(diff);
  }
  if (scanned === 0 && !refs.includes('HEAD')) {
    // No named ref resolved (e.g. `$BRANCH`, a token fused to shell syntax).
    // Fall back to HEAD so an unresolvable ref never means "scan nothing".
    const diff = diffRefAgainstBase('HEAD', cwd);
    if (diff) parts.push(diff);
  }
  return parts.join('\n');
}

function scanDiff(diff, cwd) {
  const specs = loadSpecsWithRules(cwd);
  if (specs.length === 0) {
    process.exit(0);
  }
  if (!diff) {
    process.exit(0);
  }
  const entries = parseDiff(diff);
  if (entries.length === 0) {
    process.exit(0);
  }
  const { violations, aborted } = findViolations(entries, specs);
  if (aborted) {
    process.exit(0);
  }
  if (violations.length === 0) {
    process.exit(0);
  }
  console.error(formatReport(violations));
  process.exit(2);
}

function handleHook(data) {
  const command = data && data.tool_input && data.tool_input.command;
  const cwd = process.cwd();
  // A command can be both (e.g. `git commit && git push`). The staged diff
  // and the push range are different surfaces, so scan whichever apply.
  const diffs = [];
  if (isGitCommit(command)) diffs.push(getStagedDiff(cwd));
  if (isGitPush(command) || isPrCreate(command)) diffs.push(getPushDiff(cwd, command));
  if (diffs.length === 0) {
    process.exit(0);
  }
  scanDiff(diffs.filter(Boolean).join('\n'), cwd);
}

if (require.main === module) {
  runStdinHook(handleHook, { mode: 'gating' });
}

module.exports = {
  handleHook,
  isGitCommit,
  isGitPush,
  isPrCreate,
  parsePushArgs,
  pushPlans,
  refExists,
  getStagedDiff,
  getPushDiff,
  resolveBase
};
