#!/usr/bin/env node

/**
 * Skill output offload — PostToolUse hook (auto_summarize).
 *
 * Deep Agents "save-large-outputs-to-files." For an active extended skill
 * declaring auto_summarize, when a tool output exceeds the threshold and the
 * tool is not in preserve[], the full output is archived to summaries/<id>.txt
 * and a retrieval note is injected.
 *
 * Does NOT strip the live result. PreCompact is side-effects-only;
 * updatedMCPToolOutput is MCP-only; stripping a just-produced output would
 * break the active task. The value is a durable, skill-scoped archive that
 * outlives Claude Code's native compaction — which is what reduces live
 * context.
 */

const path = require('path');
const { runStdinHook } = require('../lib/stdin-hook.cjs');
const { getSessionId } = require('../lib/session-utils.cjs');
const { activeExtendedSkills, resolveScope } = require('../lib/skill-active.cjs');
const runtime = require('../lib/skill-runtime.cjs');

const BYTES_PER_TOKEN = 4;

function serialize(resp) {
  if (resp == null) return '';
  if (typeof resp === 'string') return resp;
  if (typeof resp.stdout === 'string' || typeof resp.stderr === 'string') {
    return [resp.stdout || '', resp.stderr || ''].join('\n');
  }
  if (typeof resp.content === 'string') return resp.content;
  try { return JSON.stringify(resp); } catch { return String(resp); }
}

function handleHook(data) {
  if (!data || !data.tool_name) return process.exit(0);
  const projectRoot = data.cwd || process.cwd();
  const sessionId = getSessionId(data.session_id);

  const skills = activeExtendedSkills(projectRoot, sessionId)
    .filter(s => s.extensions.auto_summarize && s.extensions.auto_summarize.enabled);
  if (!skills.length) return process.exit(0);

  const content = serialize(data.tool_response);
  const bytes = Buffer.byteLength(content);

  const notes = [];
  for (const skill of skills) {
    const pol = skill.extensions.auto_summarize;
    if (pol.preserve.includes(data.tool_name)) continue;
    if (bytes < pol.threshold_tokens * BYTES_PER_TOKEN) continue;
    const id = `${data.tool_name}-${Date.now()}`;
    const file = runtime.archiveOutput(projectRoot, resolveScope(skill.extensions), sessionId, skill.skillName, id, content);
    notes.push(`[${skill.skillName}] ${data.tool_name} output (${bytes} bytes) archived: ${path.relative(projectRoot, file)}`);
  }

  if (notes.length) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: notes.join('\n') + '\nFull content retrievable from these paths after compaction.'
      }
    }));
  }
  process.exit(0);
}

if (require.main === module) {
  runStdinHook(handleHook, { mode: 'observability' });
}

module.exports = { handleHook, serialize };
