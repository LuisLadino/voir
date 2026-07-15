#!/usr/bin/env node

/**
 * YAML validity: pure logic for the commit-time .yaml gate (#892).
 *
 * A .yaml/.yml file under .claude/ is a whole-document YAML file, unlike a .md
 * spec whose YAML is a frontmatter block parsed separately. This module decides
 * which changed paths are in scope and strict-validates their content with
 * yaml-mini's strict mode, which turns the two constructs yaml-mini otherwise
 * SILENTLY mis-parses (a nested `: ` mapping indicator, a duplicate key) into
 * loud, line-tagged errors.
 *
 * Deliberately NOT a full spec-compliance validator. The kit's hook runtime
 * ships as copied files with no npm install, so no spec-compliant parser (the
 * `yaml` package) is available; yaml-mini is the only parser present and models
 * a YAML subset. Strict mode therefore catches the ambiguous constructs that
 * corrupt silently plus everything yaml-mini's grammar already rejects, and is
 * tuned to never flag valid YAML. That conservative contract, no false block,
 * is what a commit gate needs: a gate that blocks a valid file freezes the
 * workflow, which is worse than the latent defect it guards against.
 */

const { parse } = require('./yaml-mini.cjs');

// Whole-document YAML under .claude/. Paths are repo-relative (from git).
// .md specs are excluded by extension: their frontmatter is parsed elsewhere.
function isWholeDocYaml(filePath) {
  return typeof filePath === 'string' && /(?:^|\/)\.claude\/.*\.ya?ml$/.test(filePath);
}

// { ok: true } | { ok: false, line: number|null, message: string }
function validateContent(content) {
  try {
    parse(content, { strict: true });
    return { ok: true };
  } catch (err) {
    const line = typeof err.line === 'number' ? err.line : extractLine(err && err.message);
    return { ok: false, line, message: cleanMessage(err && err.message) };
  }
}

function extractLine(message) {
  const m = /line (\d+)/.exec(String(message || ''));
  return m ? parseInt(m[1], 10) : null;
}

function cleanMessage(message) {
  return String(message || 'invalid YAML').replace(/^yaml-mini:\s*/, '');
}

// failures: [{ filePath, line, message }]
function formatReport(failures) {
  if (!Array.isArray(failures) || failures.length === 0) return '';
  const lines = [];
  lines.push(`[BLOCKED] Invalid YAML in ${failures.length} file${failures.length === 1 ? '' : 's'} — a .yaml file must strict-parse.`);
  lines.push('');
  for (const f of failures) {
    lines.push(f.line ? `${f.filePath}:${f.line}` : f.filePath);
    lines.push(`  ${cleanMessage(f.message)}`);
    lines.push('');
  }
  lines.push('A .yaml extension promises a machine-parseable document; a consumer that YAML.loads it will fail on an invalid one.');
  lines.push('Usual cause: an unquoted value containing ": " (quote the value) or a duplicate key. Fix and re-stage.');
  return lines.join('\n');
}

module.exports = { isWholeDocYaml, validateContent, formatReport, extractLine, cleanMessage };
