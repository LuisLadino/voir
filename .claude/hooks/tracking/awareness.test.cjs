#!/usr/bin/env node

/**
 * Tests for awareness hook cooldown isolation and cleanup.
 *
 * Verifies that parallel sessions do not race on a shared cooldown file
 * (#372), that the cleanup pass removes expired files without touching
 * recent ones or unrelated tmpdir files, and that the cooldown filename
 * is sanitized against path traversal.
 *
 * Run:
 *   node .claude/hooks/tracking/awareness.test.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');

function setupTmpdir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awareness-test-'));
  process.env.TMPDIR = dir;
  return dir;
}

function teardownTmpdir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {}
}

const WORKERS = 8;
const WRITES_PER_WORKER = 50;

function runWorker() {
  const { sessionId, count, tmpdir } = JSON.parse(process.argv[2]);
  process.env.TMPDIR = tmpdir;
  const aw = require('./awareness.cjs');
  for (let i = 0; i < count; i++) {
    const file = aw.cooldownFilePath(sessionId);
    let cooldowns = {};
    try { cooldowns = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
    cooldowns.failures = Date.now();
    cooldowns.worker = sessionId;
    cooldowns.iteration = i;
    fs.writeFileSync(file, JSON.stringify(cooldowns));
  }
  process.exit(0);
}

if (process.argv[2] && process.argv[2].startsWith('{')) {
  runWorker();
}

function runTests() {
  let pass = 0, fail = 0;
  const report = (name, ok, detail) => {
    if (ok) { pass++; console.log(`PASS  ${name}`); }
    else    { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
  };

  const tmpdir = setupTmpdir();

  const aw = require('./awareness.cjs');

  const p1 = aw.cooldownFilePath('abc-123');
  report('cooldownFilePath uses session id in filename',
    p1 === path.join(tmpdir, 'claude-awareness-cooldown-abc-123.json'),
    `got ${p1}`);

  const evil = aw.cooldownFilePath('../../etc/passwd');
  report('cooldownFilePath sanitizes path traversal',
    !evil.includes('..') && !evil.includes('/etc/'),
    `got ${evil}`);
  report('cooldownFilePath stays inside tmpdir',
    path.dirname(evil) === tmpdir,
    `got dir ${path.dirname(evil)}`);

  const now = Date.now();
  report('inCooldown false when key absent',
    aw.inCooldown({}, 'failures', now) === false);
  report('inCooldown true within window',
    aw.inCooldown({ failures: now - 60_000 }, 'failures', now) === true);
  report('inCooldown false after window',
    aw.inCooldown({ failures: now - 31 * 60_000 }, 'failures', now) === false);

  const sessionIds = Array.from({ length: WORKERS }, (_, w) => `sess-${w}`);
  const children = sessionIds.map(sid => new Promise((resolve, reject) => {
    const payload = JSON.stringify({ sessionId: sid, count: WRITES_PER_WORKER, tmpdir });
    const child = fork(__filename, [payload], { stdio: 'inherit' });
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`worker ${sid} exited ${code}`)));
  }));

  return Promise.all(children).then(() => {
    let mismatches = 0;
    let missing = 0;
    for (const sid of sessionIds) {
      const file = aw.cooldownFilePath(sid);
      if (!fs.existsSync(file)) { missing++; continue; }
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.worker !== sid) mismatches++;
    }
    report('per-session cooldown files all exist after concurrent writes',
      missing === 0, `${missing} missing of ${WORKERS}`);
    report('per-session cooldown files contain own session id (no cross-contamination)',
      mismatches === 0, `${mismatches} cross-contaminated of ${WORKERS}`);

    const oldFile = path.join(tmpdir, 'claude-awareness-cooldown-old.json');
    const recentFile = path.join(tmpdir, 'claude-awareness-cooldown-recent.json');
    const unrelatedFile = path.join(tmpdir, 'unrelated-file.json');

    fs.writeFileSync(oldFile, '{}');
    fs.writeFileSync(recentFile, '{}');
    fs.writeFileSync(unrelatedFile, 'keep me');

    const ancientMs = (Date.now() - 25 * 60 * 60 * 1000) / 1000;
    fs.utimesSync(oldFile, ancientMs, ancientMs);

    aw.cleanupExpiredCooldowns();

    report('cleanup removes cooldown files older than 24h',
      !fs.existsSync(oldFile));
    report('cleanup keeps cooldown files younger than 24h',
      fs.existsSync(recentFile));
    report('cleanup leaves unrelated tmpdir files untouched',
      fs.existsSync(unrelatedFile));

    teardownTmpdir(tmpdir);

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }).catch(err => {
    console.error(err);
    teardownTmpdir(tmpdir);
    process.exit(1);
  });
}

if (require.main === module && !(process.argv[2] && process.argv[2].startsWith('{'))) {
  runTests();
}
