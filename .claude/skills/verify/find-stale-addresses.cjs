#!/usr/bin/env node

/**
 * Surface stale "Addresses #X" candidates for backlog review.
 *
 * PRs often link issues with `Addresses #X` instead of `Closes #X` when the
 * code is written but not yet verified. That's the correct default, but the
 * gap is that nobody circles back to verify and close.
 *
 * This script lists merged PRs older than a threshold whose `Addresses #X`
 * references point to issues that are still open. Run during backlog
 * review. See GitHub issue #247 for context.
 *
 * Usage:
 *   node scripts/find-stale-addresses.cjs            # default: >7 days, 100 PRs
 *   node scripts/find-stale-addresses.cjs --days 14
 *   node scripts/find-stale-addresses.cjs --limit 200
 *   node scripts/find-stale-addresses.cjs --json
 *
 * Entry point: run as a script to print to stdout. Exports are for tests.
 */

const { execFileSync } = require('child_process');

const DEFAULT_DAYS = 7;
const DEFAULT_LIMIT = 100;

// \b enforces a word boundary so we match "Addresses #5" and "- Addresses #5"
// but not "readdresses #5". "addresses the bug" doesn't match because the
// pattern requires `#` immediately after the whitespace.
const ADDRESSES_RE = /\b[Aa]ddresses\s+#(\d+)/g;

const USAGE = `Usage: find-stale-addresses [options]

Surface merged PRs whose "Addresses #X" referenced issues are still open.

Options:
  --days N     Only report PRs merged more than N days ago (default: ${DEFAULT_DAYS})
  --all-ages   Bypass --days filter; include PRs of any age (use for live verify-queue surfacing)
  --limit N    Number of merged PRs to scan (default: ${DEFAULT_LIMIT})
  --json       Emit JSON instead of human-readable text
  --help, -h   Show this message
`;

function parseAddressesRefs(body) {
  if (!body) return [];
  const refs = new Set();
  const re = new RegExp(ADDRESSES_RE);
  let m;
  while ((m = re.exec(body)) !== null) {
    refs.add(Number(m[1]));
  }
  return [...refs];
}

function parseArgs(argv) {
  const out = { days: DEFAULT_DAYS, limit: DEFAULT_LIMIT, json: false, help: false, allAges: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--days') {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 0) throw new Error(`--days expects a non-negative number, got ${argv[i]}`);
      out.days = n;
    } else if (a === '--all-ages') {
      out.allAges = true;
    } else if (a === '--limit') {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`--limit expects a positive number, got ${argv[i]}`);
      out.limit = n;
    } else if (a === '--json') {
      out.json = true;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return out;
}

function daysBetween(earlier, later) {
  return Math.floor((later.getTime() - earlier.getTime()) / (1000 * 60 * 60 * 24));
}

function ghJson(args) {
  const raw = execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(raw);
}

function listMergedPrs(limit) {
  return ghJson([
    'pr', 'list',
    '--state', 'merged',
    '--limit', String(limit),
    '--json', 'number,title,body,mergedAt,url',
  ]);
}

function listOpenIssues(limit) {
  return ghJson([
    'issue', 'list',
    '--state', 'open',
    '--limit', String(limit),
    '--json', 'number,title,url',
  ]);
}

function findStaleCandidates({ prs, openIssues, now, days, allAges = false }) {
  const openMap = new Map(openIssues.map((i) => [i.number, i]));
  const stale = [];
  for (const pr of prs) {
    if (!pr.mergedAt) continue;
    const merged = new Date(pr.mergedAt);
    const age = daysBetween(merged, now);
    if (!allAges && age <= days) continue;
    const refs = parseAddressesRefs(pr.body);
    for (const issueNum of refs) {
      const issue = openMap.get(issueNum);
      if (!issue) continue;
      stale.push({
        pr: {
          number: pr.number,
          title: pr.title,
          url: pr.url,
          mergedAt: pr.mergedAt,
          ageDays: age,
        },
        issue: {
          number: issueNum,
          title: issue.title,
          url: issue.url,
        },
      });
    }
  }
  stale.sort((a, b) => b.pr.ageDays - a.pr.ageDays);
  return stale;
}

function renderText(stale, { days, allAges = false }) {
  const scope = allAges
    ? 'all merged PRs (any age)'
    : `merged PRs older than ${days} days`;
  if (stale.length === 0) {
    return `No stale "Addresses" candidates. ${scope.charAt(0).toUpperCase() + scope.slice(1)} have their referenced issues closed.\n`;
  }
  const lines = [];
  const plural = stale.length === 1 ? 'candidate' : 'candidates';
  const scopeFrame = allAges
    ? 'any age, issues still open'
    : `merged >${days} days ago, issues still open`;
  lines.push(
    `${stale.length} stale "Addresses" ${plural} (${scopeFrame}):\n`
  );
  for (const s of stale) {
    const ageLabel = `${s.pr.ageDays} ${s.pr.ageDays === 1 ? 'day' : 'days'} ago`;
    lines.push(
      `PR #${s.pr.number} (merged ${s.pr.mergedAt.slice(0, 10)}, ${ageLabel}): ${s.pr.title}`
    );
    lines.push(`  ${s.pr.url}`);
    lines.push(`  -> Issue #${s.issue.number}: ${s.issue.title}`);
    lines.push(`     ${s.issue.url}`);
    lines.push('');
  }
  return lines.join('\n');
}

function main(argv = process.argv.slice(2), deps = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const prsFn = deps.listMergedPrs || listMergedPrs;
  const issuesFn = deps.listOpenIssues || listOpenIssues;

  const prs = prsFn(args.limit);
  const openIssues = issuesFn(Math.max(args.limit, 200));
  const stale = findStaleCandidates({
    prs,
    openIssues,
    now: deps.now || new Date(),
    days: args.days,
    allAges: args.allAges,
  });

  if (args.json) {
    process.stdout.write(JSON.stringify(stale, null, 2) + '\n');
  } else {
    process.stdout.write(renderText(stale, { days: args.days, allAges: args.allAges }));
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  ADDRESSES_RE,
  DEFAULT_DAYS,
  DEFAULT_LIMIT,
  parseAddressesRefs,
  parseArgs,
  daysBetween,
  findStaleCandidates,
  renderText,
  main,
};
