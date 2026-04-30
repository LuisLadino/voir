#!/usr/bin/env node

/**
 * Downstream-environment simulation.
 *
 * Proves enforce-voice.cjs works in a project that does not have the `yaml`
 * npm module (or any node_modules) resolvable. This was the silent-failure
 * regression in #189: tests passed inside claude-kit where `yaml` was
 * installed; hooks ran in downstream projects where it was not.
 *
 * Strategy: copy the subset of .claude/hooks/ needed by enforce-voice into a
 * tempdir that has NO node_modules directory, then spawn node with the tempdir
 * as cwd and NODE_PATH unset. Require the hook. If any file-level require
 * reaches for a missing external module, the hook crashes here.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error('       ' + (e.stack || e.message).replace(/\n/g, '\n       '));
  }
}

const kitRoot = path.resolve(__dirname, '../../..');

const HOOKS_TO_COPY = [
  'context/enforce-voice.cjs',
  'lib/voice-registry.cjs',
  'lib/yaml-mini.cjs',
  'lib/session-utils.cjs',
  'lib/project-root.cjs',
  'lib/stdin-hook.cjs'
];

function makeDownstreamClone() {
  const rawDir = fs.mkdtempSync(path.join(os.tmpdir(), 'downstream-env-'));
  const dir = fs.realpathSync(rawDir);
  const hooksRoot = path.join(dir, '.claude/hooks');
  fs.mkdirSync(path.join(hooksRoot, 'context'), { recursive: true });
  fs.mkdirSync(path.join(hooksRoot, 'lib'), { recursive: true });
  for (const rel of HOOKS_TO_COPY) {
    const src = path.join(kitRoot, '.claude/hooks', rel);
    const dst = path.join(hooksRoot, rel);
    fs.copyFileSync(src, dst);
  }
  // Sanity: NO node_modules anywhere under the tempdir
  assert.strictEqual(fs.existsSync(path.join(dir, 'node_modules')), false,
    'setup: downstream clone must have no node_modules');
  return dir;
}

function writeFile(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function runHookFromDir(dir, payload) {
  const hookPath = path.join(dir, '.claude/hooks/context/enforce-voice.cjs');
  const env = { ...process.env };
  delete env.NODE_PATH;
  const res = spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(payload),
    cwd: dir,
    env,
    encoding: 'utf8'
  });
  return { exitCode: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('voice-registry loads in downstream env (no yaml module resolvable)', () => {
  const dir = makeDownstreamClone();
  try {
    const out = spawnSync(
      process.execPath,
      ['-e', `require('${path.join(dir, '.claude/hooks/lib/voice-registry.cjs')}'); console.log('OK');`],
      { cwd: dir, encoding: 'utf8' }
    );
    assert.strictEqual(out.status, 0, `expected exit 0, got ${out.status}. stderr: ${out.stderr}`);
    assert.ok(out.stdout.includes('OK'), 'expected OK on stdout');
  } finally {
    cleanup(dir);
  }
});

test('enforce-voice blocks Write to declared .md path with Luis voice (downstream env)', () => {
  const dir = makeDownstreamClone();
  try {
    writeFile(dir, '.claude/voice.yaml', `default: luis

voices:
  luis:
    rules: |
      No em dashes. Use periods or colons.
      No corporate speak.
  none:
    rules: null

paths:
  - match: "README.md"
    voice: luis
`);
    const payload = {
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(dir, 'README.md'),
        content: 'Leverage synergy to ensure passionate outcomes — world-class results.'
      },
      session_id: 'ds-test'
    };
    const r = runHookFromDir(dir, payload);
    assert.strictEqual(r.exitCode, 2, `expected block (exit 2), got ${r.exitCode}. stderr: ${r.stderr}`);
    assert.ok(r.stderr.includes('VOICE CHECK: luis'),
      `expected Luis voice reminder on stderr, got: ${r.stderr}`);
  } finally {
    cleanup(dir);
  }
});

test('enforce-voice allows Write to undeclared .md (downstream env, Plane 1 default-skip)', () => {
  const dir = makeDownstreamClone();
  try {
    writeFile(dir, '.claude/voice.yaml', `default: luis

voices:
  luis:
    rules: |
      No em dashes.
  none:
    rules: null
`);
    const payload = {
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(dir, 'README.md'),
        content: 'Some content with an em dash — should pass under default-skip.'
      },
      session_id: 'ds-test'
    };
    const r = runHookFromDir(dir, payload);
    assert.strictEqual(r.exitCode, 0, `expected allow (exit 0), got ${r.exitCode}. stderr: ${r.stderr}`);
  } finally {
    cleanup(dir);
  }
});

test('enforce-voice allows path routed to `none` (downstream env)', () => {
  const dir = makeDownstreamClone();
  try {
    writeFile(dir, '.claude/voice.yaml', `default: luis

voices:
  luis:
    rules: |
      No em dashes.
  none:
    rules: null

paths:
  - match: "prompts/**"
    voice: none
`);
    const payload = {
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(dir, 'prompts/attack.md'),
        content: 'Leverage synergy to ensure passionate outcomes — world-class results.'
      },
      session_id: 'ds-test'
    };
    const r = runHookFromDir(dir, payload);
    assert.strictEqual(r.exitCode, 0, `expected allow (exit 0), got ${r.exitCode}. stderr: ${r.stderr}`);
  } finally {
    cleanup(dir);
  }
});

test('enforce-voice parses voice.yaml with block scalar rules (downstream env)', () => {
  const dir = makeDownstreamClone();
  try {
    writeFile(dir, '.claude/voice.yaml', `default: luis

voices:
  luis:
    rules: |
      No em dashes. Use periods or colons.
      No parens. Use a comma, colon, or new sentence.
      No corporate speak.
      Active voice, short sentences, contractions.

paths:
  - match: "note.md"
    voice: luis
`);
    const payload = {
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(dir, 'note.md'),
        content: 'This is a test — it has an em dash.'
      },
      session_id: 'ds-test'
    };
    const r = runHookFromDir(dir, payload);
    assert.strictEqual(r.exitCode, 2, `expected block (exit 2), got ${r.exitCode}. stderr: ${r.stderr}`);
    assert.ok(r.stderr.includes('No em dashes'),
      `expected block scalar rule content in reminder, got: ${r.stderr}`);
  } finally {
    cleanup(dir);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
