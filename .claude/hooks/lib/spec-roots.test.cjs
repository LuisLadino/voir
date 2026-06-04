#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getSpecRoots } = require('./spec-roots.cjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.stack}`); }
}

function withTempProject(fn) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'spec-roots-')));
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

console.log('getSpecRoots');

test('personal mode, no config: single de-duplicated root at .claude/specs', () => {
  withTempProject(dir => {
    const r = getSpecRoots(dir);
    assert.strictEqual(r.projectRootRelative, '.claude/specs');
    assert.strictEqual(r.roots.length, 1);
    assert.strictEqual(r.roots[0], path.join(dir, '.claude/specs'));
  });
});

test('client mode, no config: project root defaults to docs/specs', () => {
  withTempProject(dir => {
    fs.writeFileSync(path.join(dir, '.claude/kit-mode.yaml'), 'mode: client\n');
    const r = getSpecRoots(dir);
    assert.strictEqual(r.projectRootRelative, 'docs/specs');
    assert.strictEqual(r.roots.length, 2);
    assert.strictEqual(r.roots[0], path.join(dir, '.claude/specs'));
    assert.strictEqual(r.roots[1], path.join(dir, 'docs/specs'));
  });
});

test('explicit config overrides the mode default', () => {
  withTempProject(dir => {
    fs.writeFileSync(path.join(dir, '.claude/kit-mode.yaml'), 'mode: client\n');
    fs.writeFileSync(path.join(dir, '.claude/specs.yaml'), 'project_specs_root: custom/specs\n');
    const r = getSpecRoots(dir);
    assert.strictEqual(r.projectRootRelative, 'custom/specs');
    assert.deepStrictEqual(r.roots, [
      path.join(dir, '.claude/specs'),
      path.join(dir, 'custom/specs')
    ]);
  });
});

test('quoted config value is unquoted', () => {
  withTempProject(dir => {
    fs.writeFileSync(path.join(dir, '.claude/specs.yaml'), 'project_specs_root: "docs/specs"\n');
    const r = getSpecRoots(dir);
    assert.strictEqual(r.projectRootRelative, 'docs/specs');
  });
});

test('config pointing back at .claude/specs de-duplicates to one root', () => {
  withTempProject(dir => {
    fs.writeFileSync(path.join(dir, '.claude/specs.yaml'), 'project_specs_root: .claude/specs\n');
    const r = getSpecRoots(dir);
    assert.strictEqual(r.roots.length, 1);
  });
});

test('personal mode is the default when kit-mode.yaml is absent', () => {
  withTempProject(dir => {
    const r = getSpecRoots(dir);
    assert.strictEqual(r.projectRootRelative, '.claude/specs');
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
