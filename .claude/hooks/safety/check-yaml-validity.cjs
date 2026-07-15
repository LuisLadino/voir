#!/usr/bin/env node

/**
 * Check YAML Validity Hook (#892)
 *
 * Event: PreToolUse (Bash)
 * Matchers: Bash(*git commit*), Bash(*git push*), Bash(*gh pr create*)
 * Purpose: Block a commit/push that would land a whole-document .yaml file
 *          under .claude/ that does not strict-parse. A .yaml extension
 *          promises a machine-parseable document; without this gate an invalid
 *          one stays dormant until some consumer YAML.loads it and fails
 *          (a system-map validator, a drift-checker, /sync-stack regen).
 *
 * Two surfaces, mirroring check-spec-conformance:
 *   commit → the staged content of each changed in-scope .yaml
 *            (`git show :path`, the index blob that will be committed).
 *   push   → the content at the tip of each pushed ref (`git show ref:path`)
 *            for files that ref changes over its base. Catches invalid YAML in
 *            commits made outside Claude Code or via --no-verify.
 * In scope: whole-document .yaml/.yml under .claude/. A .md spec carries
 * frontmatter, not a whole-document body, and is parsed elsewhere.
 *
 * Validation is yaml-mini strict mode (see lib/yaml-validity.cjs) because the
 * hook runtime has no spec-compliant parser. Command detection reuses the
 * conformance gate's command-position-anchored detectors (injection-precision
 * spec) and its ref resolution, so the two gates cannot drift.
 *
 * Fails open: any internal/git error exits 0. A gate bug must never freeze the
 * commit workflow, the same invariant check-spec-conformance holds.
 */

const { spawnSync } = require('child_process');

const {
  isWholeDocYaml,
  validateContent,
  formatReport
} = require('../lib/yaml-validity.cjs');
const { runStdinHook } = require('../lib/stdin-hook.cjs');
const {
  isGitCommit,
  isGitPush,
  isPrCreate,
  refsForCommand,
  resolveBase,
  refExists
} = require('./check-spec-conformance.cjs');

function git(args, cwd) {
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  if (res.status !== 0) return null;
  return res.stdout != null ? res.stdout : '';
}

function nameLines(out) {
  return (out || '').split('\n').map(s => s.trim()).filter(Boolean);
}

// Staged surface: the index blob of each changed in-scope .yaml.
// --diff-filter=ACMR drops deletions (D); a deleted file has no content to check.
function stagedYaml(cwd) {
  const names = nameLines(
    git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'], cwd)
  ).filter(isWholeDocYaml);
  const out = [];
  for (const filePath of names) {
    const content = git(['show', `:${filePath}`], cwd);
    if (content != null) out.push({ filePath, content });
  }
  return out;
}

// Push surface: content at each pushed ref for the in-scope .yaml it changes
// over its base. Ref set and base resolution come from the conformance gate.
function pushYaml(cwd, command) {
  const refs = refsForCommand(command, cwd);
  if (!refs) return []; // every push carries no file content (deletion, dry-run, tag)
  const out = [];
  const seen = new Set();
  for (const ref of refs) {
    if (!refExists(ref, cwd)) continue;
    const base = resolveBase(ref, cwd);
    if (!base) continue;
    const names = nameLines(
      git(['diff', '--name-only', '--diff-filter=ACMR', `${base}...${ref}`], cwd)
    ).filter(isWholeDocYaml);
    for (const filePath of names) {
      const key = `${ref}\0${filePath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const content = git(['show', `${ref}:${filePath}`], cwd);
      if (content != null) out.push({ filePath, content });
    }
  }
  return out;
}

function handleHook(data) {
  try {
    const command = data && data.tool_input && data.tool_input.command;
    const cwd = process.cwd();
    let targets = [];
    if (isGitCommit(command)) targets = targets.concat(stagedYaml(cwd));
    if (isGitPush(command) || isPrCreate(command)) targets = targets.concat(pushYaml(cwd, command));
    if (targets.length === 0) return process.exit(0);

    const failures = [];
    const failed = new Set();
    for (const t of targets) {
      if (failed.has(t.filePath)) continue; // one verdict per file across surfaces
      const res = validateContent(t.content);
      if (!res.ok) {
        failed.add(t.filePath);
        failures.push({ filePath: t.filePath, line: res.line, message: res.message });
      }
    }
    if (failures.length === 0) return process.exit(0);
    console.error(formatReport(failures));
    return process.exit(2);
  } catch {
    // A gate bug must never freeze the commit workflow.
    process.exit(0);
  }
}

if (require.main === module) {
  runStdinHook(handleHook, { mode: 'gating' });
}

module.exports = { handleHook, stagedYaml, pushYaml, git };
