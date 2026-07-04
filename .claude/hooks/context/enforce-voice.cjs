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
 *   - Bash pbcopy: the external publish edge, content leaving the session for a
 *     reader. Default-enforce with Luis fallback.
 *   - Write / Edit: opt-in, fire only when the target path matches a `paths:`
 *     entry in voice.yaml. Default-skip.
 *
 * The Bash content-file redirect channel was removed in #743. Redirects to
 * `.md`/`.mdx`/`.txt` are overwhelmingly internal (notes, logs, generated
 * docs, scratch), the default-enforce taxed routine work, and the regex was
 * quote-naive (it fired on a redirect path mentioned inside a quoted argument).
 * pbcopy stays as the channel that guards content destined for an external
 * reader; file writes that need voice-checking are opt-in via `paths:`.
 *
 * State lives in the tracking event log as `voice_blocked` events carrying
 * a content hash. Retry with unchanged content is blocked again.
 *
 * Hot-path discipline: the hook short-circuits cheaply when the call is out of
 * scope (not a pbcopy sink, or a Write/Edit with no matching path rule) so the
 * common case never pays the YAML parse cost.
 */

const crypto = require('crypto');
const path = require('path');

const {
  getSessionId,
  appendTrackingEvent,
  getRecentPromptScopedState,
  getRecentSessionScopedSpecState,
  PROJECTS_DIR
} = require('../lib/session-utils.cjs');

const { resolveVoice, registryHasPathRules, resolveProjectRoot } = require('../lib/voice-registry.cjs');
const { LEAD, stripHeredocs, stripQuotedRegions } = require('../lib/command-position.cjs');

// The VOICE= override is a real shell env-var prefix, honored only at a command
// position. A bare `\s` prefix would also match `VOICE=none` sitting inside an
// argument (`echo VOICE=none | pbcopy`), silently skipping the gate. LEAD anchors
// it the same way the #642 Bash gates do; its optional VAR=val prefixes keep the
// legitimate `VOICE=none echo x | pbcopy` form working via backtracking. (#752)
const VOICE_OVERRIDE_RE = new RegExp(LEAD + String.raw`VOICE=(["']?)([^\s"']+)\1`);

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

// A heredoc body is shell data, not a quoted region, so the quote strip leaves
// it intact and a `| pbcopy` token documented inside the body would trip the
// sink test (e.g. a `gh pr create` body that shows the gate's own examples).
// stripHeredocs (preserve-operator) removes the body but keeps the operator
// line, so a real `cat <<EOF | pbcopy` sink still fires; it runs before the
// quote strip because a quoted delimiter (`<<'EOF'`) would otherwise be eaten
// by the quote pass and the body never matched. Both strippers are shared from
// command-position.cjs (#769); see voice-context.md. The clipboard channel
// fires only when pbcopy is a real command sink, not when the literal token
// rides inside a quoted argument. The quote strip runs with
// preserveSubstitutions so a real sink inside a command substitution inside
// double quotes — `echo "$(make-draft | pbcopy)"` — survives and still fires;
// a plain prose `| pbcopy` in quotes has no substitution, so it is blanked and
// passes. Heuristic, not a shell parser. (#640, #754, #851)
function detectsPbcopySink(command) {
  const unquoted = stripQuotedRegions(
    stripHeredocs(command, { mode: 'preserve-operator' }),
    { preserveSubstitutions: true }
  );
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

  // pbcopy is the only gated Bash channel: the external publish edge, where
  // content leaves the session for a reader. Everything else passes. The
  // content-file redirect channel was removed in #743 (see header).
  if (!detectsPbcopySink(command)) process.exit(0);

  const envMatch = command.match(VOICE_OVERRIDE_RE);
  const envVar = envMatch ? envMatch[2] : null;

  // pbcopy is an act of the current session, so voice resolves against cwd:
  // the registry default plus any VOICE= override. There is no file path to
  // route on.
  const voice = resolveVoice({ envVar });

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
  console.error(bashReminder(voice));
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

function bashReminder(voice) {
  const lines = [
    `[VOICE CHECK: ${voice.name}] Content is copying to clipboard.`,
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
