#!/usr/bin/env node

/**
 * Worktree. Create isolated git worktrees for parallel Claude Code sessions.
 *
 * Each session worktree lives at .claude/worktrees/session-<slug>/ on its own
 * branch. The script propagates untracked project context like .claude/ and
 * .vercel/ and runs the project's install command so the worktree is ready
 * for a new claude session without manual setup.
 *
 * Reuses dispatch primitives: propagateUntrackedContext, readDispatchConfig,
 * resolveBaseRef. The only added behavior over dispatch is dependency install.
 *
 * Entry points:
 *   node worktree.cjs create <branch> [--from <ref>] [--no-install]
 *   node worktree.cjs list
 *   node worktree.cjs remove <name|path>
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  propagateUntrackedContext,
  readDispatchConfig,
  resolveBaseRef,
  KIT_DEFAULT_CONTEXT_DIRS,
  KIT_DEFAULT_CONTEXT_FILES,
} = require('../hooks/lib/dispatch.cjs');
const { resolveProjectRoot } = require('../hooks/lib/project-root.cjs');

const WORKTREES_DIR_REL = '.claude/worktrees';
const SESSION_PREFIX = 'session-';

function parseArgs(argv) {
  if (!argv || argv.length === 0) return { mode: 'help' };
  const first = argv[0];
  if (first === 'list' || first === '--list') return { mode: 'list' };
  if (first === 'remove' || first === '--remove') {
    return { mode: 'remove', name: argv[1] };
  }
  if (first === 'help' || first === '--help' || first === '-h') return { mode: 'help' };

  const args = first === 'create' ? argv.slice(1) : argv;
  const opts = { branch: null, fromRef: null, install: true };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--no-install') { opts.install = false; continue; }
    if (a === '--from') {
      if (i + 1 >= args.length) return { mode: 'error', error: '--from requires a ref' };
      opts.fromRef = args[++i];
      continue;
    }
    if (a.startsWith('--')) return { mode: 'error', error: `unknown flag: ${a}` };
    if (!opts.branch) { opts.branch = a; continue; }
    return { mode: 'error', error: `unexpected positional arg: ${a}` };
  }
  if (!opts.branch) return { mode: 'error', error: 'create requires a branch name or issue number' };
  return { mode: 'create', opts };
}

// "feature/foo" becomes "session-feature-foo". Numeric "451" becomes "session-451".
// Consecutive runs of unsafe chars collapse to a single dash so "fix///bug"
// becomes "session-fix-bug", not "session-fix---bug".
function worktreeNameFromBranch(branch) {
  const slug = String(branch)
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) throw new Error('branch produced empty slug after sanitization');
  return `${SESSION_PREFIX}${slug}`;
}

function readBlock(text, key) {
  const re = new RegExp(`(^|\\n)${key}:[ \\t]*\\r?\\n((?:[ \\t]+[^\\n]*\\r?\\n?)*)`);
  const m = text.match(re);
  return m ? m[2] : null;
}

function parseListField(block, key) {
  const keyRe = new RegExp(`(^|\\n)([ \\t]+)${key}:[ \\t]*\\r?\\n`);
  const m = block.match(keyRe);
  if (!m) return [];
  const keyIndent = m[2].length;
  const after = block.slice(m.index + m[0].length);
  const items = [];
  for (const line of after.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const indentMatch = line.match(/^([ \t]*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;
    if (indent <= keyIndent) break;
    const itemMatch = line.match(/^[ \t]+-[ \t]+(.+?)[ \t]*$/);
    if (!itemMatch) continue;
    let v = itemMatch[1].trim();
    const q = v.match(/^"([^"]*)"$|^'([^']*)'$/);
    if (q) v = q[1] || q[2];
    if (!v) continue;
    if (v.includes('..') || v.startsWith('/') || v.includes('\0')) continue;
    if (v.split(/[\\/]/).length > 1) continue;
    items.push(v);
  }
  return items;
}

function parseScalarField(block, key) {
  const re = new RegExp(`(^|\\n)[ \\t]+${key}:[ \\t]*(["']?)([^\\r\\n]*?)\\2[ \\t]*(?:\\r?\\n|$)`);
  const m = block.match(re);
  return m ? m[3].trim() : null;
}

function detectInstallCommand(projectRoot) {
  const cfgPath = path.join(projectRoot, '.claude/specs/stack-config.yaml');
  if (fs.existsSync(cfgPath)) {
    const text = fs.readFileSync(cfgPath, 'utf8');
    const wtBlock = readBlock(text, 'worktree');
    if (wtBlock) {
      const cmd = parseScalarField(wtBlock, 'install_command');
      if (cmd) return cmd;
    }
  }
  if (fs.existsSync(path.join(projectRoot, 'package-lock.json'))) return 'npm ci';
  if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) return 'pnpm install --frozen-lockfile';
  if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) return 'yarn install --frozen-lockfile';
  if (fs.existsSync(path.join(projectRoot, 'bun.lockb'))) return 'bun install --frozen-lockfile';
  if (fs.existsSync(path.join(projectRoot, 'poetry.lock'))) return 'poetry install';
  if (fs.existsSync(path.join(projectRoot, 'Pipfile.lock'))) return 'pipenv install --deploy';
  if (fs.existsSync(path.join(projectRoot, 'requirements.txt'))) return 'pip install -r requirements.txt';
  return null;
}

// Reads .claude/specs/stack-config.yaml worktree.context_dirs + worktree.context_files
// and merges with dispatch.context_dirs + dispatch.context_files (dedup). The kit
// defaults like .claude/ are added by the caller, not here.
function readWorktreeConfig(projectRoot) {
  const dispatchCfg = readDispatchConfig(projectRoot);
  const cfgPath = path.join(projectRoot, '.claude/specs/stack-config.yaml');
  if (!fs.existsSync(cfgPath)) return dispatchCfg;
  const text = fs.readFileSync(cfgPath, 'utf8');
  const wtBlock = readBlock(text, 'worktree');
  if (!wtBlock) return dispatchCfg;
  const wt = {
    context_dirs: parseListField(wtBlock, 'context_dirs'),
    context_files: parseListField(wtBlock, 'context_files'),
  };
  return {
    context_dirs: [...new Set([...dispatchCfg.context_dirs, ...wt.context_dirs])],
    context_files: [...new Set([...dispatchCfg.context_files, ...wt.context_files])],
  };
}

function branchExistsLocal(branch, cwd) {
  const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
    cwd, encoding: 'utf8'
  });
  return r.status === 0;
}

function cmdCreate(opts, projectRoot) {
  const wtName = worktreeNameFromBranch(opts.branch);
  const wtPath = path.join(projectRoot, WORKTREES_DIR_REL, wtName);

  if (fs.existsSync(wtPath)) {
    process.stderr.write(`Worktree already exists at ${wtPath}\n`);
    process.stderr.write(`Use 'node .claude/scripts/worktree.cjs remove ${wtName}' first.\n`);
    return 1;
  }

  fs.mkdirSync(path.dirname(wtPath), { recursive: true });

  const base = opts.fromRef || resolveBaseRef(projectRoot);
  const exists = branchExistsLocal(opts.branch, projectRoot);
  const args = exists
    ? ['worktree', 'add', wtPath, opts.branch]
    : ['worktree', 'add', '-b', opts.branch, wtPath, base];

  const r = spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8' });
  if (r.status !== 0) {
    const detail = (r.stderr || r.stdout || '').trim();
    process.stderr.write(`git worktree add failed: ${detail}\n`);
    return 1;
  }

  const cfg = readWorktreeConfig(projectRoot);
  const dirs = [...KIT_DEFAULT_CONTEXT_DIRS, ...cfg.context_dirs];
  const files = [...KIT_DEFAULT_CONTEXT_FILES, ...cfg.context_files];
  const { propagated, failed } = propagateUntrackedContext(projectRoot, wtPath, dirs, files);

  process.stdout.write(`Worktree created: ${wtPath}\n`);
  process.stdout.write(`  Branch: ${opts.branch}${exists ? ' [existing]' : ' [new]'}\n`);
  process.stdout.write(`  Base:   ${base}\n`);
  if (propagated.length) process.stdout.write(`  Propagated: ${propagated.join(', ')}\n`);
  if (failed.length) process.stdout.write(`  Propagation FAILED: ${failed.join(', ')}\n`);

  if (opts.install) {
    const installCmd = detectInstallCommand(projectRoot);
    if (installCmd) {
      process.stdout.write(`\nRunning install: ${installCmd}\n`);
      const parts = installCmd.split(/\s+/);
      const cmd = parts[0];
      const installArgs = parts.slice(1);
      const r2 = spawnSync(cmd, installArgs, { cwd: wtPath, stdio: 'inherit' });
      if (r2.status === 0) {
        process.stdout.write(`Install complete.\n`);
      } else {
        process.stdout.write(`Install failed with exit ${r2.status}. Run manually inside the worktree.\n`);
      }
    } else {
      process.stdout.write(`\nNo install command detected. Skipping. Pass --no-install to silence this notice.\n`);
    }
  }

  process.stdout.write(`\nNext steps:\n`);
  process.stdout.write(`  cd ${wtPath}\n`);
  process.stdout.write(`  claude\n`);
  return 0;
}

function cmdList(projectRoot) {
  const r = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: projectRoot, encoding: 'utf8'
  });
  if (r.status !== 0) {
    process.stderr.write('git worktree list failed\n');
    return 1;
  }
  const blocks = r.stdout.split(/\n\n+/).filter(Boolean);
  const out = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const wtLine = lines.find(l => l.startsWith('worktree '));
    const branchLine = lines.find(l => l.startsWith('branch '));
    if (!wtLine) continue;
    const wtPath = wtLine.slice('worktree '.length);
    const isSession = wtPath.includes(`/${WORKTREES_DIR_REL}/${SESSION_PREFIX}`);
    if (!isSession) continue;
    const branch = branchLine
      ? branchLine.slice('branch '.length).replace(/^refs\/heads\//, '')
      : '[detached]';
    out.push({ path: wtPath, branch });
  }
  if (out.length === 0) {
    process.stdout.write('No session worktrees.\n');
    return 0;
  }
  process.stdout.write(`Session worktrees [${out.length}]:\n\n`);
  for (const w of out) {
    process.stdout.write(`  ${w.path}\n    branch: ${w.branch}\n\n`);
  }
  return 0;
}

function cmdRemove(name, projectRoot) {
  if (!name) {
    process.stderr.write('remove requires a worktree name or path\n');
    return 2;
  }
  let wtPath = name;
  if (!path.isAbsolute(name)) {
    const candidate = name.startsWith(SESSION_PREFIX) ? name : SESSION_PREFIX + name;
    wtPath = path.join(projectRoot, WORKTREES_DIR_REL, candidate);
  }
  if (!fs.existsSync(wtPath)) {
    process.stderr.write(`No worktree at ${wtPath}\n`);
    return 1;
  }
  const r = spawnSync('git', ['worktree', 'remove', wtPath, '--force'], {
    cwd: projectRoot, encoding: 'utf8'
  });
  if (r.status !== 0) {
    process.stderr.write(`git worktree remove failed: ${(r.stderr || '').trim()}\n`);
    return 1;
  }
  process.stdout.write(`Removed ${wtPath}\n`);
  return 0;
}

function printHelp() {
  process.stdout.write([
    'Usage: worktree COMMAND [ARGS]',
    '',
    'Commands:',
    '  create <branch> [--from <ref>] [--no-install]',
    '      Create a worktree at .claude/worktrees/session-<slug>/.',
    '      Branch defaults to a new branch off origin/HEAD.',
    '      Propagates .claude/ and project-declared context dirs/files.',
    '      Runs the detected install command unless --no-install.',
    '',
    '  list',
    '      Show active session worktrees.',
    '',
    '  remove <name|path>',
    '      Remove a worktree by short name or absolute path.',
    '',
    'Examples:',
    '  node .claude/scripts/worktree.cjs create feature/new-thing',
    '  node .claude/scripts/worktree.cjs create 451 --from origin/main',
    '  node .claude/scripts/worktree.cjs create fix/bug --no-install',
    '  node .claude/scripts/worktree.cjs list',
    '  node .claude/scripts/worktree.cjs remove feature-new-thing',
    ''
  ].join('\n'));
}

function main(argv) {
  const projectRoot = resolveProjectRoot();
  if (!projectRoot) {
    process.stderr.write('Error: could not resolve project root.\n');
    return 2;
  }
  const parsed = parseArgs(argv);
  switch (parsed.mode) {
    case 'help': printHelp(); return 0;
    case 'error':
      process.stderr.write(`Error: ${parsed.error}\n\n`);
      printHelp();
      return 2;
    case 'create': return cmdCreate(parsed.opts, projectRoot);
    case 'list': return cmdList(projectRoot);
    case 'remove': return cmdRemove(parsed.name, projectRoot);
    default: printHelp(); return 1;
  }
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  parseArgs,
  worktreeNameFromBranch,
  detectInstallCommand,
  readWorktreeConfig,
  cmdCreate,
  cmdList,
  cmdRemove,
  WORKTREES_DIR_REL,
  SESSION_PREFIX,
};
