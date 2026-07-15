#!/usr/bin/env node

/**
 * PROJECTS_DIR seam tests (#889).
 *
 * session-utils computes PROJECTS_DIR once at require time, honoring
 * CLAUDE_PROJECTS_DIR before falling back to ~/.claude/projects — the same
 * seam the read-side collector (scripts/collect-analyze-data.cjs) already
 * honors. The test runner points every suite at a temp dir through it, so
 * `npm test` never writes hook-errors.log lines or tracking events into the
 * real projects tree.
 *
 * Because the seam is a module-load constant, each case runs in a child node
 * process with a controlled env.
 *
 * Run: node .claude/hooks/lib/session-utils.projects-dir.test.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SESSION_UTILS = require.resolve('./session-utils.cjs');

let pass = 0;
let fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else    { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

function inChild(script, env) {
  return spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env }
  });
}

// 1. Override set → PROJECTS_DIR is the override, and logError writes land
//    under it. Mirrors the exact #889 leak shape: logError with no
//    workspacePath, resolved from cwd.
{
  const override = fs.mkdtempSync(path.join(os.tmpdir(), 'su-projects-override-'));
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'su-home-'));
  const r = inChild(
    `const su = require(${JSON.stringify(SESSION_UTILS)});
     su.logError('seam-test', 'fixture error, must not reach real log');
     console.log(su.PROJECTS_DIR);`,
    { HOME: fakeHome, CLAUDE_PROJECTS_DIR: override }
  );
  report(
    'CLAUDE_PROJECTS_DIR set: PROJECTS_DIR is the override',
    r.status === 0 && r.stdout.trim() === override,
    `status ${r.status}, stdout ${JSON.stringify(r.stdout)}, stderr ${JSON.stringify(r.stderr)}`
  );

  const written = fs.readdirSync(override).flatMap(slug => {
    const logPath = path.join(override, slug, 'hook-errors.log');
    return fs.existsSync(logPath) ? [fs.readFileSync(logPath, 'utf8')] : [];
  });
  report(
    'CLAUDE_PROJECTS_DIR set: logError writes under the override',
    written.length === 1 && /seam-test: fixture error/.test(written[0]),
    `found ${written.length} log(s): ${JSON.stringify(written)}`
  );

  const realLog = path.join(fakeHome, '.claude', 'projects');
  report(
    'CLAUDE_PROJECTS_DIR set: nothing lands under HOME/.claude/projects',
    !fs.existsSync(realLog),
    `${realLog} exists`
  );
  fs.rmSync(override, { recursive: true, force: true });
  fs.rmSync(fakeHome, { recursive: true, force: true });
}

// 2. Override unset → PROJECTS_DIR falls back to HOME/.claude/projects.
{
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'su-home-fallback-'));
  const r = inChild(
    `console.log(require(${JSON.stringify(SESSION_UTILS)}).PROJECTS_DIR);`,
    { HOME: fakeHome }
  );
  report(
    'CLAUDE_PROJECTS_DIR unset: PROJECTS_DIR falls back to HOME/.claude/projects',
    r.status === 0 && r.stdout.trim() === path.join(fakeHome, '.claude/projects'),
    `status ${r.status}, stdout ${JSON.stringify(r.stdout)}, stderr ${JSON.stringify(r.stderr)}`
  );
  fs.rmSync(fakeHome, { recursive: true, force: true });
}

// 3. Tracking writes follow the seam too — appendTrackingEvent with a temp
//    workspacePath lands its slug dir under the override, not the real tree
//    (the #898 junk-dir mechanism).
{
  const override = fs.mkdtempSync(path.join(os.tmpdir(), 'su-projects-tracking-'));
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'su-home-tracking-'));
  const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), 'su-ws-'));
  const r = inChild(
    `const su = require(${JSON.stringify(SESSION_UTILS)});
     su.appendTrackingEvent('seam-1', { type: 'session_init' }, ${JSON.stringify(tmpWs)});`,
    { HOME: fakeHome, CLAUDE_PROJECTS_DIR: override }
  );
  const slugs = fs.readdirSync(override);
  report(
    'appendTrackingEvent with temp workspace lands under the override',
    r.status === 0 && slugs.length === 1 && !fs.existsSync(path.join(fakeHome, '.claude')),
    `status ${r.status}, slugs ${JSON.stringify(slugs)}, stderr ${JSON.stringify(r.stderr)}`
  );
  [override, fakeHome, tmpWs].forEach(d => fs.rmSync(d, { recursive: true, force: true }));
}

console.log(`\n${'='.repeat(48)}`);
if (fail > 0) {
  console.error(`FAILED — ${fail} of ${pass + fail} assertions failed.`);
  process.exit(1);
}
console.log(`PASSED — all ${pass} assertions green.`);
process.exit(0);
