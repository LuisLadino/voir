// @kit-internal — required by tool-failure.cjs

/**
 * Failure classification helper for tool-failure.cjs.
 *
 * Pure function. No I/O, no side effects. Decides
 * failureKind = 'tool_error' | 'nonzero_exit' from (tool_name, tool_input).
 *
 * Lives in its own module so tests can require it without triggering
 * tool-failure.cjs's stdin-attached hook runner.
 */

// Bash binaries that exit non-zero as part of normal semantics (no-match,
// differences-found). Anything not in this allowlist defaults to tool_error.
const NONZERO_EXIT_BINS = /^(grep|egrep|fgrep|ggrep|rg|ag|ack|diff|cmp)$/;

function classifyFailure(tool_name, tool_input) {
  if (tool_name !== 'Bash') return 'tool_error';
  const command = (tool_input?.command || '').trim();
  if (!command) return 'tool_error';

  // Last segment of the pipeline — its exit code dominates the Bash result
  // when pipefail is off (default).
  const segments = command.split(/\s*(?:\|\||&&|;|\|(?!\|))\s*/);
  const lastSegment = segments[segments.length - 1].trim();

  // First word that's not a leading VAR=val assignment.
  const firstWord = lastSegment.split(/\s+/)
    .find(w => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) || '';
  const bin = firstWord.split('/').pop();

  return NONZERO_EXIT_BINS.test(bin) ? 'nonzero_exit' : 'tool_error';
}

module.exports = { classifyFailure, NONZERO_EXIT_BINS };
