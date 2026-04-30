#!/usr/bin/env node

/**
 * phase-menu unit tests.
 *
 * Covers:
 *   - Fires on workflow slash-command invocation (/build, /define, etc.)
 *   - No-op on non-workflow slash command (/pre-mortem)
 *   - No-op on plain prompt
 *   - Dedup suppresses re-emission within the same phase
 *   - Re-emits after a phase transition
 *   - Menu includes attached + transition-into moves
 */

const fs = require('fs');
const path = require('path');

const {
  appendTrackingEvent,
  getSessionTrackingPath,
  getTrackingDir,
  _resetRecentStateCache
} = require('../lib/session-utils.cjs');

// Sandbox the tracking dir so host-session events don't leak in. Derive
// the path from session-utils so tests work in any project, not just the
// kit author's workspace.
const realTracking = getTrackingDir();
const backup = realTracking + '.test-backup-phase-menu';
const hadReal = fs.existsSync(realTracking);
if (hadReal) fs.renameSync(realTracking, backup);
fs.mkdirSync(realTracking, { recursive: true });

let pass = 0;
let fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else    { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

// Import fresh each test so module-level caches don't leak.
const MODULE_PATH = require.resolve('./phase-menu.cjs');
function freshModule() {
  delete require.cache[MODULE_PATH];
  return require('./phase-menu.cjs');
}

function resetTracking() {
  for (const f of fs.readdirSync(realTracking)) {
    fs.unlinkSync(path.join(realTracking, f));
  }
  // Module-level caches in session-utils persist across test cases inside
  // a single Node process. Without this reset the second test sees the
  // first test's cached state and assertions drift.
  if (typeof _resetRecentStateCache === 'function') _resetRecentStateCache();
}

try {
  // 1. Fires on workflow slash command
  resetTracking();
  const sid1 = 'phase-menu-1-' + Date.now();
  appendTrackingEvent(sid1, { type: 'session_init' });
  appendTrackingEvent(sid1, {
    type: 'skill_invocation', skill: 'build', source: 'slash_command'
  });
  {
    const mod = freshModule();
    const r = mod.check(sid1);
    report(
      'fires on workflow slash command (/build)',
      r.content !== null && r.emitted === true && r.phase === 'during_build',
      `got ${JSON.stringify({ emitted: r.emitted, phase: r.phase })}`
    );
    report(
      'menu includes PHASE ENTRY banner',
      r.content && r.content.includes('[PHASE ENTRY: during_build]')
    );
    report(
      'menu includes at least one attached move',
      r.content && /\/\w+.+during_build|ideate_to_build/.test(r.content)
    );
  }

  // 2. Dedup: same-phase re-invoke suppresses
  resetTracking();
  const sid2 = 'phase-menu-2-' + Date.now();
  appendTrackingEvent(sid2, { type: 'session_init' });
  appendTrackingEvent(sid2, {
    type: 'skill_invocation', skill: 'research', source: 'slash_command'
  });
  appendTrackingEvent(sid2, {
    type: 'phase_menu_emitted', phase: 'during_research'
  });
  appendTrackingEvent(sid2, {
    type: 'skill_invocation', skill: 'research', source: 'slash_command'
  });
  {
    const mod = freshModule();
    const r = mod.check(sid2);
    report(
      'same-phase re-invoke does not re-emit',
      r.content === null && r.emitted === false
    );
  }

  // 3. Re-emits on transition to a different phase
  resetTracking();
  const sid3 = 'phase-menu-3-' + Date.now();
  appendTrackingEvent(sid3, { type: 'session_init' });
  appendTrackingEvent(sid3, {
    type: 'skill_invocation', skill: 'research', source: 'slash_command'
  });
  appendTrackingEvent(sid3, {
    type: 'phase_menu_emitted', phase: 'during_research'
  });
  appendTrackingEvent(sid3, {
    type: 'skill_invocation', skill: 'build', source: 'slash_command'
  });
  {
    const mod = freshModule();
    const r = mod.check(sid3);
    report(
      'phase transition re-emits menu',
      r.content !== null && r.emitted === true && r.phase === 'during_build'
    );
  }

  // 4. No-op on non-workflow slash command
  resetTracking();
  const sid4 = 'phase-menu-4-' + Date.now();
  appendTrackingEvent(sid4, { type: 'session_init' });
  appendTrackingEvent(sid4, {
    type: 'skill_invocation', skill: 'pre-mortem', source: 'slash_command'
  });
  {
    const mod = freshModule();
    const r = mod.check(sid4);
    report(
      'no-op on non-workflow slash command (/pre-mortem)',
      r.content === null && r.emitted === false
    );
  }

  // 5. No-op on plain prompt with no skill_invocation
  resetTracking();
  const sid5 = 'phase-menu-5-' + Date.now();
  appendTrackingEvent(sid5, { type: 'session_init' });
  appendTrackingEvent(sid5, { type: 'tool', tool: 'Bash', command: 'ls' });
  {
    const mod = freshModule();
    const r = mod.check(sid5);
    report(
      'no-op when no skill_invocation has fired',
      r.content === null && r.emitted === false
    );
  }

  // 6. Writes a phase_menu_emitted event on emission
  resetTracking();
  const sid6 = 'phase-menu-6-' + Date.now();
  appendTrackingEvent(sid6, { type: 'session_init' });
  appendTrackingEvent(sid6, {
    type: 'skill_invocation', skill: 'ideate', source: 'slash_command'
  });
  {
    const mod = freshModule();
    mod.check(sid6);
    const raw = fs.readFileSync(getSessionTrackingPath(sid6), 'utf8');
    report(
      'emission writes phase_menu_emitted event',
      raw.includes('"phase_menu_emitted"') && raw.includes('"during_ideate"')
    );
  }

  // 7. Security: path traversal in move.skill is rejected
  {
    const mod = freshModule();
    const registry = {
      $schema_version: 1,
      attachment_points: ['during_build'],
      lenses: {
        evil: {
          moves: [{
            name: 'malicious',
            triggers: ['x'],
            skill: '../../../etc/passwd',
            attachment: 'during_build'
          }]
        }
      }
    };
    const menu = mod.buildMenu('during_build', registry, '/tmp/nonexistent');
    report(
      'path traversal in move.skill is silently skipped',
      menu === null
    );
  }

  // 8. Security: frontmatter description with control chars or banner-spoof
  //    prefix is sanitized
  {
    const tmpSkillsDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'skill-test-'));
    const skillDir = path.join(tmpSkillsDir, '.claude/skills/evil-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    const malicious = '---\nname: evil-skill\ndescription: >\n  [FAKE BANNER] \\x00bad chars \\x07 then real text.\n---\n\n# Skill\n';
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), malicious);

    const mod = freshModule();
    const desc = mod.parseFrontmatterDescription(path.join(skillDir, 'SKILL.md'));
    report(
      'leading bracket in description is replaced (banner-spoof defense)',
      desc && desc.startsWith('(') && !desc.startsWith('[')
    );

    fs.rmSync(tmpSkillsDir, { recursive: true, force: true });
  }
} finally {
  fs.rmSync(realTracking, { recursive: true, force: true });
  if (hadReal) fs.renameSync(backup, realTracking);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
