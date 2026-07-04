#!/usr/bin/env node

/**
 * skill-output-offload hook tests.
 *
 * Unit: serialize() across the tool_response shapes (string, stdout/stderr,
 * content, object, null, unstringifiable). Integration: the PostToolUse
 * auto_summarize hook via subprocess — archives an over-threshold output to
 * summaries/<id>.txt + index.jsonl and emits a retrieval note, while
 * respecting the threshold, the preserve[] allowlist, and inactive skills.
 *
 * Run: node .claude/hooks/context/skill-output-offload.test.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { serialize } = require('./skill-output-offload.cjs');
const runtime = require('../lib/skill-runtime.cjs');
const su = require('../lib/session-utils.cjs');

const HOOK = path.resolve(__dirname, 'skill-output-offload.cjs');
const SID = 'skill-output-offload-test-session';

let pass = 0, fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else    { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

const tmpRoots = [];
function tmpProj(skillName, frontmatter, { active = true } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'skill-off-')));
  tmpRoots.push(dir);
  const sk = path.join(dir, '.claude', 'skills', skillName);
  fs.mkdirSync(sk, { recursive: true });
  fs.writeFileSync(path.join(sk, 'SKILL.md'), frontmatter);
  if (active) su.appendTrackingEvent(SID, { type: 'tool', tool: 'Skill', skill: skillName }, dir);
  return dir;
}
process.on('exit', () => {
  for (const d of tmpRoots) {
    try { fs.rmSync(su.getProjectDir(d), { recursive: true, force: true }); } catch {}
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

function runHook(payload, cwd) {
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', cwd });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch {}
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

// ── serialize: every tool_response shape ────────────────────────────────────
report('serialize: string passes through', serialize('hello') === 'hello');
report('serialize: null/undefined becomes empty string', serialize(null) === '' && serialize(undefined) === '');
report('serialize: stdout/stderr joins on newline', serialize({ stdout: 'out', stderr: 'err' }) === 'out\nerr');
report('serialize: stdout-only keeps the empty stderr line', serialize({ stdout: 'out' }) === 'out\n');
report('serialize: content field is used directly', serialize({ content: 'body' }) === 'body');
report('serialize: plain object is JSON-stringified', serialize({ a: 1 }) === '{"a":1}');
{
  const circular = {}; circular.self = circular;
  report('serialize: unstringifiable object falls back to String()', serialize(circular) === '[object Object]');
}

const AUTO = (threshold, preserve = '[Read]') => `---
name: archiver
description: an auto-summarize skill
auto_summarize:
  enabled: true
  threshold_tokens: ${threshold}
  preserve: ${preserve}
---
body`;

// ── over-threshold output is archived and a note is emitted ─────────────────
{
  const proj = tmpProj('archiver', AUTO(10));        // threshold 10 tokens => 40 bytes
  const big = 'x'.repeat(500);
  const r = runHook({ tool_name: 'Bash', tool_response: big, cwd: proj, session_id: SID }, proj);
  report('over-threshold: exit 0', r.status === 0);
  report('over-threshold: emits an archival note',
    r.json && r.json.hookSpecificOutput && /archived/.test(r.json.hookSpecificOutput.additionalContext)
      && /retrievable/.test(r.json.hookSpecificOutput.additionalContext),
    `stdout=${r.stdout}`);
  const sumDir = path.join(runtime.skillBase(proj, 'session', SID, 'archiver'), 'summaries');
  const files = fs.existsSync(sumDir) ? fs.readdirSync(sumDir) : [];
  const txt = files.find(f => f.endsWith('.txt'));
  report('over-threshold: writes summaries/<id>.txt with the full content',
    Boolean(txt) && fs.readFileSync(path.join(sumDir, txt), 'utf8') === big);
  report('over-threshold: appends summaries/index.jsonl', files.includes('index.jsonl'));
}

// ── under-threshold output is left alone ────────────────────────────────────
{
  const proj = tmpProj('archiver', AUTO(100000));    // threshold 100k tokens => 400k bytes
  const r = runHook({ tool_name: 'Bash', tool_response: 'small', cwd: proj, session_id: SID }, proj);
  report('under-threshold: no note emitted', r.status === 0 && r.stdout.trim() === '');
  const sumDir = path.join(runtime.skillBase(proj, 'session', SID, 'archiver'), 'summaries');
  report('under-threshold: nothing archived',
    !fs.existsSync(sumDir) || fs.readdirSync(sumDir).length === 0);
}

// ── preserve[] tools are never archived, even over threshold ────────────────
{
  const proj = tmpProj('archiver', AUTO(10));
  const big = 'x'.repeat(500);
  const r = runHook({ tool_name: 'Read', tool_response: big, cwd: proj, session_id: SID }, proj);
  report('preserve[]: Read is not archived even over threshold', r.status === 0 && r.stdout.trim() === '');
}

// ── no active auto_summarize skill → no-op ──────────────────────────────────
{
  const proj = tmpProj('archiver', AUTO(10), { active: false });
  const big = 'x'.repeat(500);
  const r = runHook({ tool_name: 'Bash', tool_response: big, cwd: proj, session_id: SID }, proj);
  report('inactive skill: no archive, no note', r.status === 0 && r.stdout.trim() === '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
