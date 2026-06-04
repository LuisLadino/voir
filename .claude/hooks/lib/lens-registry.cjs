/**
 * Lens Registry Loader
 *
 * Shared loader + validator for `.claude/specs/lenses/registry.json`.
 * Consumed by lens-router.cjs and phase-menu.cjs. Both need the same
 * resolved-project-root walk and the same schema-validation discipline;
 * prior to this module each kept its own drifted copy.
 *
 * Exports:
 *   - resolveProjectRoot() — walks up from cwd looking for `.claude/`,
 *     falls back to CLAUDE_PROJECT_DIR env var.
 *   - loadRegistry(hookName) — reads, parses, validates the registry.
 *     On failure emits a diagnostic to stderr + hook-errors.log via
 *     session-utils.logError and returns null. Pass a hookName string
 *     (e.g. "lens-router", "phase-menu") so diagnostics identify the
 *     caller; defaults to "lens-registry".
 *   - validateRegistry(reg) — returns an array of error strings with
 *     JSON-pointer-style paths. Empty array means valid.
 */

const fs = require('fs');
const path = require('path');

const { logError } = require('./session-utils.cjs');
const { resolveProjectRoot: baseResolveProjectRoot } = require('./project-root.cjs');

// lens-registry consumers (lens-router.cjs, phase-menu.cjs) assume a non-null
// return and build paths via `path.join(root, ...)`. Opting out of the
// symlink guard preserves that contract. See #246's decisions_needing_review.
function resolveProjectRoot() {
  return baseResolveProjectRoot(undefined, { symlinkGuard: false });
}

/**
 * Hand-written validator mirroring the shape in
 * .claude/specs/lenses/registry.schema.json. Zero-deps. Returns an array of
 * error strings with JSON-pointer-style paths; empty array = valid.
 */
function validateRegistry(reg) {
  const errors = [];
  if (!reg || typeof reg !== 'object' || Array.isArray(reg)) {
    return ['root must be an object'];
  }
  if (typeof reg.$schema_version !== 'number' || reg.$schema_version < 1) {
    errors.push('/$schema_version must be a positive integer');
  }
  const validAttachments = new Set();
  if (!Array.isArray(reg.attachment_points) || reg.attachment_points.length === 0) {
    errors.push('/attachment_points must be a non-empty array of strings');
  } else {
    reg.attachment_points.forEach((p, i) => {
      if (typeof p !== 'string') errors.push(`/attachment_points/${i} must be a string`);
      else validAttachments.add(p);
    });
  }
  if (!reg.lenses || typeof reg.lenses !== 'object' || Array.isArray(reg.lenses)) {
    errors.push('/lenses must be an object keyed by lens name');
    return errors;
  }
  for (const [lensName, lens] of Object.entries(reg.lenses)) {
    const lp = `/lenses/${lensName}`;
    if (!/^[a-z][a-z0-9-]*$/.test(lensName)) {
      errors.push(`${lp}: lens name must match ^[a-z][a-z0-9-]*$`);
    }
    if (!lens || typeof lens !== 'object' || Array.isArray(lens)) {
      errors.push(`${lp}: must be an object`);
      continue;
    }
    if (!Array.isArray(lens.moves)) {
      errors.push(`${lp}/moves: must be an array`);
      continue;
    }
    lens.moves.forEach((move, i) => {
      const mp = `${lp}/moves/${i}`;
      if (!move || typeof move !== 'object') {
        errors.push(`${mp}: must be an object`);
        return;
      }
      if (typeof move.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(move.name)) {
        errors.push(`${mp}/name: must match ^[a-z][a-z0-9-]*$`);
      }
      if (typeof move.skill !== 'string' || !/^[a-z][a-z0-9-]*$/.test(move.skill)) {
        errors.push(`${mp}/skill: must match ^[a-z][a-z0-9-]*$`);
      }
      if (!Array.isArray(move.triggers) || move.triggers.length === 0) {
        errors.push(`${mp}/triggers: must be a non-empty array of strings`);
      } else {
        move.triggers.forEach((t, j) => {
          if (typeof t !== 'string' || t.length === 0) {
            errors.push(`${mp}/triggers/${j}: must be a non-empty string`);
          }
        });
      }
      if (move.attachment !== undefined) {
        if (typeof move.attachment !== 'string') {
          errors.push(`${mp}/attachment: must be a string if present`);
        } else if (move.attachment !== 'unspecified' && validAttachments.size > 0 && !validAttachments.has(move.attachment)) {
          errors.push(`${mp}/attachment: "${move.attachment}" not in /attachment_points — bad values silently disable the move`);
        }
      }
    });
  }
  return errors;
}

function emitRegistryDiagnostic(hookName, registryPath, errors) {
  const firstLine = `[${hookName}] registry.json failed schema validation: ${errors[0]}`;
  try { process.stderr.write(firstLine + '\n'); } catch {}
  try {
    logError(hookName, `${registryPath}: ${errors.join('; ')}`);
  } catch {}
}

function loadRegistry(hookName) {
  const tag = hookName || 'lens-registry';
  const repoRoot = resolveProjectRoot();
  const registryPath = path.join(repoRoot, '.claude/specs/lenses/registry.json');

  let raw;
  try {
    raw = fs.readFileSync(registryPath, 'utf8');
  } catch {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    emitRegistryDiagnostic(tag, registryPath, [`JSON parse error: ${e.message}`]);
    return null;
  }

  const errors = validateRegistry(parsed);
  if (errors.length > 0) {
    emitRegistryDiagnostic(tag, registryPath, errors);
    return null;
  }

  return parsed;
}

module.exports = {
  resolveProjectRoot,
  loadRegistry,
  validateRegistry
};
