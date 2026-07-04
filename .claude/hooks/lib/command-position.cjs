#!/usr/bin/env node

/**
 * Command-position anchoring and the shared lexical strippers for the kit's
 * matcher-gated Bash hooks.
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
 * This module is also the single home for the two lexical strippers the Bash
 * gates use to neutralize data regions before a pattern match — `stripHeredocs`
 * (heredoc bodies) and `stripQuotedRegions` (quoted text). They were re-derived
 * five times across the gate family (#754, #764); consolidating them here means
 * one heredoc/quote parsing fix lands in one place rather than drifting across
 * copies (#769). Each gate opts into the semantics it needs via options. The
 * two documented exceptions that do NOT use these: `stripCommandContent` in
 * session-utils.cjs layers content-flag truncation on top of stripHeredocs, and
 * `stripQuotes` in check-spec-conformance.cjs is a token-level dequote, not a
 * region stripper. All heuristics, not a shell parser.
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

// One canonical heredoc span, the union of every form the gate family handled
// separately before #769: `<<` or `<<-` (tab-suppress), an optional MATCHING
// quote around the delimiter word (`<<'EOF'`, `<<"EOF"`), the rest of the
// operator line (same-line redirects/pipes), the body lines, then the closing
// delimiter. The close tolerates `<<-` tab indentation and a trailing `)` for a
// command-substitution heredoc (`$(cat <<EOF\n...\nEOF)`); the closing newline
// is left in place (lookahead, not consumed). Heuristic, not a shell parser:
// one heredoc per operator line, balanced delimiter quotes; unbalanced quotes
// and a second same-line heredoc fall through unstripped.
const HEREDOC_RE =
  /(<<-?[ \t]*(['"]?)(\w+)\2[^\n]*\n)(?:[^\n]*\n)*?[ \t]*\3[ \t]*(?:\)[^\n]*)?(?=\n|$)/g;

/**
 * Strip heredoc bodies so body text is never read as shell syntax. Modes:
 *   'preserve-operator' (default) — keep the operator line so a same-line
 *     redirect or pipe (`cat <<EOF | git commit`, `cat <<EOF > /path`) still
 *     matches; drop only the body and closing delimiter.
 *   'placeholder' — replace the whole `<<DELIM ... DELIM` span (from `<<`
 *     onward) with `placeholder`, so a scanner sees one inert token.
 *
 * @param {string} command
 * @param {{mode?: 'preserve-operator'|'placeholder', placeholder?: string}} [options]
 * @returns {string}
 */
function stripHeredocs(command, options = {}) {
  if (typeof command !== 'string') return '';
  const { mode = 'preserve-operator', placeholder = '<<HEREDOC_STRIPPED' } = options;
  return command.replace(HEREDOC_RE, mode === 'placeholder' ? placeholder : '$1');
}

/**
 * Blank single- and double-quoted regions so a separator or gated phrase inside
 * quotes is not read as real shell structure. Options:
 *   preserveSubstitutions: false (default) — remove the quoted region outright.
 *     For tests that care only about unquoted structure (pbcopy sink).
 *   preserveSubstitutions: true — keep any `$(...)`/backtick command
 *     substitution found inside the region (a real command position even inside
 *     double quotes) so a hard-block gate never false-negatives on
 *     `"$(git commit)"`; the rest becomes surrounding spaces.
 * Single-quoted `$(...)` lookalikes and unbalanced quotes stay heuristic gaps.
 *
 * @param {string} command
 * @param {{preserveSubstitutions?: boolean}} [options]
 * @returns {string}
 */
function stripQuotedRegions(command, options = {}) {
  if (typeof command !== 'string') return '';
  const { preserveSubstitutions = false } = options;
  const replace = preserveSubstitutions
    ? (region) => ' ' + (region.match(/\$\([^)]*\)|`[^`]*`/g) || []).join(' ') + ' '
    : () => '';
  return command
    .replace(/'[^']*'/g, replace)
    .replace(/"(?:\\.|[^"\\])*"/g, replace);
}

/**
 * True when `coreSource` (a regex source for a command, e.g.
 * String.raw`git\s+commit\b`) matches at a command position in `command`.
 * `coreSource` must NOT carry its own start-anchor; LEAD supplies it. Heredoc
 * bodies and quoted literals are neutralized first so the phrase is tested only
 * against real command structure (#764). The quote strip preserves command
 * substitutions so `x="$(git commit)"` still matches.
 *
 * @param {string} command     the raw Bash command
 * @param {string} coreSource  regex source without a start-anchor
 * @param {string} [flags]     extra RegExp flags, e.g. 'i'
 * @returns {boolean}
 */
function atCommandPosition(command, coreSource, flags = '') {
  if (typeof command !== 'string') return false;
  const cleaned = stripQuotedRegions(
    stripHeredocs(command, { mode: 'preserve-operator' }),
    { preserveSubstitutions: true }
  );
  return new RegExp(LEAD + coreSource, flags).test(cleaned);
}

module.exports = { LEAD, atCommandPosition, stripHeredocs, stripQuotedRegions };
