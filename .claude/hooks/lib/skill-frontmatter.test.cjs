#!/usr/bin/env node

/**
 * Unit tests for the skill-frontmatter parser (Deep Agents extension fields).
 * Run: node .claude/hooks/lib/skill-frontmatter.test.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  isTrue, isFalse, toInt, asConfig, normalizeExtensions,
  parseSkillFrontmatter, loadExtendedSkills, normalizeSkillName
} = require('./skill-frontmatter.cjs');

let pass = 0;
let fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else    { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

const tmpRoots = [];
function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-fm-'));
  tmpRoots.push(dir);
  return dir;
}
function writeSkill(root, dirName, body) {
  const skillDir = path.join(root, dirName);
  fs.mkdirSync(skillDir, { recursive: true });
  const full = path.join(skillDir, 'SKILL.md');
  fs.writeFileSync(full, body);
  return full;
}
process.on('exit', () => {
  for (const d of tmpRoots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
});

// ── coercion helpers ──────────────────────────────────────────────
report('isTrue: boolean and string true', isTrue(true) && isTrue('true'));
report('isTrue: false-ish values are not true', !isTrue(false) && !isTrue('false') && !isTrue(undefined) && !isTrue('x'));
report('isFalse: boolean and string false', isFalse(false) && isFalse('false'));
report('isFalse: true-ish values are not false', !isFalse(true) && !isFalse('true') && !isFalse(undefined));
report('toInt: parses numeric string', toInt('42', 0) === 42);
report('toInt: passes through number', toInt(42, 0) === 42);
report('toInt: falls back on non-numeric', toInt('abc', 99) === 99 && toInt(undefined, 7) === 7);

report('asConfig: true shorthand becomes {enabled:true}', JSON.stringify(asConfig(true)) === JSON.stringify({ enabled: true }));
report('asConfig: string true shorthand becomes {enabled:true}', JSON.stringify(asConfig('true')) === JSON.stringify({ enabled: true }));
report('asConfig: object passes through', (() => { const o = { a: 1 }; return asConfig(o) === o; })());
report('asConfig: false-ish and arrays become null', asConfig(false) === null && asConfig('false') === null && asConfig([1]) === null && asConfig(null) === null && asConfig(undefined) === null);

// ── normalizeExtensions ───────────────────────────────────────────
report('normalizeExtensions: empty input yields empty object', Object.keys(normalizeExtensions({})).length === 0);

const np = normalizeExtensions({ planning: true });
report('normalizeExtensions: planning:true expands to full defaults',
  np.planning && np.planning.enabled === true && np.planning.persist === true &&
  np.planning.resume_on_activation === true && np.planning.scope === 'session',
  JSON.stringify(np));

const npFalse = normalizeExtensions({ planning: { enabled: 'false' } });
report('normalizeExtensions: planning.enabled string "false" coerces to boolean false (yaml-mini guard)',
  npFalse.planning && npFalse.planning.enabled === false, JSON.stringify(npFalse));

report('normalizeExtensions: planning.scope thread is honored',
  normalizeExtensions({ planning: { scope: 'thread' } }).planning.scope === 'thread');
report('normalizeExtensions: planning.scope invalid falls back to session',
  normalizeExtensions({ planning: { scope: 'bogus' } }).planning.scope === 'session');
report('normalizeExtensions: planning:false drops the key',
  normalizeExtensions({ planning: false }).planning === undefined);

const nf = normalizeExtensions({ filesystem: true });
report('normalizeExtensions: filesystem:true expands to defaults',
  nf.filesystem && nf.filesystem.enabled === true && nf.filesystem.scope === 'session' && nf.filesystem.root_hint === 'scratch',
  JSON.stringify(nf));
report('normalizeExtensions: filesystem.root_hint empty string falls back to scratch',
  normalizeExtensions({ filesystem: { root_hint: '' } }).filesystem.root_hint === 'scratch');
report('normalizeExtensions: filesystem.root_hint custom is honored',
  normalizeExtensions({ filesystem: { root_hint: 'mem' } }).filesystem.root_hint === 'mem');
report('normalizeExtensions: filesystem.root_hint non-string falls back to scratch',
  normalizeExtensions({ filesystem: { root_hint: 123 } }).filesystem.root_hint === 'scratch');

const ns = normalizeExtensions({ subagents: [{ role: 'r1' }] });
report('normalizeExtensions: subagent gets isolation/agent defaults',
  Array.isArray(ns.subagents) && ns.subagents.length === 1 &&
  ns.subagents[0].role === 'r1' && ns.subagents[0].isolation === 'forked' && ns.subagents[0].agent === 'general-purpose',
  JSON.stringify(ns));
const ns2 = normalizeExtensions({ subagents: [{ role: 'r', isolation: 'process', agent: 'Explore', prompt_ref: 'p.md' }] });
report('normalizeExtensions: subagent valid isolation/agent/prompt_ref preserved',
  ns2.subagents[0].isolation === 'process' && ns2.subagents[0].agent === 'Explore' && ns2.subagents[0].prompt_ref === 'p.md',
  JSON.stringify(ns2));
report('normalizeExtensions: subagent invalid isolation falls back to forked',
  normalizeExtensions({ subagents: [{ role: 'r', isolation: 'weird' }] }).subagents[0].isolation === 'forked');
const ns3 = normalizeExtensions({ subagents: [{ isolation: 'process' }, { role: 'ok' }] });
report('normalizeExtensions: subagent without role is filtered out',
  ns3.subagents.length === 1 && ns3.subagents[0].role === 'ok', JSON.stringify(ns3));
report('normalizeExtensions: non-array subagents is ignored',
  normalizeExtensions({ subagents: { role: 'x' } }).subagents === undefined);

const na = normalizeExtensions({ auto_summarize: true });
report('normalizeExtensions: auto_summarize:true expands to defaults',
  na.auto_summarize && na.auto_summarize.enabled === true && na.auto_summarize.threshold_tokens === 10000 &&
  Array.isArray(na.auto_summarize.preserve) && na.auto_summarize.preserve.length === 0,
  JSON.stringify(na));
report('normalizeExtensions: auto_summarize.threshold_tokens string coerces to int',
  normalizeExtensions({ auto_summarize: { threshold_tokens: '5000' } }).auto_summarize.threshold_tokens === 5000);
report('normalizeExtensions: auto_summarize.threshold_tokens invalid falls back to 10000',
  normalizeExtensions({ auto_summarize: { threshold_tokens: 'abc' } }).auto_summarize.threshold_tokens === 10000);
const naP = normalizeExtensions({ auto_summarize: { preserve: ['a', 'b', 1, null] } });
report('normalizeExtensions: auto_summarize.preserve keeps only strings',
  JSON.stringify(naP.auto_summarize.preserve) === JSON.stringify(['a', 'b']), JSON.stringify(naP));

const nAll = normalizeExtensions({ planning: true, filesystem: true, subagents: [{ role: 'r' }], auto_summarize: true });
report('normalizeExtensions: all four fields present yields all four keys',
  Object.keys(nAll).sort().join(',') === 'auto_summarize,filesystem,planning,subagents', JSON.stringify(Object.keys(nAll)));

// ── parseSkillFrontmatter ─────────────────────────────────────────
const root = tmpRoot();
const extPath = writeSkill(root, 'extname', [
  '---', 'name: extname', 'description: an extended skill',
  'planning:', '  enabled: true', '  scope: thread', '---', '', '# body'
].join('\n'));
const ext = parseSkillFrontmatter(extPath);
report('parseSkillFrontmatter: standard fields split out',
  ext && ext.standard.name === 'extname' && ext.standard.description === 'an extended skill', JSON.stringify(ext && ext.standard));
report('parseSkillFrontmatter: extension field detected and normalized',
  ext && ext.hasExtensions === true && ext.extensions.planning && ext.extensions.planning.scope === 'thread', JSON.stringify(ext && ext.extensions));
report('parseSkillFrontmatter: skillName from name, dir from path',
  ext && ext.skillName === 'extname' && ext.dir === path.join(root, 'extname'));

const plainPath = writeSkill(root, 'plainname', [
  '---', 'name: plainname', 'description: no extensions here', '---', '', '# body'
].join('\n'));
const plain = parseSkillFrontmatter(plainPath);
report('parseSkillFrontmatter: standard-only skill has hasExtensions false',
  plain && plain.hasExtensions === false && Object.keys(plain.extensions).length === 0, JSON.stringify(plain && plain.extensions));

const noNamePath = writeSkill(root, 'fallback-skill', [
  '---', 'description: no name field', 'filesystem:', '  scope: session', '---'
].join('\n'));
const noName = parseSkillFrontmatter(noNamePath);
report('parseSkillFrontmatter: skillName falls back to parent dir basename when name absent',
  noName && noName.skillName === 'fallback-skill' && noName.hasExtensions === true, JSON.stringify(noName && noName.skillName));

report('parseSkillFrontmatter: nonexistent path returns null',
  parseSkillFrontmatter(path.join(root, 'nope', 'SKILL.md')) === null);

const noFmPath = writeSkill(root, 'nofm', '# just a heading\n\nbody\n');
report('parseSkillFrontmatter: file without frontmatter returns null',
  parseSkillFrontmatter(noFmPath) === null);

// ── loadExtendedSkills ────────────────────────────────────────────
const skillsRoot = tmpRoot();
writeSkill(skillsRoot, 'ext', ['---', 'name: extname', 'description: x', 'planning:', '  enabled: true', '---'].join('\n'));
writeSkill(skillsRoot, 'plain', ['---', 'name: plainname', 'description: y', '---'].join('\n'));
const loaded = loadExtendedSkills(skillsRoot);
report('loadExtendedSkills: only skills with extensions are returned, keyed by name',
  Object.keys(loaded).length === 1 && loaded.extname && loaded.extname.skillName === 'extname', JSON.stringify(Object.keys(loaded)));
report('loadExtendedSkills: nonexistent root returns empty object',
  Object.keys(loadExtendedSkills(path.join(skillsRoot, 'no-such-dir'))).length === 0);

// ── re-exported normalizeSkillName ────────────────────────────────
report('normalizeSkillName re-export strips slash and plugin namespace',
  normalizeSkillName('/project-management:sync-stack') === 'sync-stack');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
