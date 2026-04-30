#!/usr/bin/env node

/**
 * Shared regex utilities for hooks.
 *
 * Extracted so `lens-router.cjs` and `spec-triggers.cjs` use the same
 * metacharacter handling. A trigger like `v1.0` or `foo(bar)` would
 * otherwise match unexpectedly or fail to construct.
 */

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { escapeRegex };
