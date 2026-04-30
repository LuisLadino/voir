#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, 'enforce-voice.cjs');

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

function runHook(inputObj, { cwd, env } = {}) {
  const result = spawnSync('node', [HOOK], {
    input: JSON.stringify(inputObj),
    encoding: 'utf8',
    cwd: cwd || process.cwd(),
    env: env ? { ...process.env, ...env } : process.env
  });
  return { exitCode: result.status, stderr: result.stderr, stdout: result.stdout };
}

function withProject(registryYaml, fn) {
  const rawDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-int-'));
  const dir = fs.realpathSync(rawDir);
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  if (registryYaml !== null) {
    fs.writeFileSync(path.join(dir, '.claude/voice.yaml'), registryYaml);
  }
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log('Bash channel');

test('no pbcopy and no redirect → allow', () => {
  const r = runHook({
    tool_name: 'Bash',
    tool_input: { command: 'git status' },
    session_id: 's1'
  });
  assert.strictEqual(r.exitCode, 0);
});

test('pbcopy with no voice registry → block via Luis fallback', () => {
  withProject(null, dir => {
    const r = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'echo hi | pbcopy' },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 2);
    assert.ok(r.stderr.includes('VOICE CHECK: luis'));
    assert.ok(r.stderr.includes('fallback') || r.stderr.includes('default'));
  });
});

test('unknown VOICE=bogus env var on pbcopy → block via default (no bypass)', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
  none:
    rules: null
`, dir => {
    const r = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'VOICE=bogus echo hi | pbcopy' },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 2);
    assert.ok(r.stderr.includes('VOICE CHECK: luis'));
  });
});

test('VOICE=none env var on pbcopy → allow', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
  none:
    rules: null
`, dir => {
    const r = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'VOICE=none echo hi | pbcopy' },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 0);
  });
});

test('redirect to .md with default Luis voice → block', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, dir => {
    const r = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'echo content > notes.md' },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 2);
    assert.ok(r.stderr.includes('VOICE CHECK: luis'));
  });
});

test('redirect to .claude/foo.md → allow (Claude-consumed path)', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, dir => {
    const r = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'echo content > .claude/notes.md' },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 0);
  });
});

test('redirect to .json → allow (not content extension)', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, dir => {
    const r = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'echo "{}" > config.json' },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 0);
  });
});

test('Write retry with revised content → allow after first-attempt reminder', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
paths:
  - match: "*.md"
    voice: luis
`, dir => {
    const sessionId = 'w-revise-' + Date.now();
    const first = runHook({
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, 'post.md'), content: 'Original content' },
      session_id: sessionId,
      agent_id: 'test-agent'
    }, { cwd: dir });
    assert.strictEqual(first.exitCode, 2, 'first attempt should block with reminder');
    const second = runHook({
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, 'post.md'), content: 'Revised content.' },
      session_id: sessionId,
      agent_id: 'test-agent'
    }, { cwd: dir });
    assert.strictEqual(second.exitCode, 0, 'revised content should pass');
  });
});

test('Write retry with identical content → block as bypass attempt', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
paths:
  - match: "*.md"
    voice: luis
`, dir => {
    const sessionId = 'w-same-' + Date.now();
    const payload = {
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, 'post.md'), content: 'Same content' },
      session_id: sessionId,
      agent_id: 'test-agent'
    };
    const first = runHook(payload, { cwd: dir });
    assert.strictEqual(first.exitCode, 2);
    const second = runHook(payload, { cwd: dir });
    assert.strictEqual(second.exitCode, 2);
    assert.ok(second.stderr.includes('unchanged'));
  });
});

test('VOICE_CHECKED=1 with unchanged content after block → block again', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, dir => {
    const cmd = 'echo "same content" | pbcopy';
    const sessionId = 's-same-' + Date.now();
    const first = runHook({
      tool_name: 'Bash',
      tool_input: { command: cmd },
      session_id: sessionId,
      agent_id: 'test-agent'
    }, { cwd: dir });
    assert.strictEqual(first.exitCode, 2);
    const second = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'VOICE_CHECKED=1 ' + cmd },
      session_id: sessionId,
      agent_id: 'test-agent'
    }, { cwd: dir });
    assert.strictEqual(second.exitCode, 2);
    assert.ok(second.stderr.includes('unchanged'));
  });
});

console.log('\nWrite/Edit channel');

test('Write to declared .md path with Luis voice → block', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
paths:
  - match: "*.md"
    voice: luis
`, dir => {
    const r = runHook({
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, 'post.md'), content: 'Some content' },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 2);
    assert.ok(r.stderr.includes('VOICE CHECK: luis'));
    assert.ok(r.stderr.includes('post.md'));
  });
});

test('Write to undeclared .md → allow silently (Plane 1 default-skip)', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, dir => {
    const r = runHook({
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, 'README.md'), content: 'Some content' },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 0);
  });
});

test('Write to undeclared .md when paths: has unrelated entries → allow silently', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
paths:
  - match: "drafts/emails/**"
    voice: luis
`, dir => {
    const r = runHook({
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, 'notes.md'), content: 'Some content' },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 0);
  });
});

test('Write to cross-tree path outside project → allow silently (live repro 2026-04-23)', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, dir => {
    const outsidePath = path.join(os.tmpdir(), 'ev-crosstree-' + Date.now() + '.md');
    const r = runHook({
      tool_name: 'Write',
      tool_input: { file_path: outsidePath, content: 'Internal memory note' },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 0);
  });
});

test('Write to .claude/**.md → allow (Claude-consumed path)', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, dir => {
    fs.mkdirSync(path.join(dir, '.claude/specs'), { recursive: true });
    const r = runHook({
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.claude/specs/new-spec.md'), content: 'spec body' },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 0);
  });
});

test('Write to root CLAUDE.md → allow (Claude-consumed instruction file)', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, dir => {
    const r = runHook({
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, 'CLAUDE.md'), content: 'Claude instructions' },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 0);
  });
});

test('Write to .github/PULL_REQUEST_TEMPLATE.md → allow (meta file)', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, dir => {
    fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
    const r = runHook({
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.github/PULL_REQUEST_TEMPLATE.md'), content: 'template' },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 0);
  });
});

test('Write to .cjs → allow (not content extension)', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, dir => {
    const r = runHook({
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, 'script.cjs'), content: 'module.exports = {};' },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 0);
  });
});

test('Write to path matched by path rule with voice: none → allow', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
  none:
    rules: null
paths:
  - match: "prompts/**"
    voice: none
`, dir => {
    fs.mkdirSync(path.join(dir, 'prompts'), { recursive: true });
    const r = runHook({
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, 'prompts/attack.md'), content: 'Some content' },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 0);
  });
});

test('Write to path matched with client voice → block with client reminder', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "Luis rules"
  "client:ignite":
    rules: "Ignite brand voice rules"
paths:
  - match: "brand/**"
    voice: "client:ignite"
`, dir => {
    fs.mkdirSync(path.join(dir, 'brand'), { recursive: true });
    const r = runHook({
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, 'brand/homepage.md'), content: 'Brand copy' },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 2);
    assert.ok(r.stderr.includes('VOICE CHECK: client:ignite'));
    assert.ok(r.stderr.includes('Ignite brand voice rules'));
  });
});

test('Edit to .tsx under explicit brand path rule → block', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
  "client:ignite":
    rules: "I"
paths:
  - match: "brand/**/*.tsx"
    voice: "client:ignite"
`, dir => {
    fs.mkdirSync(path.join(dir, 'brand'), { recursive: true });
    const r = runHook({
      tool_name: 'Edit',
      tool_input: {
        file_path: path.join(dir, 'brand/Hero.tsx'),
        old_string: 'old',
        new_string: 'new content here'
      },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 2);
    assert.ok(r.stderr.includes('VOICE CHECK: client:ignite'));
  });
});

test('explicit path rule for .claude/** overrides the Claude-consumed skip', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
paths:
  - match: ".claude/**"
    voice: luis
`, dir => {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    const r = runHook({
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.claude/CLAUDE.md'), content: 'x' },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 2);
  });
});

test('unrelated tool (Read) → allow', () => {
  const r = runHook({
    tool_name: 'Read',
    tool_input: { file_path: '/tmp/a.md' },
    session_id: 's1'
  });
  assert.strictEqual(r.exitCode, 0);
});

console.log('\nAuto-memory skip (~/.claude/projects/**/memory/**)');

test('Write under PROJECTS_DIR memory tree → allow (skip fires before voice resolution)', () => {
  const rawHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-home-'));
  const fakeHome = fs.realpathSync(rawHome);
  const memoryDir = path.join(fakeHome, '.claude/projects/test-workspace/memory');
  fs.mkdirSync(memoryDir, { recursive: true });
  // Put a voice.yaml in cwd that would otherwise block, to prove the skip
  // fires before any registry resolution runs.
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
paths:
  - match: "**/*.md"
    voice: luis
`, cwdDir => {
    const target = path.join(memoryDir, 'project_handoff.md');
    const r = runHook({
      tool_name: 'Write',
      tool_input: { file_path: target, content: 'Internal memory note.' },
      session_id: 's-mem'
    }, { cwd: cwdDir, env: { HOME: fakeHome } });
    try {
      assert.strictEqual(r.exitCode, 0, `expected allow, got ${r.exitCode} stderr=${r.stderr}`);
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});

test('Bash redirect under PROJECTS_DIR memory tree → allow', () => {
  const rawHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-home-'));
  const fakeHome = fs.realpathSync(rawHome);
  const memoryDir = path.join(fakeHome, '.claude/projects/test-workspace/memory');
  fs.mkdirSync(memoryDir, { recursive: true });
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, cwdDir => {
    const target = path.join(memoryDir, 'note.md');
    const r = runHook({
      tool_name: 'Bash',
      tool_input: { command: `echo "stuff" > ${target}` },
      session_id: 's-mem-bash'
    }, { cwd: cwdDir, env: { HOME: fakeHome } });
    try {
      assert.strictEqual(r.exitCode, 0, `expected allow, got ${r.exitCode} stderr=${r.stderr}`);
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});

console.log('\nCross-repo writes (target repo voice.yaml wins)');

test('Write from repo A cwd to repo B path with B rule → block via B voice', () => {
  // Repo A is the orchestrator cwd. Repo B is the target. B has a path rule
  // that routes brand/**/*.md to a client voice. Pre-fix, A's voice.yaml (no
  // rules) would apply and the write would pass silently. Post-fix, B's rule
  // fires and the write blocks under the client voice.
  withProject(`
default: luis
voices:
  luis:
    rules: "A-rules"
`, repoA => {
    withProject(`
default: luis
voices:
  luis:
    rules: "B-rules"
  "client:brand":
    rules: "BRAND-RULES"
paths:
  - match: "brand/**/*.md"
    voice: "client:brand"
`, repoB => {
      fs.mkdirSync(path.join(repoB, 'brand'), { recursive: true });
      const target = path.join(repoB, 'brand/home.md');
      const r = runHook({
        tool_name: 'Write',
        tool_input: { file_path: target, content: 'Some brand copy.' },
        session_id: 's-cross'
      }, { cwd: repoA });
      assert.strictEqual(r.exitCode, 2, 'target repo B path rule must fire');
      assert.ok(r.stderr.includes('client:brand'),
        `expected client:brand voice, got: ${r.stderr}`);
    });
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
