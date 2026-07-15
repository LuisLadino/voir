#!/usr/bin/env node

/**
 * Skill completion patterns and the rule that decides whether a given skill
 * invocation produced a recognizable completion signal.
 *
 * Two consumers must share one rule:
 *   - verify-before-stop.cjs: gates Stop with INCOMPLETE SKILL INVOCATION when
 *     an invoked skill has no completion signal in the current prompt.
 *   - session-utils.readSkillTelemetryState: produces the per-skill rollup
 *     (applied / completed / fallback_used / tool_success_count /
 *     tool_failure_count) that tracking-persistence.md formalizes.
 *
 * This module has no dependency on session-utils. That is deliberate:
 * verify-before-stop already requires session-utils, so importing the table
 * the other direction (session-utils <- verify-before-stop) would be a
 * circular require. A dependency-free table module keeps the graph a DAG.
 */

const skillCompletionPatterns = {
  commit: {
    description: 'git push, gh pr create, or gh pr merge',
    bash: [/git\s+push/, /gh\s+pr\s+create/, /gh\s+pr\s+merge/],
    tools: []
  },
  plan: {
    // The gap is bounded (not `.*`) so extractCommandSignals, which runs this
    // on the full untruncated command and stores the match, stays linear and
    // can't capture a long secret-bearing span between the two anchors (#895).
    description: 'gh issue create (with SKILL_ACTIVE=1)',
    bash: [/gh\s+issue\s+create/, /SKILL_ACTIVE=1[^\n]{0,60}gh\s+issue/],
    tools: []
  },
  build: {
    description: 'git checkout, git switch, or git reset to create/move branches',
    bash: [/git\s+checkout/, /git\s+switch/, /git\s+reset/],
    tools: []
  },
  test: {
    description: 'run a test command (pytest, npm test, go test, cargo test, etc.)',
    bash: [/pytest|npm\s+test|npm\s+run\s+test|go\s+test|cargo\s+test|xcodebuild\s+test/],
    tools: []
  },
  research: {
    // Content search via bash counts as research, not just the Grep/Glob tools
    // — those tools are unavailable in some sessions, and a bash search is the
    // same work (#910). Match unambiguous content-search commands: ripgrep,
    // git grep, recursive grep, silver searcher. Tool names are anchored at a
    // command position (start, or after a shell separator/pipe) per
    // injection-precision.md, so a filename fragment (`x.ag`) or the word
    // "legit grep" does not false-match. Quote-stripping is NOT applied here
    // because the SKILL_COMPLETE sentinel deliberately lives inside `echo '…'`,
    // so `rg`/`ag` inside a quoted arg remains a residual false-match — accepted
    // because they are not English words, so the collision is rare and cheap
    // for a soft self-check gate. `find` is deliberately excluded: it is file
    // DISCOVERY (already covered by the Glob tool), and its token is a common
    // English verb, so it would false-complete on quoted prose ("we find
    // bugs") at a high rate. Plain `grep pattern file` (single-file read) and
    // `| grep` (incidental filter) are excluded; the #906 sentinel covers the
    // residual find-only / tools-unavailable cases.
    description: 'external inquiry (WebSearch, WebFetch, context7), the Grep/Glob tools, or a bash content search (rg, git grep, grep -r, ag)',
    bash: [
      /(?:^|[\s;&|(])rg\s/,
      /(?:^|[\s;&|(])git\s+grep\b/,
      /(?:^|[\s;&|(])grep\s+-[a-zA-Z]*[rR]/,
      /(?:^|[\s;&|(])ag\s/
    ],
    tools: ['WebSearch', 'WebFetch', 'Grep', 'Glob', 'mcp__context7__query-docs', 'mcp__context7__resolve-library-id']
  },
  dispatch: {
    description: 'node .claude/hooks/lib/dispatch.cjs invocation. Any subcommand counts: spawn, --list, --kill, --synthesize, --cleanup, --dry-run.',
    bash: [/dispatch\.cjs/],
    tools: []
  },
  board: {
    description: 'node .claude/hooks/lib/board.cjs invocation. Any subcommand counts: directive, config, workstreams, classify, unlaned, lane.',
    bash: [/board\.cjs/],
    tools: []
  },
  verify: {
    description: 'node .claude/skills/verify/find-stale-addresses.cjs invocation (queue build). Runs unconditionally in every /verify pass.',
    bash: [/find-stale-addresses\.cjs/],
    tools: []
  },
  audit: { exempt: true },
  review: { exempt: true },
  define: { exempt: true },
  ideate: { exempt: true },
  handoff: { exempt: true },
  dream: { exempt: true },
  design: { exempt: true },

  'affordance-audit': { exempt: true },
  'assumption-reframe': { exempt: true },
  'audience-lock': { exempt: true },
  'boring-check': { exempt: true },
  'chesterton-audit': { exempt: true },
  'commitment-close': { exempt: true },
  'competitive-alternatives': { exempt: true },
  'concretize-pass': { exempt: true },
  'counterfactual-check': { exempt: true },
  'curse-check': { exempt: true },
  'decision-owner': { exempt: true },
  'define-the-sample': { exempt: true },
  'delegation-level': { exempt: true },
  'eval-first': { exempt: true },
  'failure-mode-taxonomy': { exempt: true },
  'generalization-check': { exempt: true },
  'heuristic-scan': { exempt: true },
  'hierarchy-squint': { exempt: true },
  'jobs-to-be-done': { exempt: true },
  'lead-with-decision': { exempt: true },
  'leverage-point-scan': { exempt: true },
  learn: { exempt: true },
  'look-at-your-data': { exempt: true },
  'moat-check': { exempt: true },
  'name-the-metric': { exempt: true },
  'name-the-reader': { exempt: true },
  'observable-surface-audit': { exempt: true },
  'pre-mortem': { exempt: true },
  'pre-register-decision': { exempt: true },
  'reference-triangulation': { exempt: true },
  'reversibility-classify': { exempt: true },
  'roi-per-hour': { exempt: true },
  'scope-cut': { exempt: true },
  'second-order-check': { exempt: true },
  'stakeholder-map': { exempt: true },
  'strategy-kernel': { exempt: true },
  'switch-trigger': { exempt: true },
  'symptom-vs-root': { exempt: true },
  'trunk-test': { exempt: true },
  'type-specimen': { exempt: true },
  'value-over-feature': { exempt: true },

  'sync-stack': { exempt: true }
};

function escapeForRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Every completion bash pattern across all skills, flattened once. Used to
// preserve a command's signals at tracking-capture time, before the display
// copy is truncated (#895).
const ALL_BASH_SIGNALS = Object.values(skillCompletionPatterns)
  .flatMap(p => p.bash || []);

// Generic sentinel capture (any skill name). The per-name buildSentinelRegex
// re-matches whatever this preserves, so downstream matching is unchanged.
const SENTINEL_CAPTURE = /SKILL_COMPLETE:\s*[\w-]+/g;

// Scan a FULL (untruncated) command for completion signals and return the
// matched substrings. Feeding these back into isSkillComplete yields the same
// verdict as scanning the full command directly — so tool-tracker's 100-char
// display truncation can no longer hide a signal in a command's tail (#895).
function extractCommandSignals(command) {
  if (!command || typeof command !== 'string') return [];
  const found = new Set();
  for (const rx of ALL_BASH_SIGNALS) {
    const m = command.match(rx);
    if (m) found.add(m[0]);
  }
  const sentinels = command.match(SENTINEL_CAPTURE);
  if (sentinels) for (const s of sentinels) found.add(s);
  return [...found];
}

function buildSentinelRegex(skillName) {
  return new RegExp(`SKILL_COMPLETE:\\s*${escapeForRegex(skillName)}(?![\\w-])`);
}

function normalizeSkillName(skill) {
  return String(skill || '')
    .replace(/^\//, '')
    .replace(/^[a-z][a-z0-9-]*:/, '');
}

function getSkillPattern(skill) {
  return skillCompletionPatterns[normalizeSkillName(skill)];
}

function isSkillRegistered(skill) {
  return Boolean(getSkillPattern(skill));
}

function isSkillExempt(skill) {
  const pattern = getSkillPattern(skill);
  return Boolean(pattern && pattern.exempt);
}

function isSkillComplete(skill, bashCommands, usedTools) {
  const name = normalizeSkillName(skill);
  // The sentinel is computed before the registration check so it is reachable
  // for unregistered skills too — the #231 tripwire kept an unregistered
  // Skill-tool invocation gated but left it with no satisfiable action (#902).
  const sentinelRx = buildSentinelRegex(name);
  const sentinelMatch = bashCommands.some(cmd => sentinelRx.test(cmd));

  const pattern = getSkillPattern(skill);
  if (!pattern) {
    // Project-custom skill the kit table can't know. Keep it gated, but the
    // sentinel is the only completion contract it can satisfy — so name that
    // exact action rather than returning a null, unsatisfiable expectation.
    // Only emit a copy-pasteable command for a well-formed skill name: the
    // message tells the operator/model to run `expected`, and a name carrying
    // a quote or shell metachar would break out of the `echo '...'` quoting.
    // Matching is safe regardless — buildSentinelRegex escapes the name.
    const expected = /^[a-z0-9][a-z0-9-]*$/.test(name)
      ? `echo 'SKILL_COMPLETE: ${name}'`
      : 'emit a SKILL_COMPLETE sentinel naming this skill';
    return { complete: sentinelMatch, expected };
  }
  if (pattern.exempt) {
    return { complete: true, expected: null };
  }

  const bashMatch = (pattern.bash || []).some(rx =>
    bashCommands.some(cmd => rx.test(cmd))
  );
  const toolMatch = (pattern.tools || []).some(toolName => usedTools.has(toolName));

  return {
    complete: bashMatch || toolMatch || sentinelMatch,
    expected: pattern.description
  };
}

module.exports = {
  skillCompletionPatterns,
  escapeForRegex,
  buildSentinelRegex,
  extractCommandSignals,
  normalizeSkillName,
  getSkillPattern,
  isSkillRegistered,
  isSkillExempt,
  isSkillComplete
};
