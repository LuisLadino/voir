#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  inferWarrantedCategories,
  globPrefix,
  pathOverlap,
  docCoversCategory,
  computeCoverage,
  likelyWarranted,
  findUnannotatedDocs,
  diffDocMap,
  readPersistedDocMap,
  buildReport,
} = require('./doc-coverage-gaps.cjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.stack}`); }
}

function withTempProject(fn) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'doc-gaps-')));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function mkdir(dir, rel) { fs.mkdirSync(path.join(dir, rel), { recursive: true }); }
function touch(dir, rel, body = 'x') {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}
function writeDoc(dir, rel, covers, body = 'doc body') {
  const fm = covers === null
    ? ''
    : `---\ncovers:\n${covers.map(c => `  - "${c}"`).join('\n')}\n---\n`;
  touch(dir, rel, fm + body + '\n');
}
function cats(warranted) { return warranted.map(c => c.category).sort(); }

console.log('inferWarrantedCategories');

test('empty project warrants nothing', () => {
  withTempProject(dir => {
    assert.deepStrictEqual(inferWarrantedCategories(dir), []);
  });
});

test('directory signals warrant their category with a dir/** covers glob', () => {
  withTempProject(dir => {
    mkdir(dir, 'runtime');
    mkdir(dir, 'connectors');
    const w = inferWarrantedCategories(dir);
    assert.deepStrictEqual(cats(w), ['connectors', 'runtime']);
    const runtime = w.find(c => c.category === 'runtime');
    assert.deepStrictEqual(runtime.covers, ['runtime/**']);
    assert.deepStrictEqual(runtime.roots, ['runtime']);
  });
});

test('a signal directory one level under src/ is detected with the src/ prefix', () => {
  withTempProject(dir => {
    mkdir(dir, 'src/connectors');
    const w = inferWarrantedCategories(dir);
    const connectors = w.find(c => c.category === 'connectors');
    assert.deepStrictEqual(connectors.covers, ['src/connectors/**']);
    assert.deepStrictEqual(connectors.roots, ['src/connectors']);
  });
});

test('a config file signal warrants its category and covers the file itself', () => {
  withTempProject(dir => {
    touch(dir, 'Dockerfile');
    const w = inferWarrantedCategories(dir);
    const deploy = w.find(c => c.category === 'deploy');
    assert.deepStrictEqual(deploy.covers, ['Dockerfile']);
    assert.deepStrictEqual(deploy.roots, ['Dockerfile']);
  });
});

test('a nested path signal (.github/workflows) is checked at its literal path only', () => {
  withTempProject(dir => {
    mkdir(dir, '.github/workflows');
    const w = inferWarrantedCategories(dir);
    const deploy = w.find(c => c.category === 'deploy');
    assert.deepStrictEqual(deploy.covers, ['.github/workflows/**']);
  });
});

test('prisma directory warrants schema', () => {
  withTempProject(dir => {
    touch(dir, 'prisma/schema.prisma', 'model X {}');
    assert.ok(cats(inferWarrantedCategories(dir)).includes('schema'));
  });
});

test('package.json bin (existing target) warrants cli', () => {
  withTempProject(dir => {
    touch(dir, 'package.json', JSON.stringify({ bin: { mytool: './bin/run.js' } }));
    touch(dir, 'bin/run.js');
    const w = inferWarrantedCategories(dir);
    const cli = w.find(c => c.category === 'cli');
    assert.ok(cli, 'cli warranted');
    assert.ok(cli.roots.includes('bin/run.js') || cli.roots.includes('bin'));
  });
});

test('package.json bin pointing at a non-existent file does not fabricate a signal', () => {
  withTempProject(dir => {
    touch(dir, 'package.json', JSON.stringify({ bin: './bin/ghost.js' }));
    const w = inferWarrantedCategories(dir);
    assert.deepStrictEqual(cats(w), []);
  });
});

test('multiple signals for one category are merged and de-duplicated', () => {
  withTempProject(dir => {
    touch(dir, 'Dockerfile');
    mkdir(dir, '.github/workflows');
    const w = inferWarrantedCategories(dir);
    const deploy = w.find(c => c.category === 'deploy');
    assert.deepStrictEqual(deploy.covers.sort(), ['.github/workflows/**', 'Dockerfile']);
  });
});

test('two named Fly configs each become a distinct deploy signal (multi-app)', () => {
  withTempProject(dir => {
    touch(dir, 'fly.toml');           // cosmo-sams-line
    touch(dir, 'fly.runtime.toml');   // cosmo-runtime
    const deploy = inferWarrantedCategories(dir).find(c => c.category === 'deploy');
    assert.deepStrictEqual(deploy.roots.sort(), ['fly.runtime.toml', 'fly.toml']);
    assert.deepStrictEqual(deploy.covers.sort(), ['fly.runtime.toml', 'fly.toml']);
  });
});

console.log('globPrefix / pathOverlap');

test('globPrefix strips at the first wildcard segment', () => {
  assert.strictEqual(globPrefix('runtime/**'), 'runtime');
  assert.strictEqual(globPrefix('src/api/**/*.ts'), 'src/api');
  assert.strictEqual(globPrefix('runtime/server.ts'), 'runtime/server.ts');
  assert.strictEqual(globPrefix('*.ts'), '');
});

test('pathOverlap is true when one path prefixes the other', () => {
  assert.ok(pathOverlap('runtime', 'runtime'));
  assert.ok(pathOverlap('runtime', 'runtime/server.ts'));
  assert.ok(pathOverlap('runtime/server.ts', 'runtime'));
});

test('pathOverlap is false for siblings sharing a parent', () => {
  assert.ok(!pathOverlap('.github/workflows', '.github/ISSUE_TEMPLATE'));
  assert.ok(!pathOverlap('runtime', 'connectors'));
});

console.log('docCoversCategory / computeCoverage');

test('a doc covers a category when its glob points into the area', () => {
  assert.ok(docCoversCategory(['runtime/**'], ['runtime']));
  assert.ok(docCoversCategory(['runtime/server.ts'], ['runtime']));
});

test('a doc rooted at a sibling does not cover the category', () => {
  assert.ok(!docCoversCategory(['.github/ISSUE_TEMPLATE/**'], ['.github/workflows']));
  assert.ok(!docCoversCategory(['frontend/**'], ['runtime']));
});

test('computeCoverage splits covered from gaps', () => {
  const warranted = [
    { category: 'runtime', roots: ['runtime'], covers: ['runtime/**'], signals: [] },
    { category: 'schema', roots: ['prisma'], covers: ['prisma/**'], signals: [] },
  ];
  const mappings = [{ doc: 'docs/runtime.md', covers: ['runtime/**'] }];
  const { covered, gaps } = computeCoverage(warranted, mappings);
  assert.deepStrictEqual(covered.map(c => c.category), ['runtime']);
  assert.deepStrictEqual(covered[0].docs, ['docs/runtime.md']);
  assert.deepStrictEqual(gaps.map(g => g.category), ['schema']);
});

console.log('likelyWarranted / findUnannotatedDocs');

test('fact-bearing names are flagged; intent names are not', () => {
  assert.ok(likelyWarranted('docs/deployment.md'));
  assert.ok(likelyWarranted('docs/setup-guide.md'));
  assert.ok(likelyWarranted('docs/api-reference.md'));
  assert.ok(!likelyWarranted('docs/roadmap.md'));
  assert.ok(!likelyWarranted('docs/adr-0001-runtime.md'));   // intent keyword vetoes the runtime hint
  assert.ok(!likelyWarranted('docs/notes.md'));              // ambiguous defaults to false
  assert.ok(!likelyWarranted('memories/preferences/mem-x.md')); // "reference" must not fire inside "preferences"
});

test('findUnannotatedDocs returns docs without covers, classified', () => {
  withTempProject(dir => {
    writeDoc(dir, 'docs/runbook.md', ['runtime/**']);   // annotated — excluded
    writeDoc(dir, 'docs/deploy.md', null);              // un-annotated, fact-bearing
    writeDoc(dir, 'docs/vision.md', null);              // un-annotated, intent
    const un = findUnannotatedDocs(dir, ['docs']);
    assert.deepStrictEqual(un.map(u => u.doc).sort(), ['docs/deploy.md', 'docs/vision.md']);
    assert.strictEqual(un.find(u => u.doc === 'docs/deploy.md').likelyWarranted, true);
    assert.strictEqual(un.find(u => u.doc === 'docs/vision.md').likelyWarranted, false);
  });
});

console.log('diffDocMap');

test('newly-warranted and now-stale are computed by category', () => {
  const persisted = [{ category: 'runtime' }, { category: 'connectors' }];
  const current = [{ category: 'runtime' }, { category: 'schema' }];
  assert.deepStrictEqual(diffDocMap(persisted, current), {
    newlyWarranted: ['schema'],
    nowStale: ['connectors'],
  });
});

test('absent persisted map treats everything as new, nothing stale', () => {
  const current = [{ category: 'runtime' }];
  assert.deepStrictEqual(diffDocMap(null, current), { newlyWarranted: ['runtime'], nowStale: [] });
});

console.log('readPersistedDocMap');

test('reads only the doc_coverage block, tolerating other config above and below', () => {
  withTempProject(dir => {
    const yaml = [
      'name: "demo"',
      'stack:',
      '  language: "TypeScript"',
      'doc_coverage:',
      '  last_inferred: "2026-06-20"',
      '  warranted:',
      '    - category: runtime',
      '      covers: ["runtime/**"]',
      '      docs: ["docs/runtime.md"]',
      '    - category: schema',
      '      covers: ["prisma/**"]',
      '      docs: []',
      'specs:',
      '  coding: []',
      '',
    ].join('\n');
    touch(dir, '.claude/specs/stack-config.yaml', yaml);
    const map = readPersistedDocMap(dir);
    assert.strictEqual(map.last_inferred, '2026-06-20');
    assert.deepStrictEqual(map.warranted.map(w => w.category), ['runtime', 'schema']);
    assert.deepStrictEqual(map.warranted[0].docs, ['docs/runtime.md']);
  });
});

test('missing file or missing block returns null', () => {
  withTempProject(dir => {
    assert.strictEqual(readPersistedDocMap(dir), null);
    touch(dir, '.claude/specs/stack-config.yaml', 'name: "demo"\nstack:\n  x: "y"\n');
    assert.strictEqual(readPersistedDocMap(dir), null);
  });
});

console.log('buildReport (end to end)');

test('assembles detect + define + govern on a real temp project', () => {
  withTempProject(dir => {
    mkdir(dir, 'runtime');
    touch(dir, 'Dockerfile');
    writeDoc(dir, 'docs/runtime-runbook.md', ['runtime/**']);   // covers runtime
    writeDoc(dir, 'docs/setup.md', null);                       // un-annotated, fact-bearing
    const persisted = { warranted: [{ category: 'connectors' }] };
    const report = buildReport({ cwd: dir, docRoots: ['docs'], persisted });

    assert.deepStrictEqual(cats(report.warranted), ['deploy', 'runtime']);
    assert.deepStrictEqual(report.covered.map(c => c.category), ['runtime']);
    assert.deepStrictEqual(report.gaps.map(g => g.category), ['deploy']);
    assert.ok(report.unannotated.some(u => u.doc === 'docs/setup.md' && u.likelyWarranted));
    assert.deepStrictEqual(report.governance.newlyWarranted.sort(), ['deploy', 'runtime']);
    assert.deepStrictEqual(report.governance.nowStale, ['connectors']);

    const runtimeEntry = report.docMap.find(d => d.category === 'runtime');
    assert.deepStrictEqual(runtimeEntry.docs, ['docs/runtime-runbook.md']);
    const deployEntry = report.docMap.find(d => d.category === 'deploy');
    assert.deepStrictEqual(deployEntry.docs, []);
  });
});

test('multi-app project: co-located service README + named Fly configs report no false gap (#835)', () => {
  withTempProject(dir => {
    // Replicates cosmo: two root Fly apps, the service operating doc co-located,
    // and a central deploy runbook covering the runtime Fly config.
    touch(dir, 'fly.toml', 'app = "cosmo-sams-line"');
    touch(dir, 'fly.runtime.toml', 'app = "cosmo-runtime"');
    writeDoc(dir, 'services/sams-line/README.md', ['services/sams-line/**', 'fly.toml']);
    writeDoc(dir, 'docs/runbooks/deploy-cosmo-runtime.md', ['fly.runtime.toml']);

    const report = buildReport({ cwd: dir });   // no docRoots → structure-resolved

    assert.ok(report.docRoots.includes('services'), 'co-located service root is scanned');
    assert.deepStrictEqual(cats(report.warranted), ['deploy', 'runtime']);
    assert.deepStrictEqual(report.gaps, [], 'both areas covered — no false gap');
    const runtime = report.covered.find(c => c.category === 'runtime');
    assert.deepStrictEqual(runtime.docs, ['services/sams-line/README.md']);
    const deploy = report.covered.find(c => c.category === 'deploy');
    assert.ok(deploy.docs.includes('docs/runbooks/deploy-cosmo-runtime.md'));
    assert.deepStrictEqual(deploy.roots.sort(), ['fly.runtime.toml', 'fly.toml']);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
