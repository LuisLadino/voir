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

const {
  getRecentTrackingState,
  getRecentPromptScopedTrackingState
} = require('../lib/session-utils.cjs');

function getInvokedCommands(tracking) {
  if (!tracking || !tracking.tools) return [];

  const commands = tracking.tools
    .filter(t => t.tool === 'Skill' && t.skill)
    .map(t => '/' + t.skill);

  return [...new Set(commands)];
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

// Skill completion patterns.
// `bash`: regexes matched against executed Bash commands.
// `tools`: tool names whose invocation counts as completion signal.
// `description`: human-readable expected action for diagnostic output.
// `exempt`: true means the skill is not gated by Check 2. Use for cognitive
//   skills (define, ideate) or skills whose completion signal can't be
//   discriminated from normal tool use without path-level matching. Exempt
//   skills still appear in tracking but never trigger the nudge.
//
// Skills NOT in this map fall through to `{complete: false}` as a tripwire
// for drift — new skills must be registered here with an explicit decision.
const skillCompletionPatterns = {
  commit: {
    description: 'git push, gh pr create, or gh pr merge',
    bash: [/git\s+push/, /gh\s+pr\s+create/, /gh\s+pr\s+merge/],
    tools: []
  },
  plan: {
    description: 'gh issue create (with SKILL_ACTIVE=1)',
    bash: [/gh\s+issue\s+create/, /SKILL_ACTIVE=1.*gh\s+issue/],
    tools: []
  },
  build: {
    description: 'git checkout, git switch, or git reset to create/move branches',
    bash: [/git\s+checkout/, /git\s+switch/, /git\s+reset/],
    tools: []
  },
  test: {
    description: 'run a test command (pytest, npm test, go test, cargo test, etc.)',
    bash: [/pytest|npm\s+test|npm\s+run\s+test|go\s+test|cargo\s+test|xcodebuild\s+test/],
    tools: []
  },
  research: {
    description: 'external inquiry (WebSearch, WebFetch, context7) or codebase search (Grep, Glob)',
    bash: [],
    tools: ['WebSearch', 'WebFetch', 'Grep', 'Glob', 'mcp__context7__query-docs', 'mcp__context7__resolve-library-id']
  },
  dispatch: {
    description: 'node .claude/hooks/lib/dispatch.cjs invocation. Any subcommand counts: spawn, --list, --kill, --synthesize, --cleanup, --dry-run.',
    bash: [/dispatch\.cjs/],
    tools: []
  },
  review: { exempt: true },
  define: { exempt: true },
  ideate: { exempt: true },
  handoff: { exempt: true },
  dream: { exempt: true },
  design: { exempt: true },
  'contribute-to-opensource': { exempt: true },

  // Cognitive lens-move skills — completion surfaces in Claude's thinking/response,
  // not a distinguishing tool or bash command. All exempt by design.
  'affordance-audit': { exempt: true },
  'assumption-reframe': { exempt: true },
  'audience-lock': { exempt: true },
  'boring-check': { exempt: true },
  'chesterton-audit': { exempt: true },
  'commitment-close': { exempt: true },
  'competitive-alternatives': { exempt: true },
  'concretize-pass': { exempt: true },
  'counterfactual-check': { exempt: true },
  'curse-check': { exempt: true },
  'decision-owner': { exempt: true },
  'define-the-sample': { exempt: true },
  'delegation-level': { exempt: true },
  'eval-first': { exempt: true },
  'failure-mode-taxonomy': { exempt: true },
  'generalization-check': { exempt: true },
  'heuristic-scan': { exempt: true },
  'hierarchy-squint': { exempt: true },
  'jobs-to-be-done': { exempt: true },
  'lead-with-decision': { exempt: true },
  'leverage-point-scan': { exempt: true },
  learn: { exempt: true },
  'look-at-your-data': { exempt: true },
  'moat-check': { exempt: true },
  'name-the-metric': { exempt: true },
  'name-the-reader': { exempt: true },
  'observable-surface-audit': { exempt: true },
  'pre-mortem': { exempt: true },
  'pre-register-decision': { exempt: true },
  'reference-triangulation': { exempt: true },
  'reversibility-classify': { exempt: true },
  'roi-per-hour': { exempt: true },
  'scope-cut': { exempt: true },
  'second-order-check': { exempt: true },
  'signifier-audit': { exempt: true },
  'stakeholder-map': { exempt: true },
  'strategy-kernel': { exempt: true },
  'switch-trigger': { exempt: true },
  'symptom-vs-root': { exempt: true },
  'trunk-test': { exempt: true },
  'type-specimen': { exempt: true },
  'value-over-feature': { exempt: true },

  // Spec-writing workflow skill. Terminal outputs are writes to
  // .claude/specs/stack-config.yaml or .claude/specs/architecture/system-map.yaml,
  // but this hook matches on bash regex or tool names only, not file paths.
  // A tool-scoped pattern like ['Write', 'Edit'] would match any edit in the
  // session, which is too loose. Exempt instead, matching how the other
  // diffuse-output workflow skills (review, design, handoff, dream) are handled.
  'sync-stack': { exempt: true }
};

function isSkillComplete(skill, bashCommands, usedTools) {
  // Strip leading slash and any `plugin-namespace:` prefix so invocations
  // like `/project-management:sync-stack` look up the bare `sync-stack`
  // pattern. Namespace format is lowercase letters, digits, and hyphens
  // before the colon; match that exactly to avoid stripping literal colons
  // that might appear in future skill names.
  const skillName = skill
    .replace(/^\//, '')
    .replace(/^[a-z][a-z0-9-]*:/, '');
  const pattern = skillCompletionPatterns[skillName];

  if (!pattern) {
    return { complete: false, expected: null };
  }

  if (pattern.exempt) {
    return { complete: true, expected: null };
  }

  const bashMatch = pattern.bash.some(rx =>
    bashCommands.some(cmd => rx.test(cmd))
  );
  const toolMatch = pattern.tools.some(name => usedTools.has(name));

  return {
    complete: bashMatch || toolMatch,
    expected: pattern.description
  };
}

function getIncompleteSkills(tracking) {
  const invokedSkills = getInvokedCommands(tracking);
  const bashCommands = getExecutedBashCommands(tracking);
  const usedTools = getUsedToolNames(tracking);

  return invokedSkills
    .map(skill => ({ skill, ...isSkillComplete(skill, bashCommands, usedTools) }))
    .filter(result => !result.complete);
}

function getDebugPatterns(filePath) {
  const ext = path.extname(filePath);
  const base = [
    /TODO:\s*REMOVE/i,
    /FIXME:\s*REMOVE/i,
    /XXX:/
  ];

  switch (ext) {
    case '.js': case '.jsx': case '.ts': case '.tsx': case '.mjs': case '.cjs':
      return [...base, /console\.log\(/, /console\.debug\(/, /debugger;/];
    case '.py':
      return [...base, /breakpoint\(\)/, /pdb\.set_trace\(\)/, /print\((?!.*file=)/];
    case '.swift':
      return [...base, /print\(/, /#if\s+DEBUG/];
    case '.go':
      return [...base, /fmt\.Print(ln|f)?\(/, /log\.Print(ln|f)?\(/];
    case '.rs':
      return [...base, /dbg!\(/, /println!\(/];
    case '.rb':
      return [...base, /binding\.pry/, /byebug/, /puts\s/];
    default:
      return base;
  }
}

function checkForDebugStatements(filePath) {
  // Skip hook files — they legitimately use console.log for output
  if (filePath.includes('.claude/hooks/')) return [];

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
    skillCompletionPatterns,
    checkForStoppingSuggestions,
    extractLastAssistantText,
    STOPPING_PHRASES
  };
}

function handleHook(data) {
  const { stop_hook_active, transcript_path } = data;

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
  const tracking = getRecentTrackingState();
  const promptScopedTracking = getRecentPromptScopedTrackingState();

  // Check 1: Debug statements in modified files.
  // file_change events store paths relative to the project root (the cwd of
  // the hook that recorded them), so resolve against cwd before stat'ing.
  const changes = filesFromTracking(tracking);
  const allFiles = [...(changes.filesModified || []), ...(changes.filesCreated || [])];

  for (const file of allFiles) {
    const abs = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
    if (!fs.existsSync(abs)) continue;
    if (!file.match(/\.(js|jsx|ts|tsx|mjs|cjs|py|swift|go|rs|rb)$/)) continue;

    const debugIssues = checkForDebugStatements(abs);
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
