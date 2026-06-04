/**
 * Canonical resolveProjectRoot. Walks up from a hint (directory, file path,
 * or cwd when no hint) looking for `.claude/`.
 *
 * Prior to this module, dispatch.cjs, voice-registry.cjs, and
 * lens-registry.cjs each kept a near-identical copy that drifted on
 * walk-depth (voice=20, lens=10, dispatch=10) and hint handling. Issue #246
 * consolidated them here. voice-registry.cjs and lens-registry.cjs re-export
 * bound versions with `{ symlinkGuard: false }` to preserve their
 * never-returns-null contract for their downstream consumers.
 *
 * With `symlinkGuard: true` (default) a symlinked `.claude/` returns null.
 * That closes the attack vector where a hostile repo clone contains
 * `.claude -> /tmp/evil` and causes arbitrary-path writes.
 */

const fs = require('fs');
const path = require('path');

const MAX_WALK_DEPTH = 20;

function resolveProjectRoot(hint, { symlinkGuard = true } = {}) {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;

  let startDir = process.cwd();
  if (hint && typeof hint === 'string') {
    let resolved = null;
    try {
      resolved = fs.statSync(hint).isDirectory() ? hint : path.dirname(hint);
    } catch {
      resolved = path.isAbsolute(hint) ? path.dirname(hint) : null;
    }
    if (resolved) startDir = resolved;
  }

  let dir = startDir;
  for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    const claudeDir = path.join(dir, '.claude');
    if (fs.existsSync(claudeDir)) {
      if (symlinkGuard) {
        try {
          const st = fs.lstatSync(claudeDir);
          if (st.isSymbolicLink()) return null;
        } catch {
          return null;
        }
      }
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

module.exports = { resolveProjectRoot, MAX_WALK_DEPTH };
