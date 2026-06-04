#!/usr/bin/env node

/**
 * Spec Conformance: pure logic
 *
 * Loads conformance_rules from spec frontmatter, parses a unified diff,
 * and reports rule violations on added lines. Hook entry consumes the
 * results and exits non-zero on violation.
 *
 * A rule is a regex applied to each added line of a staged diff. The
 * rule's parent spec (or the rule's own applies_to override) decides
 * which files the rule scans.
 *
 * Rules are read from frontmatter so they sit next to the prose that
 * documents them. Malformed rules (bad regex, missing fields) are
 * silent-skipped with a stderr warning — a typo can never freeze the
 * commit workflow.
 */

const path = require('path');

const { getSpecRoots } = require('./spec-roots.cjs');
const { findSpecFiles, matchGlob } = require('./spec-discovery.cjs');
const { readSpecFrontmatter } = require('./spec-frontmatter.cjs');

// Per-line cap and total wall-clock budget for regex evaluation.
// A spec landed via PR or kit sync can declare a regex; without these
// caps a pathological pattern would freeze the workflow. The hook's
// stated invariant is that a rule typo can never block a commit, so
// the scan aborts open (exit 0 with a stderr warning) when the budget
// is exceeded.
const MAX_LINE_LENGTH = 4096;
const MAX_SCAN_MS = 2000;

function loadSpecsWithRules(cwd = process.cwd()) {
  const out = [];
  try {
    const { roots } = getSpecRoots(cwd);
    const seen = new Set();
    for (const root of roots) {
      for (const specPath of findSpecFiles(root)) {
        if (seen.has(specPath)) continue;
        seen.add(specPath);
        const spec = readSpec(specPath);
        if (!spec) continue;
        if (!Array.isArray(spec.conformance_rules) || spec.conformance_rules.length === 0) continue;
        const rules = normalizeRules(spec, specPath);
        if (rules.length === 0) continue;
        out.push({
          name: spec.name || path.basename(specPath, path.extname(specPath)),
          specPath,
          appliesTo: Array.isArray(spec.applies_to) ? spec.applies_to : [],
          excludes: Array.isArray(spec.excludes) ? spec.excludes : [],
          rules
        });
      }
    }
  } catch {
    // discovery never breaks the gate
  }
  return out;
}

// The single frontmatter reader lives in spec-frontmatter.cjs so this gate and
// enforce-specs cannot drift on parsing (#590). Kept as a named export for API
// and test stability.
const readSpec = readSpecFrontmatter;

function normalizeRules(spec, specPath) {
  const out = [];
  for (let i = 0; i < spec.conformance_rules.length; i++) {
    const raw = spec.conformance_rules[i];
    if (!raw || typeof raw !== 'object') {
      warnBadRule(specPath, i, 'rule entry is not a map');
      continue;
    }
    const ruleName = typeof raw.name === 'string' ? raw.name.trim() : '';
    const pattern = typeof raw.pattern === 'string' ? raw.pattern : '';
    const message = typeof raw.message === 'string' ? raw.message.trim() : '';
    if (!ruleName || !pattern || !message) {
      warnBadRule(specPath, i, 'rule missing name, pattern, or message');
      continue;
    }
    let regex;
    try {
      regex = new RegExp(pattern);
    } catch (err) {
      warnBadRule(specPath, i, `invalid regex: ${err.message}`);
      continue;
    }
    const appliesTo = Array.isArray(raw.applies_to)
      ? raw.applies_to.filter(p => typeof p === 'string' && p.length > 0)
      : null;
    const excludes = Array.isArray(raw.excludes)
      ? raw.excludes.filter(p => typeof p === 'string' && p.length > 0)
      : [];
    out.push({
      name: ruleName,
      regex,
      pattern,
      message,
      appliesTo,
      excludes
    });
  }
  return out;
}

function warnBadRule(specPath, index, reason) {
  try {
    process.stderr.write(`[check-spec-conformance] skip rule #${index} in ${specPath}: ${reason}\n`);
  } catch {}
}

function ruleAppliesToFile(rule, spec, filePath) {
  const includes = rule.appliesTo && rule.appliesTo.length > 0 ? rule.appliesTo : spec.appliesTo;
  if (!includes || includes.length === 0) return false;
  const included = includes.some(p => matchGlob(filePath, p));
  if (!included) return false;
  const excludeLists = [spec.excludes || [], rule.excludes || []];
  for (const list of excludeLists) {
    for (const p of list) {
      if (matchGlob(filePath, p)) return false;
    }
  }
  return true;
}

/**
 * Parse `git diff --cached -U0` output. Returns an array of
 *   { filePath, additions: [{ lineNo, content }] }
 * Only added lines are returned. Removals are ignored — conformance
 * checks the state after the commit lands.
 */
function parseDiff(diffText) {
  if (!diffText || typeof diffText !== 'string') return [];
  const lines = diffText.split('\n');
  const files = [];
  let current = null;
  let newLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('diff --git')) {
      if (current) files.push(current);
      current = null;
      newLine = 0;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const rest = line.slice(4).trim();
      if (rest === '/dev/null') {
        current = null;
        continue;
      }
      const filePath = rest.startsWith('b/') ? rest.slice(2) : rest;
      current = { filePath, additions: [] };
      continue;
    }
    if (line.startsWith('--- ')) continue;
    if (line.startsWith('@@')) {
      const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) newLine = parseInt(m[1], 10);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      current.additions.push({ lineNo: newLine, content: line.slice(1) });
      newLine++;
      continue;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      continue;
    }
    if (line.startsWith(' ')) {
      newLine++;
    }
  }
  if (current) files.push(current);
  return files;
}

function findViolations(diffEntries, specs, options) {
  const opts = options || {};
  const lineCap = typeof opts.maxLineLength === 'number' ? opts.maxLineLength : MAX_LINE_LENGTH;
  const budgetMs = typeof opts.maxScanMs === 'number' ? opts.maxScanMs : MAX_SCAN_MS;
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const start = now();
  const violations = [];
  let aborted = false;
  outer:
  for (const entry of diffEntries) {
    for (const spec of specs) {
      for (const rule of spec.rules) {
        if (!ruleAppliesToFile(rule, spec, entry.filePath)) continue;
        for (const addition of entry.additions) {
          if (addition.content.length > lineCap) continue;
          if (now() - start > budgetMs) {
            aborted = true;
            break outer;
          }
          rule.regex.lastIndex = 0;
          if (rule.regex.test(addition.content)) {
            violations.push({
              filePath: entry.filePath,
              lineNo: addition.lineNo,
              content: addition.content,
              specName: spec.name,
              specPath: spec.specPath,
              ruleName: rule.name,
              ruleMessage: rule.message
            });
          }
        }
      }
    }
  }
  if (aborted) {
    try {
      process.stderr.write(`[check-spec-conformance] scan exceeded ${budgetMs}ms budget, aborting. A spec rule may be pathological (ReDoS). Inspect recent changes to .claude/specs/.\n`);
    } catch {}
  }
  return { violations, aborted };
}

function formatReport(violations) {
  if (violations.length === 0) return '';
  const lines = [];
  lines.push(`[BLOCKED] Spec conformance check failed (${violations.length} violation${violations.length === 1 ? '' : 's'}).`);
  lines.push('');
  const byFile = new Map();
  for (const v of violations) {
    if (!byFile.has(v.filePath)) byFile.set(v.filePath, []);
    byFile.get(v.filePath).push(v);
  }
  for (const [filePath, list] of byFile) {
    lines.push(filePath);
    for (const v of list) {
      lines.push(`  ${v.lineNo}: ${truncate(v.content.trim(), 120)}`);
      lines.push(`    rule:    ${v.specName} > ${v.ruleName}`);
      lines.push(`    fix:     ${v.ruleMessage}`);
    }
    lines.push('');
  }
  lines.push('Editing a line puts every token on that line in scope, not just the part you intended to change.');
  lines.push('Fix the violations above and re-stage, or amend the spec rule if the documented standard has shifted.');
  return lines.join('\n');
}

function truncate(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

module.exports = {
  loadSpecsWithRules,
  parseDiff,
  findViolations,
  formatReport,
  ruleAppliesToFile,
  matchGlob,
  normalizeRules,
  readSpec
};
