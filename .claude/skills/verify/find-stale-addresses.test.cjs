#!/usr/bin/env node

const assert = require('assert');
const {
  parseAddressesRefs,
  parseArgs,
  daysBetween,
  findStaleCandidates,
  renderText,
  main,
  DEFAULT_DAYS,
  DEFAULT_LIMIT,
} = require('./find-stale-addresses.cjs');

// parseAddressesRefs
assert.deepStrictEqual(parseAddressesRefs('Addresses #123'), [123], 'capitalized reference');
assert.deepStrictEqual(parseAddressesRefs('addresses #45'), [45], 'lowercase reference');
assert.deepStrictEqual(
  parseAddressesRefs('Addresses #1, addresses #2, and Addresses #3.'),
  [1, 2, 3],
  'multiple mixed-case references'
);
assert.deepStrictEqual(
  parseAddressesRefs('- [ ] Addresses #99'),
  [99],
  'markdown checklist form'
);
assert.deepStrictEqual(
  parseAddressesRefs('**Addresses #42**'),
  [42],
  'markdown bold form'
);
assert.deepStrictEqual(
  parseAddressesRefs('closes #1. Addresses #2.'),
  [2],
  'ignores non-addresses keywords'
);
assert.deepStrictEqual(
  parseAddressesRefs('this readdresses #5'),
  [],
  'does not match partial-word preceding "addresses"'
);
assert.deepStrictEqual(
  parseAddressesRefs('the PR addresses the concern in #42'),
  [],
  'does not match when # is not adjacent to the word'
);
assert.deepStrictEqual(
  parseAddressesRefs('Addresses #5. Addresses #5.'),
  [5],
  'dedupes repeated references'
);
assert.deepStrictEqual(parseAddressesRefs(''), [], 'empty body');
assert.deepStrictEqual(parseAddressesRefs(null), [], 'null body');
assert.deepStrictEqual(parseAddressesRefs(undefined), [], 'undefined body');

// parseArgs
assert.deepStrictEqual(parseArgs([]), {
  days: DEFAULT_DAYS,
  limit: DEFAULT_LIMIT,
  json: false,
  help: false,
  allAges: false,
});
assert.deepStrictEqual(parseArgs(['--days', '14']), {
  days: 14,
  limit: DEFAULT_LIMIT,
  json: false,
  help: false,
  allAges: false,
});
assert.deepStrictEqual(parseArgs(['--limit', '50']), {
  days: DEFAULT_DAYS,
  limit: 50,
  json: false,
  help: false,
  allAges: false,
});
assert.deepStrictEqual(parseArgs(['--json']), {
  days: DEFAULT_DAYS,
  limit: DEFAULT_LIMIT,
  json: true,
  help: false,
  allAges: false,
});
assert.deepStrictEqual(parseArgs(['--days', '14', '--limit', '50', '--json']), {
  days: 14,
  limit: 50,
  json: true,
  help: false,
  allAges: false,
});
assert.deepStrictEqual(parseArgs(['--help']), {
  days: DEFAULT_DAYS,
  limit: DEFAULT_LIMIT,
  json: false,
  help: true,
  allAges: false,
});
assert.deepStrictEqual(parseArgs(['--all-ages']), {
  days: DEFAULT_DAYS,
  limit: DEFAULT_LIMIT,
  json: false,
  help: false,
  allAges: true,
}, '--all-ages flag parses');
assert.throws(() => parseArgs(['--days', 'abc']), /non-negative/, 'rejects non-numeric days');
assert.throws(() => parseArgs(['--days', '-1']), /non-negative/, 'rejects negative days');
assert.throws(() => parseArgs(['--limit', '0']), /positive/, 'rejects zero limit');
assert.throws(() => parseArgs(['--unknown']), /Unknown argument/, 'rejects unknown flag');

// daysBetween
assert.strictEqual(
  daysBetween(new Date('2026-04-14T00:00:00Z'), new Date('2026-04-21T00:00:00Z')),
  7
);
assert.strictEqual(
  daysBetween(new Date('2026-04-21T00:00:00Z'), new Date('2026-04-21T00:00:00Z')),
  0
);
assert.strictEqual(
  daysBetween(new Date('2026-04-21T23:00:00Z'), new Date('2026-04-22T22:00:00Z')),
  0,
  'partial day rounds down'
);

// findStaleCandidates
const now = new Date('2026-04-28T00:00:00Z');
const prs = [
  {
    number: 191,
    title: 'fix: old PR with still-open issue',
    body: 'Addresses #190',
    mergedAt: '2026-04-20T00:00:00Z',
    url: 'https://example/pr/191',
  },
  {
    number: 195,
    title: 'fix: two refs, one open one closed',
    body: 'Addresses #193, Addresses #194',
    mergedAt: '2026-04-18T00:00:00Z',
    url: 'https://example/pr/195',
  },
  {
    number: 200,
    title: 'fix: too recent, skip',
    body: 'Addresses #199',
    mergedAt: '2026-04-27T00:00:00Z',
    url: 'https://example/pr/200',
  },
  {
    number: 210,
    title: 'feat: no Addresses line',
    body: 'No linking pattern here.',
    mergedAt: '2026-04-01T00:00:00Z',
    url: 'https://example/pr/210',
  },
  {
    number: 215,
    title: 'fix: referenced issue already closed',
    body: 'Addresses #214',
    mergedAt: '2026-04-01T00:00:00Z',
    url: 'https://example/pr/215',
  },
  {
    number: 220,
    title: 'fix: closes-only PR should be ignored',
    body: 'Closes #219',
    mergedAt: '2026-04-01T00:00:00Z',
    url: 'https://example/pr/220',
  },
];
const openIssues = [
  { number: 190, title: 'old bug still open', url: 'https://example/issue/190' },
  { number: 193, title: 'also still open', url: 'https://example/issue/193' },
  { number: 199, title: 'recent bug still open', url: 'https://example/issue/199' },
  { number: 219, title: 'closes-only, unrelated', url: 'https://example/issue/219' },
];

const stale = findStaleCandidates({ prs, openIssues, now, days: 7 });
assert.strictEqual(stale.length, 2, 'two stale candidates');

const byPr = Object.fromEntries(stale.map((s) => [s.pr.number, s]));
assert.ok(byPr[191], 'PR 191 is stale');
assert.strictEqual(byPr[191].issue.number, 190);
assert.strictEqual(byPr[191].pr.ageDays, 8);
assert.ok(byPr[195], 'PR 195 is stale');
assert.strictEqual(byPr[195].issue.number, 193);
assert.strictEqual(byPr[195].pr.ageDays, 10);

assert.strictEqual(stale[0].pr.number, 195, 'sorted by age, oldest first');

// findStaleCandidates — boundary: exactly at threshold is NOT stale
const exactlyAtThreshold = findStaleCandidates({
  prs: [
    {
      number: 1,
      title: 'exactly 7 days old',
      body: 'Addresses #190',
      mergedAt: '2026-04-21T00:00:00Z',
      url: 'x',
    },
  ],
  openIssues,
  now,
  days: 7,
});
assert.strictEqual(exactlyAtThreshold.length, 0, 'threshold is exclusive');

// findStaleCandidates — allAges bypasses age filter, includes today's merges
const allAgesResult = findStaleCandidates({
  prs,
  openIssues,
  now,
  days: 7,
  allAges: true,
});
assert.strictEqual(allAgesResult.length, 3, 'allAges includes age=1 (PR 200) plus the two stale candidates');
const allAgesPrs = new Set(allAgesResult.map((s) => s.pr.number));
assert.ok(allAgesPrs.has(200), 'PR 200 (age 1) included under allAges');
assert.ok(allAgesPrs.has(191), 'PR 191 still included under allAges');
assert.ok(allAgesPrs.has(195), 'PR 195 still included under allAges');

// findStaleCandidates — no PRs
assert.deepStrictEqual(
  findStaleCandidates({ prs: [], openIssues, now, days: 7 }),
  []
);

// findStaleCandidates — unmerged PR skipped
assert.deepStrictEqual(
  findStaleCandidates({
    prs: [{ number: 9, title: 'draft', body: 'Addresses #190', mergedAt: null, url: 'x' }],
    openIssues,
    now,
    days: 7,
  }),
  []
);

// renderText
const emptyOut = renderText([], { days: 7 });
assert.match(emptyOut, /No stale "Addresses" candidates/);
assert.match(emptyOut, /older than 7 days/);

const text = renderText(stale, { days: 7 });
assert.match(text, /2 stale "Addresses" candidates/);
assert.match(text, /PR #191/);
assert.match(text, /PR #195/);
assert.match(text, /Issue #190/);
assert.match(text, /Issue #193/);
assert.match(text, /merged 2026-04-20, 8 days ago/);

const singleDay = renderText(
  [
    {
      pr: {
        number: 1,
        title: 't',
        url: 'u',
        mergedAt: '2026-04-27T00:00:00Z',
        ageDays: 1,
      },
      issue: { number: 2, title: 'i', url: 'iu' },
    },
  ],
  { days: 0 }
);
assert.match(singleDay, /1 day ago/);
assert.doesNotMatch(singleDay, /1 days ago/);

const singular = renderText([stale[0]], { days: 7 });
assert.match(singular, /1 stale "Addresses" candidate \(/);

// main — integration via dep injection
let stdout = '';
const writeSpy = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk) => {
  stdout += chunk;
  return true;
};
try {
  const exitCode = main(['--days', '7', '--json'], {
    listMergedPrs: () => prs,
    listOpenIssues: () => openIssues,
    now,
  });
  assert.strictEqual(exitCode, 0);
  const parsed = JSON.parse(stdout);
  assert.strictEqual(parsed.length, 2);
} finally {
  process.stdout.write = writeSpy;
}

process.stdout.write('All tests passed\n');
