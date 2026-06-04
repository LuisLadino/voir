#!/usr/bin/env node

/**
 * Skill frontmatter parser for the Deep Agents extension fields.
 *
 * Splits a SKILL.md's frontmatter into Claude Code standard fields and the
 * four kit extension fields. Parsing is delegated to the shared
 * readSpecFrontmatter (#590) so SKILL.md and spec files never drift on YAML
 * edge cases. yaml-mini returns every non-null scalar as a string, so
 * normalizeExtensions coerces the known boolean/number fields — without it,
 * `persist: false` reads as the truthy string 'false'.
 */

const fs = require('fs');
const path = require('path');
const { readSpecFrontmatter } = require('./spec-frontmatter.cjs');
const { normalizeSkillName } = require('./skill-patterns.cjs');

const STANDARD_FIELDS = new Set([
  'name', 'description', 'argument-hint',
  'disable-model-invocation', 'user-invocable',
  'model', 'effort', 'allowed-tools',
  'context', 'agent', 'paths', 'hooks', 'shell'
]);

const EXTENSION_FIELDS = ['planning', 'filesystem', 'subagents', 'auto_summarize'];

function isTrue(v) { return v === true || v === 'true'; }
function isFalse(v) { return v === false || v === 'false'; }
function toInt(v, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
}

function asConfig(v) {
  if (isTrue(v)) return { enabled: true };
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  return null;
}

function normalizeExtensions(raw) {
  const ext = {};

  const p = asConfig(raw.planning);
  if (p) {
    ext.planning = {
      enabled: !isFalse(p.enabled),
      persist: !isFalse(p.persist),
      resume_on_activation: !isFalse(p.resume_on_activation),
      scope: p.scope === 'thread' ? 'thread' : 'session'
    };
  }

  const f = asConfig(raw.filesystem);
  if (f) {
    ext.filesystem = {
      enabled: !isFalse(f.enabled),
      scope: f.scope === 'thread' ? 'thread' : 'session',
      root_hint: typeof f.root_hint === 'string' && f.root_hint ? f.root_hint : 'scratch'
    };
  }

  if (Array.isArray(raw.subagents)) {
    ext.subagents = raw.subagents
      .filter(s => s && typeof s === 'object' && s.role)
      .map(s => ({
        role: s.role,
        isolation: ['none', 'forked', 'process'].includes(s.isolation) ? s.isolation : 'forked',
        agent: typeof s.agent === 'string' && s.agent ? s.agent : 'general-purpose',
        prompt_ref: typeof s.prompt_ref === 'string' ? s.prompt_ref : undefined
      }));
  }

  const a = asConfig(raw.auto_summarize);
  if (a) {
    ext.auto_summarize = {
      enabled: !isFalse(a.enabled),
      threshold_tokens: toInt(a.threshold_tokens, 10000),
      preserve: Array.isArray(a.preserve) ? a.preserve.filter(x => typeof x === 'string') : []
    };
  }

  return ext;
}

function parseSkillFrontmatter(skillPath) {
  const parsed = readSpecFrontmatter(skillPath);
  if (!parsed || typeof parsed !== 'object') return null;

  const standard = {};
  const rawExt = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (EXTENSION_FIELDS.includes(k)) rawExt[k] = v;
    else standard[k] = v;
  }

  const extensions = normalizeExtensions(rawExt);
  return {
    standard,
    extensions,
    hasExtensions: Object.keys(extensions).length > 0,
    skillName: standard.name || path.basename(path.dirname(skillPath)),
    dir: path.dirname(skillPath)
  };
}

function loadExtendedSkills(skillsRoot) {
  const out = {};
  let entries;
  try { entries = fs.readdirSync(skillsRoot, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const parsed = parseSkillFrontmatter(path.join(skillsRoot, entry.name, 'SKILL.md'));
    if (parsed && parsed.hasExtensions) out[parsed.skillName] = parsed;
  }
  return out;
}

module.exports = {
  STANDARD_FIELDS, EXTENSION_FIELDS,
  isTrue, isFalse, toInt, asConfig, normalizeExtensions,
  parseSkillFrontmatter, loadExtendedSkills, normalizeSkillName
};
