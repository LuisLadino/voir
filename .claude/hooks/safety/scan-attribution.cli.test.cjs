#!/usr/bin/env node
// CLI integration tests for scan-attribution.cjs. Spawns the script as a
// subprocess to verify exit codes, stdin handling, and file handling.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, 'scan-attribution.cjs');

let passed = 0;
let failed = 0;
const failures = [];

function run(args, stdin) {
  return spawnSync('node', [SCRIPT, ...args], {
    input: stdin,
    encoding: 'utf-8',
  });
}

function assertExit(name, result, expected) {
  if (result.status === expected) {
    passed++;
  } else {
    failed++;
    failures.push({
      name,
      expected,
      got: result.status,
      stderr: result.stderr,
      stdout: result.stdout,
    });
  }
}

// Setup temp files for file-mode tests
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-cli-test-'));
const cleanFile = path.join(tempDir, 'clean.txt');
const dirtyFile = path.join(tempDir, 'dirty.txt');
fs.writeFileSync(cleanFile, 'fix: resolve login bug');
fs.writeFileSync(dirtyFile, 'feat: bug\n\nCo-Authored-By: Claude <noreply@anthropic.com>');

// No arg -> exit 2
assertExit('no arg exits 2', run([]), 2);

// Bad file -> exit 2
assertExit('missing file exits 2', run([path.join(tempDir, 'does-not-exist.txt')]), 2);

// File with attribution -> exit 1
assertExit('file with attribution exits 1', run([dirtyFile]), 1);

// Clean file -> exit 0
assertExit('clean file exits 0', run([cleanFile]), 0);

// --stdin with attribution -> exit 1
assertExit(
  'stdin with attribution exits 1',
  run(['--stdin'], 'feat: bug\n\nCo-Authored-By: Claude <x@example.com>'),
  1
);

// --stdin clean -> exit 0
assertExit('stdin clean exits 0', run(['--stdin'], 'feat: resolve bug'), 0);

// Cleanup
fs.rmSync(tempDir, { recursive: true, force: true });

console.log(`${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log('');
  for (const f of failures) {
    console.log(`FAIL ${f.name}: expected exit ${f.expected}, got ${f.got}`);
    if (f.stderr) console.log(`  stderr: ${f.stderr.trim()}`);
  }
  process.exit(1);
}

process.exit(0);
