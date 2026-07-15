#!/usr/bin/env node

/**
 * Minimal YAML subset parser for kit config files.
 *
 * Zero runtime deps. Hand-rolled to the schema used by .claude/voice.yaml
 * and spec frontmatter under .claude/specs/. Supports:
 *
 *   - Top-level map with string keys
 *   - String scalars: plain, single-quoted, double-quoted
 *   - null literal (unquoted `null`, lowercase, or `~`)
 *   - Block scalars with `|` (literal, newlines preserved) and `>` (folded,
 *     newlines collapsed to spaces; blank lines preserved as paragraph breaks)
 *   - Nested maps (arbitrary depth)
 *   - Sequences of maps (`- key: value` with continuation lines)
 *   - Sequences of scalars (`- "value"` or `- value`); items in one sequence
 *     can mix scalars and maps when each item carries its own type.
 *   - Single-line flow sequences of scalars (`[a, b]`, `[]`); quote-aware
 *     comma split, each item unquoted like any scalar. Covers spec frontmatter
 *     `triggers`, `related`, and empty `applies_to: []`.
 *   - Comments via `#` (line-only or after whitespace on unquoted lines)
 *
 * Explicitly NOT supported:
 *   - Anchors (&, *), tags (!!)
 *   - Flow-style maps {k: v}; multi-line flow sequences
 *   - Chomping modifiers (|-, |+, >-, >+); clip is the only chomping mode
 *   - Numeric/boolean auto-conversion (all non-null scalars return as string)
 *   - Explicit indent indicators
 *
 * Throws on parse errors. Caller is expected to try/catch.
 *
 * Strict mode: parse(input, { strict: true }) additionally throws on two
 * constructs lenient mode SILENTLY mis-parses — a second `: ` mapping
 * indicator inside what is then treated as a plain scalar value (which
 * spec-compliant parsers reject as "mapping values are not allowed in this
 * context"), and a duplicate mapping key. It exists for the commit-time
 * .yaml validity gate (check-yaml-validity.cjs): the gate needs these to be
 * loud failures, not silent data corruption. Every strict throw carries a
 * numeric `.line`. Lenient mode is the default and unchanged, so no existing
 * consumer is affected (#892).
 */

function parse(input, opts = {}) {
  if (typeof input !== 'string') {
    throw new Error('yaml-mini: input must be a string');
  }
  const strict = !!(opts && opts.strict);
  const rawLines = input.split('\n').map((text, i) => {
    const indent = leadingSpaces(text);
    const trimmed = text.slice(indent);
    const commentStripped = stripInlineComment(trimmed);
    return {
      raw: text,
      indent,
      trimmed,
      content: commentStripped,
      isBlank: trimmed.length === 0,
      isCommentOnly: trimmed.startsWith('#'),
      n: i + 1
    };
  });
  const state = { lines: rawLines, i: 0, strict };
  skipInactive(state);
  if (state.i >= state.lines.length) return {};
  const first = state.lines[state.i];
  if (first.indent !== 0) {
    throw new Error(`yaml-mini: document must start at column 0 (line ${first.n})`);
  }
  const value = parseNode(state, -1);
  skipInactive(state);
  if (state.i < state.lines.length) {
    const extra = state.lines[state.i];
    throw new Error(`yaml-mini: unexpected content at line ${extra.n}`);
  }
  return value;
}

function leadingSpaces(text) {
  const m = text.match(/^ +/);
  return m ? m[0].length : 0;
}

function stripInlineComment(text) {
  let inSingle = false;
  let inDouble = false;
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble) {
      if (k === 0 || /\s/.test(text[k - 1])) return text.slice(0, k).replace(/\s+$/, '');
    }
  }
  return text.replace(/\s+$/, '');
}

function isActive(line) {
  return !line.isBlank && !line.isCommentOnly && line.content.length > 0;
}

function skipInactive(state) {
  while (state.i < state.lines.length && !isActive(state.lines[state.i])) state.i++;
}

function parseNode(state, parentIndent) {
  skipInactive(state);
  if (state.i >= state.lines.length) return {};
  const first = state.lines[state.i];
  if (first.indent <= parentIndent) {
    throw new Error(`yaml-mini: expected indented content at line ${first.n}`);
  }
  if (first.content.startsWith('- ') || first.content === '-') {
    return parseSequence(state, first.indent);
  }
  return parseMap(state, first.indent);
}

function parseMap(state, indent) {
  const out = {};
  while (state.i < state.lines.length) {
    skipInactive(state);
    if (state.i >= state.lines.length) break;
    const line = state.lines[state.i];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new Error(`yaml-mini: unexpected indent at line ${line.n}`);
    }
    if (line.content.startsWith('- ') || line.content === '-') break;
    const [key, rest] = splitKeyValue(line.content, line.n);
    state.i++;
    assertUniqueKey(state, out, key, line.n);
    if (rest === '|') {
      out[key] = readBlockScalar(state, indent, 'literal');
    } else if (rest === '>') {
      out[key] = readBlockScalar(state, indent, 'folded');
    } else if (rest === '') {
      skipInactive(state);
      const next = state.lines[state.i];
      if (next && next.indent > indent) {
        out[key] = parseNode(state, indent);
      } else {
        out[key] = null;
      }
    } else if (rest === 'null' || rest === '~') {
      out[key] = null;
    } else {
      assertPlainScalarValue(state, rest, line.n);
      out[key] = parseScalar(rest, line.n);
    }
  }
  return out;
}

function parseSequence(state, indent) {
  const out = [];
  while (state.i < state.lines.length) {
    skipInactive(state);
    if (state.i >= state.lines.length) break;
    const line = state.lines[state.i];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new Error(`yaml-mini: unexpected indent in sequence at line ${line.n}`);
    }
    if (!(line.content.startsWith('- ') || line.content === '-')) break;

    const after = line.content === '-' ? '' : line.content.slice(2);
    if (after === '') {
      throw new Error(`yaml-mini: empty sequence item at line ${line.n} not supported`);
    }
    if (findUnquotedColon(after) < 0) {
      state.i++;
      if (after === 'null' || after === '~') {
        out.push(null);
      } else {
        out.push(parseScalar(after, line.n));
      }
      continue;
    }
    const [firstKey, firstRest] = splitKeyValue(after, line.n);
    const item = {};
    const itemIndent = indent + 2;
    state.i++;
    if (firstRest === '|') {
      item[firstKey] = readBlockScalar(state, itemIndent, 'literal');
    } else if (firstRest === '>') {
      item[firstKey] = readBlockScalar(state, itemIndent, 'folded');
    } else if (firstRest === '') {
      skipInactive(state);
      const next = state.lines[state.i];
      if (next && next.indent > itemIndent) {
        item[firstKey] = parseNode(state, itemIndent);
      } else {
        item[firstKey] = null;
      }
    } else if (firstRest === 'null' || firstRest === '~') {
      item[firstKey] = null;
    } else {
      assertPlainScalarValue(state, firstRest, line.n);
      item[firstKey] = parseScalar(firstRest, line.n);
    }
    while (state.i < state.lines.length) {
      skipInactive(state);
      if (state.i >= state.lines.length) break;
      const cont = state.lines[state.i];
      if (cont.indent <= indent) break;
      if (cont.content.startsWith('- ') || cont.content === '-') break;
      if (cont.indent !== itemIndent) {
        throw new Error(`yaml-mini: inconsistent indent in sequence item at line ${cont.n}`);
      }
      const [ck, cv] = splitKeyValue(cont.content, cont.n);
      state.i++;
      assertUniqueKey(state, item, ck, cont.n);
      if (cv === '|') {
        item[ck] = readBlockScalar(state, itemIndent, 'literal');
      } else if (cv === '>') {
        item[ck] = readBlockScalar(state, itemIndent, 'folded');
      } else if (cv === '') {
        skipInactive(state);
        const next = state.lines[state.i];
        if (next && next.indent > itemIndent) {
          item[ck] = parseNode(state, itemIndent);
        } else {
          item[ck] = null;
        }
      } else if (cv === 'null' || cv === '~') {
        item[ck] = null;
      } else {
        assertPlainScalarValue(state, cv, cont.n);
        item[ck] = parseScalar(cv, cont.n);
      }
    }
    out.push(item);
  }
  return out;
}

function splitKeyValue(content, lineNo) {
  const colon = findUnquotedColon(content);
  if (colon < 0) {
    throw new Error(`yaml-mini: expected 'key: value' at line ${lineNo}`);
  }
  const keyRaw = content.slice(0, colon).trim();
  const valueRaw = content.slice(colon + 1).trim();
  if (keyRaw.length === 0) {
    throw new Error(`yaml-mini: empty key at line ${lineNo}`);
  }
  return [unquoteString(keyRaw, lineNo), valueRaw];
}

function findUnquotedColon(text) {
  let inSingle = false;
  let inDouble = false;
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === ':' && !inSingle && !inDouble) {
      if (k === text.length - 1 || text[k + 1] === ' ' || text[k + 1] === '\t') return k;
    }
  }
  return -1;
}

// Strict-mode guards. No-ops unless state.strict, so lenient callers are
// unaffected. See the header for why these two constructs are singled out.
function strictError(message, lineNo) {
  const err = new Error(`yaml-mini: ${message} at line ${lineNo}`);
  err.line = lineNo;
  return err;
}

function assertUniqueKey(state, map, key, lineNo) {
  if (!state.strict) return;
  if (Object.prototype.hasOwnProperty.call(map, key)) {
    throw strictError(`duplicate key '${key}'`, lineNo);
  }
}

// A plain (unquoted, non-flow) scalar value must not carry its own `: ` — that
// second mapping indicator is what a spec parser rejects as "mapping values are
// not allowed in this context". Quoted, flow-sequence `[...]`, and flow-map
// `{...}` values are exempt: those carry inner colons legitimately and a
// spec-compliant parser accepts them, so flagging them would block valid YAML
// (yaml-mini itself does not model flow maps, but strict mode must not turn that
// gap into a false error).
function assertPlainScalarValue(state, value, lineNo) {
  if (!state.strict || value.length === 0) return;
  const first = value[0];
  const last = value[value.length - 1];
  if (first === '"' || first === "'") return;
  if (first === '[' && last === ']') return;
  if (first === '{' && last === '}') return;
  if (findUnquotedColon(value) >= 0) {
    throw strictError(`mapping value not allowed in plain scalar (quote the value)`, lineNo);
  }
}

function readBlockScalar(state, parentIndent, style) {
  // Default YAML clip chomping: content is preserved, one trailing newline is kept.
  // style === 'literal' (|) keeps newlines verbatim. 'folded' (>) collapses
  // newlines between non-blank lines to single spaces; blank lines stay as
  // paragraph breaks (single newline in output).
  const collected = [];
  while (state.i < state.lines.length) {
    const line = state.lines[state.i];
    if (line.isBlank) {
      collected.push(line);
      state.i++;
      continue;
    }
    if (line.indent > parentIndent) {
      collected.push(line);
      state.i++;
      continue;
    }
    break;
  }
  while (collected.length && collected[collected.length - 1].isBlank) collected.pop();
  if (collected.length === 0) return '';
  const nonBlanks = collected.filter(l => !l.isBlank);
  if (nonBlanks.length === 0) return '';
  const baseIndent = Math.min(...nonBlanks.map(l => l.indent));
  if (style === 'folded') {
    let out = '';
    let prevBlank = false;
    for (let i = 0; i < collected.length; i++) {
      const l = collected[i];
      if (l.isBlank) {
        out += '\n';
        prevBlank = true;
        continue;
      }
      if (out.length > 0 && !prevBlank) out += ' ';
      out += l.raw.slice(baseIndent);
      prevBlank = false;
    }
    return out + '\n';
  }
  const body = collected.map(l => l.isBlank ? '' : l.raw.slice(baseIndent)).join('\n');
  return body + '\n';
}

function parseScalar(text, lineNo) {
  if (text.length === 0) return '';
  const first = text[0];
  if (first === '"' || first === "'") {
    return unquoteString(text, lineNo);
  }
  // Single-line flow sequence: an unquoted value that opens '[' and closes ']'
  // is a sequence in YAML, never a plain scalar. A literal "[x]" string must
  // be quoted, which is handled by the quote branch above.
  if (first === '[' && text[text.length - 1] === ']') {
    return parseFlowSequence(text, lineNo);
  }
  return text;
}

function parseFlowSequence(text, lineNo) {
  const inner = text.slice(1, -1).trim();
  if (inner.length === 0) return [];
  return splitFlowItems(inner)
    .map(item => item.trim())
    .filter(item => item.length > 0)
    .map(item => {
      if (item === 'null' || item === '~') return null;
      return parseScalar(item, lineNo);
    });
}

// Split on top-level commas, honoring single/double quotes so a quoted item
// can contain a comma. Bracket depth is tracked so a nested flow value stays
// in one item (nested flow itself is then parsed by the recursive parseScalar).
function splitFlowItems(text) {
  const items = [];
  let inSingle = false;
  let inDouble = false;
  let depth = 0;
  let start = 0;
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (c === '[') depth++;
      else if (c === ']') depth--;
      else if (c === ',' && depth === 0) {
        items.push(text.slice(start, k));
        start = k + 1;
      }
    }
  }
  items.push(text.slice(start));
  return items;
}

function unquoteString(text, lineNo) {
  if (text.length === 0) return text;
  const first = text[0];
  if (first !== '"' && first !== "'") return text;
  const last = text[text.length - 1];
  if (last !== first || text.length < 2) {
    throw new Error(`yaml-mini: unterminated quoted string at line ${lineNo}`);
  }
  const inner = text.slice(1, -1);
  if (first === "'") return inner.replace(/''/g, "'");
  return inner.replace(/\\(.)/g, (_m, c) => {
    if (c === 'n') return '\n';
    if (c === 't') return '\t';
    if (c === 'r') return '\r';
    if (c === '\\') return '\\';
    if (c === '"') return '"';
    return c;
  });
}

module.exports = { parse };
