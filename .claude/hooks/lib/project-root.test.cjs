#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveProjectRoot, MAX_WALK_DEPTH } = require('./project-root.cjs');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${(e.stack || e.message).replace(/\n/g, '\n       ')}`); }
}

function withTempProject(fn) {
  const raw = fs.mkdtempSync(path.join(os.tmpdir(), 'project-root-'));
  const dir = fs.realpathSync(raw);
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function withoutProjectDirEnv(fn) {
  const saved = process.env.CLAUDE_PROJECT_DIR;
  delete process.env.CLAUDE_PROJECT_DIR;
  try { fn(); } finally {
    if (saved !== undefined) process.env.CLAUDE_PROJECT_DIR = saved;
  }
}

console.log('resolveProjectRoot');

test('returns CLAUDE_PROJECT_DIR when set', () => {
  const saved = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = '/some/env/dir';
  try {
    assert.strictEqual(resolveProjectRoot(), '/some/env/dir');
    assert.strictEqual(resolveProjectRoot('/any/hint'), '/some/env/dir');
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = saved;
  }
});

test('directory hint: walks from hint directory', () => {
  withoutProjectDirEnv(() => {
    withTempProject(dir => {
      assert.strictEqual(resolveProjectRoot(dir), dir);
    });
  });
});

test('file-path hint: walks from dirname of absolute file path', () => {
  withoutProjectDirEnv(() => {
    withTempProject(dir => {
      const target = path.join(dir, 'notes/foo.md');
      assert.strictEqual(resolveProjectRoot(target), dir);
    });
  });
});

test('file-path hint: non-existent file still resolves via dirname when absolute', () => {
  withoutProjectDirEnv(() => {
    withTempProject(dir => {
      const target = path.join(dir, 'does/not/exist.md');
      assert.strictEqual(resolveProjectRoot(target), dir);
    });
  });
});

test('no-hint: falls back to cwd walk', () => {
  withoutProjectDirEnv(() => {
    withTempProject(dir => {
      const saved = process.cwd();
      process.chdir(dir);
      try { assert.strictEqual(resolveProjectRoot(), dir); }
      finally { process.chdir(saved); }
    });
  });
});

test('relative-path hint with no stat: ignored, falls to cwd', () => {
  withoutProjectDirEnv(() => {
    withTempProject(dir => {
      const saved = process.cwd();
      process.chdir(dir);
      try { assert.strictEqual(resolveProjectRoot('nonexistent-relative/file.md'), dir); }
      finally { process.chdir(saved); }
    });
  });
});

test('symlinkGuard true (default): returns null on symlinked .claude/', () => {
  withoutProjectDirEnv(() => {
    const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sym-')));
    const realDir = path.join(parent, 'real-claude');
    fs.mkdirSync(realDir, { recursive: true });
    const projectDir = path.join(parent, 'project');
    fs.mkdirSync(projectDir);
    fs.symlinkSync(realDir, path.join(projectDir, '.claude'));
    try { assert.strictEqual(resolveProjectRoot(projectDir), null); }
    finally { fs.rmSync(parent, { recursive: true, force: true }); }
  });
});

test('symlinkGuard false: returns dir even when .claude/ is a symlink', () => {
  withoutProjectDirEnv(() => {
    const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sym-')));
    const realDir = path.join(parent, 'real-claude');
    fs.mkdirSync(realDir, { recursive: true });
    const projectDir = path.join(parent, 'project');
    fs.mkdirSync(projectDir);
    fs.symlinkSync(realDir, path.join(projectDir, '.claude'));
    try {
      assert.strictEqual(
        resolveProjectRoot(projectDir, { symlinkGuard: false }),
        projectDir
      );
    } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  });
});

test('walk depth: finds .claude/ up to 20 parents deep', () => {
  withoutProjectDirEnv(() => {
    withTempProject(root => {
      let deep = root;
      for (let i = 0; i < 15; i++) {
        deep = path.join(deep, `n${i}`);
        fs.mkdirSync(deep);
      }
      assert.strictEqual(resolveProjectRoot(deep), root);
    });
  });
});

test('MAX_WALK_DEPTH is exported and is 20', () => {
  assert.strictEqual(MAX_WALK_DEPTH, 20);
});

test('fallback returns startDir when .claude/ not found in walk', () => {
  withoutProjectDirEnv(() => {
    const raw = fs.mkdtempSync(path.join(os.tmpdir(), 'no-claude-'));
    const dir = fs.realpathSync(raw);
    try { assert.strictEqual(resolveProjectRoot(dir), dir); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

test('fallback returns cwd when no hint and no .claude/ in walk', () => {
  withoutProjectDirEnv(() => {
    const raw = fs.mkdtempSync(path.join(os.tmpdir(), 'no-claude-'));
    const dir = fs.realpathSync(raw);
    const saved = process.cwd();
    process.chdir(dir);
    try { assert.strictEqual(resolveProjectRoot(), dir); }
    finally {
      process.chdir(saved);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
