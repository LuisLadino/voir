#!/usr/bin/env node

const assert = require('assert');
const { atCommandPosition, LEAD } = require('./command-position.cjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.stack}`); }
}

const COMMIT = String.raw`git\s+commit\b`;
const ISSUE = String.raw`gh\s+issue\s+create\b`;

test('matches a bare command at start', () => {
  assert.strictEqual(atCommandPosition('git commit -m x', COMMIT), true);
});

test('matches after && ; | and newline separators', () => {
  for (const c of [
    'git add . && git commit -m x',
    'foo; git commit',
    'foo | git commit',
    'foo\ngit commit',
  ]) assert.strictEqual(atCommandPosition(c, COMMIT), true, c);
});

test('matches after VAR= assignment prefixes', () => {
  assert.strictEqual(atCommandPosition('SKILL_ACTIVE=1 DOCS_CHECKED=1 git commit', COMMIT), true);
});

test('matches inside $(...) and backtick command substitution', () => {
  assert.strictEqual(atCommandPosition('x=$(git commit -m x)', COMMIT), true);
  assert.strictEqual(atCommandPosition('out=`git commit`', COMMIT), true);
});

test('does NOT match the phrase inside a quoted argument', () => {
  for (const c of [
    "node -e 'git commit -m x'",
    'echo "git commit"',
    'grep "git commit" file',
    'printf "run git commit later"',
  ]) assert.strictEqual(atCommandPosition(c, COMMIT), false, c);
});

test('does NOT match after a bare paren in quoted text', () => {
  assert.strictEqual(atCommandPosition('echo "(git commit) was the fix"', COMMIT), false);
});

test('does NOT match a longer word containing the token', () => {
  assert.strictEqual(atCommandPosition('xgit commit', COMMIT), false);
});

test('case-insensitive flag honored; default is case-sensitive', () => {
  assert.strictEqual(atCommandPosition('GIT COMMIT', COMMIT, 'i'), true);
  assert.strictEqual(atCommandPosition('GIT COMMIT', COMMIT), false);
});

test('multi-word cores anchor correctly', () => {
  assert.strictEqual(atCommandPosition('gh issue create --title x', ISSUE, 'i'), true);
  assert.strictEqual(atCommandPosition('grep "gh issue create" notes', ISSUE, 'i'), false);
});

test('non-string command returns false', () => {
  assert.strictEqual(atCommandPosition(undefined, COMMIT), false);
  assert.strictEqual(atCommandPosition(null, COMMIT), false);
  assert.strictEqual(atCommandPosition(42, COMMIT), false);
});

test('#764 does NOT match a phrase documented inside a heredoc body', () => {
  for (const c of [
    'gh pr create --body "$(cat <<EOF\ngit commit -m fix\nEOF\n)"',
    'cat <<EOF\nrun git commit to save\nEOF',
    'cat <<-EOF\n\tgit commit\n\tEOF',
  ]) assert.strictEqual(atCommandPosition(c, COMMIT, 'i'), false, c);
});

test('#764 does NOT match a phrase after a separator inside quotes', () => {
  for (const c of [
    'echo "; git commit"',
    "echo 'step 1; git commit later'",
    'echo "a | git commit"',
  ]) assert.strictEqual(atCommandPosition(c, COMMIT, 'i'), false, c);
});

test('#764 STILL matches a real command substitution inside double quotes (no false-negative)', () => {
  for (const c of [
    'out="$(git commit -m x)"',
    'x="$(setup | git commit)"',
    'y="`git commit`"',
  ]) assert.strictEqual(atCommandPosition(c, COMMIT, 'i'), true, c);
});

test('#764 STILL matches a real command after a heredoc operator line', () => {
  assert.strictEqual(atCommandPosition('cat <<EOF | git commit\nbody\nEOF', COMMIT, 'i'), true);
});

test('LEAD is exported as a string', () => {
  assert.strictEqual(typeof LEAD, 'string');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
