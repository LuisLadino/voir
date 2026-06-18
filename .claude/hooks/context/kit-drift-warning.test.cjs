#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { run, evaluate, warningText, resolveKitSource, readManifest, kitSourceFiles, loadKitPaths } = require('./kit-drift-warning.cjs');

let passed = 0, failed = 0, skipped = 0;
const SKIP = Symbol('skip');
// Skip a test from inside its body: throws a tagged error that test() reports
// as a skip rather than a pass or a failure. For environment preconditions a
// downstream can't meet (e.g. kit-source-only files), not for masking defects.
function skip(reason) { const e = new Error(reason); e[SKIP] = true; throw e; }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) {
    if (e && e[SKIP]) { skipped++; console.log(`  skip ${name} (${e.message})`); return; }
    failed++; console.error(`  FAIL ${name}\n       ${e.stack}`);
  }
}

function sh(cwd, ...args) {
  const r = spawnSync(args[0], args.slice(1), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) throw new Error(`${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

// A downstream git repo whose .claude/ holds kit-owned files plus a manifest
// listing them, and a separate kit source checkout to compare against.
function withDownstreamAndKit(fn) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kdw-test-')));
  const kit = path.join(base, 'kit');
  const work = path.join(base, 'work');
  try {
    // Kit source: .claude/CLAUDE.md, no manifest, plus the path-layout config.
    fs.mkdirSync(path.join(kit, '.claude', 'hooks', 'safety'), { recursive: true });
    fs.writeFileSync(path.join(kit, '.claude', 'CLAUDE.md'), 'kit instructions v2\n');
    fs.writeFileSync(path.join(kit, '.claude', 'hooks', 'safety', 'a.cjs'), 'KIT A v2\n');
    fs.writeFileSync(path.join(kit, 'kit-paths.conf'), 'dir hooks\nfile CLAUDE.md\n');

    // Downstream: committed copy of the kit files + a manifest listing them.
    fs.mkdirSync(path.join(work, '.claude', 'hooks', 'safety'), { recursive: true });
    fs.writeFileSync(path.join(work, '.claude', 'CLAUDE.md'), 'kit instructions v2\n');
    fs.writeFileSync(path.join(work, '.claude', 'hooks', 'safety', 'a.cjs'), 'KIT A v2\n');
    fs.writeFileSync(path.join(work, '.claude', '.kit-manifest'), 'CLAUDE.md\nhooks/safety/a.cjs\n');
    sh(work, 'git', 'init');
    sh(work, 'git', 'config', 'user.email', 't@t.t');
    sh(work, 'git', 'config', 'user.name', 'T');
    sh(work, 'git', 'config', 'commit.gpgsign', 'false');
    sh(work, 'git', 'add', '.');
    sh(work, 'git', 'commit', '-m', 'init');
    sh(work, 'git', 'branch', '-M', 'main');
    fn({ base, kit, work });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

test('warningText surfaces both signals, the fix, and the silence hint', () => {
  const t = warningText({ projectName: 'cosmo', uncommitted: ['CLAUDE.md'], behind: ['skills/verify/SKILL.md', 'hooks/x.cjs'], kitSource: '/k' });
  assert.ok(t.includes('KIT DRIFT'));
  assert.ok(t.includes('UNCOMMITTED: 1'));
  assert.ok(t.includes('BEHIND KIT: 2'));
  assert.ok(t.includes('/kit-sync'));
  assert.ok(t.includes('/commit'));
  assert.ok(t.includes('CLAUDE_KIT_NO_KIT_DRIFT_WARN=1'));
});

test('evaluate is null when in sync (committed, matches kit, clean)', () => {
  withDownstreamAndKit(({ kit, work }) => {
    assert.strictEqual(evaluate(work, kit), null);
  });
});

test('evaluate flags an upstream content change (BEHIND)', () => {
  withDownstreamAndKit(({ kit, work }) => {
    fs.writeFileSync(path.join(kit, '.claude', 'CLAUDE.md'), 'kit instructions v3\n'); // kit moved ahead
    const v = evaluate(work, kit);
    assert.ok(v);
    assert.deepStrictEqual(v.behind, ['CLAUDE.md']);
    assert.deepStrictEqual(v.uncommitted, []);
  });
});

test('evaluate flags a file added upstream (BEHIND)', () => {
  withDownstreamAndKit(({ kit, work }) => {
    fs.writeFileSync(path.join(kit, '.claude', 'hooks', 'safety', 'b.cjs'), 'KIT B new\n');
    const v = evaluate(work, kit);
    assert.ok(v);
    assert.deepStrictEqual(v.behind, ['hooks/safety/b.cjs']);
  });
});

test('evaluate flags a file removed upstream (BEHIND)', () => {
  withDownstreamAndKit(({ kit, work }) => {
    fs.rmSync(path.join(kit, '.claude', 'hooks', 'safety', 'a.cjs'));
    const v = evaluate(work, kit);
    assert.ok(v);
    assert.deepStrictEqual(v.behind, ['hooks/safety/a.cjs']);
  });
});

test('evaluate flags an uncommitted kit file in the working tree (UNCOMMITTED)', () => {
  withDownstreamAndKit(({ kit, work }) => {
    fs.writeFileSync(path.join(work, '.claude', 'CLAUDE.md'), 'kit instructions v2 LOCAL EDIT\n');
    const v = evaluate(work, kit);
    assert.ok(v);
    assert.deepStrictEqual(v.uncommitted, ['CLAUDE.md']);
    // Working tree now differs from the kit too, so BEHIND also lists it.
    assert.ok(v.behind.includes('CLAUDE.md'));
  });
});

test('evaluate ignores non-kit-owned dirty files (UNCOMMITTED is manifest-scoped)', () => {
  withDownstreamAndKit(({ kit, work }) => {
    fs.writeFileSync(path.join(work, '.claude', 'project-note.md'), 'not kit owned\n');
    const v = evaluate(work, kit);
    assert.strictEqual(v, null); // a project file is not in the manifest
  });
});

test('evaluate runs the UNCOMMITTED signal even with no kit source', () => {
  withDownstreamAndKit(({ work }) => {
    fs.writeFileSync(path.join(work, '.claude', 'hooks', 'safety', 'a.cjs'), 'LOCAL\n');
    const v = evaluate(work, null);
    assert.ok(v);
    assert.deepStrictEqual(v.uncommitted, ['hooks/safety/a.cjs']);
    assert.deepStrictEqual(v.behind, []); // no source to compare against
    assert.strictEqual(v.kitSource, null);
  });
});

test('evaluate is null outside a downstream (no .kit-manifest)', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kdw-nd-')));
  try {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'CLAUDE.md'), 'kit source, no manifest\n');
    assert.strictEqual(evaluate(dir, null), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('evaluate skips BEHIND when kit source resolves to the project itself', () => {
  withDownstreamAndKit(({ work }) => {
    // Point the comparison at the project's own root: no false drift, BEHIND off.
    fs.writeFileSync(path.join(work, '.claude', 'hooks', 'safety', 'a.cjs'), 'LOCAL\n');
    const v = evaluate(work, fs.realpathSync(work));
    assert.ok(v);
    assert.deepStrictEqual(v.behind, []);
    assert.deepStrictEqual(v.uncommitted, ['hooks/safety/a.cjs']);
  });
});

test('kitSourceFiles honors the analyze.md exclude from kit-paths.conf', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kdw-ex-')));
  try {
    fs.mkdirSync(path.join(dir, '.claude', 'commands', 'utilities'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'commands', 'utilities', 'analyze.md'), 'kit-only\n');
    fs.writeFileSync(path.join(dir, '.claude', 'commands', 'utilities', 'audit.md'), 'synced\n');
    fs.writeFileSync(path.join(dir, 'kit-paths.conf'), 'dir commands\nexclude commands/utilities/analyze.md\n');
    const files = kitSourceFiles(dir);
    assert.ok(files.has('commands/utilities/audit.md'));
    assert.ok(!files.has('commands/utilities/analyze.md'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadKitPaths parses dir/file/exclude, ignores comments and blanks', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kdw-lp-')));
  try {
    fs.writeFileSync(path.join(dir, 'kit-paths.conf'),
      '# comment\n\ndir hooks\ndir specs/kit\nfile CLAUDE.md\nexclude commands/utilities/analyze.md\nbogus entry\n');
    const { dirs, files, exclude } = loadKitPaths(dir);
    assert.deepStrictEqual(dirs, ['hooks', 'specs/kit']);
    assert.deepStrictEqual(files, ['CLAUDE.md']);
    assert.ok(exclude.has('commands/utilities/analyze.md'));
    assert.strictEqual(exclude.size, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadKitPaths degrades to empty lists when kit-paths.conf is missing', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kdw-lp0-')));
  try {
    const { dirs, files, exclude } = loadKitPaths(dir);
    assert.deepStrictEqual(dirs, []);
    assert.deepStrictEqual(files, []);
    assert.strictEqual(exclude.size, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BEHIND still flags changed/removed with no kit-paths.conf (graceful degrade)', () => {
  withDownstreamAndKit(({ kit, work }) => {
    fs.rmSync(path.join(kit, 'kit-paths.conf')); // no layout config available
    fs.writeFileSync(path.join(kit, '.claude', 'CLAUDE.md'), 'kit instructions v3\n'); // changed upstream
    const v = evaluate(work, kit);
    assert.ok(v);
    assert.ok(v.behind.includes('CLAUDE.md')); // changed detected via existsSync + content, no config needed
  });
});

test('kit-paths.conf parity: sync-kit.sh and the hook resolve the same layout (#737)', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  // Parity is only meaningful in the kit source, where both the bash propagator
  // (sync-kit.sh) and the JS resolver (kit-paths.conf) coexist at the repo root.
  // Downstreams sync this test file but not those root-only files, so skip there;
  // the hook's downstream degrade is already covered by the graceful-degrade tests.
  if (!fs.existsSync(path.join(repoRoot, 'sync-kit.sh'))) {
    skip('downstream: no sync-kit.sh at repo root');
  }
  // JS side: the hook's loader against the real repo config.
  const js = loadKitPaths(repoRoot);
  const jsLines = [
    ...js.dirs.map(d => `dir ${d}`),
    ...js.files.map(f => `file ${f}`),
    ...[...js.exclude].map(e => `exclude ${e}`),
  ].sort();
  // Bash side: sync-kit.sh's loader via its print mode.
  const r = spawnSync('bash', [path.join(repoRoot, 'sync-kit.sh')], {
    cwd: repoRoot,
    env: { ...process.env, SYNC_KIT_PRINT_PATHS: '1' },
    encoding: 'utf8',
  });
  assert.strictEqual(r.status, 0, `sync-kit.sh print mode failed: ${r.stderr}`);
  const bashLines = r.stdout.split('\n').map(s => s.trim()).filter(Boolean).sort();
  assert.deepStrictEqual(jsLines, bashLines);
});

test('readManifest returns sorted unique entries, or [] when absent', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kdw-mf-')));
  try {
    assert.deepStrictEqual(readManifest(dir), []);
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', '.kit-manifest'), 'b\na\n\na\n');
    assert.deepStrictEqual(readManifest(dir), ['a', 'b']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveKitSource honors CLAUDE_KIT_SOURCE and rejects a downstream', () => {
  const prev = process.env.CLAUDE_KIT_SOURCE;
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kdw-rs-')));
  try {
    const src = path.join(base, 'src');
    fs.mkdirSync(path.join(src, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(src, '.claude', 'CLAUDE.md'), 'kit\n');
    process.env.CLAUDE_KIT_SOURCE = src;
    assert.strictEqual(resolveKitSource(), fs.realpathSync(src));

    // A path carrying a manifest is a downstream, not the source: rejected,
    // so it falls through to the default (absent under the temp dir) → null.
    fs.writeFileSync(path.join(src, '.claude', '.kit-manifest'), 'CLAUDE.md\n');
    const r = resolveKitSource();
    assert.notStrictEqual(r, fs.realpathSync(src));
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_KIT_SOURCE;
    else process.env.CLAUDE_KIT_SOURCE = prev;
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('run is silenced by CLAUDE_KIT_NO_KIT_DRIFT_WARN', () => {
  const prev = process.env.CLAUDE_KIT_NO_KIT_DRIFT_WARN;
  process.env.CLAUDE_KIT_NO_KIT_DRIFT_WARN = '1';
  try {
    assert.strictEqual(run().state, 'silenced');
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_KIT_NO_KIT_DRIFT_WARN;
    else process.env.CLAUDE_KIT_NO_KIT_DRIFT_WARN = prev;
  }
});

test('run is a no-op outside a framework checkout', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kdw-nf-')));
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    assert.strictEqual(run().state, 'not-framework');
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('run reports drift on a downstream behind the kit', () => {
  withDownstreamAndKit(({ kit, work }) => {
    fs.writeFileSync(path.join(kit, '.claude', 'CLAUDE.md'), 'kit instructions v3\n');
    const cwd = process.cwd();
    const prevSrc = process.env.CLAUDE_KIT_SOURCE;
    const origWrite = process.stdout.write;
    process.stdout.write = () => true; // swallow the injected warning
    try {
      process.env.CLAUDE_KIT_SOURCE = kit;
      process.chdir(work);
      const r = run();
      assert.strictEqual(r.state, 'drift');
      assert.strictEqual(r.behind, 1);
    } finally {
      process.stdout.write = origWrite;
      process.chdir(cwd);
      if (prevSrc === undefined) delete process.env.CLAUDE_KIT_SOURCE;
      else process.env.CLAUDE_KIT_SOURCE = prevSrc;
    }
  });
});

console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed > 0 ? 1 : 0);
