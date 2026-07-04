#!/usr/bin/env node

/**
 * Verify Before Stop Hook
 *
 * Event: Stop
 * Purpose: Ensures quality checks pass before Claude stops
 *
 * Checks:
 * 1. No console.log/debugger statements left behind
 * 2. If a slash command was invoked, confirm all steps were completed
 * 3. No stopping-suggestion phrases in the last assistant message.
 *    Luis decides when to stop; Claude never suggests it (#111).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const {
  getRecentTrackingState,
  getRecentPromptScopedTrackingState
} = require('../lib/session-utils.cjs');

const {
  isSkillComplete,
  buildSentinelRegex,
  skillCompletionPatterns,
  isSkillRegistered
} = require('../lib/skill-patterns.cjs');

function getInvokedCommands(tracking) {
  if (!tracking) return [];

  // Skill-tool path (assistant invocations via Skill tool)
  const skillToolInvocations = (tracking.tools || [])
    .filter(t => t.tool === 'Skill' && t.skill)
    .map(t => '/' + t.skill);

  // Slash-command path (user-typed slash commands). Filter out unregistered
  // commands like /cost, /help, /config that aren't kit skills. The Skill-tool
  // path (above) keeps its existing drift tripwire for unregistered invocations
  // (#231 contract). Slash path never trips for unregistered since built-in
  // CLI commands have no completion rule.
  const slashInvocations = (tracking.skillInvocations || [])
    .filter(s => s.skill && isSkillRegistered(s.skill))
    .map(s => '/' + s.skill);

  return [...new Set([...skillToolInvocations, ...slashInvocations])];
}

function getExecutedBashCommands(tracking) {
  if (!tracking || !tracking.tools) return [];

  return tracking.tools
    .filter(t => t.tool === 'Bash')
    .map(t => t.command || '')
    .filter(cmd => cmd);
}

function getUsedToolNames(tracking) {
  if (!tracking || !tracking.tools) return new Set();

  return new Set(tracking.tools.map(t => t.tool));
}

// Skill completion patterns and the rule itself live in
// .claude/hooks/lib/skill-patterns.cjs. Both this hook and the
// readSkillTelemetryState reducer in session-utils consume the same table so
// the gate and the rollup never drift. Imports above re-export the symbols
// this file's public surface promises (#347).

function getIncompleteSkills(tracking) {
  const invokedSkills = getInvokedCommands(tracking);
  const bashCommands = getExecutedBashCommands(tracking);
  const usedTools = getUsedToolNames(tracking);

  return invokedSkills
    .map(skill => ({ skill, ...isSkillComplete(skill, bashCommands, usedTools) }))
    .filter(result => !result.complete);
}

// Each keyword-leading pattern is guarded by `(?<!\w)`, a negative lookbehind
// for a word char, so the keyword cannot be the tail of a larger identifier —
// `print(` must not match `fingerprint(`, `puts ` must not match `inputs `,
// `console.log(` must not match `myconsole.log(`. JS `\b` does not help: there
// is no word boundary inside `fingerprint`, where `print` sits flush against
// identifier chars. `this.console.log(` / `import pdb; pdb.set_trace()` still
// match — the char before the keyword (`.`, `;`, space) is not a word char. #838
function getDebugPatterns(filePath) {
  const ext = path.extname(filePath);
  const base = [
    /TODO:\s*REMOVE/i,
    /FIXME:\s*REMOVE/i,
    /XXX:/
  ];

  switch (ext) {
    case '.js': case '.jsx': case '.ts': case '.tsx': case '.mjs': case '.cjs':
      return [...base, /(?<!\w)console\.log\(/, /(?<!\w)console\.debug\(/, /(?<!\w)debugger;/];
    case '.py':
      return [...base, /(?<!\w)breakpoint\(\)/, /(?<!\w)pdb\.set_trace\(\)/, /(?<!\w)print\((?!.*file=)/];
    case '.swift':
      return [...base, /(?<!\w)print\(/, /#if\s+DEBUG/];
    case '.go':
      return [...base, /(?<!\w)fmt\.Print(ln|f)?\(/, /(?<!\w)log\.Print(ln|f)?\(/];
    case '.rs':
      return [...base, /(?<!\w)dbg!\(/, /(?<!\w)println!\(/];
    case '.rb':
      return [...base, /(?<!\w)binding\.pry/, /(?<!\w)byebug/, /(?<!\w)puts\s/];
    default:
      return base;
  }
}

// Resolve the repo root once per hook run. A file outside it — e.g. a /tmp
// scratch script used to apply a batch edit — is not repo work and must not
// trip the pre-stop debug scan. #510
function getRepoRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return null;
  }
}

// True when absPath is the repo root or nested inside it. With no repo root
// (not a git repo), returns true so behavior outside git is unchanged.
function isInsideRepo(absPath, repoRoot) {
  if (!repoRoot) return true;
  const rel = path.relative(repoRoot, absPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Files where stdout is the product, not stray debug logging: hooks log by
// design, test runners print results, and CLI scripts use stdout as output.
// #506 added the test-file and .claude/scripts/ exemptions; #557 added the
// repo-root scripts/ dir, which holds the same kind of tooling; #680 added the
// Python package CLI entrypoint, whose prints ARE the CLI output.
function isDebugScanExempt(filePath, repoRoot) {
  // Hook files — hooks legitimately use console.log for output.
  if (filePath.includes('.claude/hooks/')) return true;

  // Test files — test runners use console.log to print results.
  if (/\.(test|spec)\.(cjs|js|mjs|ts|tsx)$/.test(filePath)) return true;

  // Python package CLI entrypoint (`python -m pkg` runs `pkg/__main__.py`),
  // where `print(` is the program's output, not leftover debug. Matched by
  // basename so it stays precise to the canonical entrypoint. #680
  if (path.basename(filePath) === '__main__.py') return true;

  // Standalone CLI scripts under .claude/scripts/ and .claude/skills/<name>/.
  if (filePath.includes('.claude/scripts/')) return true;
  if (/\.claude\/skills\/[^/]+\/[^/]+\.cjs$/.test(filePath)) return true;

  // Repo-root scripts/ dir — CLI tooling (run-tests.cjs, cognee/*, etc.)
  // where stdout is the output. Matched precisely against the repo root so an
  // unrelated nested scripts/ dir is not swept in. #557
  if (repoRoot) {
    const rel = path.relative(repoRoot, filePath);
    if (rel === 'scripts' || rel.startsWith('scripts' + path.sep)) return true;
  }

  return false;
}

function checkForDebugStatements(filePath, repoRoot) {
  if (isDebugScanExempt(filePath, repoRoot)) return [];

  const debugPatterns = getDebugPatterns(filePath);

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    const issues = [];
    lines.forEach((line, index) => {
      for (const pattern of debugPatterns) {
        if (pattern.test(line)) {
          issues.push({
            line: index + 1,
            content: line.trim(),
            pattern: pattern.toString()
          });
        }
      }
    });

    return issues;
  } catch {
    return [];
  }
}

function filesFromTracking(tracking) {
  if (!tracking) return { filesModified: [], filesCreated: [] };
  return {
    filesModified: tracking.filesModified || [],
    filesCreated: tracking.filesCreated || []
  };
}

// Phrases Luis has flagged as stopping suggestions. Specific enough to
// avoid false positives on past-tense, unrelated uses like "I stopped the
// server" or "the script stopped working." Case-insensitive.
const STOPPING_PHRASES = [
  /\bstop(?:ping)?\s+here\b/i,
  /\bpaus(?:e|ing)\s+here\b/i,
  /\bnatural\s+stopping\s+point\b/i,
  /\bnatural\s+(?:pause|break)\b/i,
  /\breasonable\s+(?:place|point)\s+to\s+(?:stop|pause|break|end)\b/i,
  /\bgood\s+(?:place|point|time)\s+to\s+(?:stop|pause|break|wrap\s+up)\b/i,
  /\b(?:want|like|ready)\s+to\s+(?:stop|pause|take\s+a\s+break|wrap\s+(?:up|this\s+up))\b/i,
  /\blet'?s\s+(?:stop|pause|take\s+a\s+break|wrap\s+(?:up|this\s+up))\b/i,
  /\bwe\s+(?:could|can|should)\s+(?:stop|pause|wrap\s+(?:up|this\s+up))\s+(?:here|now)\b/i,
  /\bi'?ll\s+(?:stop|pause)\s+here\b/i,
  /\btake\s+a\s+break\b/i,
  /\bmay\s+not\s+be\s+feasible\b/i,
  /\bmight\s+not\s+be\s+feasible\b/i,
  /\bmight\s+be\s+worth\s+moving\s+on\b/i,
  /\bworth\s+moving\s+on\s+from\b/i
];

function extractLastAssistantText(transcriptPath) {
  if (!transcriptPath) return '';
  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return '';
  }
  const lines = raw.split('\n').filter(l => l.trim().length > 0);
  // Walk backwards to find the most recent assistant message entry.
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try { entry = JSON.parse(lines[i]); } catch { continue; }
    const role = entry.type || entry.role || entry?.message?.role;
    if (role !== 'assistant') continue;
    // Assistant messages can be a string or an array of content blocks.
    const content = entry?.message?.content ?? entry.content ?? entry.text ?? '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter(c => c && (c.type === 'text' || typeof c.text === 'string'))
        .map(c => c.text || '')
        .join('\n');
    }
    return '';
  }
  return '';
}

function checkForStoppingSuggestions(transcriptPath) {
  const text = extractLastAssistantText(transcriptPath);
  if (!text) return [];
  const hits = [];
  for (const pattern of STOPPING_PHRASES) {
    const m = text.match(pattern);
    if (m) hits.push({ phrase: m[0], pattern: pattern.toString() });
  }
  return hits;
}

// Run as hook only when invoked directly. When required as a module (e.g. from
// a test), skip the stdin listener so the importing process doesn't hang or
// exit prematurely.
if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook(handleHook, { mode: 'gating' });
} else {
  module.exports = {
    isSkillComplete,
    getIncompleteSkills,
    buildSentinelRegex,
    skillCompletionPatterns,
    checkForStoppingSuggestions,
    extractLastAssistantText,
    STOPPING_PHRASES,
    getRepoRoot,
    isInsideRepo,
    isDebugScanExempt,
    getDebugPatterns,
    checkForDebugStatements
  };
}

function handleHook(data) {
  const { stop_hook_active, transcript_path, session_id } = data;

  // Safety: prevent infinite loops
  if (stop_hook_active) {
    process.exit(0);
  }

  const issues = [];

  // Tracking is append-only and persists across context compaction. Check 1
  // reads the full session because "are there debug statements in any file
  // I modified this session" is a session-wide question. Check 2 needs to
  // scope to the current prompt only. Otherwise a Skill invocation from
  // turn 3 re-fires the incomplete-skill tripwire at every Stop in turns
  // 4..N, even when it completed correctly. See #231. `prompt_start` events
  // written by clear-pending.cjs mark the boundary.
  const tracking = getRecentTrackingState(undefined, session_id);
  const promptScopedTracking = getRecentPromptScopedTrackingState(undefined, session_id);

  // Check 1: Debug statements in modified files.
  // file_change events store paths relative to the project root (the cwd of
  // the hook that recorded them), so resolve against cwd before stat'ing.
  const changes = filesFromTracking(tracking);
  const allFiles = [...(changes.filesModified || []), ...(changes.filesCreated || [])];
  const repoRoot = getRepoRoot();

  for (const file of allFiles) {
    const abs = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
    if (!fs.existsSync(abs)) continue;
    // #510: scratch files outside the repo (e.g. /tmp) are not repo work.
    if (!isInsideRepo(abs, repoRoot)) continue;
    if (!file.match(/\.(js|jsx|ts|tsx|mjs|cjs|py|swift|go|rs|rb)$/)) continue;

    const debugIssues = checkForDebugStatements(abs, repoRoot);
    if (debugIssues.length > 0) {
      issues.push({
        type: 'debug_statements',
        file,
        details: debugIssues
      });
    }
  }

  // Check 2: Command completion, scoped to current prompt only. See #231.
  const incompleteSkills = getIncompleteSkills(promptScopedTracking);

  if (incompleteSkills.length > 0) {
    issues.push({
      type: 'command_completion',
      incomplete: incompleteSkills
    });
  }

  // Check 3: Stopping-suggestion phrases in the last assistant message.
  // Luis decides when to stop. Claude never suggests it. (#111)
  const stoppingHits = checkForStoppingSuggestions(transcript_path);
  if (stoppingHits.length > 0) {
    issues.push({
      type: 'stopping_suggestion',
      hits: stoppingHits
    });
  }

  // If issues found, block stopping
  if (issues.length > 0) {
    const parts = [];

    // Debug statements
    const debugIssues = issues.filter(i => i.type === 'debug_statements');
    if (debugIssues.length > 0) {
      parts.push('DEBUG STATEMENTS FOUND:');
      for (const issue of debugIssues) {
        const details = issue.details.map(d => `  Line ${d.line}: ${d.content}`).join('\n');
        parts.push(`${issue.file}:\n${details}`);
      }
      parts.push('');
    }

    // Command completion
    const cmdIssue = issues.find(i => i.type === 'command_completion');
    if (cmdIssue) {
      parts.push('INCOMPLETE SKILL INVOCATION:');
      parts.push('');
      for (const item of cmdIssue.incomplete) {
        parts.push(`${item.skill} — no completion signal detected.`);
        if (item.expected) {
          parts.push(`  Expected: ${item.expected}`);
        }
      }
      parts.push('');
      parts.push('If you completed the skill, execute the expected action.');
      parts.push('If you abandoned it intentionally, state that and stop.');
    }

    // Stopping suggestions
    const stopIssue = issues.find(i => i.type === 'stopping_suggestion');
    if (stopIssue) {
      if (parts.length > 0) parts.push('');
      parts.push('STOPPING SUGGESTION DETECTED:');
      parts.push('');
      for (const hit of stopIssue.hits) {
        parts.push(`  Matched: "${hit.phrase}"`);
      }
      parts.push('');
      parts.push('Luis decides when to stop. Never suggest stopping, pausing, taking a');
      parts.push('break, or moving on from a hard problem. After completing a task,');
      parts.push('move to the next thing or state what is done and what is left.');
      parts.push('Rewrite the response without the stopping suggestion.');
    }

    // Stop responses use {decision, reason} only. Claude Code's validator
    // rejects hookSpecificOutput on Stop — that field is PreToolUse /
    // UserPromptSubmit / PostToolUse only. #108 added it based on the kit's
    // hooks.md which was documented incorrectly; corrected here.
    const output = {
      decision: 'block',
      reason: parts.join('\n')
    };

    console.log(JSON.stringify(output));
    process.exit(0);
  }

  // All good, allow stop
  process.exit(0);
}
