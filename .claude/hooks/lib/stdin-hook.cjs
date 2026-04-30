#!/usr/bin/env node

/**
 * Shared stdin-driven hook runner.
 *
 * Replaces the recurring pattern:
 *
 *   process.stdin.on('end', () => {
 *     try {
 *       const data = JSON.parse(input);
 *       handleHook(data);
 *     } catch (e) {
 *       process.exit(0);
 *     }
 *   });
 *
 * The generic catch swallowed logic errors from handleHook alongside
 * JSON-parse errors. A thrown bug in a gating hook silently let the
 * tool call through with no signal. #204 pins this class of failure.
 *
 * runStdinHook(handler, { mode, name?, parseJson? }) separates:
 *   - JSON-parse errors from stdin input (always fail open with exit 0)
 *   - Handler logic errors (policy depends on mode)
 *
 * Modes:
 *   - gating: handler errors rethrow. Node exits non-zero with the stack
 *     on stderr, which Claude Code surfaces and the gate stays closed
 *     on the error. Use for hooks that block tool calls: enforce-*,
 *     block-*, mcp-security-scan, scan-attribution, verify-before-stop.
 *   - observability: handler errors are caught, logged to the tracking
 *     event log as hook_handler_error, then exit 0. The hook fails open
 *     but leaves a trail. Use for context injection, tracking, lifecycle.
 *
 * Options:
 *   - mode: 'gating' | 'observability' (required)
 *   - name: string override for hook name in tracking events
 *     (defaults to basename of require.main without .cjs)
 *   - parseJson: boolean, default true. Set false for hooks that don't
 *     consume stdin JSON (SessionStart, scheduled checks).
 */

const path = require('path');

function deriveHookName(mainModule) {
  if (!mainModule || !mainModule.filename) return 'unknown';
  return path.basename(mainModule.filename, '.cjs');
}

function logHandlerError(hookName, err, claudeSessionId) {
  try {
    const { getSessionId, appendTrackingEvent } = require('./session-utils.cjs');
    const sessionId = getSessionId(claudeSessionId);
    appendTrackingEvent(sessionId, {
      type: 'hook_handler_error',
      hook: hookName,
      error: {
        name: err && err.name ? String(err.name) : 'Error',
        message: err && err.message ? String(err.message) : String(err),
        stack: err && err.stack ? String(err.stack) : undefined,
      },
    });
  } catch {
    // Tracking-write failure must not crash observability over observability.
  }
}

function runStdinHook(handler, options) {
  if (typeof handler !== 'function') {
    throw new Error('runStdinHook: handler must be a function');
  }
  if (!options || typeof options !== 'object') {
    throw new Error('runStdinHook: options object is required');
  }
  const { mode, name, parseJson = true } = options;
  if (mode !== 'gating' && mode !== 'observability') {
    throw new Error(
      `runStdinHook: options.mode must be 'gating' or 'observability', got ${JSON.stringify(mode)}`
    );
  }
  const hookName = name || deriveHookName(require.main);

  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    let data = null;
    if (parseJson) {
      try {
        data = JSON.parse(input);
      } catch (err) {
        if (err instanceof SyntaxError) process.exit(0);
        if (mode === 'gating') throw err;
        logHandlerError(hookName, err, null);
        process.exit(0);
      }
    }
    try {
      handler(data);
    } catch (err) {
      if (mode === 'gating') throw err;
      logHandlerError(hookName, err, data && data.session_id);
      process.exit(0);
    }
  });
}

module.exports = { runStdinHook, deriveHookName, logHandlerError };
