#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');

const registry = require('./dispatch-registry.cjs');
const {
  appendWorkerEvent,
  readEvents,
  reduceWorkers,
  readActiveWorkers,
  resetAndSeed,
  compactRegistry,
  activeJsonlPath
} = registry;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error('       ' + (e.stack || e.message).replace(/\n/g, '\n       '));
  }
}

function withTempProject(fn) {
  const raw = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-test-'));
  const dir = fs.realpathSync(raw);
  fs.mkdirSync(path.join(dir, '.claude/dispatch'), { recursive: true });
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function mkWorker(sessionId, overrides = {}) {
  return {
    sessionId,
    pid: 12345,
    target: { type: 'issue', value: '42' },
    model: 'opus',
    repo: null,
    cwd: '/tmp/cwd',
    worktreePath: `/tmp/wt/${sessionId}`,
    branch: `dispatch-${sessionId}`,
    startedAt: '2026-04-23T00:00:00.000Z',
    outputFile: `/tmp/${sessionId}.jsonl`,
    ...overrides
  };
}

// Forked entry point for the concurrency test.
if (process.argv.includes('--concurrency-worker')) {
  const payload = JSON.parse(process.argv[process.argv.indexOf('--concurrency-worker') + 1]);
  const { projectRoot, workerId, count } = payload;
  for (let i = 0; i < count; i++) {
    appendWorkerEvent(projectRoot, {
      type: 'worker_spawned',
      ...mkWorker(`${workerId}-${i}`, { pid: 1000 * workerId + i })
    });
  }
  process.exit(0);
}

console.log('append / read / reduce');

test('append then read returns the worker with all fields', () => {
  withTempProject(dir => {
    appendWorkerEvent(dir, { type: 'worker_spawned', ...mkWorker('a') });
    const { workers } = readActiveWorkers(dir);
    assert.strictEqual(workers.length, 1);
    assert.strictEqual(workers[0].sessionId, 'a');
    assert.strictEqual(workers[0].worktreePath, '/tmp/wt/a');
    assert.strictEqual(workers[0].branch, 'dispatch-a');
    assert.deepStrictEqual(workers[0].target, { type: 'issue', value: '42' });
  });
});

test('missing sessionId throws', () => {
  withTempProject(dir => {
    assert.throws(() => appendWorkerEvent(dir, { type: 'worker_spawned' }));
  });
});

test('missing type throws', () => {
  withTempProject(dir => {
    assert.throws(() => appendWorkerEvent(dir, { sessionId: 'x' }));
  });
});

test('readActiveWorkers returns empty when file missing', () => {
  withTempProject(dir => {
    assert.deepStrictEqual(readActiveWorkers(dir), { workers: [] });
  });
});

test('malformed lines are skipped', () => {
  withTempProject(dir => {
    fs.writeFileSync(activeJsonlPath(dir),
      'not valid\n' +
      JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', type: 'worker_spawned', ...mkWorker('good') }) + '\n');
    const { workers } = readActiveWorkers(dir);
    assert.strictEqual(workers.length, 1);
    assert.strictEqual(workers[0].sessionId, 'good');
  });
});

console.log('\nterminal events');

test('worker_killed drops worker from active', () => {
  withTempProject(dir => {
    appendWorkerEvent(dir, { type: 'worker_spawned', ...mkWorker('a') });
    appendWorkerEvent(dir, { type: 'worker_killed', sessionId: 'a', pid: 1, killedAt: '2026-04-23T01:00:00.000Z' });
    assert.strictEqual(readActiveWorkers(dir).workers.length, 0);
  });
});

test('worker_completed drops worker', () => {
  withTempProject(dir => {
    appendWorkerEvent(dir, { type: 'worker_spawned', ...mkWorker('b') });
    appendWorkerEvent(dir, { type: 'worker_completed', sessionId: 'b', completedAt: '2026-04-23T02:00:00.000Z' });
    assert.strictEqual(readActiveWorkers(dir).workers.length, 0);
  });
});

test('worker_orphaned drops worker', () => {
  withTempProject(dir => {
    appendWorkerEvent(dir, { type: 'worker_spawned', ...mkWorker('c') });
    appendWorkerEvent(dir, { type: 'worker_orphaned', sessionId: 'c', orphanedAt: '2026-04-23T03:00:00.000Z', reason: 'test' });
    assert.strictEqual(readActiveWorkers(dir).workers.length, 0);
  });
});

test('second terminal event does not resurrect the worker', () => {
  withTempProject(dir => {
    appendWorkerEvent(dir, { type: 'worker_spawned', ...mkWorker('d') });
    appendWorkerEvent(dir, { type: 'worker_killed', sessionId: 'd', pid: 1, killedAt: '2026-04-23T01:00:00.000Z' });
    appendWorkerEvent(dir, { type: 'worker_completed', sessionId: 'd', completedAt: '2026-04-23T02:00:00.000Z' });
    assert.strictEqual(readActiveWorkers(dir).workers.length, 0);
  });
});

test('terminal before spawn is ignored (no resurrection of a never-spawned sid)', () => {
  withTempProject(dir => {
    appendWorkerEvent(dir, { type: 'worker_completed', sessionId: 'ghost', completedAt: '2026-04-23T02:00:00.000Z' });
    assert.strictEqual(readActiveWorkers(dir).workers.length, 0);
  });
});

test('two active plus one terminated yields the right history split', () => {
  withTempProject(dir => {
    appendWorkerEvent(dir, { type: 'worker_spawned', ...mkWorker('a') });
    appendWorkerEvent(dir, { type: 'worker_spawned', ...mkWorker('b') });
    appendWorkerEvent(dir, { type: 'worker_spawned', ...mkWorker('c') });
    appendWorkerEvent(dir, { type: 'worker_completed', sessionId: 'b', completedAt: '2026-04-23T01:00:00.000Z' });
    const { active, terminated } = reduceWorkers(readEvents(dir));
    assert.strictEqual(active.length, 2);
    assert.strictEqual(terminated.length, 1);
    assert.strictEqual(terminated[0].sessionId, 'b');
  });
});

console.log('\nresetAndSeed (test helper)');

test('resetAndSeed rewrites the registry from a worker list', () => {
  withTempProject(dir => {
    resetAndSeed(dir, [mkWorker('a'), mkWorker('b')]);
    const { workers } = readActiveWorkers(dir);
    assert.deepStrictEqual(workers.map(w => w.sessionId).sort(), ['a', 'b']);
  });
});

test('resetAndSeed with empty list truncates', () => {
  withTempProject(dir => {
    resetAndSeed(dir, [mkWorker('a')]);
    resetAndSeed(dir, []);
    assert.strictEqual(readActiveWorkers(dir).workers.length, 0);
  });
});

console.log('\nmigration from legacy active.json');

test('first read drains legacy active.json and renames it', () => {
  withTempProject(dir => {
    fs.writeFileSync(path.join(dir, '.claude/dispatch/active.json'),
      JSON.stringify({ workers: [mkWorker('legacyA'), mkWorker('legacyB')] }));
    const { workers } = readActiveWorkers(dir);
    assert.strictEqual(workers.length, 2);
    assert.ok(fs.existsSync(path.join(dir, '.claude/dispatch/active.jsonl')));
    assert.ok(fs.existsSync(path.join(dir, '.claude/dispatch/active.json.migrated')));
    assert.ok(!fs.existsSync(path.join(dir, '.claude/dispatch/active.json')));
  });
});

test('migration preserves worktreePath and branch', () => {
  withTempProject(dir => {
    fs.writeFileSync(path.join(dir, '.claude/dispatch/active.json'),
      JSON.stringify({ workers: [mkWorker('x', { worktreePath: '/tmp/wt/x', branch: 'dispatch-x' })] }));
    const { workers } = readActiveWorkers(dir);
    assert.strictEqual(workers[0].worktreePath, '/tmp/wt/x');
    assert.strictEqual(workers[0].branch, 'dispatch-x');
  });
});

test('migration preserves startedAt as the event timestamp', () => {
  withTempProject(dir => {
    fs.writeFileSync(path.join(dir, '.claude/dispatch/active.json'),
      JSON.stringify({ workers: [mkWorker('x', { startedAt: '2026-04-01T00:00:00.000Z' })] }));
    const events = readEvents(dir);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].timestamp, '2026-04-01T00:00:00.000Z');
  });
});

test('migration tolerates a corrupt legacy file', () => {
  withTempProject(dir => {
    fs.writeFileSync(path.join(dir, '.claude/dispatch/active.json'), 'not valid');
    const { workers } = readActiveWorkers(dir);
    assert.strictEqual(workers.length, 0);
    assert.ok(fs.existsSync(path.join(dir, '.claude/dispatch/active.jsonl')));
  });
});

test('migration does not re-run when active.jsonl already exists', () => {
  withTempProject(dir => {
    fs.writeFileSync(path.join(dir, '.claude/dispatch/active.jsonl'), '');
    fs.writeFileSync(path.join(dir, '.claude/dispatch/active.json'),
      JSON.stringify({ workers: [mkWorker('shouldSkip')] }));
    assert.strictEqual(readActiveWorkers(dir).workers.length, 0);
    assert.ok(fs.existsSync(path.join(dir, '.claude/dispatch/active.json')));
  });
});

console.log('\ncompaction');

test('compactRegistry drops old terminated, keeps active', () => {
  withTempProject(dir => {
    appendWorkerEvent(dir, { type: 'worker_spawned', ...mkWorker('active') });
    appendWorkerEvent(dir, { type: 'worker_spawned', ...mkWorker('oldDone') });
    appendWorkerEvent(dir, { type: 'worker_completed', sessionId: 'oldDone',
      timestamp: '2026-04-01T00:00:00.000Z', completedAt: '2026-04-01T00:00:00.000Z' });
    const res = compactRegistry(dir, { nowMs: Date.parse('2026-04-23T00:00:00.000Z') });
    assert.ok(res.compacted);
    assert.strictEqual(res.activeCount, 1);
    assert.strictEqual(res.terminatedDropped, 1);
    const { workers } = readActiveWorkers(dir);
    assert.strictEqual(workers.length, 1);
    assert.strictEqual(workers[0].sessionId, 'active');
    assert.strictEqual(workers[0].worktreePath, '/tmp/wt/active');
  });
});

test('compactRegistry keeps recent terminations within the window', () => {
  withTempProject(dir => {
    appendWorkerEvent(dir, { type: 'worker_spawned', ...mkWorker('recent') });
    appendWorkerEvent(dir, { type: 'worker_completed', sessionId: 'recent',
      timestamp: '2026-04-22T23:00:00.000Z', completedAt: '2026-04-22T23:00:00.000Z' });
    const res = compactRegistry(dir, { nowMs: Date.parse('2026-04-23T00:00:00.000Z') });
    assert.strictEqual(res.terminatedKept, 1);
    assert.strictEqual(res.terminatedDropped, 0);
  });
});

test('compactRegistry is a no-op when the log is missing', () => {
  withTempProject(dir => {
    const res = compactRegistry(dir);
    assert.strictEqual(res.compacted, false);
    assert.strictEqual(res.reason, 'no-log');
  });
});

test('a fresh compaction lock blocks a concurrent compaction', () => {
  withTempProject(dir => {
    appendWorkerEvent(dir, { type: 'worker_spawned', ...mkWorker('w') });
    fs.writeFileSync(path.join(dir, '.claude/dispatch/active.jsonl.compacting'), '');
    const res = compactRegistry(dir, { nowMs: Date.now() });
    assert.strictEqual(res.compacted, false);
    assert.strictEqual(res.reason, 'locked');
  });
});

console.log('\nconcurrency (forked appenders)');

async function concurrencyTest() {
  await new Promise((resolve) => {
    withTempProject(async (dir) => {
      const N = 8, COUNT = 50;
      const forks = [];
      for (let id = 0; id < N; id++) {
        forks.push(new Promise((res, rej) => {
          const c = fork(__filename,
            ['--concurrency-worker', JSON.stringify({ projectRoot: dir, workerId: id, count: COUNT })],
            { stdio: 'ignore' });
          c.on('exit', code => code === 0 ? res() : rej(new Error(`worker ${id} exited ${code}`)));
          c.on('error', rej);
        }));
      }
      try {
        await Promise.all(forks);
        const { workers } = readActiveWorkers(dir);
        assert.strictEqual(workers.length, N * COUNT, `lost events: got ${workers.length}/${N * COUNT}`);
        assert.strictEqual(new Set(workers.map(w => w.sessionId)).size, N * COUNT, 'duplicate/missing sessionIds');
        passed++; console.log('  ok  N forked appenders lose no events');
      } catch (e) {
        failed++; console.error('  FAIL N forked appenders lose no events\n       ' + e.message);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        resolve();
      }
    });
  });
}

concurrencyTest().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
});
