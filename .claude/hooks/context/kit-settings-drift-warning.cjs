#!/usr/bin/env node

/**
 * Kit Settings Drift Warning Hook
 *
 * Event: SessionStart
 * Purpose: Warn when this kit checkout's ~/.claude/settings.json hooks block has
 *   drifted from settings.template.json — a hook was added or changed in the
 *   template but setup-kit.sh has not been re-run, so the kit's own sessions run
 *   stale hook registrations and a just-merged hook never fires here until it's
 *   picked up (#808). This is the settings-side analog of the spec/system-map
 *   kit-drift warning (#736); #799 hit it live (the new kit-eval-reminder hook
 *   was registered in the template but absent from the loaded user settings).
 *
 * Fires ONLY in the kit source repo, detected by settings.template.json +
 *   setup-kit.sh at the repo root. Downstreams receive neither (the template is
 *   not synced), so it no-ops there. Drift is decided by `setup-kit.sh --check`
 *   (the canonical-JSON hooks-block compare, exit 1 = drift) — the same check the
 *   installer uses, so detector and installer never disagree.
 *
 * Advisory only — SessionStart is context-only and cannot block. Exit 0 always,
 *   observability mode so any throw fails open. The fix is ./setup-kit.sh, which
 *   merges the template's hooks into ~/.claude/settings.json (backed up first).
 *
 * Silence with CLAUDE_KIT_NO_SETTINGS_DRIFT_WARN=1.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// True only in the kit source repo: it ships settings.template.json + setup-kit.sh
// at the root. Downstreams receive neither, so this hook is silent everywhere else.
function isKitSource(root) {
  return fs.existsSync(path.join(root, 'settings.template.json'))
    && fs.existsSync(path.join(root, 'setup-kit.sh'));
}

// Drift verdict via `setup-kit.sh --check` (exit 1 = drift, exit 0 = clean), the
// same canonical-JSON hooks-block compare the installer applies. Anything else
// (missing node, unreadable template) is 'unknown' and stays quiet — a drift
// warning must never itself break SessionStart.
function checkDrift(root, _spawn) {
  const sp = _spawn || spawnSync;
  const r = sp('bash', [path.join(root, 'setup-kit.sh'), '--check'], { cwd: root, encoding: 'utf8' });
  if (r.status === 1) return 'drift';
  if (r.status === 0) return 'clean';
  return 'unknown';
}

function warningText() {
  return [
    '',
    '========================================',
    'KIT SETTINGS DRIFT',
    '========================================',
    "This kit checkout's ~/.claude/settings.json hooks block differs from",
    'settings.template.json. A hook was added or changed in the template but',
    'setup-kit.sh has not been re-run, so this kit runs stale hook registrations',
    '— a just-merged hook will not fire in the kit\'s own sessions until you pick',
    'it up.',
    '',
    'FIX:',
    '',
    '  ./setup-kit.sh            # merge the template into ~/.claude/settings.json (backs up first)',
    '  ./setup-kit.sh --dry-run  # preview the hooks block first',
    '',
    'Silence: CLAUDE_KIT_NO_SETTINGS_DRIFT_WARN=1',
    '========================================',
    ''
  ].join('\n');
}

function run(deps = {}) {
  if (process.env.CLAUDE_KIT_NO_SETTINGS_DRIFT_WARN === '1') return { state: 'silenced' };
  const root = (deps && deps.root) || process.cwd();
  if (!isKitSource(root)) return { state: 'not-kit-source' };
  let verdict;
  try { verdict = (deps.checkDrift || checkDrift)(root); }
  catch { return { state: 'error' }; } // never break SessionStart
  if (verdict === 'drift') {
    process.stdout.write(warningText());
    return { state: 'drift' };
  }
  return { state: verdict };
}

if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook(run, { mode: 'observability' });
}

module.exports = { run, isKitSource, checkDrift, warningText };
