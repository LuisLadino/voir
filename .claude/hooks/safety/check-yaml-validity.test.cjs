#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, 'check-yaml-validity.cjs');

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
  return spawnSync('node', [HOOK], { cwd, input: stdin, encoding: 'utf8' });
}

const VALID_YAML = 'name: demo\nlist:\n  - a\n  - b\n';
// A second `: ` inside a plain scalar value — the #892 motivating construct.
const INVALID_YAML = 'components:\n  - agent latency (in: 0.1s, out: 0.2s)\n';

// Minimal repo with one committed valid .claude yaml as a baseline.
function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-yaml-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.claude', 'specs', 'architecture'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'specs', 'architecture', 'system-map.yaml'), VALID_YAML);
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '-m', 'baseline'], { cwd: dir });
  return dir;
}

function stage(dir, rel, body) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  spawnSync('git', ['add', rel], { cwd: dir });
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('check-yaml-validity: commit gate');

test('exits 0 when the command is not a git commit/push', () => {
  const dir = makeWorkspace();
  const r = run(JSON.stringify({ tool_input: { command: 'ls -la' } }), dir);
  assert.strictEqual(r.status, 0, r.stderr);
  cleanup(dir);
});

test('allows a commit of a valid .claude .yaml', () => {
  const dir = makeWorkspace();
  stage(dir, '.claude/specs/architecture/system-map.yaml', VALID_YAML + 'extra: value\n');
  const r = run(JSON.stringify({ tool_input: { command: 'git commit -m x' } }), dir);
  assert.strictEqual(r.status, 0, r.stderr);
  cleanup(dir);
});

test('blocks a commit of an invalid .claude .yaml and names file:line', () => {
  const dir = makeWorkspace();
  stage(dir, '.claude/specs/architecture/system-map.yaml', INVALID_YAML);
  const r = run(JSON.stringify({ tool_input: { command: 'git commit -m x' } }), dir);
  assert.strictEqual(r.status, 2, `expected block, got ${r.status}\n${r.stderr}`);
  assert.ok(r.stderr.includes('.claude/specs/architecture/system-map.yaml:2'), r.stderr);
  assert.ok(/mapping value/.test(r.stderr), r.stderr);
  cleanup(dir);
});

test('blocks a commit of an invalid top-level .claude .yaml (voice.yaml scope)', () => {
  const dir = makeWorkspace();
  stage(dir, '.claude/voice.yaml', 'a: 1\na: 2\n');
  const r = run(JSON.stringify({ tool_input: { command: 'git commit -m x' } }), dir);
  assert.strictEqual(r.status, 2, r.stderr);
  assert.ok(/duplicate key/.test(r.stderr), r.stderr);
  cleanup(dir);
});

test('ignores an invalid .md spec (frontmatter, not whole-doc yaml)', () => {
  const dir = makeWorkspace();
  stage(dir, '.claude/specs/kit/bad.md', '---\nname: x\nnote: a (b: c)\n---\n');
  const r = run(JSON.stringify({ tool_input: { command: 'git commit -m x' } }), dir);
  assert.strictEqual(r.status, 0, r.stderr);
  cleanup(dir);
});

test('ignores an invalid .yaml outside .claude', () => {
  const dir = makeWorkspace();
  stage(dir, 'config/app.yaml', INVALID_YAML);
  const r = run(JSON.stringify({ tool_input: { command: 'git commit -m x' } }), dir);
  assert.strictEqual(r.status, 0, r.stderr);
  cleanup(dir);
});

test('exits 0 when nothing is staged', () => {
  const dir = makeWorkspace();
  const r = run(JSON.stringify({ tool_input: { command: 'git commit -m x' } }), dir);
  assert.strictEqual(r.status, 0, r.stderr);
  cleanup(dir);
});

test('does not fire on the phrase inside a quoted argument', () => {
  const dir = makeWorkspace();
  stage(dir, '.claude/board.yaml', INVALID_YAML);
  const r = run(JSON.stringify({ tool_input: { command: 'echo "git commit"' } }), dir);
  assert.strictEqual(r.status, 0, r.stderr);
  cleanup(dir);
});

console.log('\ncheck-yaml-validity: push gate');

// Work tree wired to a bare origin. Commits go in directly, bypassing the
// commit gate — the path the push gate exists to catch.
function makeRemoteWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-yaml-push-'));
  const origin = path.join(dir, 'origin.git');
  const work = path.join(dir, 'work');
  spawnSync('git', ['init', '-q', '--bare', origin], { cwd: dir });
  spawnSync('git', ['init', '-q', '-b', 'main', work], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 't@example.com'], { cwd: work });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: work });
  fs.mkdirSync(path.join(work, '.claude', 'specs', 'architecture'), { recursive: true });
  fs.writeFileSync(path.join(work, '.claude', 'specs', 'architecture', 'system-map.yaml'), VALID_YAML);
  fs.writeFileSync(path.join(work, 'README.md'), 'baseline\n');
  spawnSync('git', ['add', '-A'], { cwd: work });
  spawnSync('git', ['commit', '-q', '-m', 'baseline'], { cwd: work });
  spawnSync('git', ['remote', 'add', 'origin', origin], { cwd: work });
  spawnSync('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: work });
  spawnSync('git', ['remote', 'set-head', 'origin', 'main'], { cwd: work });
  return { dir, work };
}

function commitFile(work, name, body, message) {
  const abs = path.join(work, name);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  spawnSync('git', ['add', name], { cwd: work });
  spawnSync('git', ['commit', '-q', '-m', message], { cwd: work });
}

test('blocks a push when a pending commit carries invalid .claude .yaml', () => {
  const { dir, work } = makeRemoteWorkspace();
  commitFile(work, '.claude/specs/architecture/system-map.yaml', INVALID_YAML, 'sneak');
  const r = run(JSON.stringify({ tool_input: { command: 'git push' } }), work);
  assert.strictEqual(r.status, 2, `expected block, got ${r.status}\n${r.stderr}`);
  assert.ok(r.stderr.includes('.claude/specs/architecture/system-map.yaml'), r.stderr);
  cleanup(dir);
});

test('allows a push when pending .claude .yaml is valid', () => {
  const { dir, work } = makeRemoteWorkspace();
  commitFile(work, '.claude/specs/architecture/system-map.yaml', VALID_YAML + 'extra: ok\n', 'clean');
  const r = run(JSON.stringify({ tool_input: { command: 'git push' } }), work);
  assert.strictEqual(r.status, 0, r.stderr);
  cleanup(dir);
});

test('gh pr create is gated like push', () => {
  const { dir, work } = makeRemoteWorkspace();
  commitFile(work, '.claude/specs/architecture/system-map.yaml', INVALID_YAML, 'sneak');
  const r = run(JSON.stringify({ tool_input: { command: 'gh pr create --fill' } }), work);
  assert.strictEqual(r.status, 2, r.stderr);
  cleanup(dir);
});

test('skips a --delete push (no incoming content)', () => {
  const { dir, work } = makeRemoteWorkspace();
  commitFile(work, '.claude/specs/architecture/system-map.yaml', INVALID_YAML, 'sneak');
  const r = run(JSON.stringify({ tool_input: { command: 'git push origin --delete main' } }), work);
  assert.strictEqual(r.status, 0, r.stderr);
  cleanup(dir);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
