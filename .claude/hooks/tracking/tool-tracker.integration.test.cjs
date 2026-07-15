#!/usr/bin/env node

/**
 * Integration test for tool-tracker's capture-time signal extraction (#895).
 *
 * Spawns the real hook with a Bash tool payload on stdin and asserts the
 * recorded JSONL event preserves the completion signals from the FULL command
 * even though the display `command` is truncated to 100 chars. CLAUDE_PROJECTS_DIR
 * (the #889 seam) redirects the tracking write into a throwaway dir so the real
 * ~/.claude/projects tree is never touched.
 *
 * Run: node .claude/hooks/tracking/tool-tracker.integration.test.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, 'tool-tracker.cjs');

let pass = 0;
let fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else    { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

// Run the hook once with a given command, return the single recorded event.
function recordBash(command) {
  const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-895-projects-'));
  const sessionId = 'test-895';
  const payload = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command },
    session_id: sessionId
  });
  const r = spawnSync(process.execPath, [HOOK], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECTS_DIR: projectsDir }
  });
  if (r.status !== 0) throw new Error(`hook exited ${r.status}: ${r.stderr}`);
  // Find the one tracking JSONL under the throwaway projects dir.
  const files = [];
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.jsonl')) files.push(full);
    }
  };
  walk(projectsDir);
  const lines = files.flatMap(f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean));
  const events = lines.map(l => JSON.parse(l)).filter(e => e.type === 'tool' && e.tool === 'Bash');
  fs.rmSync(projectsDir, { recursive: true, force: true });
  return events[events.length - 1];
}

// A compound command whose `git push` sits well past the 100-char truncation.
const longCommit = 'git add ' + 'some/long/path/file.ts '.repeat(8) +
  "&& SKILL_ACTIVE=1 git commit -m msg && git push -u origin feature/x";
const ev = recordBash(longCommit);
report('#895: long compound command records a Bash tool event',
  ev && ev.tool === 'Bash', JSON.stringify(ev));
report('#895: display command is truncated to 100 chars',
  ev.command.length <= 103 && ev.command.endsWith('...'), `len ${ev.command && ev.command.length}`);
report('#895: git push (in the truncated tail) is preserved in signals',
  Array.isArray(ev.signals) && ev.signals.includes('git push'), JSON.stringify(ev.signals));

// A signal-free command must NOT carry a signals field (no event bloat).
const plain = recordBash('git status && ls -la && cat README.md');
report('#895: signal-free command records no signals field',
  plain && plain.signals === undefined, JSON.stringify(plain && plain.signals));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
