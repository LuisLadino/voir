#!/usr/bin/env node

/**
 * Kit-Eval Reminder Hook
 *
 * Event: PreToolUse (Bash)
 * Matchers: Bash(*git push*), Bash(*gh pr create*)
 * Purpose: ADVISORY. When a change about to leave the machine touches a file
 *   that a kit-eval corpus watches, surface the EXACT live walk to run before
 *   merging. Never blocks: exit 0 always, no model call. kit-eval's live walks
 *   are a local pre-merge step, not a CI gate — putting a live `claude -p` eval
 *   in blocking CI would couple merges to model availability, token cost, and
 *   nondeterministic flake (#413, #744). This hook is the missing trigger for
 *   that documented-but-manual ritual (#799, kit-eval.md "CI vs local").
 *
 * Mapping (the actual deliverable of #799): each corpus declares the files it
 * watches in a `tests_source` frontmatter list of repo-relative globs. The walk
 * command is derived from the corpus's directory (which harness) and basename
 * (the <name> arg). A changed file therefore resolves to its exact walk with no
 * central registry to drift out of sync — the corpus owns what it watches.
 *
 * Push surface is shared with check-spec-conformance: the same getPushDiff /
 * isGitPush / isPrCreate, so the reminder sees exactly the change set the
 * blocking conformance gate sees. This hook is separate, not folded into that
 * gate, so an advisory nudge can never entangle with a hard block.
 *
 * Out of scope: skill-trigger evals / /skill-gate (a separate gate per
 * kit-eval.md), and any blocking or CI-run behavior (the rejected #413/#744
 * model).
 *
 * Failure modes (all fail open, exit 0 — a reminder must never block a push):
 * - command is not a real push / pr create → exit 0
 * - no corpora, or none watch a changed file → exit 0, silent
 * - any internal error → logged via observability mode, exit 0
 */

const fs = require('fs');
const path = require('path');

const { parseDiff, matchGlob } = require('../lib/spec-conformance.cjs');
const { readSpecFrontmatter } = require('../lib/spec-frontmatter.cjs');
const { runStdinHook } = require('../lib/stdin-hook.cjs');
const {
  isGitPush,
  isPrCreate,
  getPushDiff
} = require('../safety/check-spec-conformance.cjs');

// Each kit-eval corpus directory maps to one harness. The corpus basename is
// the <name> argument the harness takes. Keep in lockstep with kit-eval.md.
const CORPUS_DIRS = [
  {
    dir: path.join('.claude', 'research', 'instruction-wording-evals'),
    script: '.claude/scripts/instruction-wording-walk.cjs',
    scope: 'instruction-wording'
  },
  {
    dir: path.join('.claude', 'research', 'skill-output-evals'),
    script: '.claude/scripts/skill-output-eval.cjs',
    scope: 'skill-output'
  }
];

/**
 * Load every kit-eval corpus and the source globs it watches.
 * Returns [{ name, scope, command, sources: string[], corpusPath }].
 * A corpus with no `tests_source` is skipped — it watches nothing, so it can
 * never produce a reminder. The corpora well-formedness test (CI) is what
 * enforces the field's presence; this hook stays defensive and silent.
 */
function loadCorpora(cwd) {
  const out = [];
  for (const { dir, script, scope } of CORPUS_DIRS) {
    const abs = path.join(cwd, dir);
    let files;
    try {
      files = fs.readdirSync(abs).filter(f => f.endsWith('.md'));
    } catch {
      continue; // directory absent in this checkout
    }
    for (const file of files) {
      const corpusPath = path.join(dir, file);
      const meta = readSpecFrontmatter(path.join(cwd, corpusPath));
      const sources = meta && Array.isArray(meta.tests_source)
        ? meta.tests_source.filter(s => typeof s === 'string' && s.length > 0)
        : [];
      if (sources.length === 0) continue;
      const name = path.basename(file, '.md');
      out.push({
        name,
        scope,
        command: `node ${script} ${name}`,
        sources,
        corpusPath
      });
    }
  }
  return out;
}

/**
 * Pure mapping: changed files x corpora -> reminders. One reminder per corpus
 * whose `tests_source` matches at least one changed file, carrying the exact
 * walk command and the files that triggered it.
 */
function remindersFor(changedFiles, corpora) {
  const reminders = [];
  for (const corpus of corpora) {
    const matched = changedFiles.filter(file =>
      corpus.sources.some(glob => matchGlob(file, glob))
    );
    if (matched.length === 0) continue;
    reminders.push({
      scope: corpus.scope,
      name: corpus.name,
      command: corpus.command,
      matched,
      corpusPath: corpus.corpusPath
    });
  }
  return reminders;
}

function formatReminder(reminders) {
  const lines = [];
  lines.push('[kit-eval] This change touches files a kit-eval corpus watches.');
  lines.push('Run the live walk(s) below before merging and paste the result into the PR.');
  lines.push('Advisory only — the deterministic layer already gated in CI; this is the local live-eval step (.claude/specs/kit/kit-eval.md "CI vs local").');
  lines.push('');
  for (const r of reminders) {
    lines.push(`- ${r.matched.join(', ')} (${r.scope})`);
    lines.push(`    ${r.command}`);
  }
  return lines.join('\n');
}

function changedFilesForCommand(command, cwd) {
  const diff = getPushDiff(cwd, command);
  if (!diff) return [];
  return parseDiff(diff).map(entry => entry.filePath);
}

function handleHook(data) {
  const command = data && data.tool_input && data.tool_input.command;
  if (!isGitPush(command) && !isPrCreate(command)) {
    process.exit(0);
  }
  const cwd = process.cwd();
  const changedFiles = changedFilesForCommand(command, cwd);
  if (changedFiles.length === 0) {
    process.exit(0);
  }
  const reminders = remindersFor(changedFiles, loadCorpora(cwd));
  if (reminders.length === 0) {
    process.exit(0);
  }
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: formatReminder(reminders)
    }
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

if (require.main === module) {
  runStdinHook(handleHook, { mode: 'observability' });
}

module.exports = {
  loadCorpora,
  remindersFor,
  formatReminder,
  changedFilesForCommand,
  handleHook,
  CORPUS_DIRS
};
