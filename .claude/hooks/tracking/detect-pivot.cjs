#!/usr/bin/env node

/**
 * Pivot Detection Hook
 *
 * Event: PostToolUse (Bash)
 * Purpose: Detects dependency or structural changes and prompts for /sync-stack
 *
 * Language-agnostic. Catches:
 * - Package install commands (Node, Python, Rust, Go, Ruby, PHP, Java)
 * - Config file modifications (any language)
 * - New directory creation that may indicate structural changes
 */

const { stripCommandContent } = require('../lib/session-utils.cjs');

const { runStdinHook } = require('../lib/stdin-hook.cjs');
runStdinHook(handleHook, { mode: 'observability' });

function handleHook(data) {
  const { tool_input } = data;
  const command = tool_input?.command;

  if (!command) {
    process.exit(0);
  }

  // --- Dependency install commands (any language) ---
  const installPatterns = [
    // Node
    /npm\s+(install|i|add)\b/i,
    /yarn\s+(add|install)\b/i,
    /pnpm\s+(add|install|i)\b/i,
    /bun\s+(add|install|i)\b/i,
    // Python
    /pip\s+install\b/i,
    /pip3\s+install\b/i,
    /uv\s+(pip\s+install|add)\b/i,
    /poetry\s+add\b/i,
    /pdm\s+add\b/i,
    // Rust
    /cargo\s+add\b/i,
    // Go
    /go\s+get\b/i,
    /go\s+install\b/i,
    // Ruby
    /gem\s+install\b/i,
    /bundle\s+add\b/i,
    // PHP
    /composer\s+require\b/i,
    // Java/Kotlin
    /gradle\s+.*dependencies/i,
    /mvn\s+.*dependency/i,
    // Swift
    /swift\s+package\s+add/i,
    // .NET
    /dotnet\s+add\s+package/i
  ];

  // --- Config file modifications ---
  const configPatterns = [
    // Editing dependency/config files directly
    />\s*(package\.json|Cargo\.toml|go\.mod|Gemfile|requirements\.txt|pyproject\.toml|composer\.json|build\.gradle|pom\.xml)/i,
    // Writing to config files
    /cat\s+.*>\s*(tsconfig|tailwind\.config|vite\.config|next\.config|nuxt\.config|svelte\.config|astro\.config|webpack\.config|rollup\.config|eslint\.config|prettier\.config|jest\.config|vitest\.config|\.env)/i
  ];

  // --- Structural changes ---
  const structurePatterns = [
    // Creating new top-level or src-level directories
    /mkdir\s+(-p\s+)?(src\/|packages\/|apps\/|backend|frontend|server|client|api|workers|lib|shared|services|infra|deploy)/i
  ];

  // Commit messages and gh api body fields can contain install/config
  // keywords that would otherwise trigger false-positive /sync-stack reminders.
  const commandToCheck = stripCommandContent(command);

  const isInstall = installPatterns.some(p => p.test(commandToCheck));
  const isConfigChange = configPatterns.some(p => p.test(commandToCheck));
  const isStructuralChange = structurePatterns.some(p => p.test(commandToCheck));

  // Emit via PostToolUse response JSON on stdout so the reminder reaches
  // Claude's context. stderr on exit 0 is only shown in verbose mode.
  const lines = [];
  if (isInstall) {
    lines.push('[PIVOT DETECTED] Dependencies changed.');
    lines.push('Consider running /sync-stack to update specs and system map.');
  }
  if (isConfigChange) {
    lines.push('[PIVOT DETECTED] Config file modified.');
    lines.push('Specs may be stale. Consider running /sync-stack.');
  }
  if (isStructuralChange) {
    lines.push('[PIVOT DETECTED] New project structure created.');
    lines.push('Consider running /sync-stack to generate component specs and update the system map.');
  }

  if (lines.length > 0) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: lines.join('\n')
      }
    }));
  }

  process.exit(0);
}
