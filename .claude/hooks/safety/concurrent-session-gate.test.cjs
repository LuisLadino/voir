#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, 'concurrent-session-gate.cjs');
const { isGitMutating, decide } = require('./concurrent-session-gate.cjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.stack}`); }
}

test('isGitMutating matches shared-state git + gh pr commands', () => {
  for (const c of [
    'git commit -m x', 'git push', 'git push origin main', 'git checkout -b f',
    'git switch main', 'git pull', 'git rebase main', 'git reset --hard HEAD~1',
    'git cherry-pick abc', 'git revert abc', 'git stash', 'git branch -D old',
    'git add . && git commit -m wip', 'cd sub && git push',
    'gh pr create --fill', 'gh pr merge 12 --squash',
  ]) assert.strictEqual(isGitMutating(c), true, c);
});

test('isGitMutating ignores read-only / unrelated (incl. deploys → Layer 3)', () => {
  for (const c of [
    'git status', 'git log --oneline', 'git diff', 'git show HEAD', 'git branch',
    'git branch -a', 'git rev-parse HEAD', 'gh pr view 5', 'gh pr list',
    'echo "git push the changes"', 'ls -la', 'npm test',
    'vercel deploy', 'vercel --prod', 'netlify deploy',
  ]) assert.strictEqual(isGitMutating(c), false, c);
});

test('decide blocks only mutating + others present + no override', () => {
  const others = [{ data: { session_id: 'abc', pid: 1, started_at: new Date().toISOString() } }];
  assert.strictEqual(decide('git commit -m x', others, {}).block, true);
  assert.strictEqual(decide('git commit -m x', [], {}).block, false);
  assert.strictEqual(decide('git status', others, {}).block, false);
  assert.strictEqual(decide('git commit -m x', others, { ALLOW_CONCURRENT_GIT: '1' }).block, false);
});

test('decide override is dedicated: banner-silence var does NOT disable the block', () => {
  const others = [{ data: { session_id: 'abc', pid: 1, started_at: new Date().toISOString() } }];
  // CLAUDE_KIT_NO_CONCURRENCY_WARN silences the Layer 2 banner but must not
  // disable this protective gate. Only ALLOW_CONCURRENT_GIT does.
  assert.strictEqual(decide('git push', others, { CLAUDE_KIT_NO_CONCURRENCY_WARN: '1' }).block, true);
});

function runHook(input) {
  try {
    execFileSync('node', [HOOK], { input: JSON.stringify(input), stdio: ['pipe', 'pipe', 'pipe'] });
    return 0;
  } catch (e) { return e.status; }
}

test('integration: no markers → git commit allowed (exit 0)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csg-'));
  fs.mkdirSync(path.join(dir, '.claude/sessions'), { recursive: true });
  assert.strictEqual(runHook({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: dir, session_id: 'self' }), 0);
});

test('integration: read-only git allowed (exit 0)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csg-'));
  fs.mkdirSync(path.join(dir, '.claude/sessions'), { recursive: true });
  assert.strictEqual(runHook({ tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: dir, session_id: 'self' }), 0);
});

test('isGitMutating catches command-substitution mutations ($(...) and backticks)', () => {
  assert.strictEqual(isGitMutating('x=$(git push origin main)'), true);
  assert.strictEqual(isGitMutating('out=`git commit -m x`'), true);
});

test('isGitMutating ignores a bare paren inside quoted text (no false positive)', () => {
  assert.strictEqual(isGitMutating('echo "(git push) later"'), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
