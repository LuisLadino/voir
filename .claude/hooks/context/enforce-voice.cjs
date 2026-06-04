#!/usr/bin/env node

/**
 * Enforce Voice Guidelines Hook
 *
 * Event: PreToolUse
 * Matchers: Bash, Write, Edit
 * Type: Hash-verified gate with registry-driven voice routing.
 *
 * Voice contract routes through `.claude/voice.yaml`. Fires a reminder for the
 * active voice and blocks the tool call until content changes. If the active
 * voice has `rules: null` (e.g. `none`), the hook allows the call without
 * enforcement.
 *
 * Channels covered:
 *   - Bash pbcopy
 *   - Bash redirect to content file (`> file.md`, `>> file.md`)
 *   - Write tool
 *   - Edit tool
 *
 * State lives in the tracking event log as `voice_blocked` events carrying
 * a content hash. Retry with unchanged content is blocked again.
 *
 * Hot-path discipline: the hook short-circuits cheaply when the file is out of
 * scope (non-content ext + no matching path rules) so the common case never
 * pays the YAML parse cost.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  getSessionId,
  appendTrackingEvent,
  getRecentPromptScopedState,
  getRecentSessionScopedSpecState,
  PROJECTS_DIR
} = require('../lib/session-utils.cjs');

const { resolveVoice, registryHasPathRules, toRelative, resolveProjectRoot } = require('../lib/voice-registry.cjs');

// Auto-memory tree under ~/.claude/projects/<workspace>/memory/ is Claude's own
// internal state. Writes there are never external content. No voice.yaml rule
// can match these paths because they are out-of-tree relative to any project
// root, so a hardcoded skip is required. Resolved + prefix-guarded to prevent
// traversal tricks.
const PROJECTS_DIR_RESOLVED = path.resolve(PROJECTS_DIR);

function isUnderProjectsTree(filePath) {
  if (!filePath) return false;
  let resolved;
  try { resolved = path.resolve(filePath); } catch { return false; }
  if (resolved === PROJECTS_DIR_RESOLVED) return false;
  return resolved.startsWith(PROJECTS_DIR_RESOLVED + path.sep);
}

// True when some ancestor of absPath holds a `.claude` directory, i.e. the path
// lives inside a project tree. Walks the real filesystem rather than
// resolveProjectRoot, which short-circuits to CLAUDE_PROJECT_DIR and otherwise
// falls back to the path's own dir (never null), so it cannot tell a scratch
// target from project content. A `> /tmp/k.txt` redirect has no project
// ancestor; an in-tree or cross-repo content file does. (#631)
function hasProjectAncestor(absPath) {
  let dir = path.dirname(absPath);
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(path.join(dir, '.claude'))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
  return false;
}

const CONTENT_EXTENSIONS = new Set(['.md', '.mdx', '.txt']);

// Paths under these prefixes, or these exact filenames, are Claude-consumed
// instructions. The self-documentation spec governs format; voice rules do not
// apply. Root CLAUDE.md is included because it's Claude's per-project
// instruction file, not external content.
const VOICE_SKIP_PATH_PREFIXES = ['.claude/', '.github/'];
const VOICE_SKIP_FILENAMES = new Set(['CLAUDE.md']);

function isClaudeConsumedPath(relPath) {
  if (!relPath) return false;
  if (VOICE_SKIP_FILENAMES.has(relPath)) return true;
  return VOICE_SKIP_PATH_PREFIXES.some(p => relPath.startsWith(p));
}

const { runStdinHook } = require('../lib/stdin-hook.cjs');
runStdinHook(handleHook, { mode: 'gating' });

function handleHook(data) {
  const toolName = data.tool_name;
  if (toolName === 'Bash') return handleBash(data);
  if (toolName === 'Write' || toolName === 'Edit') return handleFileWrite(data);
  process.exit(0);
}

function readerFor(agentId, sessionId) {
  const isSubagent = typeof agentId === 'string' && agentId.length > 0;
  return () => isSubagent
    ? getRecentSessionScopedSpecState(undefined, sessionId)
    : getRecentPromptScopedState(undefined, sessionId);
}

function hashOf(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

function recordBlock(sessionId, hash) {
  try {
    appendTrackingEvent(getSessionId(sessionId), {
      type: 'voice_blocked',
      hash
    });
  } catch {}
}

// The clipboard channel fires only when pbcopy is a real command sink, not when
// the literal token `pbcopy` rides inside an argument. A shell pipe can never
// live inside quotes, so quoted regions are stripped before the test: a grep
// alternation `'a\|pbcopy'`, an `echo`/`sed` body, or a `gh issue create`
// --body that merely shows `| pbcopy` as an example no longer trips the gate.
// Backslash-escaped pipes (`grep a\|pbcopy`, BRE alternation without quotes)
// are excluded too. Heuristic, not a shell parser; see voice-context.md. (#640)
function stripQuotedRegions(command) {
  return command
    .replace(/'[^']*'/g, '')
    .replace(/"(?:\\.|[^"\\])*"/g, '');
}

function detectsPbcopySink(command) {
  const unquoted = stripQuotedRegions(command);
  // Real pipe into pbcopy: a `|` that is not the second bar of `||` and not a
  // backslash-escaped `\|`.
  if (/(?:^|[^|\\])\|\s*pbcopy\b/.test(unquoted)) return true;
  // pbcopy as a leading command, e.g. `pbcopy < draft.txt`.
  if (/^\s*pbcopy\b/.test(unquoted)) return true;
  return false;
}

function handleBash(data) {
  const { tool_input, session_id, agent_id } = data;
  const command = tool_input?.command;
  if (!command) process.exit(0);

  const pbcopyMatch = detectsPbcopySink(command);
  const redirectMatch = command.match(/>>?\s*["']?([^\s"'|&;]+\.(?:md|mdx|txt))["']?/);
  if (!pbcopyMatch && !redirectMatch) process.exit(0);

  const envMatch = command.match(/(?:^|\s)VOICE=(["']?)([^\s"']+)\1/);
  const envVar = envMatch ? envMatch[2] : null;
  const filePathRaw = redirectMatch ? redirectMatch[1] : null;

  // Auto-memory tree skip for Bash redirects too.
  if (filePathRaw && isUnderProjectsTree(filePathRaw)) process.exit(0);

  // A redirect whose target has no .claude ancestor is a scratch file outside
  // any project (e.g. `npm run knip > /tmp/k.txt`, `> $TMPDIR/out.txt`), not
  // content to voice-check. Skip, mirroring the auto-memory skip above. pbcopy
  // (filePathRaw null) and in-tree / cross-repo content redirects are
  // unaffected. (#631)
  if (filePathRaw && !hasProjectAncestor(path.resolve(filePathRaw))) process.exit(0);

  // Resolve target repo root from redirect path when present. pbcopy without
  // a redirect falls back to cwd-based resolution, which is correct because
  // pbcopy is an act of the current session.
  const targetRoot = filePathRaw ? resolveProjectRoot(filePathRaw) : undefined;
  const filePathRel = filePathRaw ? toRelative(filePathRaw, targetRoot) : null;

  // Redirect into a Claude-consumed path skips, unless an env var or path rule
  // upgrades the voice explicitly.
  if (filePathRel && isClaudeConsumedPath(filePathRel) && !envVar) {
    if (!registryHasPathRules(targetRoot)) process.exit(0);
  }

  const voice = resolveVoice({ filePath: filePathRaw, envVar, projectRoot: targetRoot });

  if (filePathRel && isClaudeConsumedPath(filePathRel)
      && voice.source !== 'path' && voice.source !== 'env') {
    process.exit(0);
  }

  if (voice.rules === null) process.exit(0);

  const commandWithoutMarker = command.replace(/^\s*VOICE_CHECKED=1\s*/, '').trim();
  const commandHash = hashOf(commandWithoutMarker);
  const readState = readerFor(agent_id, session_id);

  if (command.includes('VOICE_CHECKED=1')) {
    const state = readState() || { lastVoiceBlockedHash: null };
    if (state.lastVoiceBlockedHash === commandHash) {
      console.error('[VOICE CHECK FAILED] Content is unchanged from the blocked version.');
      console.error('');
      console.error('You added VOICE_CHECKED=1 but did not revise the content.');
      console.error('Apply the voice guidelines, make actual changes, then retry.');
      process.exit(2);
    }
    process.exit(0);
  }

  recordBlock(session_id, commandHash);
  console.error(bashReminder(voice, Boolean(pbcopyMatch)));
  process.exit(2);
}

function handleFileWrite(data) {
  const { tool_input, session_id, agent_id } = data;
  const filePath = tool_input?.file_path;
  const content = tool_input?.content ?? tool_input?.new_string ?? '';
  if (!filePath || typeof content !== 'string' || content.length === 0) process.exit(0);

  // Auto-memory tree under ~/.claude/projects/**/memory/** is always skipped.
  // These are Claude's own internal files and have no external reader.
  if (isUnderProjectsTree(filePath)) process.exit(0);

  // Resolve the project root from the TARGET file path, not from the
  // orchestrator's cwd. Fixes cross-repo writes that previously loaded the
  // orchestrator repo's voice.yaml instead of the target repo's.
  const targetRoot = resolveProjectRoot(filePath);

  // Write/Edit default-skip under the #239 scope inversion. Voice enforcement
  // on Write/Edit fires only when the target path matches a paths: entry in
  // voice.yaml. Unmatched writes pass silently regardless of file extension
  // or project tree. The pbcopy channel keeps default-enforce via handleBash.
  //
  // Fast path: no path rules in the registry means nothing can match. Skip
  // the YAML parse entirely.
  if (!registryHasPathRules(targetRoot)) process.exit(0);

  const voice = resolveVoice({ filePath, projectRoot: targetRoot });

  // Only path-resolved voices enforce on Write/Edit. Default and env routing
  // do not apply to this channel.
  if (voice.source !== 'path') process.exit(0);

  // Matched path routes to voice: none.
  if (voice.rules === null) process.exit(0);

  const contentHash = hashOf(content);
  const readState = readerFor(agent_id, session_id);
  const state = readState() || { lastVoiceBlockedHash: null };
  const priorHash = state.lastVoiceBlockedHash;

  // First attempt: record the hash and show the reminder. A verbatim retry is
  // caught below as a bypass.
  if (priorHash === null) {
    recordBlock(session_id, contentHash);
    console.error(fileWriteReminder(voice, filePath));
    process.exit(2);
  }

  // Retry with unchanged content: bypass attempt. Block with targeted message.
  if (priorHash === contentHash) {
    console.error(`[VOICE CHECK FAILED] Content for ${filePath} is unchanged from the blocked version.`);
    console.error('');
    console.error('Apply the voice guidelines, revise the content, then retry.');
    process.exit(2);
  }

  // Retry with revised content: Claude saw the reminder and changed the
  // content. Allow.
  process.exit(0);
}

function bashReminder(voice, isPbcopy) {
  const action = isPbcopy ? 'copying to clipboard' : 'writing to a content file';
  const lines = [
    `[VOICE CHECK: ${voice.name}] Content is ${action}.`,
    `Resolved via ${voice.source}. Review against voice rules:`,
    '',
    voice.rules,
    '',
    'Revise the content, then retry with VOICE_CHECKED=1 prefix.',
    'Example: VOICE_CHECKED=1 echo "revised content" | pbcopy',
    '',
    'To override voice, prefix with VOICE=NAME. Example: VOICE=none for adversarial drafts.'
  ];
  return lines.join('\n');
}

function fileWriteReminder(voice, filePath) {
  const lines = [
    `[VOICE CHECK: ${voice.name}] Writing to ${filePath}.`,
    `Resolved via ${voice.source}. Review against voice rules:`,
    '',
    voice.rules,
    '',
    'Revise the content, then retry. Unchanged content is blocked again.',
    '',
    'To route this path differently, add a rule under `paths:` in `.claude/voice.yaml`.'
  ];
  return lines.join('\n');
}
