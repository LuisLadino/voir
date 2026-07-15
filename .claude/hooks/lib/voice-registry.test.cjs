#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Malformed-registry cases below exercise voice-registry's logError path,
// which writes through session-utils' PROJECTS_DIR. Scope it before the
// require so a direct `node <this file>` run stays hermetic; under the test
// runner the env is already set (#889).
if (!process.env.CLAUDE_PROJECTS_DIR) {
  process.env.CLAUDE_PROJECTS_DIR =
    fs.mkdtempSync(path.join(os.tmpdir(), 'voice-registry-projects-'));
}

const {
  resolveVoice,
  registryHasPathRules,
  validateRegistry,
  globToRegex,
  matchesGlob,
  toRelative,
  resolveProjectRoot,
  FALLBACK_LUIS_RULES
} = require('./voice-registry.cjs');

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

function withTempProject(fn) {
  const rawDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-registry-'));
  const dir = fs.realpathSync(rawDir);
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// CLAUDE_PROJECT_DIR short-circuits hint-path resolution. Tests that exercise
// the hint must run with it unset.
function withoutProjectDirEnv(fn) {
  const saved = process.env.CLAUDE_PROJECT_DIR;
  delete process.env.CLAUDE_PROJECT_DIR;
  try { fn(); } finally {
    if (saved !== undefined) process.env.CLAUDE_PROJECT_DIR = saved;
  }
}

function writeRegistry(projectRoot, content) {
  fs.writeFileSync(path.join(projectRoot, '.claude/voice.yaml'), content);
}

console.log('globToRegex');

test('** matches any depth including zero', () => {
  const re = globToRegex('prompts/**');
  assert.ok(re.test('prompts/'));
  assert.ok(re.test('prompts/a.md'));
  assert.ok(re.test('prompts/deep/nested/a.md'));
  assert.ok(!re.test('other/a.md'));
});

test('* does not cross path segments', () => {
  const re = globToRegex('content/*.md');
  assert.ok(re.test('content/a.md'));
  assert.ok(!re.test('content/sub/a.md'));
});

test('literal dots are escaped', () => {
  const re = globToRegex('*.md');
  assert.ok(re.test('a.md'));
  assert.ok(!re.test('amd'));
});

test('brace alternation', () => {
  const re = globToRegex('**/*.{md,tsx}');
  assert.ok(re.test('a.md'));
  assert.ok(re.test('deep/b.tsx'));
  assert.ok(!re.test('a.txt'));
});

test('matchesGlob is path-relative', () => {
  assert.ok(matchesGlob('prompts/a.md', 'prompts/**'));
  assert.ok(!matchesGlob('x/prompts/a.md', 'prompts/**'));
});

console.log('\nvalidateRegistry');

test('rejects non-object root', () => {
  assert.deepStrictEqual(validateRegistry(null), ['root must be an object']);
  assert.deepStrictEqual(validateRegistry([]), ['root must be an object']);
});

test('requires voices object', () => {
  const errs = validateRegistry({ default: 'luis' });
  assert.ok(errs.some(e => e.includes('/voices')));
});

test('accepts null rules (none voice)', () => {
  const errs = validateRegistry({
    default: 'luis',
    voices: { luis: { rules: 'x' }, none: { rules: null } }
  });
  assert.deepStrictEqual(errs, []);
});

test('rejects default that points to unknown voice', () => {
  const errs = validateRegistry({
    default: 'ghost',
    voices: { luis: { rules: 'x' } }
  });
  assert.ok(errs.some(e => e.includes('unknown voice "ghost"')));
});

test('rejects path rule referencing unknown voice', () => {
  const errs = validateRegistry({
    voices: { luis: { rules: 'x' } },
    paths: [{ match: 'a/**', voice: 'ignite' }]
  });
  assert.ok(errs.some(e => e.includes('unknown voice "ignite"')));
});

test('accepts well-formed registry', () => {
  const errs = validateRegistry({
    default: 'luis',
    voices: {
      luis: { rules: 'r' },
      'client:ignite': { rules: 'i' },
      none: { rules: null }
    },
    paths: [
      { match: 'prompts/**', voice: 'none' },
      { match: 'brand/**', voice: 'client:ignite' }
    ]
  });
  assert.deepStrictEqual(errs, []);
});

console.log('\nresolveVoice precedence');

test('returns hardcoded fallback when no registry file', () => {
  withTempProject(dir => {
    const r = resolveVoice({ projectRoot: dir });
    assert.strictEqual(r.name, 'luis');
    assert.strictEqual(r.source, 'fallback');
    assert.ok(r.rules.includes('em dashes'));
  });
});

test('returns fallback on invalid registry', () => {
  withTempProject(dir => {
    writeRegistry(dir, 'not: [valid registry');
    const r = resolveVoice({ projectRoot: dir });
    assert.strictEqual(r.source, 'fallback');
  });
});

test('returns default voice when no filePath or envVar', () => {
  withTempProject(dir => {
    writeRegistry(dir, `
default: luis
voices:
  luis:
    rules: "luis rules"
`);
    const r = resolveVoice({ projectRoot: dir });
    assert.strictEqual(r.name, 'luis');
    assert.strictEqual(r.rules, 'luis rules');
    assert.strictEqual(r.source, 'default');
  });
});

test('path pattern wins over default', () => {
  withTempProject(dir => {
    writeRegistry(dir, `
default: luis
voices:
  luis:
    rules: "L"
  none:
    rules: null
paths:
  - match: "prompts/**"
    voice: none
`);
    const r = resolveVoice({ projectRoot: dir, filePath: 'prompts/attack.md' });
    assert.strictEqual(r.name, 'none');
    assert.strictEqual(r.rules, null);
    assert.strictEqual(r.source, 'path');
  });
});

test('envVar wins over path pattern', () => {
  withTempProject(dir => {
    writeRegistry(dir, `
default: luis
voices:
  luis:
    rules: "L"
  "client:ignite":
    rules: "I"
  none:
    rules: null
paths:
  - match: "prompts/**"
    voice: none
`);
    const r = resolveVoice({
      projectRoot: dir,
      filePath: 'prompts/attack.md',
      envVar: 'client:ignite'
    });
    assert.strictEqual(r.name, 'client:ignite');
    assert.strictEqual(r.source, 'env');
  });
});

test('first-match-wins on path ordering', () => {
  withTempProject(dir => {
    writeRegistry(dir, `
default: luis
voices:
  luis:
    rules: "L"
  none:
    rules: null
  "client:ignite":
    rules: "I"
paths:
  - match: "brand/special.md"
    voice: "client:ignite"
  - match: "brand/**"
    voice: luis
`);
    const specific = resolveVoice({ projectRoot: dir, filePath: 'brand/special.md' });
    assert.strictEqual(specific.name, 'client:ignite');
    const general = resolveVoice({ projectRoot: dir, filePath: 'brand/other.md' });
    assert.strictEqual(general.name, 'luis');
  });
});

test('unknown envVar falls through to default', () => {
  withTempProject(dir => {
    writeRegistry(dir, `
default: luis
voices:
  luis:
    rules: "L"
`);
    const r = resolveVoice({ projectRoot: dir, envVar: 'ghost' });
    assert.strictEqual(r.name, 'luis');
    assert.strictEqual(r.source, 'default');
  });
});

test('absolute path outside project root does not match', () => {
  withTempProject(dir => {
    writeRegistry(dir, `
default: luis
voices:
  luis:
    rules: "L"
  none:
    rules: null
paths:
  - match: "prompts/**"
    voice: none
`);
    const outside = resolveVoice({ projectRoot: dir, filePath: '/tmp/other/prompts/a.md' });
    assert.strictEqual(outside.source, 'default');
  });
});

test('absolute path inside project root is normalized', () => {
  withTempProject(dir => {
    writeRegistry(dir, `
default: luis
voices:
  luis:
    rules: "L"
  none:
    rules: null
paths:
  - match: "prompts/**"
    voice: none
`);
    const abs = path.join(dir, 'prompts/a.md');
    const r = resolveVoice({ projectRoot: dir, filePath: abs });
    assert.strictEqual(r.name, 'none');
  });
});

test('toRelative returns null for paths outside root', () => {
  withTempProject(dir => {
    assert.strictEqual(toRelative('/tmp/elsewhere/a.md', dir), null);
  });
});

test('FALLBACK_LUIS_RULES is exported and non-empty', () => {
  assert.ok(typeof FALLBACK_LUIS_RULES === 'string');
  assert.ok(FALLBACK_LUIS_RULES.length > 50);
});

test('FALLBACK_LUIS_RULES does not contain an em dash', () => {
  assert.ok(!FALLBACK_LUIS_RULES.includes('\u2014'), 'em dash found in fallback rules');
});

console.log('\nregistryHasPathRules short-circuit check');

test('returns false when voice.yaml is missing', () => {
  withTempProject(dir => {
    assert.strictEqual(registryHasPathRules(dir), false);
  });
});

test('returns false when voice.yaml exists but has no paths: block', () => {
  withTempProject(dir => {
    writeRegistry(dir, `
default: luis
voices:
  luis:
    rules: "L"
`);
    assert.strictEqual(registryHasPathRules(dir), false);
  });
});

test('returns true when voice.yaml has paths: with a list item', () => {
  withTempProject(dir => {
    writeRegistry(dir, `
default: luis
voices:
  luis:
    rules: "L"
  none:
    rules: null
paths:
  - match: "prompts/**"
    voice: none
`);
    assert.strictEqual(registryHasPathRules(dir), true);
  });
});

test('returns false when voice.yaml is malformed', () => {
  withTempProject(dir => {
    writeRegistry(dir, 'not: [valid');
    assert.strictEqual(registryHasPathRules(dir), false);
  });
});

console.log('\nresolveProjectRoot hint-path (cross-repo)');

test('hint-path walks from target file, not cwd — fixes cross-repo writes', () => {
  withoutProjectDirEnv(() => {
    withTempProject(repoA => {
      withTempProject(repoB => {
        const target = path.join(repoB, 'notes/foo.md');
        assert.strictEqual(resolveProjectRoot(target), repoB,
          'target-path hint should resolve to target repo, not cwd');
      });
    });
  });
});

test('CLAUDE_PROJECT_DIR env var wins over hint-path', () => {
  const saved = process.env.CLAUDE_PROJECT_DIR;
  withTempProject(repoA => {
    withTempProject(repoB => {
      process.env.CLAUDE_PROJECT_DIR = repoA;
      try {
        assert.strictEqual(resolveProjectRoot(path.join(repoB, 'x.md')), repoA);
      } finally {
        if (saved === undefined) delete process.env.CLAUDE_PROJECT_DIR;
        else process.env.CLAUDE_PROJECT_DIR = saved;
      }
    });
  });
});

test('cross-repo write: target repo path rule fires, not orchestrator default', () => {
  withoutProjectDirEnv(() => {
    withTempProject(repoA => {
      withTempProject(repoB => {
        writeRegistry(repoA, `
default: luis
voices:
  luis:
    rules: "A-luis"
`);
        writeRegistry(repoB, `
default: luis
voices:
  luis:
    rules: "B-luis"
  none:
    rules: null
paths:
  - match: "projects/**"
    voice: none
`);
        const target = path.join(repoB, 'projects/research/notes.md');
        const r = resolveVoice({ filePath: target });
        assert.strictEqual(r.name, 'none', 'target repo path rule must win');
        assert.strictEqual(r.source, 'path');
      });
    });
  });
});

test('no-hint falls back to cwd walk (backwards compat)', () => {
  withoutProjectDirEnv(() => {
    withTempProject(dir => {
      writeRegistry(dir, `
default: luis
voices:
  luis:
    rules: "L"
`);
      const savedCwd = process.cwd();
      process.chdir(dir);
      try {
        assert.strictEqual(resolveProjectRoot(), dir);
      } finally {
        process.chdir(savedCwd);
      }
    });
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
