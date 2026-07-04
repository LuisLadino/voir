#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CENTRAL_DOC_ROOTS,
  GUARD_TABLE,
  fileSignalMatches,
  dirSignalMatches,
  colocatedDocRoots,
  resolveDocRoots,
} = require('./doc-coverage-structure.cjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.stack}`); }
}

function withTempProject(fn) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'doc-struct-')));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function mkdir(dir, rel) { fs.mkdirSync(path.join(dir, rel), { recursive: true }); }
function touch(dir, rel, body = 'x') {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

console.log('fileSignalMatches');

test('a literal name resolves to itself only when the file exists', () => {
  withTempProject(dir => {
    touch(dir, 'Dockerfile');
    assert.deepStrictEqual(fileSignalMatches(dir, 'Dockerfile'), ['Dockerfile']);
    assert.deepStrictEqual(fileSignalMatches(dir, 'docker-compose.yml'), []);
  });
});

test('a glob expands to every matching top-level file (the multi-app Fly case)', () => {
  withTempProject(dir => {
    touch(dir, 'fly.toml');
    touch(dir, 'fly.runtime.toml');
    touch(dir, 'netlify.toml');                 // must NOT match fly*.toml
    assert.deepStrictEqual(fileSignalMatches(dir, 'fly*.toml'), ['fly.runtime.toml', 'fly.toml']);
  });
});

test('fly*.toml matches a single plain fly.toml', () => {
  withTempProject(dir => {
    touch(dir, 'fly.toml');
    assert.deepStrictEqual(fileSignalMatches(dir, 'fly*.toml'), ['fly.toml']);
  });
});

test('a glob does not match a directory of the same shape', () => {
  withTempProject(dir => {
    mkdir(dir, 'fly.d.toml');                    // a directory, not a file
    assert.deepStrictEqual(fileSignalMatches(dir, 'fly*.toml'), []);
  });
});

test('a glob over a missing project root returns empty, does not throw', () => {
  assert.deepStrictEqual(fileSignalMatches(path.join(os.tmpdir(), 'nope-' + process.pid), 'fly*.toml'), []);
});

console.log('the guard table carries the Fly glob');

test('deploy files glob fly*.toml instead of the literal fly.toml', () => {
  const deploy = GUARD_TABLE.find(c => c.category === 'deploy');
  assert.ok(deploy.files.includes('fly*.toml'));
  assert.ok(!deploy.files.includes('fly.toml'));
});

console.log('dirSignalMatches');

test('a top-level guard dir and its src/ variant both resolve', () => {
  withTempProject(dir => {
    mkdir(dir, 'services');
    mkdir(dir, 'src/services');
    assert.deepStrictEqual(dirSignalMatches(dir, 'services').sort(), ['services', 'src/services']);
  });
});

console.log('colocatedDocRoots / resolveDocRoots');

test('colocatedDocRoots surfaces existing guard-table code dirs (top level and src/)', () => {
  withTempProject(dir => {
    mkdir(dir, 'services');
    mkdir(dir, 'src/connectors');
    mkdir(dir, 'frontend');                      // not a guard-table area — ignored
    assert.deepStrictEqual(colocatedDocRoots(dir).sort(), ['services', 'src/connectors']);
  });
});

test('colocatedDocRoots excludes nested infra paths like .github/workflows', () => {
  withTempProject(dir => {
    mkdir(dir, '.github/workflows');             // deploy signal, but config not a doc home
    assert.deepStrictEqual(colocatedDocRoots(dir), []);
  });
});

test('resolveDocRoots puts central roots first, then co-located, deduped', () => {
  withTempProject(dir => {
    mkdir(dir, 'services');
    assert.deepStrictEqual(resolveDocRoots(dir), [...CENTRAL_DOC_ROOTS, 'services']);
  });
});

test('resolveDocRoots appends caller extras and drops duplicates', () => {
  withTempProject(dir => {
    mkdir(dir, 'services');
    assert.deepStrictEqual(
      resolveDocRoots(dir, ['services', 'extra-docs']),
      [...CENTRAL_DOC_ROOTS, 'services', 'extra-docs'],
    );
  });
});

test('resolveDocRoots on a project with no code areas is just the central roots', () => {
  withTempProject(dir => {
    assert.deepStrictEqual(resolveDocRoots(dir), CENTRAL_DOC_ROOTS);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
