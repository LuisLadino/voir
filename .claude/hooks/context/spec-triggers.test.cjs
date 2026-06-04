#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildTriggers, check } = require('./spec-triggers.cjs');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${err.stack || err.message}`); }
}

function patternsFor(triggers, label) {
  const t = triggers.find(x => x.label === label);
  return t ? t.patterns : null;
}

console.log('spec-triggers: hermetic frontmatter routing');

const origCwd = process.cwd();
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-trig-'));
const specsDir = path.join(proj, '.claude', 'specs');
fs.mkdirSync(specsDir, { recursive: true });

fs.writeFileSync(path.join(specsDir, 'flowspec.md'),
  ['---', 'name: flow-spec', 'triggers: [alpha, beta-gamma]', '---', '', '# Flow body'].join('\n'));
fs.writeFileSync(path.join(specsDir, 'blockspec.md'),
  ['---', 'name: block-spec', 'triggers:', '  - delta', '  - epsilon', '---', '', '# Block body'].join('\n'));
fs.writeFileSync(path.join(specsDir, 'notrig.md'),
  ['---', 'name: no-trig', 'category: kit', '---', '', '# No triggers'].join('\n'));
fs.writeFileSync(path.join(specsDir, 'emptyspec.md'),
  ['---', 'name: empty-spec', 'triggers: []', '---', '', '# Empty triggers'].join('\n'));
fs.writeFileSync(path.join(specsDir, 'noname.md'),
  ['---', 'triggers: [zeta]', '---', '', '# No name field'].join('\n'));

try {
  process.chdir(proj);

  test('flow-style triggers produce a trigger entry', () => {
    const t = buildTriggers();
    const p = patternsFor(t, 'flow-spec');
    assert.ok(p, 'flow-spec entry should exist');
    assert.ok(p.some(rx => rx.test('please run alpha')), 'alpha keyword matches');
    assert.ok(p.some(rx => rx.test('do beta-gamma')), 'beta-gamma keyword matches');
  });

  test('block-style triggers produce a trigger entry', () => {
    const t = buildTriggers();
    const p = patternsFor(t, 'block-spec');
    assert.ok(p, 'block-spec entry should exist');
    assert.ok(p.some(rx => rx.test('the delta path')), 'delta keyword matches');
    assert.ok(p.some(rx => rx.test('epsilon here')), 'epsilon keyword matches');
  });

  test('spec without triggers field is not registered', () => {
    assert.strictEqual(patternsFor(buildTriggers(), 'no-trig'), null);
  });

  test('empty flow triggers ([]) is not registered', () => {
    assert.strictEqual(patternsFor(buildTriggers(), 'empty-spec'), null);
  });

  test('spec without name falls back to filename label', () => {
    assert.ok(patternsFor(buildTriggers(), 'noname'), 'noname (basename) entry should exist');
  });

  test('check() loads the matching spec content', () => {
    const r = check('please run alpha now');
    assert.ok(r.specsLoaded.includes('flow-spec'), 'flow-spec should load');
    assert.ok(r.content && r.content.join('\n').includes('Flow body'), 'spec body injected');
  });

  test('check() does not load specs whose triggers are absent from the prompt', () => {
    const r = check('please run alpha now');
    assert.ok(!r.specsLoaded.includes('block-spec'), 'block-spec should not load');
  });
} finally {
  process.chdir(origCwd);
  fs.rmSync(proj, { recursive: true, force: true });
}

console.log('\nspec-triggers: real-spec routing (block-dangerous, owasp-mapping, version-control)');

test('block-dangerous routes on its trigger keyword', () => {
  const r = check('audit the block-dangerous patterns');
  assert.ok(r.specsLoaded.includes('block-dangerous'), `got: ${JSON.stringify(r.specsLoaded)}`);
});

test('owasp-mapping routes on its trigger keyword', () => {
  const r = check('how does this map to owasp');
  assert.ok(r.specsLoaded.includes('owasp-mapping'), `got: ${JSON.stringify(r.specsLoaded)}`);
});

test('version-control routes on its trigger keyword', () => {
  const r = check('what is the branch strategy');
  assert.ok(r.specsLoaded.includes('version-control'), `got: ${JSON.stringify(r.specsLoaded)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
