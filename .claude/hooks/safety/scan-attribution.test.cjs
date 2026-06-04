#!/usr/bin/env node
// Tests the attribution scanner against the golden set from issue #162.
// Golden set is documented at .claude/research/kit/issue-162-attribution-scan-eval.md.

const { scan } = require('./scan-attribution.cjs');

const cases = [
  // Positive: must block (scan returns at least one violation)
  { name: 'P1 Claude co-author', text: 'fix: bug\n\nCo-Authored-By: Claude <noreply@anthropic.com>', expect: 'block' },
  { name: 'P2 Generated with Claude Code', text: 'feat: add auth\n\nGenerated with Claude Code', expect: 'block' },
  { name: 'P3 Emoji Generated with Claude', text: 'chore: deps\n\n🤖 Generated with Claude', expect: 'block' },
  { name: 'P4 Anthropic co-author', text: 'refactor: helper\n\nCo-Authored-By: Anthropic Bot <bot@anthropic.com>', expect: 'block' },
  { name: 'P5 Case-insensitive co-author', text: 'fix: typo\n\nCo-authored-by: claude <x@example.com>', expect: 'block' },

  // Negative: must pass (no violations)
  { name: 'N1 Plain commit', text: 'fix: resolve login bug', expect: 'pass' },
  { name: 'N2 Claude API client', text: 'feat: add Claude API client\n\nIntegrates /v1/messages endpoint.', expect: 'pass' },
  { name: 'N3 anthropic CLI notes', text: 'docs: update anthropic CLI notes', expect: 'pass' },
  { name: 'N4 claudeClient rename', text: 'chore: rename claudeClient to aiClient', expect: 'pass' },
  { name: 'N5 commit skill bug', text: 'fix: bug in /commit skill', expect: 'pass' },

  // Edge: must pass
  { name: 'E1 Anthropic URL', text: 'fix: issue\n\nSee https://anthropic.com/docs', expect: 'pass' },
  { name: 'E2 Human co-author', text: 'feat: add feature\n\nCo-Authored-By: Some Human <human@example.com>', expect: 'pass' },
  { name: 'E3 Generated with love', text: 'chore: cleanup\n\nGenerated with love', expect: 'pass' },
];

let passed = 0;
let failed = 0;
const failures = [];

for (const c of cases) {
  const violations = scan(c.text);
  const result = violations.length > 0 ? 'block' : 'pass';
  if (result === c.expect) {
    passed++;
  } else {
    failed++;
    failures.push({ name: c.name, expected: c.expect, got: result, violations });
  }
}

console.log(`${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log('');
  for (const f of failures) {
    console.log(`FAIL ${f.name}: expected ${f.expected}, got ${f.got}`);
    if (f.violations.length > 0) {
      for (const v of f.violations) {
        console.log(`  violation: ${v.pattern} matched "${v.match.trim()}"`);
      }
    }
  }
  process.exit(1);
}

process.exit(0);
