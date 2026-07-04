#!/usr/bin/env node

/**
 * Session Init Hook
 *
 * Event: SessionStart
 * Purpose: Initialize session tracking and check for project changes
 *
 * Does:
 * - Creates session tracking file
 * - Checks sync state for project changes
 * - Cleans up old session tracking files
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  initSession,
  cleanupOldSessions
} = require('../lib/session-utils.cjs');

const SYNC_STATE_PATH = '.claude/specs/.sync-state.json';
// Committed companion to the gitignored .sync-state.json. /sync-stack writes
// both into the same specs dir; stack-config.yaml is tracked, so it survives
// into a fresh git worktree where .sync-state.json (gitignored) does not.
const STACK_CONFIG_PATH = path.join(path.dirname(SYNC_STATE_PATH), 'stack-config.yaml');

const WATCHED_FILES = [
  // JavaScript/TypeScript
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'tsconfig.json',
  'tailwind.config.js',
  'tailwind.config.ts',
  'vite.config.js',
  'vite.config.ts',
  'next.config.js',
  'next.config.ts',
  'next.config.mjs',
  'astro.config.mjs',
  'astro.config.ts',
  // Python
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'requirements.txt',
  'Pipfile',
  'Pipfile.lock',
  'poetry.lock',
  // Rust
  'Cargo.toml',
  'Cargo.lock',
  // Go
  'go.mod',
  'go.sum',
  // Swift
  'Package.swift',
  'Package.resolved',
  // Ruby
  'Gemfile',
  'Gemfile.lock',
  // PHP
  'composer.json',
  'composer.lock',
  // Java/Kotlin
  'build.gradle',
  'build.gradle.kts',
  'pom.xml',
  // .NET
  'Directory.Build.props',
  // Elixir
  'mix.exs',
  'mix.lock'
];

function getFileHash(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
  } catch {
    return null;
  }
}

function loadSyncState(cwd) {
  try {
    const content = fs.readFileSync(path.join(cwd, SYNC_STATE_PATH), 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function checkForChanges(cwd = process.cwd()) {
  const syncState = loadSyncState(cwd);

  if (!syncState) {
    // .sync-state.json is gitignored, so it is absent in every fresh git
    // worktree even when the project is fully synced. Gate the "never synced"
    // warning on the absence of committed sync evidence (stack-config.yaml),
    // not on the per-worktree marker — otherwise a worktree-heavy setup
    // (Conductor) re-fires the warning on every new worktree and trains the
    // user to ignore it, masking a genuinely un-synced project. See #812.
    if (fs.existsSync(path.join(cwd, STACK_CONFIG_PATH))) {
      return { changed: false };
    }
    // Check for any dependency manifest, not just package.json
    const manifests = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'Package.swift', 'Gemfile', 'composer.json', 'build.gradle', 'pom.xml', 'mix.exs'];
    const hasManifest = manifests.some(m => fs.existsSync(path.join(cwd, m)));
    if (hasManifest) {
      return {
        changed: true,
        reason: 'Project has never been synced. Run /sync-stack to set up specs and system map.'
      };
    }
    return { changed: false };
  }

  const changes = [];
  for (const file of WATCHED_FILES) {
    const filePath = path.join(cwd, file);
    const currentHash = getFileHash(filePath);
    const storedHash = syncState.hashes?.[file];

    if (currentHash && storedHash && currentHash !== storedHash) {
      changes.push(file);
    } else if (currentHash && !storedHash) {
      changes.push(`${file} (new)`);
    }
  }

  if (changes.length > 0) {
    return {
      changed: true,
      reason: `Files changed since last sync: ${changes.join(', ')}`,
      files: changes,
      lastSync: syncState.lastSync
    };
  }

  return { changed: false };
}

const LEGACY_SESSION_STATE = '.claude/session-state.json';

// session-state.json was removed in #102 — per-prompt enforcement state now
// lives in the tracking JSONL event log. Unlink any leftover file from an
// older kit version so inspection of .claude/ isn't misleading.
function cleanupLegacySessionState() {
  try {
    if (fs.existsSync(LEGACY_SESSION_STATE)) {
      fs.unlinkSync(LEGACY_SESSION_STATE);
    }
  } catch (e) {}
}

function writeSessionMarker(cwd, sessionId) {
  if (!sessionId) return;
  try {
    const sessionsDir = path.join(cwd, '.claude/sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    const marker = {
      session_id: sessionId,
      pid: process.ppid || process.pid,
      cwd,
      started_at: new Date().toISOString()
    };
    fs.writeFileSync(
      path.join(sessionsDir, `${sessionId}.json`),
      JSON.stringify(marker, null, 2)
    );
  } catch {}
}

function recordStartingBranch(cwd, sessionId) {
  if (!sessionId) return;
  try {
    const { execSync } = require('child_process');
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    if (!branch) return;
    const { appendTrackingEvent } = require('../lib/session-utils.cjs');
    appendTrackingEvent(sessionId, {
      type: 'session_branch_baseline',
      branch
    }, cwd);
  } catch {}
}

function handleHook(data) {
  const { source } = data;
  const cwd = process.cwd();

  // Initialize session tracking
  if (source === 'startup' || source === 'clear') {
    initSession(cwd);
    cleanupOldSessions(cwd);
    writeSessionMarker(cwd, data.session_id);
    recordStartingBranch(cwd, data.session_id);
  }

  // Project-specific work — only run inside a framework project
  const isFrameworkProject = fs.existsSync(path.join(cwd, '.claude'));
  if (!isFrameworkProject) {
    process.exit(0);
    return;
  }

  // Remove legacy session-state.json if it exists (replaced by tracking events)
  if (source === 'startup' || source === 'clear') {
    cleanupLegacySessionState();
  }

  // Check for project changes
  const result = checkForChanges(cwd);
  if (result.changed) {
    console.log('\n========================================');
    console.log('PROJECT CHANGES DETECTED');
    console.log('========================================');
    console.log(result.reason);
    if (result.lastSync) {
      console.log(`Last sync: ${result.lastSync}`);
    }
    console.log('\nConsider running /sync-stack to update specs and system map.');
    console.log('========================================\n');
  }

  process.exit(0);
}

if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook(handleHook, { mode: 'observability' });
}

module.exports = { checkForChanges, loadSyncState };
