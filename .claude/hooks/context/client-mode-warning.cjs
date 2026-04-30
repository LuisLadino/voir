#!/usr/bin/env node

/**
 * Client Mode Warning Hook
 *
 * Event: SessionStart
 * Purpose: Make the client-mode .claude/ exclusion discoverable.
 *
 * In client-mode projects, .claude/ is excluded from commits via
 * .git/info/exclude (local-only, not .gitignore). Sessions that check only
 * .gitignore conclude .claude/ is tracked, when it is not. They then write
 * project work into .claude/ that silently vanishes on the next clone.
 *
 * This hook detects the client-mode state and injects a prominent warning
 * at session start so the exclusion is impossible to miss.
 */

const fs = require('fs');
const path = require('path');

const KIT_MODE_PATH = '.claude/kit-mode.yaml';
const GIT_EXCLUDE_PATH = '.git/info/exclude';

function readFileOrNull(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function isClientMode(cwd) {
  const content = readFileOrNull(path.join(cwd, KIT_MODE_PATH));
  if (!content) return false;
  return /^mode:\s*client\s*$/m.test(content);
}

function excludeContainsClaude(cwd) {
  const content = readFileOrNull(path.join(cwd, GIT_EXCLUDE_PATH));
  if (!content) return false;
  return content.split('\n').some(line => {
    const trimmed = line.replace(/#.*$/, '').trim();
    return trimmed === '.claude/' || trimmed === '.claude';
  });
}

function evaluate(cwd) {
  const clientMode = isClientMode(cwd);
  if (!clientMode) return { state: 'not-client' };

  const excludeOk = excludeContainsClaude(cwd);
  if (!excludeOk) return { state: 'broken-exclude' };

  return { state: 'client-active' };
}

function warningActive() {
  return [
    '',
    '========================================',
    'CLIENT MODE: .claude/ EXCLUDED FROM COMMITS',
    '========================================',
    '',
    'This repo is in client mode. .claude/ is excluded from commits via',
    '.git/info/exclude. That file is local-only and never committed. It is',
    'NOT .gitignore.',
    '',
    'WHAT THIS MEANS: anything you write under .claude/ will NOT be committed',
    'and will not be visible to collaborators. Files written there silently',
    'vanish on the next clone.',
    '',
    'Anything that needs to reach the team belongs in the normal project tree',
    "per that project's conventions. Not in .claude/. This includes design",
    'specs, project briefs, architecture notes, and shared documentation.',
    '',
    'Verify the exclusion is active:',
    '  cat .git/info/exclude | grep .claude',
    '  git check-ignore -v .claude/anything',
    '',
    'This warning fires on every session in client-mode repos. By design.',
    '========================================',
    ''
  ].join('\n');
}

function warningBroken() {
  return [
    '',
    '========================================',
    'CLIENT MODE BROKEN: EXCLUDE MISSING',
    '========================================',
    '',
    '.claude/kit-mode.yaml declares mode: client, but .git/info/exclude does',
    'not contain .claude/.',
    '',
    'RISK: .claude/ will appear as untracked. A naive `git add .` commits it',
    'into the client repo, which client mode is meant to prevent.',
    '',
    'FIX: re-run sync-kit.sh from the kit repo against this project to repair',
    'the exclude entry. Or manually append `.claude/` to .git/info/exclude.',
    '',
    'Until fixed, do NOT stage .claude/ files.',
    '========================================',
    ''
  ].join('\n');
}

function run(cwd) {
  const result = evaluate(cwd);
  if (result.state === 'client-active') {
    process.stdout.write(warningActive());
  } else if (result.state === 'broken-exclude') {
    process.stdout.write(warningBroken());
  }
  return result;
}

module.exports = {
  evaluate,
  isClientMode,
  excludeContainsClaude,
  warningActive,
  warningBroken,
  run
};

if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook(() => run(process.cwd()), { mode: 'observability', parseJson: false });
}
