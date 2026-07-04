#!/usr/bin/env node

/**
 * Local LLM primitive. The kit's local analog of a `claude -p --output-format
 * json` call: invoke a model served by Ollama with a JSON schema and get back
 * structured output. This is the reusable atom the kit's local-as-tool routing
 * builds on (#845; runtime Ollama-MLX + eventual LiteLLM router decided in #302).
 *
 * Fails HONEST. Ollama unreachable, model not pulled, a non-200, an Ollama
 * `error` field, or output that does not parse to the schema all return
 * `{ ok: false, error }`. Nothing here silently returns a plausible-but-empty
 * result, so a down or missing local model can never masquerade as a real
 * answer — the caller (a gate, an eval) decides what a non-`ok` means, and for
 * a gate that means do not pass on a judge that could not run.
 *
 * Uses Ollama's structured-output API: POST /api/chat with `format` set to a
 * JSON schema and `stream: false`
 * (https://docs.ollama.com/capabilities/structured-outputs). Node's built-in
 * fetch — no runtime dependency, consistent with the kit's zero-dep posture.
 * Requires Node >= 18 (global fetch + AbortController).
 *
 * Not a Claude Code hook (no stdin/exit-code contract); a shared lib that lives
 * in hooks/lib/ with the kit's other libs.
 */

const DEFAULT_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

// ---- pure core (deterministic, unit-tested) ----

/**
 * The /api/chat request body for one structured-output call. `options` are
 * Ollama generation options (e.g. `{ temperature: 0 }` for a deterministic
 * judge); omitted when empty so the model's defaults stand.
 */
function buildChatRequest(model, prompt, schema, options) {
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    format: schema,
  };
  if (options && Object.keys(options).length) body.options = options;
  return body;
}

/**
 * Parse an Ollama /api/chat response into a structured result. The model's text
 * lives at message.content and, under a schema, is itself a JSON document.
 * Returns { ok:true, data } or { ok:false, error }.
 */
function parseChatResponse(raw) {
  let outer;
  try { outer = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch (_) { return { ok: false, error: 'ollama response was not JSON' }; }
  if (outer && outer.error) return { ok: false, error: `ollama error: ${outer.error}` };
  const content = outer && outer.message && outer.message.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    return { ok: false, error: 'ollama response had no message.content' };
  }
  let data;
  try { data = JSON.parse(content); }
  catch (_) { return { ok: false, error: 'model output was not valid JSON for the schema' }; }
  return { ok: true, data };
}

/**
 * Is `model` present in a /api/tags response? Matches the exact tag, or — when
 * the caller passed a bare base name with no `:tag` — any pulled tag of that
 * base, so `qwen3` resolves a pulled `qwen3:32b`.
 */
function modelInTags(tagsResponse, model) {
  const names = ((tagsResponse && tagsResponse.models) || []).map((m) => m && m.name).filter(Boolean);
  if (names.includes(model)) return true;
  if (model.includes(':')) return false;
  return names.some((n) => n.split(':')[0] === model);
}

// ---- edge (IO, network) ----

async function fetchWithTimeout(url, opts, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

/** Confirm Ollama is up and `model` is pulled. { ok:true } or { ok:false, error }. */
async function checkAvailable({ model, host = DEFAULT_HOST, timeoutMs = 5000 } = {}) {
  let r;
  try { r = await fetchWithTimeout(`${host}/api/tags`, { method: 'GET' }, timeoutMs); }
  catch (e) {
    const why = e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || 'error';
    return { ok: false, error: `ollama not reachable at ${host} (${why}) — is it running?` };
  }
  if (r.status !== 200) return { ok: false, error: `ollama /api/tags returned ${r.status}` };
  let tags;
  try { tags = JSON.parse(r.text); } catch (_) { return { ok: false, error: 'ollama /api/tags response was not JSON' }; }
  if (!modelInTags(tags, model)) return { ok: false, error: `model "${model}" not pulled — run: ollama pull ${model}` };
  return { ok: true };
}

/** One structured-output call. { ok:true, data } or { ok:false, error }. */
async function localJson({ prompt, schema, model, host = DEFAULT_HOST, timeoutMs = 120000, options }) {
  const body = JSON.stringify(buildChatRequest(model, prompt, schema, options));
  let r;
  try {
    r = await fetchWithTimeout(`${host}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, timeoutMs);
  } catch (e) {
    const why = e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || 'error';
    return { ok: false, error: `ollama /api/chat failed (${why})` };
  }
  if (r.status !== 200) return { ok: false, error: `ollama /api/chat returned ${r.status}: ${r.text.slice(0, 200)}` };
  return parseChatResponse(r.text);
}

module.exports = { buildChatRequest, parseChatResponse, modelInTags, checkAvailable, localJson, DEFAULT_HOST };
