#!/usr/bin/env node

/**
 * Unit tests for the shared skill-pattern module.
 * Run: node .claude/hooks/lib/skill-patterns.test.cjs
 */

const {
  isSkillComplete,
  isSkillExempt,
  isSkillRegistered,
  normalizeSkillName,
  buildSentinelRegex,
  extractCommandSignals
} = require('./skill-patterns.cjs');

let pass = 0;
let fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else    { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

report('strips leading slash', normalizeSkillName('/research') === 'research');
report('strips plugin namespace', normalizeSkillName('/project-management:sync-stack') === 'sync-stack');
report('passes through bare name', normalizeSkillName('research') === 'research');
report('handles undefined', normalizeSkillName(undefined) === '');

report('research is registered', isSkillRegistered('research'));
report('define is registered (exempt)', isSkillRegistered('define'));
report('unknown is not registered', !isSkillRegistered('this-is-not-a-skill'));

report('define is exempt', isSkillExempt('define'));
report('research is not exempt', !isSkillExempt('research'));
report('unknown is not exempt', !isSkillExempt('this-is-not-a-skill'));

const setOf = (...names) => new Set(names);

const r1 = isSkillComplete('research', [], setOf('WebSearch'));
report('research complete via WebSearch tool', r1.complete === true);

const r2 = isSkillComplete('research', [], setOf('Read'));
report('research incomplete with only Read', r2.complete === false && r2.expected !== null);

// #910: bash content search completes research (Grep/Glob tools are unavailable
// in some sessions; a bash search is the same work), including after a separator.
const researchBash = cmd => isSkillComplete('research', [cmd], setOf()).complete;
for (const cmd of ['rg logError .claude', 'git grep foo', 'grep -rn pattern src/', 'grep -Rl x .', 'ag needle', 'ls && rg foo', 'a; grep -R z .']) {
  report(`#910: research completes via bash search: ${cmd}`, researchBash(cmd) === true);
}
// #910: incidental / single-file / unrelated commands must NOT complete research.
// Filename fragments (`x.ag`) and "legit grep" are excluded by the command-position
// anchor; the `-r` requirement keeps single-file grep out.
for (const cmd of ['ps aux | grep node', 'grep -n foo file.cjs', 'git merge main', 'echo merge', 'cat findings.txt', 'npm run build', 'cat report.ag data', 'cat x.rg out', 'legit grep foo']) {
  report(`#910: research NOT completed by: ${cmd}`, researchBash(cmd) === false);
}
// #910: `find` is excluded (file-discovery, common English verb) — quoted prose
// containing "find" must NOT complete research, the high-frequency false-positive
// that dropping `find` prevents.
for (const cmd of ['git commit -m "we find bugs"', 'gh pr create --body "helps to find and fix"', 'echo "let me find that"', 'find . -name x']) {
  report(`#910: "find" in a command does NOT complete research: ${cmd}`, researchBash(cmd) === false);
}
report('#910: research description names the bash content-search option',
  isSkillComplete('research', [], setOf()).expected.includes('bash content search'));

const c1 = isSkillComplete('commit', ['git push origin main'], setOf());
report('commit complete via git push', c1.complete === true);

const c2 = isSkillComplete('commit', ['git status'], setOf());
report('commit incomplete with only git status', c2.complete === false);

const s1 = isSkillComplete('plan', ['echo SKILL_COMPLETE: plan'], setOf());
report('sentinel completes plan', s1.complete === true);

const s2 = isSkillComplete('plan', ['echo SKILL_COMPLETE: plan-foo'], setOf());
report('sentinel does not match plan-foo for plan', s2.complete === false);

const e1 = isSkillComplete('define', [], setOf());
report('exempt skill complete with no signal', e1.complete === true);

// #902: an unregistered (project-custom) skill stays gated, but ONLY its own
// SKILL_COMPLETE sentinel satisfies it — another skill's natural signals do not.
const u1 = isSkillComplete('this-is-not-a-skill', ['git push'], setOf('WebSearch'));
report('unregistered skill not complete without its sentinel (tripwire holds)', u1.complete === false);
report('unregistered skill names the sentinel as the expected action (#902)',
  u1.expected === "echo 'SKILL_COMPLETE: this-is-not-a-skill'");

const u2 = isSkillComplete('brief', ["echo 'SKILL_COMPLETE: brief'"], setOf());
report('unregistered skill completes via its own sentinel (#902)',
  u2.complete === true && u2.expected === "echo 'SKILL_COMPLETE: brief'");

const u3 = isSkillComplete('cosmo:brief', ["echo 'SKILL_COMPLETE: brief'"], setOf());
report('unregistered namespaced skill completes on the normalized-name sentinel (#902)',
  u3.complete === true && u3.expected === "echo 'SKILL_COMPLETE: brief'");

const u4 = isSkillComplete('brief', ["echo 'SKILL_COMPLETE: briefing'"], setOf());
report('unregistered sentinel is word-bounded (briefing does not satisfy brief) (#902)',
  u4.complete === false);

// #902: a malformed skill name (quote/metachar) must NOT be surfaced as a
// copy-pasteable `echo '...'` command — the Stop message tells the operator to
// run `expected`, so a quote-breakout name falls back to a non-runnable string.
const u5 = isSkillComplete("x'; rm -rf ~; echo '", [], setOf());
report('unregistered malformed name yields no runnable echo (#902 injection guard)',
  !u5.expected.includes('echo ') && u5.expected.includes('SKILL_COMPLETE'));

// #902 must not change registered-skill behavior: the sentinel was already in
// their completion OR, and expected stays the natural-signal description.
const rc = isSkillComplete('commit', [], setOf());
report('registered incomplete still reports the natural-signal description (#902 no-regress)',
  rc.complete === false && rc.expected === 'git push, gh pr create, or gh pr merge');

const p1 = isSkillComplete('/project-management:sync-stack', [], setOf());
report('namespaced sync-stack treated as exempt', p1.complete === true);

const rx = buildSentinelRegex('skill-with-dash');
report('sentinel matches with dash', rx.test('SKILL_COMPLETE: skill-with-dash'));
report('sentinel does not partial-match', !rx.test('SKILL_COMPLETE: skill-with-dash-extra'));

// #895: extractCommandSignals preserves completion tokens from the FULL command
// so tool-tracker's 100-char display truncation can't hide a signal in a tail.
// Invariant: isSkillComplete over [truncated, ...signals] == over the full command.
const truncate = (s, n) => (s.length <= n ? s : s.slice(0, n) + '...');
const longCommit = "git add " + "p/".repeat(60) + "x && SKILL_ACTIVE=1 git commit -m m && git push -u origin f";
const sig = extractCommandSignals(longCommit);
report('#895: git push extracted from a long compound tail', sig.includes('git push'));
report('#895: signals-fed verdict equals full-command verdict (invariant)',
  isSkillComplete('commit', [truncate(longCommit, 100), ...sig], setOf()).complete ===
  isSkillComplete('commit', [longCommit], setOf()).complete);
report('#895: truncated-only reproduces the bug (incomplete)',
  isSkillComplete('commit', [truncate(longCommit, 100)], setOf()).complete === false);

const heredoc = "PR_BODY=$(cat <<'EOF'\n" + 'x'.repeat(600) + "\nEOF\n) && gh pr create --body \"$PR_BODY\" && gh pr merge --auto --squash";
const hSig = extractCommandSignals(heredoc);
report('#895: gh pr create/merge extracted after a long heredoc body',
  hSig.includes('gh pr create') && hSig.includes('gh pr merge'));

const inlineSentinel = 'bash /tmp/x.sh && ' + 'y'.repeat(120) + " && echo 'SKILL_COMPLETE: brief'";
report('#895: inline sentinel in a compound tail is preserved',
  extractCommandSignals(inlineSentinel).includes('SKILL_COMPLETE: brief'));

report('#895: signal-free command extracts nothing (no event bloat)',
  extractCommandSignals('git status && ls -la && cat file').length === 0);
report('#895: prefix-collision preserved through extraction (plan-foo != plan)',
  isSkillComplete('plan', ['x', ...extractCommandSignals("echo 'SKILL_COMPLETE: plan-foo'")], setOf()).complete === false);
report('#895: non-string input returns []', extractCommandSignals(undefined).length === 0);

// #895: the plan gap-pattern is bounded so extraction over a huge command stays
// linear (no O(n^2) ReDoS) and can't capture a long secret-bearing span.
const redosInput = 'SKILL_ACTIVE=1 '.repeat(200000 / 15);
const redosStart = process.hrtime.bigint();
extractCommandSignals(redosInput);
const redosMs = Number(process.hrtime.bigint() - redosStart) / 1e6;
report('#895: 200KB repeated-anchor input extracts in <100ms (ReDoS bounded)', redosMs < 100,
  `took ${redosMs.toFixed(1)}ms`);
report('#895: a secret past the 60-char gap bound is NOT captured into signals',
  !extractCommandSignals('SKILL_ACTIVE=1 ' + 'x'.repeat(70) + ' GH_TOKEN=ghp_SECRET gh issue create')
    .some(s => s.includes('SECRET')));
report('#895: real SKILL_ACTIVE-prefixed gh issue is still detected (bound is generous)',
  isSkillComplete('plan', extractCommandSignals('SKILL_ACTIVE=1 DOCS_CHECKED=1 gh issue edit 5'), setOf()).complete === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
