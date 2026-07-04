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
  // Resolution order (voice-context.md) puts CLAUDE_PROJECT_DIR first. Tests that
  // assert target-path resolution must not inherit the suite session's value, or
  // it overrides the fixture. Strip it from the base; an explicit `env` override
  // (the env-first precedence test below) still wins via the spread. (#870)
  const base = { ...process.env };
  delete base.CLAUDE_PROJECT_DIR;
  const result = spawnSync('node', [HOOK], {
    input: JSON.stringify(inputObj),
    encoding: 'utf8',
    cwd: cwd || process.cwd(),
    env: env ? { ...base, ...env } : base
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

test('non-pbcopy Bash command → allow', () => {
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

// #752: VOICE=none as an echo ARGUMENT, not a command-position env prefix, must
// not resolve the override. A bare `\s`-prefixed regex matched the space before
// the argument and skipped the gate (false negative). The command-position
// anchor ignores it, so the gate fires via the default voice.
test('VOICE=none as an echo argument on pbcopy → block (not an env prefix)', () => {
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
      tool_input: { command: 'echo VOICE=none | pbcopy' },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 2,
      `expected block: VOICE=none is an argument, not a prefix; got ${r.exitCode} stderr=${r.stderr}`);
    assert.ok(r.stderr.includes('VOICE CHECK: luis'));
  });
});

// #752: a real env prefix ahead of VOICE= still honors the override. LEAD's
// optional VAR=val group backtracks so the core VOICE= matches at command
// position even with a leading assignment.
test('FOO=bar VOICE=none env prefix on pbcopy → allow (leading env var)', () => {
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
      tool_input: { command: 'FOO=bar VOICE=none echo hi | pbcopy' },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 0,
      `expected allow: VOICE=none is a real prefix; got ${r.exitCode} stderr=${r.stderr}`);
  });
});

// #743: the Bash content-file redirect channel was removed. Redirects to
// content files are internal work, not the external publish edge, and the
// regex was quote-naive. Redirects now always pass; only pbcopy gates Bash.
test('redirect to a content file → allow (#743 redirect channel removed)', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, dir => {
    const r = runHook({
      tool_name: 'Bash',
      tool_input: { command: `echo draft > ${path.join(dir, 'notes.md')}` },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 0,
      `expected allow for in-tree content redirect after #743, got ${r.exitCode} stderr=${r.stderr}`);
  });
});

test('redirect path mentioned inside a quoted argument → allow (#743, former false positive)', () => {
  // The quote-naive redirect regex used to fire when a redirect path merely
  // appeared inside a quoted argument (a grep pattern, an echoed example),
  // blocking commands that wrote nothing. With the channel gone, these pass.
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, dir => {
    const r = runHook({
      tool_name: 'Bash',
      tool_input: { command: `grep -n "redirect to > notes.md" enforce-voice.cjs` },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 0,
      `expected allow for redirect pattern inside a quoted arg, got ${r.exitCode} stderr=${r.stderr}`);
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

console.log('\n#640 pbcopy sink detection (literal token vs real pipe)');

test('real pipe to pbcopy with quoted content still blocks (#640 guard)', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, dir => {
    const r = runHook({
      tool_name: 'Bash',
      tool_input: { command: `echo "Leverage world-class synergy" | pbcopy` },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 2,
      `expected block for real pipe-to-pbcopy, got ${r.exitCode} stderr=${r.stderr}`);
    assert.ok(r.stderr.includes('VOICE CHECK: luis'));
  });
});

test('pbcopy reading from a file as leading command still blocks (#640 guard)', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, dir => {
    const r = runHook({
      tool_name: 'Bash',
      tool_input: { command: `pbcopy < draft.txt` },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 2,
      `expected block for leading pbcopy, got ${r.exitCode} stderr=${r.stderr}`);
    assert.ok(r.stderr.includes('VOICE CHECK: luis'));
  });
});

test('grep with pbcopy in a quoted alternation → allow (#640)', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, dir => {
    const r = runHook({
      tool_name: 'Bash',
      tool_input: { command: `grep -n 'redirect\\|pbcopy\\|channel' enforce-voice.cjs` },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 0,
      `expected allow for grep alternation containing pbcopy, got ${r.exitCode} stderr=${r.stderr}`);
  });
});

test('grep with an unquoted backslash-escaped pipe before pbcopy → allow (#640)', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, dir => {
    const r = runHook({
      tool_name: 'Bash',
      tool_input: { command: `grep -rn foo\\|pbcopy src` },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 0,
      `expected allow for unquoted escaped-pipe grep, got ${r.exitCode} stderr=${r.stderr}`);
  });
});

test('echo with a literal "| pbcopy" inside quotes → allow (#640)', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, dir => {
    const r = runHook({
      tool_name: 'Bash',
      tool_input: { command: `echo "example: echo hi | pbcopy"` },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 0,
      `expected allow for echo mentioning pbcopy, got ${r.exitCode} stderr=${r.stderr}`);
  });
});

test('pbcopy sink inside a command substitution in double quotes → block (#851)', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, dir => {
    const r = runHook({
      tool_name: 'Bash',
      tool_input: { command: `echo "$(make-draft | pbcopy)"` },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 2,
      `expected block for substitution-wrapped pbcopy sink, got ${r.exitCode} stderr=${r.stderr}`);
    assert.ok(r.stderr.includes('VOICE CHECK: luis'));
  });
});

test('sed with a pbcopy token in a quoted script → allow (#640)', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, dir => {
    const r = runHook({
      tool_name: 'Bash',
      tool_input: { command: `sed -n 's/.*| pbcopy.*//p' notes.txt` },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 0,
      `expected allow for sed script mentioning pbcopy, got ${r.exitCode} stderr=${r.stderr}`);
  });
});

test('gh issue create with "| pbcopy" inside a quoted --body → allow (#640)', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, dir => {
    const r = runHook({
      tool_name: 'Bash',
      tool_input: { command: `gh issue create --title t --body "tripped on: echo x | pbcopy"` },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 0,
      `expected allow for gh issue body mentioning pbcopy, got ${r.exitCode} stderr=${r.stderr}`);
  });
});

console.log('\n#754 heredoc-body pbcopy sink detection');

test('heredoc body documenting "| pbcopy", command not piped to pbcopy → allow (#754)', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, dir => {
    const r = runHook({
      tool_name: 'Bash',
      tool_input: { command: `PR_BODY=$(cat <<EOF\nRevise then retry: echo x | pbcopy\nEOF\n)\ngh pr create --body "$PR_BODY"` },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 0,
      `expected allow for heredoc body mentioning pbcopy, got ${r.exitCode} stderr=${r.stderr}`);
  });
});

test('quoted-delimiter heredoc (<<\'EOF\') body with "| pbcopy" → allow (#754, strip-order)', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, dir => {
    const r = runHook({
      tool_name: 'Bash',
      tool_input: { command: `BODY=$(cat <<'EOF'\nexample: echo hi | pbcopy\nEOF\n)\ngh issue create --body "$BODY"` },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 0,
      `expected allow for quoted-delimiter heredoc body, got ${r.exitCode} stderr=${r.stderr}`);
  });
});

test('dash heredoc (<<-EOF) with tab-indented body and close, "| pbcopy" inside → allow (#754)', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, dir => {
    const r = runHook({
      tool_name: 'Bash',
      tool_input: { command: `cat <<-EOF\n\t- echo hi | pbcopy\n\tEOF` },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 0,
      `expected allow for dash-heredoc body, got ${r.exitCode} stderr=${r.stderr}`);
  });
});

test('real heredoc operator-line sink (cat <<EOF | pbcopy) still blocks (#754 guard)', () => {
  withProject(`
default: luis
voices:
  luis:
    rules: "L"
`, dir => {
    const r = runHook({
      tool_name: 'Bash',
      tool_input: { command: `cat <<EOF | pbcopy\nLeverage world-class synergy\nEOF` },
      session_id: 's1'
    }, { cwd: dir });
    assert.strictEqual(r.exitCode, 2,
      `expected block for real heredoc-to-pbcopy sink, got ${r.exitCode} stderr=${r.stderr}`);
    assert.ok(r.stderr.includes('VOICE CHECK: luis'));
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

test('CLAUDE_PROJECT_DIR set → wins over the target-path walk (voice-context.md order)', () => {
  // The flip side of the cross-repo test above. Resolution order puts
  // CLAUDE_PROJECT_DIR first, so the target-path walk is only the no-env
  // (subagent) fallback. Here the target repo has a rule that WOULD block, but
  // the env points at a decoy with no matching rule, so resolution short-circuits
  // to the decoy and the write passes. This is the same precedence #872 pins for
  // dispatch, asserted here for the voice gate. (#870)
  withProject(`
default: luis
voices:
  luis:
    rules: "DECOY"
`, decoy => {
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
        session_id: 's-envfirst'
      }, { cwd: repoB, env: { CLAUDE_PROJECT_DIR: decoy } });
      assert.strictEqual(r.exitCode, 0,
        `CLAUDE_PROJECT_DIR must win: decoy has no rule for the target path, so the write passes; got ${r.exitCode} stderr=${r.stderr}`);
    });
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
