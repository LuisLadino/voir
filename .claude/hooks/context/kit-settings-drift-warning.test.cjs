'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const h = require('./kit-settings-drift-warning.cjs');

const CREATED = [];
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ksd-'));
  CREATED.push(d);
  return d;
}
function mkKit() {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'settings.template.json'), '{}');
  fs.writeFileSync(path.join(d, 'setup-kit.sh'), '#!/bin/bash\n');
  return d;
}
process.on('exit', () => {
  for (const d of CREATED) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

function captureStdout(fn) {
  const orig = process.stdout.write;
  let out = '';
  process.stdout.write = (s) => { out += s; return true; };
  try { fn(); } finally { process.stdout.write = orig; }
  return out;
}

test('isKitSource: true only when settings.template.json + setup-kit.sh both present', () => {
  assert.strictEqual(h.isKitSource(mkKit()), true);
  assert.strictEqual(h.isKitSource(tmp()), false);
  const onlyTemplate = tmp();
  fs.writeFileSync(path.join(onlyTemplate, 'settings.template.json'), '{}');
  assert.strictEqual(h.isKitSource(onlyTemplate), false);
});

test('checkDrift: maps setup-kit.sh --check exit code to a verdict', () => {
  assert.strictEqual(h.checkDrift('/x', () => ({ status: 1 })), 'drift');
  assert.strictEqual(h.checkDrift('/x', () => ({ status: 0 })), 'clean');
  assert.strictEqual(h.checkDrift('/x', () => ({ status: 2 })), 'unknown');
  assert.strictEqual(h.checkDrift('/x', () => ({ status: null })), 'unknown');
});

test('warningText names the fix and the silencer', () => {
  const t = h.warningText();
  assert.match(t, /KIT SETTINGS DRIFT/);
  assert.match(t, /\.\/setup-kit\.sh/);
  assert.match(t, /CLAUDE_KIT_NO_SETTINGS_DRIFT_WARN=1/);
});

test('run: silenced by env', () => {
  process.env.CLAUDE_KIT_NO_SETTINGS_DRIFT_WARN = '1';
  try {
    assert.strictEqual(h.run().state, 'silenced');
  } finally {
    delete process.env.CLAUDE_KIT_NO_SETTINGS_DRIFT_WARN;
  }
});

test('run: no-op outside the kit source (no template / setup-kit.sh)', () => {
  assert.strictEqual(h.run({ root: tmp() }).state, 'not-kit-source');
});

test('run: drift writes the warning and returns drift', () => {
  const root = mkKit();
  let state;
  const out = captureStdout(() => { state = h.run({ root, checkDrift: () => 'drift' }).state; });
  assert.strictEqual(state, 'drift');
  assert.match(out, /KIT SETTINGS DRIFT/);
});

test('run: clean is silent', () => {
  const root = mkKit();
  const out = captureStdout(() => {
    assert.strictEqual(h.run({ root, checkDrift: () => 'clean' }).state, 'clean');
  });
  assert.strictEqual(out, '');
});

test('run: a thrown check fails open (never breaks SessionStart)', () => {
  const root = mkKit();
  assert.strictEqual(h.run({ root, checkDrift: () => { throw new Error('boom'); } }).state, 'error');
});
