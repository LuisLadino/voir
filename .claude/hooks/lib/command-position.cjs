#!/usr/bin/env node

/**
 * Command-position anchoring for matcher-gated Bash hooks.
 *
 * Settings matchers like `Bash(*git commit*)` are coarse substring globs: they
 * fire whenever the phrase appears anywhere in the command, including inside a
 * quoted argument, a heredoc, or a `node -e` script that merely contains the
 * words. A matcher cannot be anchored, so the precision lives here — a gate
 * re-checks that the phrase sits at an actual command position before
 * enforcing, and treats the matcher as a cheap pre-filter only.
 *
 * "Command position" = start-of-string, immediately after a shell command
 * separator (newline ; & |), inside a `$(...)` or backtick command
 * substitution, optionally preceded by VAR=val assignment prefixes. So
 * `git commit`, `FOO=1 git commit`, `a && git commit`, and `x=$(git commit)`
 * match, while `echo "git commit"`, `node -e 'git commit'`, and the phrase in
 * any other quoted argument do not. A bare `(` (a literal paren inside quoted
 * text) is deliberately NOT a boundary — only `$(` is — so `echo "(git
 * commit)"` does not trip a gate.
 *
 * First derived inline in concurrent-session-gate.cjs (#630); extracted here so
 * enforce-skills, enforce-plan, check-spec-conformance, and the gate share one
 * anchoring implementation rather than each re-deriving it (#642). The sibling
 * discipline for UserPromptSubmit prompt triggers is escapeRegex + word
 * boundaries; see .claude/specs/kit/injection-precision.md.
 */

// Boundary: start, a shell separator, or a `$(` / backtick command-substitution
// open — optionally followed by `VAR=val ` assignment prefixes. Built as a
// plain string (not String.raw) because the class contains a literal backtick,
// which would close a template literal.
const LEAD = '(?:^|[\\n;&|]|\\$\\(|`)\\s*(?:[A-Za-z_]\\w*=\\S*\\s+)*';

/**
 * True when `coreSource` (a regex source for a command, e.g.
 * String.raw`git\s+commit\b`) matches at a command position in `command`.
 * `coreSource` must NOT carry its own start-anchor; LEAD supplies it.
 *
 * @param {string} command     the raw Bash command
 * @param {string} coreSource  regex source without a start-anchor
 * @param {string} [flags]     extra RegExp flags, e.g. 'i'
 * @returns {boolean}
 */
function atCommandPosition(command, coreSource, flags = '') {
  if (typeof command !== 'string') return false;
  return new RegExp(LEAD + coreSource, flags).test(command);
}

module.exports = { LEAD, atCommandPosition };
