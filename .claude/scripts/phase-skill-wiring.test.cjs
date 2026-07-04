#!/usr/bin/env node

/**
 * Phase-skill wiring-integrity gate (#348, the #498 carve-out).
 *
 * The cold golden-trigger walk (specs/kit/skills.md) cannot validly measure the
 * five design-thinking PHASE skills — research, define, ideate, build, test.
 * Their value is the work they govern across a framed session; the formal
 * Skill() call is workflow ceremony that a contextless `claude -p` strips away,
 * so they under-fire by construction (#498, research/skill-trigger-eval-2026-05.md).
 * skills.md carves them out of the trigger gate. They fire by WIRING instead, so
 * the valid deterministic test is that the wiring is intact:
 *   1. each phase skill exists with a parseable, non-empty description, and
 *   2. each is named in the documented workflow sequence in .claude/CLAUDE.md.
 * Rename or delete one without updating the workflow and this fails in CI — the
 * teeth the carved-out trigger gate no longer provides.
 *
 * Pure + deterministic: reads files, no claude -p, no model call.
 * Run: node .claude/scripts/phase-skill-wiring.test.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PHASE_SKILLS = ['research', 'define', 'ideate', 'build', 'test'];
const CLAUDE_MD = path.join(ROOT, '.claude', 'CLAUDE.md');

let pass = 0;
let fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

// Extract the frontmatter `description:` from a SKILL.md, folded (`>`/`|`) or
// inline. Self-contained so the gate never depends on a folded-scalar parser's
// quirks — it only needs to know the description exists and is non-empty.
function skillDescription(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const block = fm[1];
  const m = block.match(/^description:[ \t]*(.*)$/m);
  if (!m) return null;
  const inline = m[1].trim();
  if (inline === '>' || inline === '|' || inline === '') {
    const after = block.slice(block.indexOf(m[0]) + m[0].length).split('\n');
    const body = [];
    for (const line of after) {
      if (/^[ \t]+\S/.test(line)) body.push(line.trim());
      else if (line.trim() === '') continue;
      else break; // next top-level key ends the folded scalar
    }
    return body.join(' ').trim();
  }
  return inline;
}

const claudeMd = fs.existsSync(CLAUDE_MD) ? fs.readFileSync(CLAUDE_MD, 'utf8') : '';
report('.claude/CLAUDE.md exists and is readable', claudeMd.length > 0, CLAUDE_MD);

// The documented workflow line is the arrow chain that frames a session so the
// phase skills fire (`GitHub Issue → /research → /define → ...`).
const workflowLine = claudeMd.split('\n').find((l) => /\/research\b/.test(l) && /→|->/.test(l)) || '';
report('documented workflow sequence line is present', workflowLine.length > 0,
  'expected a line like: GitHub Issue → /research → /define → /ideate → /build → /test → ...');

for (const skill of PHASE_SKILLS) {
  const file = path.join(ROOT, '.claude', 'skills', skill, 'SKILL.md');
  report(`phase skill "${skill}" exists at .claude/skills/${skill}/SKILL.md`, fs.existsSync(file));
  const desc = skillDescription(file);
  report(`phase skill "${skill}" has a non-empty frontmatter description`,
    typeof desc === 'string' && desc.length > 0, JSON.stringify(desc));
  report(`phase skill "${skill}" is wired into the documented workflow (/${skill})`,
    new RegExp(`/${skill}\\b`).test(workflowLine), workflowLine);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
