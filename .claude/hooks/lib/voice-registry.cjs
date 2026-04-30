/**
 * Voice Registry
 *
 * Loads `.claude/voice.yaml` and resolves which voice contract applies to
 * a given write act. Consumed by enforce-voice.cjs and voice-identity.cjs.
 *
 * resolveVoice({filePath?, envVar?}) precedence:
 *   1. envVar (explicit override at the act — covers pbcopy, conversation)
 *   2. filePath (path-pattern match against registry.paths, first-match-wins)
 *   3. registry.default
 *   4. hardcoded Luis fallback (when no registry or parse fails)
 *
 * A voice whose `rules` is null (e.g. `none`) means "skip enforcement."
 * Callers check result.rules === null.
 */

const fs = require('fs');
const path = require('path');
const YAML = require('./yaml-mini.cjs');

const { logError } = require('./session-utils.cjs');

const FALLBACK_LUIS_RULES = [
  'No em dashes. Use periods or colons.',
  'No parens. Use a comma, colon, or new sentence.',
  'No corporate speak. Avoid leverage, synergize, ensure, utilize, passionate.',
  'No scaffolding phrases. Avoid "Here\'s what I found:", "Let me explain:".',
  'Active voice, short sentences, contractions.',
  'Specifics over adjectives. Show, don\'t tell.',
  'Varied sentence length. Mix short and medium.',
  'If it sounds like AI wrote it, rewrite it.'
].join('\n');

function resolveProjectRoot(hintPath) {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  const hintAbs = hintPath && typeof hintPath === 'string' && path.isAbsolute(hintPath);
  let dir = hintAbs ? path.dirname(hintPath) : process.cwd();
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, '.claude'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return hintAbs ? path.dirname(hintPath) : process.cwd();
}

function registryPath(projectRoot) {
  return path.join(projectRoot || resolveProjectRoot(), '.claude/voice.yaml');
}

function validateRegistry(reg) {
  const errors = [];
  if (!reg || typeof reg !== 'object' || Array.isArray(reg)) {
    return ['root must be an object'];
  }
  if (reg.default !== undefined && typeof reg.default !== 'string') {
    errors.push('/default must be a string');
  }
  if (!reg.voices || typeof reg.voices !== 'object' || Array.isArray(reg.voices)) {
    errors.push('/voices must be an object keyed by voice name');
    return errors;
  }
  for (const [name, voice] of Object.entries(reg.voices)) {
    if (!voice || typeof voice !== 'object' || Array.isArray(voice)) {
      errors.push(`/voices/${name} must be an object`);
      continue;
    }
    if (voice.rules !== null && typeof voice.rules !== 'string') {
      errors.push(`/voices/${name}/rules must be a string or null`);
    }
  }
  if (reg.default && !reg.voices[reg.default]) {
    errors.push(`/default references unknown voice "${reg.default}"`);
  }
  if (reg.paths !== undefined) {
    if (!Array.isArray(reg.paths)) {
      errors.push('/paths must be an array');
    } else {
      reg.paths.forEach((rule, i) => {
        const p = `/paths/${i}`;
        if (!rule || typeof rule !== 'object') {
          errors.push(`${p} must be an object`);
          return;
        }
        if (typeof rule.match !== 'string') {
          errors.push(`${p}/match must be a string`);
        }
        if (typeof rule.voice !== 'string') {
          errors.push(`${p}/voice must be a string`);
        } else if (reg.voices && !reg.voices[rule.voice]) {
          errors.push(`${p}/voice references unknown voice "${rule.voice}"`);
        }
      });
    }
  }
  return errors;
}

function loadRegistry(projectRoot) {
  const p = registryPath(projectRoot);
  if (!fs.existsSync(p)) return null;
  let parsed;
  try {
    parsed = YAML.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    try { logError('voice-registry', `YAML parse error: ${e.message}`); } catch {}
    return null;
  }
  const errs = validateRegistry(parsed);
  if (errs.length) {
    try { logError('voice-registry', `invalid registry: ${errs.join('; ')}`); } catch {}
    return null;
  }
  return parsed;
}

// Cheap check to short-circuit the hot path in enforce-voice.cjs before doing
// a full YAML parse. Returns true if voice.yaml exists and contains any `paths:`
// rules. Non-existent file returns false. Substring scan, no parse.
function registryHasPathRules(projectRoot) {
  const p = registryPath(projectRoot);
  if (!fs.existsSync(p)) return false;
  let text;
  try { text = fs.readFileSync(p, 'utf8'); } catch { return false; }
  return /(^|\n)paths:\s*(\n\s*-|\[)/.test(text);
}

function globToRegex(glob) {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 3;
          continue;
        }
        re += '.*';
        i += 2;
        continue;
      }
      re += '[^/]*';
      i += 1;
      continue;
    }
    if (c === '?') { re += '[^/]'; i += 1; continue; }
    if (c === '.' || c === '+' || c === '(' || c === ')' || c === '|' || c === '^' || c === '$' || c === '\\') {
      re += '\\' + c;
      i += 1;
      continue;
    }
    if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end > i) {
        const alts = glob.slice(i + 1, end).split(',').map(a => a.replace(/[.+()|^$\\]/g, '\\$&'));
        re += '(?:' + alts.join('|') + ')';
        i = end + 1;
        continue;
      }
    }
    re += c;
    i += 1;
  }
  return new RegExp('^' + re + '$');
}

function matchesGlob(relPath, pattern) {
  return globToRegex(pattern).test(relPath);
}

function toRelative(filePath, projectRoot) {
  if (!filePath) return null;
  const root = projectRoot || resolveProjectRoot(filePath);
  if (path.isAbsolute(filePath)) {
    const rel = path.relative(root, filePath);
    if (rel.startsWith('..')) return null;
    return rel;
  }
  return filePath;
}

function voiceResult(name, rules, source) {
  return { name, rules, source };
}

function resolveVoice({ filePath, envVar, projectRoot } = {}) {
  const effectiveRoot = projectRoot || resolveProjectRoot(filePath);
  const reg = loadRegistry(effectiveRoot);

  if (!reg) {
    return voiceResult('luis', FALLBACK_LUIS_RULES, 'fallback');
  }

  if (envVar && typeof envVar === 'string' && envVar.length > 0) {
    const v = reg.voices[envVar];
    if (v) return voiceResult(envVar, v.rules, 'env');
  }

  if (filePath && Array.isArray(reg.paths) && reg.paths.length > 0) {
    const rel = toRelative(filePath, effectiveRoot);
    if (rel !== null) {
      for (const rule of reg.paths) {
        if (matchesGlob(rel, rule.match)) {
          const v = reg.voices[rule.voice];
          if (v) return voiceResult(rule.voice, v.rules, 'path');
        }
      }
    }
  }

  const defName = reg.default || 'luis';
  const def = reg.voices[defName];
  if (def) return voiceResult(defName, def.rules, 'default');

  return voiceResult('luis', FALLBACK_LUIS_RULES, 'fallback');
}

module.exports = {
  resolveVoice,
  loadRegistry,
  registryHasPathRules,
  validateRegistry,
  globToRegex,
  matchesGlob,
  toRelative,
  resolveProjectRoot,
  FALLBACK_LUIS_RULES
};
