#!/usr/bin/env node

/**
 * Unit tests for skill-runtime (per-skill working-memory tree manager).
 * Run: node .claude/hooks/lib/skill-runtime.test.cjs
 *
 * Covers path/key derivation (sanitize, currentBranch, scopeKey, skillBase,
 * fsRoot), directory provisioning (ensureSkillDirs), the append-only plan-log
 * round-trip (appendPlanEntry/readLatestPlan, incl. malformed-line skip), output
 * archival (archiveOutput), and age-based session sweeping (sweepOldSessions)
 * against temp project trees.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ROOT_REL, MAX_AGE_MS, sanitize, currentBranch, scopeKey, skillBase,
  ensureSkillDirs, fsRoot, appendPlanEntry, readLatestPlan, archiveOutput, sweepOldSessions
} = require('./skill-runtime.cjs');

let pass = 0;
let fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else    { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

const tmpRoots = [];
function tmpProj() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-rt-'));
  tmpRoots.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const d of tmpRoots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
});

// ── sanitize ──────────────────────────────────────────────────────
report('sanitize: replaces path separators', sanitize('feature/x') === 'feature_x');
report('sanitize: replaces runs of unsafe chars', sanitize('a b!c') === 'a_b_c');
report('sanitize: empty becomes unknown', sanitize('') === 'unknown');
report('sanitize: null/undefined becomes unknown', sanitize(null) === 'unknown' && sanitize(undefined) === 'unknown');
report('sanitize: safe chars pass through', sanitize('OK-name_1') === 'OK-name_1');

// ── currentBranch ─────────────────────────────────────────────────
report('currentBranch: non-repo cwd falls back to nobranch', currentBranch('/no/such/dir/xyz') === 'nobranch');
report('currentBranch: always returns a string', typeof currentBranch(process.cwd()) === 'string');

// ── scopeKey ──────────────────────────────────────────────────────
const proj = tmpProj();
report('scopeKey: session scope keys by session id', scopeKey('session', proj, 'sess-1') === path.join('session', 'sess-1'));
report('scopeKey: session id is sanitized', scopeKey('session', proj, 'a/b') === path.join('session', 'a_b'));
report('scopeKey: thread scope keys by sanitized branch (nobranch when no repo)',
  scopeKey('thread', '/no/such/dir/xyz', 'ignored') === path.join('thread', 'nobranch'));
report('scopeKey: unknown scope is treated as session', scopeKey('weird', proj, 'sid') === path.join('session', 'sid'));

// ── skillBase ─────────────────────────────────────────────────────
report('skillBase: composes root/scope/skill and sanitizes skill name',
  skillBase(proj, 'session', 'sess-1', 'my skill') === path.join(proj, ROOT_REL, 'session', 'sess-1', 'my_skill'));

// ── ensureSkillDirs ───────────────────────────────────────────────
const base = ensureSkillDirs(proj, 'session', 'sid', 'sk');
report('ensureSkillDirs: returns the skill base path', base === skillBase(proj, 'session', 'sid', 'sk'));
report('ensureSkillDirs: creates plans, summaries, and fs/scratch',
  fs.existsSync(path.join(base, 'plans')) && fs.existsSync(path.join(base, 'summaries')) && fs.existsSync(path.join(base, 'fs', 'scratch')));
const base2 = ensureSkillDirs(proj, 'session', 'sid2', 'sk', { root_hint: 'mem' });
report('ensureSkillDirs: honors custom root_hint', fs.existsSync(path.join(base2, 'fs', 'mem')));

// ── fsRoot ────────────────────────────────────────────────────────
report('fsRoot: defaults to fs/scratch',
  fsRoot(proj, 'session', 'sid', 'sk') === path.join(skillBase(proj, 'session', 'sid', 'sk'), 'fs', 'scratch'));
report('fsRoot: honors custom root hint',
  fsRoot(proj, 'session', 'sid', 'sk', 'mem') === path.join(skillBase(proj, 'session', 'sid', 'sk'), 'fs', 'mem'));

// ── appendPlanEntry / readLatestPlan ──────────────────────────────
report('readLatestPlan: no file returns null', readLatestPlan(proj, 'session', 'noplan', 'sk') === null);

appendPlanEntry(proj, 'session', 'plan-sid', 'sk', { todos: ['a'] });
appendPlanEntry(proj, 'session', 'plan-sid', 'sk', { todos: ['a', 'b'] });
const latest = readLatestPlan(proj, 'session', 'plan-sid', 'sk');
report('readLatestPlan: returns the most recent entry and stamps a timestamp',
  latest && JSON.stringify(latest.todos) === JSON.stringify(['a', 'b']) && typeof latest.timestamp === 'string',
  JSON.stringify(latest));

appendPlanEntry(proj, 'session', 'plan-mal', 'sk', { v: 1 });
const malFile = path.join(skillBase(proj, 'session', 'plan-mal', 'sk'), 'plans', 'plan.jsonl');
fs.appendFileSync(malFile, '\nnot valid json{\n');
const afterMal = readLatestPlan(proj, 'session', 'plan-mal', 'sk');
report('readLatestPlan: skips a malformed trailing line and returns the last valid entry',
  afterMal && afterMal.v === 1, JSON.stringify(afterMal));

// ── archiveOutput ─────────────────────────────────────────────────
const target = archiveOutput(proj, 'session', 'arc-sid', 'sk', 'out1', 'hello world');
report('archiveOutput: writes content to summaries/<id>.txt and returns the path',
  target === path.join(skillBase(proj, 'session', 'arc-sid', 'sk'), 'summaries', 'out1.txt') &&
  fs.readFileSync(target, 'utf8') === 'hello world');
const idxFile = path.join(skillBase(proj, 'session', 'arc-sid', 'sk'), 'summaries', 'index.jsonl');
const idxLines = fs.readFileSync(idxFile, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
const idxEntry = JSON.parse(idxLines[idxLines.length - 1]);
report('archiveOutput: appends an index entry with id and byte count',
  idxEntry.id === 'out1' && idxEntry.bytes === Buffer.byteLength('hello world'), JSON.stringify(idxEntry));
const target2 = archiveOutput(proj, 'session', 'arc-sid', 'sk', 'a/b', 'x');
report('archiveOutput: sanitizes the id used for the filename', path.basename(target2) === 'a_b.txt');

// ── sweepOldSessions ──────────────────────────────────────────────
report('sweepOldSessions: missing session root returns 0', sweepOldSessions('/no/such/projroot') === 0);

const sweepProj = tmpProj();
const sessionRoot = path.join(sweepProj, ROOT_REL, 'session');
const oldDir = path.join(sessionRoot, 'old');
const recentDir = path.join(sessionRoot, 'recent');
fs.mkdirSync(oldDir, { recursive: true });
fs.mkdirSync(recentDir, { recursive: true });
const oldSec = (Date.now() - MAX_AGE_MS - 60000) / 1000;
fs.utimesSync(oldDir, oldSec, oldSec);
const removed = sweepOldSessions(sweepProj);
report('sweepOldSessions: removes dirs older than MAX_AGE_MS, keeps recent ones',
  removed === 1 && !fs.existsSync(oldDir) && fs.existsSync(recentDir), `removed=${removed}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
