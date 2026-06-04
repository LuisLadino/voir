#!/usr/bin/env node

/**
 * Spec Roots Resolver
 *
 * Returns the ordered list of directories that contain specs.
 * Kit specs always live under .claude/specs/.
 * Project specs live under the configured project_specs_root,
 * which defaults to .claude/specs/ (legacy / personal) or
 * docs/specs/ (client mode), and is overridable via .claude/specs.yaml.
 */

const fs = require('fs');
const path = require('path');

const KIT_SPECS_DIR = '.claude/specs';
const CONFIG_PATH = '.claude/specs.yaml';
const CLIENT_MODE_PATH = '.claude/kit-mode.yaml';
const CLIENT_DEFAULT_ROOT = 'docs/specs';
const PERSONAL_DEFAULT_ROOT = '.claude/specs';

function isClientMode(cwd) {
  try {
    const content = fs.readFileSync(path.join(cwd, CLIENT_MODE_PATH), 'utf8');
    return /^mode:\s*client\s*$/m.test(content);
  } catch {
    return false;
  }
}

function readConfig(cwd) {
  try {
    const content = fs.readFileSync(path.join(cwd, CONFIG_PATH), 'utf8');
    const match = content.match(/^project_specs_root:\s*"?([^"\n]+?)"?\s*$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Returns { kitRoot, projectRoot, roots: [absolute paths] }.
 * `roots` is the list to walk for spec discovery.
 * `kitRoot` always exists (it's in the kit). `projectRoot` may equal kitRoot
 * (legacy / personal default) — callers should de-duplicate before walking.
 */
function getSpecRoots(cwd = process.cwd()) {
  const configured = readConfig(cwd);
  const defaultRoot = isClientMode(cwd) ? CLIENT_DEFAULT_ROOT : PERSONAL_DEFAULT_ROOT;
  const projectRoot = configured || defaultRoot;

  const kitAbs = path.join(cwd, KIT_SPECS_DIR);
  const projectAbs = path.join(cwd, projectRoot);

  const roots = projectAbs === kitAbs ? [kitAbs] : [kitAbs, projectAbs];

  return {
    kitRoot: kitAbs,
    projectRoot: projectAbs,
    projectRootRelative: projectRoot,
    roots
  };
}

module.exports = { getSpecRoots };
