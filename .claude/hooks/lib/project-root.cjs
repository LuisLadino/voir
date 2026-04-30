/**
 * Shared resolveProjectRoot: walks up from cwd looking for `.claude/`.
 *
 * Prior to this module, dispatch.cjs, voice-registry.cjs, and
 * lens-registry.cjs each kept a near-identical copy. This is the canonical
 * one; the others can import from here over time.
 *
 * Includes a symlink guard: if the resolved `.claude/` is a symlink, the
 * function returns null. That closes the attack vector where a hostile repo
 * clone contains `.claude -> /tmp/evil` and causes arbitrary-path writes.
 */

const fs = require('fs');
const path = require('path');

function resolveProjectRoot(hintDir) {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  let dir = hintDir || process.cwd();
  for (let i = 0; i < 10; i++) {
    const claudeDir = path.join(dir, '.claude');
    if (fs.existsSync(claudeDir)) {
      try {
        const st = fs.lstatSync(claudeDir);
        if (st.isSymbolicLink()) return null;
      } catch {
        return null;
      }
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return hintDir || process.cwd();
}

module.exports = { resolveProjectRoot };
