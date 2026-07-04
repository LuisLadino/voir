#!/usr/bin/env node
// Tests for block-dangerous.cjs (#769 added the seam: detectDangerous is now a
// pure, exported function). Confirms heredoc bodies are neutralized before
// pattern matching and that real dangerous commands still fire.
// Assumes security-patterns.json ships an `rm -rf /` pattern (per block-dangerous.md).

const assert = require('assert');
const { detectDangerous } = require('./block-dangerous.cjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.stack}`); }
}

test('blocks a real rm -rf /', () => {
  assert.ok(detectDangerous('rm -rf /'));
});

test('does not block rm -rf / documented inside a heredoc body', () => {
  assert.strictEqual(detectDangerous('cat <<EOF\nrm -rf /\nEOF'), null);
});

test('does not block a dangerous example inside a <<- indented heredoc', () => {
  assert.strictEqual(detectDangerous('cat <<-EOF\n\trm -rf /\n\tEOF'), null);
});

test('still blocks a real command chained before a heredoc', () => {
  assert.ok(detectDangerous('rm -rf / && cat <<EOF\nnote\nEOF'));
});

test('empty / non-string returns null', () => {
  assert.strictEqual(detectDangerous(''), null);
  assert.strictEqual(detectDangerous(undefined), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
