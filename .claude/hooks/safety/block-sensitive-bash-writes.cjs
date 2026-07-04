#!/usr/bin/env node

/**
 * Block Sensitive File Writes via Bash
 *
 * Event: PreToolUse (Bash)
 * Purpose: Closes the Bash bypass of Claude Code's built-in sensitive-file
 *   protection. Tokenizes the command with quote awareness, identifies write
 *   destinations (shell redirects + cp/mv/install/rsync/tee/sed -i/awk -i
 *   inplace/perl -i destinations + node/python script writes), and blocks
 *   if any destination resolves to a protected path. Quoted strings are
 *   treated as literal data, so paths inside --body, --message, or any other
 *   quoted argument are not treated as write targets. Heredoc bodies are
 *   stripped before parsing so body content never poses as shell syntax.
 *
 * Protected paths (relative to cwd or absolute home/user paths):
 * - .claude/hooks/** .{cjs,js,sh,mjs}
 * - .claude/settings[.local].json
 * - ~/.claude/settings[.local].json
 * - /Users/<name>/.claude/settings[.local].json
 *
 * When blocked, Write/Edit should be used instead. Those tools fire the
 * built-in approval flow. Workers that cannot answer prompts will fail
 * cleanly and flag the edit under decisions_needing_review.
 *
 * Spec: .claude/specs/kit/sensitive-file-protection.md
 */

const { stripHeredocs } = require('../lib/command-position.cjs');

const SENSITIVE_PATH_TOKEN_RE =
  /^(?:(?:\.{1,2}\/)+)?(?:\.claude|~\/\.claude|\/Users\/[^/]+\/\.claude)\/(?:hooks\/.+\.(?:cjs|js|sh|mjs)|settings(?:\.local)?\.json)$/;

function isSensitivePath(value) {
  if (typeof value !== 'string') return false;
  return SENSITIVE_PATH_TOKEN_RE.test(value.trim());
}

// Tokenize a Bash command into segments. Each segment:
//   { tokens: Array<{value: string}>, redirects: Array<{op: string, target: string}> }
// Quoting rules:
//   - Single quotes: contents literal until next single quote.
//   - Double quotes: contents literal except backslash escapes.
//   - Backslash outside quotes: next char literal.
// Recognized only OUTSIDE quotes:
//   Segment separators ; && || | &
//   Output redirects > >> &> &>> N> N>>
//   Input redirects < << <<<  (target consumed but discarded)
//   FD-to-FD redirects N>&M  (consumed, no target file)
//   $(...) and `...`: copied as opaque content of current token.
function parseShell(input) {
  if (typeof input !== 'string') return [];
  const segments = [];
  let segment = { tokens: [], redirects: [] };
  let token = null;
  let pendingRedir = null;

  function ensureToken() {
    if (token === null) token = { value: '' };
  }
  function pushToken() {
    if (token === null) return;
    if (pendingRedir !== null) {
      if (pendingRedir !== '<DISCARD') {
        segment.redirects.push({ op: pendingRedir, target: token.value });
      }
      pendingRedir = null;
    } else {
      segment.tokens.push(token);
    }
    token = null;
  }
  function newSegment() {
    pushToken();
    segments.push(segment);
    segment = { tokens: [], redirects: [] };
  }

  let i = 0;
  while (i < input.length) {
    const ch = input[i];

    if (ch === "'") {
      ensureToken();
      i++;
      while (i < input.length && input[i] !== "'") { token.value += input[i]; i++; }
      if (i < input.length) i++;
      continue;
    }

    if (ch === '"') {
      ensureToken();
      i++;
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) {
          token.value += input[i + 1];
          i += 2;
        } else {
          token.value += input[i];
          i++;
        }
      }
      if (i < input.length) i++;
      continue;
    }

    if (ch === '\\' && i + 1 < input.length) {
      ensureToken();
      token.value += input[i + 1];
      i += 2;
      continue;
    }

    if (ch === '$' && input[i + 1] === '(') {
      ensureToken();
      token.value += '$(';
      i += 2;
      let depth = 1;
      while (i < input.length && depth > 0) {
        const c = input[i];
        if (c === '\\' && i + 1 < input.length) {
          token.value += c + input[i + 1];
          i += 2;
        } else if (c === "'" || c === '"') {
          const q = c;
          token.value += c;
          i++;
          while (i < input.length && input[i] !== q) {
            if (input[i] === '\\' && i + 1 < input.length && q === '"') {
              token.value += input[i] + input[i + 1];
              i += 2;
            } else {
              token.value += input[i];
              i++;
            }
          }
          if (i < input.length) { token.value += input[i]; i++; }
        } else if (c === '(') { depth++; token.value += c; i++; }
        else if (c === ')') { depth--; token.value += c; i++; }
        else { token.value += c; i++; }
      }
      continue;
    }

    if (ch === '`') {
      ensureToken();
      token.value += '`';
      i++;
      while (i < input.length && input[i] !== '`') {
        if (input[i] === '\\' && i + 1 < input.length) {
          token.value += input[i] + input[i + 1];
          i += 2;
        } else {
          token.value += input[i];
          i++;
        }
      }
      if (i < input.length) { token.value += '`'; i++; }
      continue;
    }

    if (/\s/.test(ch)) { pushToken(); i++; continue; }

    if (ch === ';') { newSegment(); i++; continue; }

    if (ch === '&') {
      pushToken();
      if (input[i + 1] === '&') { newSegment(); i += 2; continue; }
      if (input[i + 1] === '>') {
        let op = '&>';
        i += 2;
        if (input[i] === '>') { op = '&>>'; i++; }
        pendingRedir = op;
        continue;
      }
      newSegment();
      i++;
      continue;
    }

    if (ch === '|') {
      pushToken();
      if (input[i + 1] === '|') { newSegment(); i += 2; continue; }
      if (input[i + 1] === '&') { newSegment(); i += 2; continue; }
      newSegment();
      i++;
      continue;
    }

    if (ch === '>') {
      pushToken();
      let op = '>';
      i++;
      if (input[i] === '>') { op = '>>'; i++; }
      pendingRedir = op;
      continue;
    }

    if (ch === '<') {
      pushToken();
      i++;
      if (input[i] === '<') { i++; if (input[i] === '<') i++; }
      pendingRedir = '<DISCARD';
      continue;
    }

    if (/[0-9]/.test(ch) && token === null) {
      let j = i;
      while (j < input.length && /[0-9]/.test(input[j])) j++;
      if (input[j] === '>') {
        const fd = input.substring(i, j);
        i = j + 1;
        let op = `${fd}>`;
        if (input[i] === '>') { op = `${fd}>>`; i++; }
        if (input[i] === '&') {
          i++;
          while (i < input.length && /[0-9-]/.test(input[i])) i++;
          continue;
        }
        pendingRedir = op;
        continue;
      }
      if (input[j] === '<') {
        i = j + 1;
        if (input[i] === '<') i++;
        pendingRedir = '<DISCARD';
        continue;
      }
    }

    ensureToken();
    token.value += ch;
    i++;
  }

  pushToken();
  segments.push(segment);
  return segments;
}

const SHELL_WRAPPERS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const COPY_LIKE = new Set(['cp', 'mv', 'install', 'rsync', 'gcp', 'gmv', 'ginstall']);
const TEE_LIKE = new Set(['tee', 'gtee']);
const SED_LIKE = new Set(['sed', 'gsed']);
const AWK_LIKE = new Set(['awk', 'gawk', 'mawk', 'nawk']);
const PERL_LIKE = new Set(['perl']);
const NODE_LIKE = new Set(['node']);
const PYTHON_LIKE = new Set(['python', 'python3']);

function basename(p) {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? p : p.substring(idx + 1);
}

function isFlag(arg) {
  return typeof arg === 'string' && arg.startsWith('-') && arg !== '-';
}

function lastPositional(args) {
  for (let i = args.length - 1; i >= 0; i--) {
    if (!isFlag(args[i])) return args[i];
  }
  return null;
}

function positionals(args) {
  const out = [];
  for (const a of args) if (!isFlag(a)) out.push(a);
  return out;
}

const NODE_WRITE_PATH_RE =
  /\.(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|truncate|truncateSync)\s*\(\s*['"`]([^'"`]+)['"`]/g;

function nodeScriptWrites(script) {
  if (typeof script !== 'string') return [];
  const out = [];
  let m;
  NODE_WRITE_PATH_RE.lastIndex = 0;
  while ((m = NODE_WRITE_PATH_RE.exec(script)) !== null) out.push(m[1]);
  return out;
}

const PYTHON_OPEN_RE =
  /\bopen\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"][rwax+bt]*[wax][rwax+bt]*['"]/g;

function pythonScriptWrites(script) {
  if (typeof script !== 'string') return [];
  const out = [];
  let m;
  PYTHON_OPEN_RE.lastIndex = 0;
  while ((m = PYTHON_OPEN_RE.exec(script)) !== null) out.push(m[1]);
  return out;
}

const SED_AWK_PERL_FLAG_VALUE = new Set([
  '-e', '--expression', '-f', '--file',
  '-F', '-v', '--field-separator', '--assign',
  '-M', '-m', '-I',
]);

function sedAwkPerlFiles(args, cmd) {
  const hasScriptFlag = args.some(
    x => x === '-e' || x === '-f' || x === '--expression' || x === '--file' ||
         x === '-pe' || x === '-ne' || x === '-Pe'
  );
  const files = [];
  let scriptConsumed = false;
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === '--') { i++; while (i < args.length) { files.push(args[i]); i++; } break; }
    if (cmd === 'awk' && a === '-i') { i += 2; continue; }
    if (cmd === 'sed' && a === '-i' && i + 1 < args.length && args[i + 1] === '') {
      i += 2;
      continue;
    }
    if (SED_AWK_PERL_FLAG_VALUE.has(a)) { i += 2; continue; }
    if (a.startsWith('-')) { i++; continue; }
    if (!scriptConsumed && (cmd === 'sed' || cmd === 'awk' || cmd === 'perl') && !hasScriptFlag) {
      scriptConsumed = true;
      i++;
      continue;
    }
    files.push(a);
    i++;
  }
  return files;
}

function getWriteTargets(segment, depth = 0) {
  const targets = [];
  if (depth > 4) return targets;

  for (const r of segment.redirects) {
    if (r.op === '>' || r.op === '>>' || r.op === '&>' || r.op === '&>>' || /^\d+>>?$/.test(r.op)) {
      targets.push({ kind: `redirect ${r.op}`, value: r.target });
    }
  }

  if (segment.tokens.length === 0) return targets;

  let cmdIdx = 0;
  while (cmdIdx < segment.tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(segment.tokens[cmdIdx].value)) {
    cmdIdx++;
  }
  if (cmdIdx >= segment.tokens.length) return targets;

  const cmdValue = segment.tokens[cmdIdx].value;
  const cmd = basename(cmdValue);
  const args = segment.tokens.slice(cmdIdx + 1).map(t => t.value);

  if (SHELL_WRAPPERS.has(cmd)) {
    const cIdx = args.findIndex(a => a === '-c');
    if (cIdx >= 0 && cIdx + 1 < args.length) {
      const subSegments = parseShell(stripHeredocs(args[cIdx + 1], { mode: 'preserve-operator' }));
      for (const seg of subSegments) {
        const subTargets = getWriteTargets(seg, depth + 1);
        for (const t of subTargets) targets.push({ kind: `${cmd} -c ${t.kind}`, value: t.value });
      }
    }
    return targets;
  }

  if (COPY_LIKE.has(cmd)) {
    const dest = lastPositional(args);
    if (dest !== null) targets.push({ kind: `${cmd} dest`, value: dest });
    return targets;
  }

  if (TEE_LIKE.has(cmd)) {
    for (const a of positionals(args)) targets.push({ kind: `${cmd} dest`, value: a });
    return targets;
  }

  if (SED_LIKE.has(cmd)) {
    if (!args.some(a => a === '-i' || /^-i.+/.test(a))) return targets;
    for (const f of sedAwkPerlFiles(args, 'sed')) targets.push({ kind: `${cmd} -i target`, value: f });
    return targets;
  }

  if (AWK_LIKE.has(cmd)) {
    const idx = args.findIndex(a => a === '-i');
    if (idx < 0 || args[idx + 1] !== 'inplace') return targets;
    for (const f of sedAwkPerlFiles(args, 'awk')) targets.push({ kind: `${cmd} -i inplace target`, value: f });
    return targets;
  }

  if (PERL_LIKE.has(cmd)) {
    if (!args.some(a => a.startsWith('-i'))) return targets;
    for (const f of sedAwkPerlFiles(args, 'perl')) targets.push({ kind: `${cmd} -i target`, value: f });
    return targets;
  }

  if (NODE_LIKE.has(cmd)) {
    const evalIdx = args.findIndex(a => a === '-e' || a === '--eval');
    if (evalIdx >= 0 && evalIdx + 1 < args.length) {
      for (const w of nodeScriptWrites(args[evalIdx + 1])) {
        targets.push({ kind: `${cmd} -e fs write`, value: w });
      }
    }
    return targets;
  }

  if (PYTHON_LIKE.has(cmd)) {
    const cIdx = args.findIndex(a => a === '-c');
    if (cIdx >= 0 && cIdx + 1 < args.length) {
      for (const w of pythonScriptWrites(args[cIdx + 1])) {
        targets.push({ kind: `${cmd} -c open w`, value: w });
      }
    }
    return targets;
  }

  return targets;
}

function detectSensitiveWrite(command) {
  if (typeof command !== 'string' || command.length === 0) return null;

  if (!/\.claude\/(?:hooks|settings)/.test(command) &&
      !/~\/\.claude\/settings/.test(command)) {
    return null;
  }

  let segments;
  try {
    segments = parseShell(stripHeredocs(command, { mode: 'preserve-operator' }));
  } catch {
    return null;
  }

  for (const seg of segments) {
    for (const t of getWriteTargets(seg)) {
      if (isSensitivePath(t.value)) {
        return { pattern: t.kind, target: t.value };
      }
    }
  }
  return null;
}

function handleHook(data) {
  const command = data && data.tool_input && data.tool_input.command;
  if (!command) {
    process.exit(0);
  }

  const hit = detectSensitiveWrite(command);
  if (hit) {
    console.error(`[BLOCKED] Bash write to sensitive file via ${hit.pattern}: ${hit.target}`);
    console.error(`Sensitive files require human review via the Write or Edit tool.`);
    console.error(`Protected: .claude/hooks/*.{cjs,js,sh,mjs}, .claude/settings[.local].json, ~/.claude/settings[.local].json`);
    console.error(`If this is a dispatched worker, surface the intended change under decisions_needing_review and stop.`);
    process.exit(2);
  }
  process.exit(0);
}

if (require.main === module) {
  const { runStdinHook } = require('../lib/stdin-hook.cjs');
  runStdinHook(handleHook, { mode: 'gating' });
}

module.exports = { detectSensitiveWrite, parseShell, getWriteTargets, isSensitivePath };
