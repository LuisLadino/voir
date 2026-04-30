#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  evaluate,
  isClientMode,
  excludeContainsClaude,
  warningActive,
  warningBroken,
  run
} = require('./client-mode-warning.cjs');

let pass = 0;
let fail = 0;

function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) {
    fail++;
    console.error(`  FAIL ${name}`);
    console.error('       ' + (e.stack || e.message).replace(/\n/g, '\n       '));
  }
}

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmw-'));
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.git', 'info'), { recursive: true });
  return dir;
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

console.log('isClientMode');

test('returns false when kit-mode.yaml missing', () => {
  const dir = makeFixture();
  try {
    assert.strictEqual(isClientMode(dir), false);
  } finally { rmrf(dir); }
});

test('returns true for mode: client', () => {
  const dir = makeFixture();
  try {
    fs.writeFileSync(path.join(dir, '.claude/kit-mode.yaml'), 'mode: client\n');
    assert.strictEqual(isClientMode(dir), true);
  } finally { rmrf(dir); }
});

test('returns true for mode:client (no space)', () => {
  const dir = makeFixture();
  try {
    fs.writeFileSync(path.join(dir, '.claude/kit-mode.yaml'), 'mode:client\n');
    assert.strictEqual(isClientMode(dir), true);
  } finally { rmrf(dir); }
});

test('returns false for mode: personal', () => {
  const dir = makeFixture();
  try {
    fs.writeFileSync(path.join(dir, '.claude/kit-mode.yaml'), 'mode: personal\n');
    assert.strictEqual(isClientMode(dir), false);
  } finally { rmrf(dir); }
});

test('case-sensitive: rejects mode: CLIENT', () => {
  const dir = makeFixture();
  try {
    fs.writeFileSync(path.join(dir, '.claude/kit-mode.yaml'), 'mode: CLIENT\n');
    assert.strictEqual(isClientMode(dir), false);
  } finally { rmrf(dir); }
});

console.log('\nexcludeContainsClaude');

test('returns false when exclude file missing', () => {
  const dir = makeFixture();
  try {
    assert.strictEqual(excludeContainsClaude(dir), false);
  } finally { rmrf(dir); }
});

test('returns true for .claude/ entry', () => {
  const dir = makeFixture();
  try {
    fs.writeFileSync(path.join(dir, '.git/info/exclude'), '# test\n.claude/\n');
    assert.strictEqual(excludeContainsClaude(dir), true);
  } finally { rmrf(dir); }
});

test('returns true for .claude entry without slash', () => {
  const dir = makeFixture();
  try {
    fs.writeFileSync(path.join(dir, '.git/info/exclude'), '.claude\n');
    assert.strictEqual(excludeContainsClaude(dir), true);
  } finally { rmrf(dir); }
});

test('ignores comments containing .claude/', () => {
  const dir = makeFixture();
  try {
    fs.writeFileSync(path.join(dir, '.git/info/exclude'), '# .claude/ should be excluded\n');
    assert.strictEqual(excludeContainsClaude(dir), false);
  } finally { rmrf(dir); }
});

test('returns false when exclude has only unrelated entries', () => {
  const dir = makeFixture();
  try {
    fs.writeFileSync(path.join(dir, '.git/info/exclude'), 'node_modules/\n*.log\n');
    assert.strictEqual(excludeContainsClaude(dir), false);
  } finally { rmrf(dir); }
});

console.log('\nevaluate');

test('not-client when kit-mode.yaml missing', () => {
  const dir = makeFixture();
  try {
    assert.strictEqual(evaluate(dir).state, 'not-client');
  } finally { rmrf(dir); }
});

test('not-client when mode is personal', () => {
  const dir = makeFixture();
  try {
    fs.writeFileSync(path.join(dir, '.claude/kit-mode.yaml'), 'mode: personal\n');
    fs.writeFileSync(path.join(dir, '.git/info/exclude'), '.claude/\n');
    assert.strictEqual(evaluate(dir).state, 'not-client');
  } finally { rmrf(dir); }
});

test('client-active when mode client and exclude has .claude/', () => {
  const dir = makeFixture();
  try {
    fs.writeFileSync(path.join(dir, '.claude/kit-mode.yaml'), 'mode: client\n');
    fs.writeFileSync(path.join(dir, '.git/info/exclude'), '.claude/\n');
    assert.strictEqual(evaluate(dir).state, 'client-active');
  } finally { rmrf(dir); }
});

test('broken-exclude when mode client but exclude missing entry', () => {
  const dir = makeFixture();
  try {
    fs.writeFileSync(path.join(dir, '.claude/kit-mode.yaml'), 'mode: client\n');
    fs.writeFileSync(path.join(dir, '.git/info/exclude'), '# no claude entry\n');
    assert.strictEqual(evaluate(dir).state, 'broken-exclude');
  } finally { rmrf(dir); }
});

test('broken-exclude when mode client but exclude file absent', () => {
  const dir = makeFixture();
  try {
    fs.writeFileSync(path.join(dir, '.claude/kit-mode.yaml'), 'mode: client\n');
    assert.strictEqual(evaluate(dir).state, 'broken-exclude');
  } finally { rmrf(dir); }
});

console.log('\nwarning content');

test('active warning mentions .git/info/exclude', () => {
  assert.ok(warningActive().includes('.git/info/exclude'));
});

test('active warning explicitly contrasts with .gitignore', () => {
  assert.ok(/NOT \.gitignore/.test(warningActive()));
});

test('active warning includes verification commands', () => {
  const w = warningActive();
  assert.ok(w.includes('git check-ignore'));
  assert.ok(w.includes('cat .git/info/exclude'));
});

test('broken warning instructs sync-kit re-run', () => {
  assert.ok(warningBroken().includes('sync-kit.sh'));
});

console.log('\nrun() side effects');

test('run prints active warning to stdout in client mode', () => {
  const dir = makeFixture();
  const origWrite = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = (chunk) => { captured += chunk; return true; };
  try {
    fs.writeFileSync(path.join(dir, '.claude/kit-mode.yaml'), 'mode: client\n');
    fs.writeFileSync(path.join(dir, '.git/info/exclude'), '.claude/\n');
    const r = run(dir);
    assert.strictEqual(r.state, 'client-active');
    assert.ok(captured.includes('CLIENT MODE: .claude/ EXCLUDED FROM COMMITS'));
  } finally {
    process.stdout.write = origWrite;
    rmrf(dir);
  }
});

test('run is silent in non-client repo', () => {
  const dir = makeFixture();
  const origWrite = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = (chunk) => { captured += chunk; return true; };
  try {
    const r = run(dir);
    assert.strictEqual(r.state, 'not-client');
    assert.strictEqual(captured, '');
  } finally {
    process.stdout.write = origWrite;
    rmrf(dir);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
