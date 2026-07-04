#!/usr/bin/env node

/**
 * Inject Shared Memory Hook
 *
 * Event: SessionStart
 * Purpose: Load the user-scope shared-memory layer (`~/.claude/memory/`) into
 * every project session, so universal `type: feedback` / `type: user` memories
 * apply everywhere — not only the repo they were first written under (#679).
 * The harness native-loads a project's OWN memory; this fills the cross-project
 * auto-load gap for the shared layer.
 *
 * Silent when:
 *   - The shared dir is absent or empty (a project with no shared layer yet)
 *   - Silenced with CLAUDE_NO_SHARED_MEMORY=1
 *
 * Context-only: SessionStart cannot block. The injection is framed as background
 * context, not fresh instructions. Reading/counting logic lives in the shared-
 * memory lib.
 */

const { sharedMemoryDir, readSharedMemories, buildInjection } = require('../lib/shared-memory.cjs');

function handleHook() {
  if (process.env.CLAUDE_NO_SHARED_MEMORY === '1') return process.exit(0);

  const memories = readSharedMemories(sharedMemoryDir());
  const injection = buildInjection(memories);
  if (injection === null) return process.exit(0);

  console.log(injection);
  process.exit(0);
}

if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook(handleHook, { mode: 'observability', parseJson: false });
} else {
  module.exports = { handleHook };
}
