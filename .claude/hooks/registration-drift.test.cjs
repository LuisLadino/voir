#!/usr/bin/env node

/**
 * Registration drift test (#416).
 *
 * Two assertions on the kit's hook surface:
 *
 *   FORWARD  Every `node .claude/hooks/.../foo.cjs` command in
 *            settings.template.json must reference a file that exists.
 *            Catches: template stale after a hook is deleted or renamed.
 *
 *   REVERSE  Every .cjs file under .claude/hooks/ (excluding lib/ and
 *            *.test.cjs) must either be registered in the template OR
 *            carry a `// @kit-internal` marker. Catches: a hook lands in
 *            the kit, syncs to disk, and silently never fires because no
 *            Claude Code lifecycle phase invokes it.
 *
 * The marker convention puts the decision at the hook file. A new top-level
 * hook fails this test until it's added to settings.template.json. A new
 * internal-only helper (required by another hook or spawned by a skill)
 * fails until it carries the marker. Either way the author makes the
 * registration decision explicitly, not by accident.
 *
 * Background: this gap surfaced during the #126 review. Without it, the
 * next person who adds a kit hook re-introduces the silent-failure mode
 * #126 was filed against, just one layer deeper.
 *
 * Run: node .claude/hooks/registration-drift.test.cjs
 */

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../..');
const HOOKS_DIR = path.join(REPO, '.claude/hooks');
const TEMPLATE = path.join(REPO, 'settings.template.json');

let pass = 0;
let fail = 0;
const report = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else    { fail++; console.log(`FAIL  ${name}${detail ? '\n  ' + detail : ''}`); }
};

function walkHooks(dir, prefix = '') {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'lib') continue;
      found.push(...walkHooks(full, rel));
    } else if (entry.name.endsWith('.cjs') && !entry.name.endsWith('.test.cjs')) {
      found.push(rel);
    }
  }
  return found;
}

function extractRegisteredPaths(template) {
  const registered = new Set();
  const cmdRegex = /node\s+\.claude\/hooks\/([^\s;|&"'`)}\]]+\.cjs)/g;

  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') return Object.values(node).forEach(walk);
    if (typeof node !== 'string') return;
    let m;
    while ((m = cmdRegex.exec(node)) !== null) registered.add(m[1]);
  };

  walk(template.hooks || {});
  return registered;
}

function isMarkedInternal(absPath) {
  const head = fs.readFileSync(absPath, 'utf8').split('\n').slice(0, 30).join('\n');
  return /^\s*\/\/\s*@kit-internal\b/m.test(head);
}

let template;
try {
  template = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
} catch (e) {
  console.error(`FAIL  could not read/parse ${TEMPLATE}: ${e.message}`);
  process.exit(1);
}

const registered = extractRegisteredPaths(template);
const onDisk = new Set(walkHooks(HOOKS_DIR));

for (const rel of [...registered].sort()) {
  const abs = path.join(HOOKS_DIR, rel);
  const exists = fs.existsSync(abs);
  report(`forward: registered hook exists on disk — ${rel}`, exists,
    exists ? '' : `template references ${rel} but file is missing under .claude/hooks/`);
}

for (const rel of [...onDisk].sort()) {
  if (registered.has(rel)) {
    report(`reverse: on-disk hook is registered — ${rel}`, true);
    continue;
  }
  const abs = path.join(HOOKS_DIR, rel);
  const marked = isMarkedInternal(abs);
  report(`reverse: on-disk hook is registered or @kit-internal — ${rel}`, marked,
    marked ? '' : `${rel} is neither registered in settings.template.json nor marked '// @kit-internal'. Either add a registration block to settings.template.json or, if this hook is intentionally invoked by another hook/skill/script, add '// @kit-internal' to its header.`);
}

console.log(`\n${'='.repeat(48)}`);
if (fail > 0) {
  console.error(`FAILED — ${fail} of ${pass + fail} assertions failed.`);
  process.exit(1);
}
console.log(`PASSED — all ${pass} assertions green.`);
process.exit(0);
