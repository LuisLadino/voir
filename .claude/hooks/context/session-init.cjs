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

function loadSyncState() {
  try {
    const content = fs.readFileSync(SYNC_STATE_PATH, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function checkForChanges() {
  const cwd = process.cwd();
  const syncState = loadSyncState();

  if (!syncState) {
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

const { runStdinHook } = require('../lib/stdin-hook.cjs');
runStdinHook(handleHook, { mode: 'observability' });

function handleHook(data) {
  const { source } = data;
  const cwd = process.cwd();

  // Initialize session tracking
  if (source === 'startup' || source === 'clear') {
    initSession(cwd);
    cleanupOldSessions(cwd);
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
  const result = checkForChanges();
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
