#!/usr/bin/env node
// Tests for stripCommandContent in session-utils.cjs (#769). It layers
// content-flag truncation on top of the shared heredoc stripper.

const assert = require('assert');
const { stripCommandContent } = require('./session-utils.cjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.stack}`); }
}

test('replaces a heredoc body with the placeholder token', () => {
  const out = stripCommandContent('cat <<EOF\ngit commit -m x\nEOF');
  assert.ok(out.includes('<<HEREDOC_STRIPPED'), out);
  assert.ok(!out.includes('git commit'), out);
});

test('truncates at a --body content flag', () => {
  const out = stripCommandContent('gh issue create --title x --body "git commit here"');
  assert.ok(!out.includes('git commit'), out);
  assert.ok(out.includes('gh issue create'), out);
});

test('truncates at -m', () => {
  const out = stripCommandContent('git commit -m "message text"');
  assert.ok(!out.includes('message text'), out);
});

test('strips a <<- indented heredoc body (delta vs pre-#769 copy)', () => {
  const out = stripCommandContent('cat <<-EOF\n\tgit commit\n\tEOF');
  assert.ok(!out.includes('git commit'), out);
});

test('leaves a plain command untouched', () => {
  assert.strictEqual(stripCommandContent('git status'), 'git status');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
