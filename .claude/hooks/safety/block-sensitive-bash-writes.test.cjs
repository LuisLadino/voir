#!/usr/bin/env node
// Tests for block-sensitive-bash-writes.cjs
// Covers the bypass patterns confirmed in worker self-reports (#184) and
// guards against common write paths targeting sensitive files.

const { detectSensitiveWrite } = require('./block-sensitive-bash-writes.cjs');

const cases = [
  // BLOCK — known bypass patterns
  {
    name: 'B1 heredoc redirect to kit hook',
    cmd: `cat <<'EOF' > .claude/hooks/safety/block-dangerous.cjs\nmalicious\nEOF`,
    expect: 'block',
  },
  {
    name: 'B2 heredoc redirect to user settings',
    cmd: `cat <<'EOF' > ~/.claude/settings.json\n{}\nEOF`,
    expect: 'block',
  },
  {
    name: 'B3 node -e fs.writeFileSync to kit hook',
    cmd: `node -e "require('fs').writeFileSync('.claude/hooks/context/enforce-specs.cjs', 'x')"`,
    expect: 'block',
  },
  {
    name: 'B4 node --eval fs.writeFile to settings',
    cmd: `node --eval "require('fs').writeFile('/Users/luis/.claude/settings.json', 'x', ()=>{})"`,
    expect: 'block',
  },
  {
    name: 'B5 echo redirect to kit hook',
    cmd: `echo 'malicious' > .claude/hooks/safety/evil.cjs`,
    expect: 'block',
  },
  {
    name: 'B6 append redirect to settings',
    cmd: `printf '%s' 'x' >> ~/.claude/settings.json`,
    expect: 'block',
  },
  {
    name: 'B7 tee to kit hook',
    cmd: `echo '{}' | tee .claude/hooks/safety/foo.cjs`,
    expect: 'block',
  },
  {
    name: 'B8 cp source to sensitive destination',
    cmd: `cp /tmp/evil.cjs .claude/hooks/safety/block-dangerous.cjs`,
    expect: 'block',
  },
  {
    name: 'B9 mv to sensitive destination',
    cmd: `mv /tmp/evil.json ~/.claude/settings.json`,
    expect: 'block',
  },
  {
    name: 'B10 python -c open w',
    cmd: `python3 -c "open('.claude/hooks/safety/foo.cjs', 'w').write('x')"`,
    expect: 'block',
  },
  {
    name: 'B11 heredoc with absolute home path',
    cmd: `cat <<EOF > /Users/luisladino/.claude/settings.json\n{}\nEOF`,
    expect: 'block',
  },
  {
    name: 'B12 heredoc redirect to settings.local.json',
    cmd: `cat <<EOF > ~/.claude/settings.local.json\n{}\nEOF`,
    expect: 'block',
  },
  {
    name: 'B13 sed -i on kit hook (BSD syntax)',
    cmd: `sed -i '' 's/foo/bar/' .claude/hooks/tracking/awareness.cjs`,
    expect: 'block',
  },
  {
    name: 'B14 sed -i on settings (GNU syntax)',
    cmd: `sed -i 's/foo/bar/' ~/.claude/settings.json`,
    expect: 'block',
  },
  {
    name: 'B15 sed -i with -e on kit hook',
    cmd: `sed -i -e 's/foo/bar/' .claude/hooks/safety/block-dangerous.cjs`,
    expect: 'block',
  },
  {
    name: 'B16 awk -i inplace on kit hook',
    cmd: `awk -i inplace '{print}' .claude/hooks/context/enforce-specs.cjs`,
    expect: 'block',
  },
  {
    name: 'B17 perl -i -pe on kit hook',
    cmd: `perl -i -pe 's/foo/bar/' .claude/hooks/tracking/awareness.cjs`,
    expect: 'block',
  },
  {
    name: 'B18 perl -i.bak on settings',
    cmd: `perl -i.bak -pe 's/foo/bar/' ~/.claude/settings.json`,
    expect: 'block',
  },

  // PASS — legitimate reads or non-sensitive writes
  {
    name: 'P1 read hook file',
    cmd: `cat .claude/hooks/safety/block-dangerous.cjs`,
    expect: 'pass',
  },
  {
    name: 'P2 grep in hooks dir',
    cmd: `grep -r "writeFile" .claude/hooks/`,
    expect: 'pass',
  },
  {
    name: 'P3 write to non-sensitive path',
    cmd: `echo 'x' > /tmp/scratch.txt`,
    expect: 'pass',
  },
  {
    name: 'P4 write to .claude/docs',
    cmd: `cat <<EOF > .claude/docs/note.md\nnote\nEOF`,
    expect: 'pass',
  },
  {
    name: 'P5 write to .claude/specs',
    cmd: `echo 'spec' > .claude/specs/custom.md`,
    expect: 'pass',
  },
  {
    name: 'P6 node script reading sensitive path',
    cmd: `node -e "console.log(require('fs').readFileSync('.claude/hooks/context/enforce-specs.cjs', 'utf8'))"`,
    expect: 'pass',
  },
  {
    name: 'P7 ls on hooks dir',
    cmd: `ls .claude/hooks/`,
    expect: 'pass',
  },
  {
    name: 'P8 git operations referencing hooks',
    cmd: `git diff .claude/hooks/safety/block-dangerous.cjs`,
    expect: 'pass',
  },
  {
    name: 'P9 empty command',
    cmd: ``,
    expect: 'pass',
  },
  {
    name: 'P10 unrelated command with fs.writeFileSync',
    cmd: `node -e "require('fs').writeFileSync('/tmp/out.txt', 'x')"`,
    expect: 'pass',
  },
  // PASS — false positives the previous regex implementation hit (#233)
  {
    name: 'P11 cp source-only sensitive (#233 F1)',
    cmd: `cp .claude/hooks/safety/foo.cjs /tmp/backup.cjs`,
    expect: 'pass',
  },
  {
    name: 'P12 cp settings to backup (#233 F2)',
    cmd: `cp ~/.claude/settings.json ~/backups/settings.json`,
    expect: 'pass',
  },
  {
    name: 'P13 mv from sensitive to safe',
    cmd: `mv .claude/hooks/safety/foo.cjs /tmp/foo.cjs`,
    expect: 'pass',
  },
  {
    name: 'P14 rsync from sensitive to safe',
    cmd: `rsync ~/.claude/settings.json /tmp/`,
    expect: 'pass',
  },
  {
    name: 'P15 gh issue body mentions protected path',
    cmd: `gh issue create --body "fix .claude/hooks/foo.cjs handling"`,
    expect: 'pass',
  },
  {
    name: 'P16 gh issue body contains literal redirect token',
    cmd: `gh issue create --body "use > .claude/hooks/foo.cjs to write"`,
    expect: 'pass',
  },
  {
    name: 'P17 gh issue body mentions sed -i string',
    cmd: `gh issue create --body "sed -i 's/x/y/' .claude/hooks/foo.cjs"`,
    expect: 'pass',
  },
  {
    name: 'P18 gh api -f body assignment with single-quoted path',
    cmd: `gh api repos/x/y/issues/1/comments -f body='fix .claude/hooks/safety/foo.cjs'`,
    expect: 'pass',
  },
  {
    name: 'P19 echo string mentions cp pattern',
    cmd: `echo "look at cp x .claude/hooks/foo.cjs"`,
    expect: 'pass',
  },
  {
    name: 'P20 diff sensitive vs other',
    cmd: `diff .claude/hooks/safety/foo.cjs /tmp/old.cjs`,
    expect: 'pass',
  },
  {
    name: 'P21 heredoc body contains literal sensitive write pattern, real dest is safe',
    cmd: `cat <<'EOF' > /tmp/note.txt\ncp x .claude/hooks/foo.cjs\nEOF`,
    expect: 'pass',
  },
  {
    name: 'P22 cp sensitive sources to safe directory',
    cmd: `cp .claude/settings.json ~/.claude/settings.json /tmp/backup/`,
    expect: 'pass',
  },
  {
    name: 'P23 tar backup including sensitive paths',
    cmd: `tar czf /tmp/bk.tgz .claude/hooks ~/.claude/settings.json`,
    expect: 'pass',
  },

  // BLOCK — additional coverage from the destination-aware rewrite
  {
    name: 'B19 cp many sources to sensitive dest',
    cmd: `cp /tmp/a /tmp/b .claude/hooks/safety/foo.cjs`,
    expect: 'block',
  },
  {
    name: 'B20 sh -c with redirect bypass',
    cmd: `sh -c "echo x > .claude/hooks/safety/foo.cjs"`,
    expect: 'block',
  },
  {
    name: 'B21 bash -c with cp bypass',
    cmd: `bash -c "cp /tmp/x .claude/hooks/safety/foo.cjs"`,
    expect: 'block',
  },
  {
    name: 'B22 chained && with sensitive write second',
    cmd: `cp /tmp/a /tmp/b && cp /tmp/x .claude/hooks/safety/foo.cjs`,
    expect: 'block',
  },
  {
    name: 'B23 install -m to settings',
    cmd: `install -m 644 /tmp/x.json ~/.claude/settings.json`,
    expect: 'block',
  },
  {
    name: 'B24 tee with multiple targets including sensitive',
    cmd: `echo x | tee /tmp/a .claude/hooks/safety/foo.cjs`,
    expect: 'block',
  },
  {
    name: 'B25 fd-numbered redirect to sensitive',
    cmd: `mycmd 2> .claude/hooks/safety/foo.cjs`,
    expect: 'block',
  },
  {
    name: 'B26 &> redirect to sensitive',
    cmd: `mycmd &> .claude/hooks/safety/foo.cjs`,
    expect: 'block',
  },
  {
    name: 'B27 zsh -c bypass',
    cmd: `zsh -c "printf x > .claude/hooks/safety/foo.cjs"`,
    expect: 'block',
  },
  {
    name: 'B28 node -e createWriteStream to sensitive',
    cmd: `node -e "require('fs').createWriteStream('.claude/hooks/safety/foo.cjs').end('x')"`,
    expect: 'block',
  },
];

let passed = 0;
let failed = 0;
const failures = [];

for (const c of cases) {
  const hit = detectSensitiveWrite(c.cmd);
  const result = hit ? 'block' : 'pass';
  if (result === c.expect) {
    passed++;
  } else {
    failed++;
    failures.push({ name: c.name, expected: c.expect, got: result, hit });
  }
}

console.log(`${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log('');
  for (const f of failures) {
    console.log(`FAIL ${f.name}: expected ${f.expected}, got ${f.got}`);
    if (f.hit) {
      console.log(`  matched pattern: ${f.hit.pattern}, target: ${f.hit.target}`);
    }
  }
  process.exit(1);
}

process.exit(0);
