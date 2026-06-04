#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, 'check-spec-conformance.cjs');
const { isGitCommit, isGitPush, isPrCreate } = require('./check-spec-conformance.cjs');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}\n       ${err.stack || err.message}`);
  }
}

function run(stdin, cwd) {
  return spawnSync('node', [HOOK], {
    cwd,
    input: stdin,
    encoding: 'utf8'
  });
}

function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-conformance-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.claude', 'specs', 'design'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'specs', 'design', 'demo.md'), [
    '---',
    'name: demo',
    'applies_to:',
    '  - "**/*.tsx"',
    'category: design',
    'conformance_rules:',
    '  - name: ban-bad-token',
    '    pattern: "BAD_TOKEN"',
    '    message: "use GOOD_TOKEN instead"',
    '---'
  ].join('\n'));
  return dir;
}

console.log('check-spec-conformance: hook entry');

test('exits 0 when command is not a git commit', () => {
  const dir = makeWorkspace();
  const r = run(JSON.stringify({ tool_input: { command: 'ls -la' } }), dir);
  assert.strictEqual(r.status, 0, r.stderr);
  fs.rmSync(dir, { recursive: true });
});

test('exits 0 when staged diff has no violation', () => {
  const dir = makeWorkspace();
  fs.writeFileSync(path.join(dir, 'Foo.tsx'), 'export const x = "GOOD_TOKEN";\n');
  spawnSync('git', ['add', 'Foo.tsx'], { cwd: dir });
  const r = run(JSON.stringify({ tool_input: { command: 'git commit -m x' } }), dir);
  assert.strictEqual(r.status, 0, r.stderr);
  fs.rmSync(dir, { recursive: true });
});

test('exits 2 with report when staged diff violates a rule', () => {
  const dir = makeWorkspace();
  fs.writeFileSync(path.join(dir, 'Bar.tsx'), 'export const x = "BAD_TOKEN";\n');
  spawnSync('git', ['add', 'Bar.tsx'], { cwd: dir });
  const r = run(JSON.stringify({ tool_input: { command: 'git commit -m x' } }), dir);
  assert.strictEqual(r.status, 2);
  assert.ok(r.stderr.includes('[BLOCKED]'), 'expected BLOCKED marker, got: ' + r.stderr);
  assert.ok(r.stderr.includes('Bar.tsx'));
  assert.ok(r.stderr.includes('demo > ban-bad-token'));
  assert.ok(r.stderr.includes('every token on that line in scope'));
  fs.rmSync(dir, { recursive: true });
});

test('exits 0 when violation lives in a file the rule does not cover', () => {
  const dir = makeWorkspace();
  fs.writeFileSync(path.join(dir, 'NOTES.md'), 'using BAD_TOKEN is bad\n');
  spawnSync('git', ['add', 'NOTES.md'], { cwd: dir });
  const r = run(JSON.stringify({ tool_input: { command: 'git commit -m x' } }), dir);
  assert.strictEqual(r.status, 0, r.stderr);
  fs.rmSync(dir, { recursive: true });
});

test('exits 0 when no specs declare conformance_rules', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-conformance-empty-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'Foo.tsx'), 'BAD_TOKEN\n');
  spawnSync('git', ['add', 'Foo.tsx'], { cwd: dir });
  const r = run(JSON.stringify({ tool_input: { command: 'git commit -m x' } }), dir);
  assert.strictEqual(r.status, 0, r.stderr);
  fs.rmSync(dir, { recursive: true });
});

test('SKILL_ACTIVE=1 DOCS_CHECKED=1 git commit is still scanned', () => {
  const dir = makeWorkspace();
  fs.writeFileSync(path.join(dir, 'Baz.tsx'), 'BAD_TOKEN\n');
  spawnSync('git', ['add', 'Baz.tsx'], { cwd: dir });
  const cmd = 'SKILL_ACTIVE=1 DOCS_CHECKED=1 git commit -m "feat: x"';
  const r = run(JSON.stringify({ tool_input: { command: cmd } }), dir);
  assert.strictEqual(r.status, 2);
  assert.ok(r.stderr.includes('Baz.tsx'));
  fs.rmSync(dir, { recursive: true });
});

// --- push / gh pr create gate ---------------------------------------------

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// A work tree wired to a bare origin, baseline pushed, origin/HEAD set, and
// main tracking origin/main. Commits made here go in directly, bypassing the
// commit gate — that is the violation path the push gate is meant to catch.
function makeRemoteWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-conformance-push-'));
  const origin = path.join(dir, 'origin.git');
  const work = path.join(dir, 'work');
  spawnSync('git', ['init', '-q', '--bare', origin], { cwd: dir });
  spawnSync('git', ['init', '-q', '-b', 'main', work], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 't@example.com'], { cwd: work });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: work });
  fs.mkdirSync(path.join(work, '.claude', 'specs', 'design'), { recursive: true });
  fs.writeFileSync(path.join(work, '.claude', 'specs', 'design', 'demo.md'), [
    '---',
    'name: demo',
    'applies_to:',
    '  - "**/*.tsx"',
    'category: design',
    'conformance_rules:',
    '  - name: ban-bad-token',
    '    pattern: "BAD_TOKEN"',
    '    message: "use GOOD_TOKEN instead"',
    '---'
  ].join('\n'));
  fs.writeFileSync(path.join(work, 'README.md'), 'baseline\n');
  spawnSync('git', ['add', '-A'], { cwd: work });
  spawnSync('git', ['commit', '-q', '-m', 'baseline'], { cwd: work });
  spawnSync('git', ['remote', 'add', 'origin', origin], { cwd: work });
  spawnSync('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: work });
  spawnSync('git', ['remote', 'set-head', 'origin', 'main'], { cwd: work });
  return { dir, work };
}

function commitFile(work, name, body, message) {
  fs.writeFileSync(path.join(work, name), body);
  spawnSync('git', ['add', name], { cwd: work });
  spawnSync('git', ['commit', '-q', '-m', message], { cwd: work });
}

console.log('\ncheck-spec-conformance: push gate');

test('blocks push when a pending commit violates a rule (upstream tracked)', () => {
  const { dir, work } = makeRemoteWorkspace();
  commitFile(work, 'Bar.tsx', 'export const x = "BAD_TOKEN";\n', 'sneak');
  const r = run(JSON.stringify({ tool_input: { command: 'git push' } }), work);
  assert.strictEqual(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes('Bar.tsx'), r.stderr);
  assert.ok(r.stderr.includes('demo > ban-bad-token'), r.stderr);
  cleanup(dir);
});

test('exits 0 when pending commits are clean', () => {
  const { dir, work } = makeRemoteWorkspace();
  commitFile(work, 'Ok.tsx', 'export const x = "GOOD_TOKEN";\n', 'clean');
  const r = run(JSON.stringify({ tool_input: { command: 'git push' } }), work);
  assert.strictEqual(r.status, 0, r.stderr);
  cleanup(dir);
});

test('exits 0 when nothing is pending (HEAD == upstream)', () => {
  const { dir, work } = makeRemoteWorkspace();
  const r = run(JSON.stringify({ tool_input: { command: 'git push' } }), work);
  assert.strictEqual(r.status, 0, r.stderr);
  cleanup(dir);
});

test('no-upstream branch falls back to origin/HEAD and blocks a violation', () => {
  const { dir, work } = makeRemoteWorkspace();
  spawnSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: work });
  commitFile(work, 'Baz.tsx', 'const x = "BAD_TOKEN";\n', 'feature work');
  const r = run(JSON.stringify({ tool_input: { command: 'git push -u origin feature' } }), work);
  assert.strictEqual(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes('Baz.tsx'), r.stderr);
  cleanup(dir);
});

test('gh pr create is gated like push', () => {
  const { dir, work } = makeRemoteWorkspace();
  spawnSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: work });
  commitFile(work, 'Qux.tsx', 'const x = "BAD_TOKEN";\n', 'pr work');
  const r = run(JSON.stringify({ tool_input: { command: 'gh pr create --fill' } }), work);
  assert.strictEqual(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes('Qux.tsx'), r.stderr);
  cleanup(dir);
});

test('skips a --delete push even with a pending violation', () => {
  const { dir, work } = makeRemoteWorkspace();
  commitFile(work, 'Del.tsx', 'const x = "BAD_TOKEN";\n', 'x');
  const r = run(JSON.stringify({ tool_input: { command: 'git push origin --delete main' } }), work);
  assert.strictEqual(r.status, 0, r.stderr);
  cleanup(dir);
});

test('skips a colon-refspec deletion push', () => {
  const { dir, work } = makeRemoteWorkspace();
  commitFile(work, 'Del2.tsx', 'const x = "BAD_TOKEN";\n', 'x');
  const r = run(JSON.stringify({ tool_input: { command: 'git push origin :main' } }), work);
  assert.strictEqual(r.status, 0, r.stderr);
  cleanup(dir);
});

test('a normal HEAD:branch refspec push is scanned, not treated as deletion', () => {
  const { dir, work } = makeRemoteWorkspace();
  commitFile(work, 'Ref.tsx', 'const x = "BAD_TOKEN";\n', 'x');
  const r = run(JSON.stringify({ tool_input: { command: 'git push origin HEAD:main' } }), work);
  assert.strictEqual(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes('Ref.tsx'), r.stderr);
  cleanup(dir);
});

test('scans the pushed ref, not the checked-out branch', () => {
  const { dir, work } = makeRemoteWorkspace();
  spawnSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: work });
  commitFile(work, 'Feat.tsx', 'const x = "BAD_TOKEN";\n', 'feat');
  spawnSync('git', ['checkout', '-q', 'main'], { cwd: work });
  const r = run(JSON.stringify({ tool_input: { command: 'git push origin feature' } }), work);
  assert.strictEqual(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes('Feat.tsx'), r.stderr);
  cleanup(dir);
});

test('does not block on the checked-out branch when a clean other branch is pushed', () => {
  const { dir, work } = makeRemoteWorkspace();
  commitFile(work, 'Dirty.tsx', 'const x = "BAD_TOKEN";\n', 'dirty main');
  spawnSync('git', ['checkout', '-q', '-b', 'feature', 'origin/main'], { cwd: work });
  commitFile(work, 'Clean.tsx', 'const x = "GOOD_TOKEN";\n', 'clean feat');
  spawnSync('git', ['checkout', '-q', 'main'], { cwd: work });
  const r = run(JSON.stringify({ tool_input: { command: 'git push origin feature' } }), work);
  assert.strictEqual(r.status, 0, r.stderr);
  cleanup(dir);
});

test('multi-ref push is blocked when any pushed ref violates', () => {
  const { dir, work } = makeRemoteWorkspace();
  spawnSync('git', ['checkout', '-q', '-b', 'clean', 'origin/main'], { cwd: work });
  commitFile(work, 'CleanRef.tsx', 'const x = "GOOD_TOKEN";\n', 'clean');
  spawnSync('git', ['checkout', '-q', '-b', 'bad', 'origin/main'], { cwd: work });
  commitFile(work, 'BadRef.tsx', 'const x = "BAD_TOKEN";\n', 'bad');
  spawnSync('git', ['checkout', '-q', 'main'], { cwd: work });
  const r = run(JSON.stringify({ tool_input: { command: 'git push origin clean bad' } }), work);
  assert.strictEqual(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes('BadRef.tsx'), r.stderr);
  cleanup(dir);
});

test('a trailing comment with a colon token is not read as a deletion', () => {
  const { dir, work } = makeRemoteWorkspace();
  commitFile(work, 'Cmt.tsx', 'const x = "BAD_TOKEN";\n', 'x');
  const r = run(JSON.stringify({ tool_input: { command: 'git push origin main # cleanup :stuff' } }), work);
  assert.strictEqual(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes('Cmt.tsx'), r.stderr);
  cleanup(dir);
});

test('dry-run push is skipped', () => {
  const { dir, work } = makeRemoteWorkspace();
  commitFile(work, 'Dry.tsx', 'const x = "BAD_TOKEN";\n', 'x');
  const r = run(JSON.stringify({ tool_input: { command: 'git push --dry-run' } }), work);
  assert.strictEqual(r.status, 0, r.stderr);
  cleanup(dir);
});

test('tag-only push is skipped', () => {
  const { dir, work } = makeRemoteWorkspace();
  commitFile(work, 'Tagged.tsx', 'const x = "BAD_TOKEN";\n', 'x');
  spawnSync('git', ['tag', 'v1'], { cwd: work });
  const r = run(JSON.stringify({ tool_input: { command: 'git push origin --tags' } }), work);
  assert.strictEqual(r.status, 0, r.stderr);
  cleanup(dir);
});

test('strips quotes from a quoted refspec', () => {
  const { dir, work } = makeRemoteWorkspace();
  spawnSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: work });
  commitFile(work, 'Quoted.tsx', 'const x = "BAD_TOKEN";\n', 'q');
  spawnSync('git', ['checkout', '-q', 'main'], { cwd: work });
  const r = run(JSON.stringify({ tool_input: { command: "git push origin 'feature'" } }), work);
  assert.strictEqual(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes('Quoted.tsx'), r.stderr);
  cleanup(dir);
});

test('a value-taking flag does not consume the HEAD push (--repo origin)', () => {
  const { dir, work } = makeRemoteWorkspace();
  commitFile(work, 'Repo.tsx', 'const x = "BAD_TOKEN";\n', 'r');
  const r = run(JSON.stringify({ tool_input: { command: 'git push --repo myproj origin' } }), work);
  assert.strictEqual(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes('Repo.tsx'), r.stderr);
  cleanup(dir);
});

test('scans the real push in a chain after a dry-run', () => {
  const { dir, work } = makeRemoteWorkspace();
  commitFile(work, 'Chain.tsx', 'const x = "BAD_TOKEN";\n', 'c');
  const r = run(JSON.stringify({ tool_input: { command: 'git push --dry-run && git push origin main' } }), work);
  assert.strictEqual(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes('Chain.tsx'), r.stderr);
  cleanup(dir);
});

test('scans the real push in a chain after a deletion', () => {
  const { dir, work } = makeRemoteWorkspace();
  commitFile(work, 'Chain2.tsx', 'const x = "BAD_TOKEN";\n', 'c');
  const r = run(JSON.stringify({ tool_input: { command: 'git push origin --delete old && git push origin main' } }), work);
  assert.strictEqual(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes('Chain2.tsx'), r.stderr);
  cleanup(dir);
});

test('a combined commit-and-push command still scans the push range', () => {
  const { dir, work } = makeRemoteWorkspace();
  commitFile(work, 'Amend.tsx', 'const x = "BAD_TOKEN";\n', 'committed earlier');
  const r = run(JSON.stringify({ tool_input: { command: 'git commit --amend --no-edit && git push -f' } }), work);
  assert.strictEqual(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes('Amend.tsx'), r.stderr);
  cleanup(dir);
});

test('a push wrapped in command substitution is still scanned', () => {
  const { dir, work } = makeRemoteWorkspace();
  spawnSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: work });
  commitFile(work, 'Subshell.tsx', 'const x = "BAD_TOKEN";\n', 's');
  spawnSync('git', ['checkout', '-q', 'main'], { cwd: work });
  const r = run(JSON.stringify({ tool_input: { command: 'x=$(git push origin feature)' } }), work);
  assert.strictEqual(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes('Subshell.tsx'), r.stderr);
  cleanup(dir);
});

test('an unresolvable ref token falls back to scanning HEAD', () => {
  const { dir, work } = makeRemoteWorkspace();
  commitFile(work, 'Fallback.tsx', 'const x = "BAD_TOKEN";\n', 'f');
  const r = run(JSON.stringify({ tool_input: { command: 'git push origin $BRANCH' } }), work);
  assert.strictEqual(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes('Fallback.tsx'), r.stderr);
  cleanup(dir);
});

test('fails open when no upstream and no origin/HEAD resolve', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-conformance-noremote-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.claude', 'specs', 'design'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'specs', 'design', 'demo.md'), [
    '---', 'name: demo', 'applies_to:', '  - "**/*.tsx"', 'category: design',
    'conformance_rules:', '  - name: ban-bad-token', '    pattern: "BAD_TOKEN"',
    '    message: "use GOOD_TOKEN instead"', '---'
  ].join('\n'));
  commitFile(dir, 'Bar.tsx', 'const x = "BAD_TOKEN";\n', 'orphan');
  const r = run(JSON.stringify({ tool_input: { command: 'git push' } }), dir);
  assert.strictEqual(r.status, 0, r.stderr);
  cleanup(dir);
});

console.log('\ncheck-spec-conformance: command-position anchoring (#642)');

test('predicates ignore the phrase inside a quoted argument', () => {
  assert.strictEqual(isGitCommit('echo "git commit"'), false);
  assert.strictEqual(isGitPush('grep "git push" build.log'), false);
  assert.strictEqual(isPrCreate('echo "gh pr create"'), false);
});

test('predicates match a real command at a command position', () => {
  assert.strictEqual(isGitCommit('git commit -m x'), true);
  assert.strictEqual(isGitPush('git commit -m "x" && git push'), true);
  assert.strictEqual(isPrCreate('gh pr create --fill'), true);
});

test('command-substitution push is still detected (no safety regression)', () => {
  assert.strictEqual(isGitPush('x=$(git push origin feature)'), true);
});

test('integration: a substring-in-argument commit does not trigger a scan', () => {
  const dir = makeWorkspace();
  fs.writeFileSync(path.join(dir, 'Bad.tsx'), 'export const x = "BAD_TOKEN";\n');
  spawnSync('git', ['add', 'Bad.tsx'], { cwd: dir });
  // The staged diff DOES violate, but the command only mentions "git commit"
  // inside a grep argument, so the gate must not scan -> exit 0.
  const r = run(JSON.stringify({ tool_input: { command: 'grep "git commit" Bad.tsx' } }), dir);
  assert.strictEqual(r.status, 0, r.stderr);
  cleanup(dir);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
