/**
 * Shared atoms for the kit-eval harnesses (#859). The trigger, behavior, output,
 * and faithfulness walks each carried their own near-identical copy of the
 * `claude -p` producer and a tolerant JSON judge-parse; three copies drift
 * independently, so a fix to one (a stream-json edge, a kill-on-timeout bug, the
 * #867 fail-closed parser) silently missed the others. This is the one home for
 * those atoms. Only the JUDGE parse and the producer are shared here — each
 * harness keeps its own verdict shape via the `key`/`fallback` params, and its
 * own grading, aggregation, and CLI.
 */

const { spawn } = require('child_process');

/**
 * Spawn a cold `claude -p --safe-mode --output-format json`, timeout-safe, and
 * resolve its `.result` text. Returns '' on timeout, spawn error, or an
 * unparseable envelope — fail quiet, since the caller grades an empty output as
 * non-compliant. `appendSystem` injects `--append-system-prompt` when a string;
 * pass null to omit it (the faithfulness walk grades a bare producer).
 */
function claudeRun(prompt, appendSystem, opts) {
  const { model, timeoutMs, cwd } = opts;
  return new Promise((resolve) => {
    const args = ['-p', prompt, '--safe-mode', '--output-format', 'json'];
    if (appendSystem) args.push('--append-system-prompt', appendSystem);
    if (model) args.push('--model', model);
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const child = spawn('claude', args, { cwd, env });
    let out = '';
    let settled = false;
    const finish = (text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch (_) { /* gone */ }
      resolve(text);
    };
    const timer = setTimeout(() => finish(''), timeoutMs);
    child.stdout.on('data', (c) => { out += c; });
    child.on('error', (err) => { console.error(`claude spawn failed: ${err.message}`); finish(''); });
    child.on('close', () => {
      let text = '';
      try { text = JSON.parse(out).result || ''; } catch (_) { text = ''; }
      finish(text);
    });
  });
}

/**
 * Extract the first parseable JSON object from judge text, tolerant of how the
 * Claude judge backend wraps it (#867). The old greedy first-`{` to last-`}`
 * match failed closed whenever the model added prose, a ```json fence, or a brace
 * inside a string value. This strips fences, tries the whole trimmed string, then
 * scans for the first `{` whose balanced (string-aware) close parses. Returns the
 * parsed object, or null when nothing parses.
 */
function extractJsonObject(text) {
  const t = String(text || '');
  if (!t.trim()) return null;
  const unfenced = t.replace(/```(?:json)?\s*([\s\S]*?)```/gi, '$1');
  // Happy path: the judge returned bare JSON.
  try { const j = JSON.parse(unfenced.trim()); if (j && typeof j === 'object') return j; } catch (_) { /* scan below */ }
  // Balanced-brace scan, string-aware so a brace inside a "reason" value does not
  // end the object early (the greedy-regex failure #867 fixes).
  for (let i = 0; i < unfenced.length; i++) {
    if (unfenced[i] !== '{') continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let k = i; k < unfenced.length; k++) {
      const c = unfenced[k];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          try { const j = JSON.parse(unfenced.slice(i, k + 1)); if (j && typeof j === 'object') return j; } catch (_) { /* next '{' */ }
          break;
        }
      }
    }
  }
  return null;
}

/**
 * Read a boolean verdict under `key` from judge text, failing to `fallback` when
 * no JSON parses or the key is absent/non-boolean. Preserves each harness's shape:
 * output reads `pass`/false, behavior reads `complies`/false, faithfulness reads
 * `faithful`/null (undecided). The strict `typeof === 'boolean'` check means a
 * string "true" is not a pass — the fail-closed contract the harness tests pin.
 */
function readJudgeVerdict(text, key, fallback) {
  const obj = extractJsonObject(text);
  if (!obj) return { [key]: fallback, reason: 'no JSON verdict found' };
  if (typeof obj[key] !== 'boolean') return { [key]: fallback, reason: `verdict missing boolean "${key}"` };
  return { [key]: obj[key], reason: String(obj.reason || '') };
}

/**
 * Map a local-LLM (Ollama) structured result to a `{ [key], reason }` verdict.
 * Fails closed to `fallback` with the error surfaced when the local judge did not
 * run, and applies the same strict-boolean check as readJudgeVerdict.
 */
function mapLocalVerdict(r, key, fallback) {
  if (!r || !r.ok) return { [key]: fallback, reason: (r && r.error) || 'local judge failed' };
  const d = r.data || {};
  return { [key]: (typeof d[key] === 'boolean' ? d[key] : fallback), reason: String(d.reason || '') };
}

module.exports = { claudeRun, extractJsonObject, readJudgeVerdict, mapLocalVerdict };
