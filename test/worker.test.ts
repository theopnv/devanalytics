import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../core/contract.ts';
import type { Metric, RunSnapshot, Store, WorkerEntry } from '../core/contract.ts';
import { CHUNK_SIZE } from '../core/worker/chunks.ts';
import { MAX_QUERY_ROWS } from '../core/worker/query.ts';
import { createWorker } from '../core/worker/router.ts';
import { workerRegistry } from '../src/generated/worker-registry.ts';

const SHA = 'a'.repeat(40);
const INGEST = 'test-ingest-token';
const QUERY = 'test-query-token';
const DATE = '2026-01-15T10:00:00.000Z';

interface RunsSnapshot extends RunSnapshot {
  names: string[];
}

const runsMetric: Metric<RunsSnapshot> = {
  name: 'runs',
  key: 'run',
  parse(body) {
    const { run_id, run_attempt, date, names } = body as Partial<RunsSnapshot>;
    if (typeof run_id !== 'number' || typeof run_attempt !== 'number' || typeof date !== 'string' || !Array.isArray(names)) {
      throw new ValidationError('bad run snapshot');
    }
    return { run_id, run_attempt, date, names };
  },
};

const runsStore: Store<RunsSnapshot> = {
  tables: ['runs_items'],
  toRows: (snapshot) => [{
    table: 'runs_items',
    insert: 'INSERT INTO runs_items (run_id, run_attempt, date, name) SELECT ?1, ?2, ?3, value ->> 0 FROM json_each(?4)',
    rows: snapshot.names.map((name) => [name]),
  }],
  async badge(_db, params) {
    const label = params.get('label');
    if (!label) {
      throw new ValidationError('label is required');
    }
    return { schemaVersion: 1, label, message: 'ok', color: 'green' };
  },
};

const worker = createWorker([...workerRegistry, { metric: runsMetric, store: runsStore } as unknown as WorkerEntry]);

/** The generated `Env` types the limit as the literal from `wrangler.jsonc`. */
function withLimit(limit: string): Env {
  return { ...env, DAILY_WRITE_LIMIT: limit } as unknown as Env;
}

function request(path: string, { method = 'POST', token, body, headers = {} }: { method?: string; token?: string | null; body?: unknown; headers?: Record<string, string> } = {}): Request {
  const all: Record<string, string> = { 'Content-Type': 'application/json', ...headers };
  if (token) {
    all['Authorization'] = `Bearer ${token}`;
  }
  return new Request(`https://worker.test${path}`, { method, headers: all, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

function call(path: string, options?: Parameters<typeof request>[1], limit = '100000'): Promise<Response> {
  return worker.fetch(request(path, options), withLimit(limit));
}

function items(count: number): { name: string; value: number }[] {
  return Array.from({ length: count }, (_, index) => ({ name: `item${index}`, value: index }));
}

const exampleSnapshot = (count: number, sha = SHA) => ({ sha, date: DATE, items: items(count) });

async function count(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

async function usedToday(): Promise<number> {
  const response = await call('/v1/usage', { method: 'GET', token: QUERY });
  return (await response.json<{ rowsWritten: number }>()).rowsWritten;
}

beforeAll(async () => {
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS runs_items (run_id INTEGER NOT NULL, run_attempt INTEGER NOT NULL, date TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (run_id, run_attempt, name)) WITHOUT ROWID',
  ).run();
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM example_items'),
    env.DB.prepare('DELETE FROM runs_items'),
    env.DB.prepare('DELETE FROM usage'),
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /v1/:metric/ingest', () => {
  it('stores a snapshot in more than one chunk', async () => {
    // Arrange
    const snapshot = exampleSnapshot(CHUNK_SIZE + 20);

    // Act
    const response = await call('/v1/example/ingest', { token: INGEST, body: snapshot });

    // Assert
    expect(response.status).toBe(200);
    expect(await count('example_items')).toBe(CHUNK_SIZE + 20);
  });

  it('works through the Worker entry point', async () => {
    // Act
    const response = await exports.default.fetch(request('/v1/example/ingest', { token: INGEST, body: exampleSnapshot(2) }));

    // Assert
    expect(response.status).toBe(200);
    expect(await count('example_items')).toBe(2);
  });

  it('replaces the rows of a sha that it already has', async () => {
    // Arrange
    await call('/v1/example/ingest', { token: INGEST, body: exampleSnapshot(40) });

    // Act
    const response = await call('/v1/example/ingest', { token: INGEST, body: exampleSnapshot(10) });

    // Assert
    expect(response.status).toBe(200);
    expect(await count('example_items')).toBe(10);
  });

  it('keeps the rows of the other shas', async () => {
    // Arrange
    await call('/v1/example/ingest', { token: INGEST, body: exampleSnapshot(5, 'b'.repeat(40)) });

    // Act
    await call('/v1/example/ingest', { token: INGEST, body: exampleSnapshot(5) });

    // Assert
    expect(await count('example_items')).toBe(10);
  });

  it('accepts a 64-character sha', async () => {
    // Act
    const response = await call('/v1/example/ingest', { token: INGEST, body: exampleSnapshot(1, 'c'.repeat(64)) });

    // Assert
    expect(response.status).toBe(200);
  });

  it('keeps the old rows when an insert fails', async () => {
    // Arrange
    await call('/v1/example/ingest', { token: INGEST, body: exampleSnapshot(10) });
    const duplicate = { sha: SHA, date: DATE, items: [...items(CHUNK_SIZE + 1), { name: 'item0', value: 1 }] };

    // Act
    const response = await call('/v1/example/ingest', { token: INGEST, body: duplicate });

    // Assert
    expect(response.status).toBe(422);
    expect(await count('example_items')).toBe(10);
    expect(await usedToday()).toBe(11);
  });

  it('replaces a run by its run id and attempt', async () => {
    // Arrange
    const run = (run_attempt: number, names: string[]) => ({ run_id: 7, run_attempt, date: DATE, names });
    await call('/v1/runs/ingest', { token: INGEST, body: run(1, ['a', 'b', 'c']) });
    await call('/v1/runs/ingest', { token: INGEST, body: run(2, ['a']) });

    // Act
    const response = await call('/v1/runs/ingest', { token: INGEST, body: run(1, ['x']) });

    // Assert
    expect(response.status).toBe(200);
    const rows = await env.DB.prepare('SELECT run_attempt, name FROM runs_items ORDER BY run_attempt, name').all();
    expect(rows.results).toEqual([{ run_attempt: 1, name: 'x' }, { run_attempt: 2, name: 'a' }]);
  });

  it.each([
    ['no token', null],
    ['the query token', QUERY],
    ['a wrong token', 'nope'],
  ])('refuses %s', async (_label, token) => {
    // Act
    const response = await call('/v1/example/ingest', { token, body: exampleSnapshot(1) });

    // Assert
    expect(response.status).toBe(401);
    expect(await count('example_items')).toBe(0);
  });

  it.each([
    ['a short sha', { ...exampleSnapshot(1), sha: 'main' }],
    ['a snapshot of another metric', { run_id: 1, run_attempt: 1, date: DATE, names: [] }],
  ])('answers 400 for %s', async (_label, body) => {
    // Act
    const response = await call('/v1/example/ingest', { token: INGEST, body });

    // Assert
    expect(response.status).toBe(400);
  });

  it('answers 400 when the body is not JSON', async () => {
    // Act
    const response = await worker.fetch(
      new Request('https://worker.test/v1/example/ingest', { method: 'POST', headers: { Authorization: `Bearer ${INGEST}` }, body: 'not json' }),
      env,
    );

    // Assert
    expect(response.status).toBe(400);
  });
});

describe('routing', () => {
  it.each([
    ['an unknown path', '/nope'],
    ['an unknown metric', '/v1/nope/ingest'],
    ['an unknown action', '/v1/example/nope'],
    ['the old path without the version', '/example/ingest'],
    ['a badge for a metric without one', '/v1/example/badge'],
  ])('answers 404 for %s', async (_label, path) => {
    // Act
    const response = await call(path, { token: QUERY, body: {} });

    // Assert
    expect(response.status).toBe(404);
  });

  it.each([
    ['GET on ingest', '/v1/example/ingest', 'GET'],
    ['GET on query', '/v1/example/query', 'GET'],
    ['POST on usage', '/v1/usage', 'POST'],
    ['POST on badge', '/v1/runs/badge', 'POST'],
  ])('answers 405 for %s', async (_label, path, method) => {
    // Act
    const response = await call(path, { method, token: QUERY, ...(method === 'POST' ? { body: {} } : {}) });

    // Assert
    expect(response.status).toBe(405);
  });
});

describe('POST /v1/:metric/query', () => {
  beforeEach(async () => {
    await call('/v1/example/ingest', { token: INGEST, body: exampleSnapshot(30) });
    await call('/v1/runs/ingest', { token: INGEST, body: { run_id: 1, run_attempt: 1, date: DATE, names: ['a'] } });
  });

  it('runs a SELECT with params and returns the rows and rows_read', async () => {
    // Act
    const response = await call('/v1/example/query', {
      token: QUERY,
      body: { sql: 'SELECT name, value FROM example_items WHERE sha = ?1 AND value = ?2;', params: [SHA, 3] },
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json<{ rows: unknown[]; truncated: boolean; meta: { rows_read: number } }>();
    expect(body.rows).toEqual([{ name: 'item3', value: 3 }]);
    expect(body.truncated).toBe(false);
    expect(body.meta.rows_read).toBeGreaterThan(0);
  });

  it('runs a WITH query', async () => {
    // Act
    const response = await call('/v1/example/query', { token: QUERY, body: { sql: 'WITH t AS (SELECT count(*) AS n FROM example_items) SELECT n FROM t' } });

    // Assert
    expect(await response.json()).toMatchObject({ rows: [{ n: 30 }] });
  });

  it.each([
    ['a DELETE', 'DELETE FROM example_items'],
    ['a second statement', 'SELECT 1; DELETE FROM example_items'],
    ['a DELETE behind a WITH', 'WITH t AS (SELECT 1) DELETE FROM example_items'],
    ['a statement that closes the wrapper', 'SELECT 1) ; DROP TABLE example_items; SELECT * FROM (SELECT 1'],
    ['a PRAGMA', 'PRAGMA table_list'],
  ])('refuses %s', async (_label, sql) => {
    // Act
    const response = await call('/v1/example/query', { token: QUERY, body: { sql } });

    // Assert
    expect([400, 422]).toContain(response.status);
    expect(await count('example_items')).toBe(30);
  });

  it.each([
    ['the schema table', 'SELECT name FROM sqlite_master'],
    ['the migrations table', 'SELECT * FROM d1_migrations'],
    ['a Cloudflare table', 'SELECT * FROM _cf_KV'],
    ['the usage table', 'SELECT * FROM usage'],
    ['the usage table in quotes and capitals', 'SELECT * FROM "USAGE"'],
    ['a table of another metric', 'SELECT * FROM runs_items'],
    ['a table of another metric in quotes', 'SELECT * FROM "runs_items"'],
    ['a CTE that has the name of a table of another metric', 'WITH runs_items AS (SELECT 1) SELECT * FROM runs_items'],
    ['a table-valued PRAGMA', 'SELECT * FROM pragma_table_list'],
  ])('refuses %s with 400', async (_label, sql) => {
    // Act
    const response = await call('/v1/example/query', { token: QUERY, body: { sql } });

    // Assert
    expect(response.status).toBe(400);
  });

  it('lets the other metric read its own table', async () => {
    // Act
    const response = await call('/v1/runs/query', { token: QUERY, body: { sql: 'SELECT name FROM runs_items' } });

    // Assert
    expect(await response.json()).toMatchObject({ rows: [{ name: 'a' }] });
  });

  it.each([
    ['no token', null],
    ['the ingest token', INGEST],
  ])('refuses %s', async (_label, token) => {
    // Act
    const response = await call('/v1/example/query', { token, body: { sql: 'SELECT 1' } });

    // Assert
    expect(response.status).toBe(401);
  });

  it(`returns at most ${MAX_QUERY_ROWS} rows and says so`, async () => {
    // Act
    const response = await call('/v1/example/query', {
      token: QUERY,
      body: { sql: `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${MAX_QUERY_ROWS + 5}) SELECT i FROM n` },
    });

    // Assert
    const body = await response.json<{ rows: unknown[]; truncated: boolean }>();
    expect(body.rows).toHaveLength(MAX_QUERY_ROWS);
    expect(body.truncated).toBe(true);
  });
});

describe('GET /v1/:metric/badge', () => {
  it('answers without a token and sets the cache headers', async () => {
    // Act
    const response = await call('/v1/runs/badge?label=coverage', { method: 'GET' });

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
    expect(await response.json()).toEqual({ schemaVersion: 1, label: 'coverage', message: 'ok', color: 'green', cacheSeconds: 3600 });
  });

  it('answers 400 when the store refuses a parameter', async () => {
    // Act
    const response = await call('/v1/runs/badge', { method: 'GET' });

    // Assert
    expect(response.status).toBe(400);
  });
});

describe('write budget', () => {
  const ingestWith = (count: number, { limit = '100', backfill = false, sha = SHA } = {}) => call(
    '/v1/example/ingest',
    { token: INGEST, body: exampleSnapshot(count, sha), headers: backfill ? { 'X-Devanalytics-Mode': 'backfill' } : {} },
    limit,
  );

  it('counts the inserted rows, the deleted rows and the usage row', async () => {
    // Act
    const first = await ingestWith(5);
    const second = await ingestWith(3);

    // Assert
    expect(await first.json()).toEqual({ rowsWritten: 5 + 1 });
    expect(await second.json()).toEqual({ rowsWritten: 5 + 3 + 1 });
    expect(await usedToday()).toBe(6 + 9);
  });

  it('reports the day and the two limits', async () => {
    // Arrange
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-27T22:30:00Z'));
    await ingestWith(4);

    // Act
    const response = await call('/v1/usage', { method: 'GET', token: QUERY }, '100');

    // Assert
    expect(await response.json()).toEqual({ day: '2026-11-27', rowsWritten: 5, limit: 95, backfillLimit: 70 });
  });

  it('starts a new count on the next UTC day', async () => {
    // Arrange
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-27T23:59:00Z'));
    await ingestWith(4);

    // Act
    vi.setSystemTime(new Date('2026-11-28T00:00:01Z'));
    const response = await call('/v1/usage', { method: 'GET', token: QUERY });

    // Assert
    expect(await response.json()).toMatchObject({ day: '2026-11-28', rowsWritten: 0 });
  });

  it('refuses an ingest above 95% of the limit, with the seconds until 00:00 UTC', async () => {
    // Arrange
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-27T22:30:00Z'));
    await ingestWith(89);

    // Act
    const response = await ingestWith(10, { sha: 'b'.repeat(40) });

    // Assert
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('5400');
    expect(await response.json()).toMatchObject({ rowsWritten: 90, cost: 11, limit: 95 });
    expect(await count('example_items')).toBe(89);
    expect(await usedToday()).toBe(90);
  });

  it('accepts an ingest that ends at 95% of the limit', async () => {
    // Arrange
    await ingestWith(89);

    // Act
    const response = await ingestWith(4, { sha: 'b'.repeat(40) });

    // Assert
    expect(response.status).toBe(200);
    expect(await usedToday()).toBe(95);
  });

  it('refuses a backfill ingest above 70% of the limit and accepts a normal ingest for the same rows', async () => {
    // Arrange
    await ingestWith(65);

    // Act
    const backfill = await ingestWith(5, { backfill: true, sha: 'b'.repeat(40) });
    const normal = await ingestWith(5, { sha: 'b'.repeat(40) });

    // Assert
    expect(backfill.status).toBe(429);
    expect(await backfill.json()).toMatchObject({ rowsWritten: 66, cost: 6, limit: 70 });
    expect(normal.status).toBe(200);
  });

  it('counts the rows that the replace deletes', async () => {
    // Arrange
    await ingestWith(50);

    // Act
    const response = await ingestWith(10);

    // Assert
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ rowsWritten: 51, cost: 50 + 10 + 1 });
    expect(await count('example_items')).toBe(50);
  });

  it('says that a snapshot is too large for any day', async () => {
    // Act
    const response = await ingestWith(100, { backfill: true });

    // Assert
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('the limit for one day is 70 rows'), cost: 101 });
  });

  it('uses 100000 when the limit is not a number', async () => {
    // Act
    const response = await call('/v1/usage', { method: 'GET', token: QUERY }, 'many');

    // Assert
    expect(await response.json()).toMatchObject({ limit: 95_000, backfillLimit: 70_000 });
  });

  it.each([
    ['no token', null],
    ['the ingest token', INGEST],
  ])('refuses /v1/usage with %s', async (_label, token) => {
    // Act
    const response = await call('/v1/usage', { method: 'GET', token });

    // Assert
    expect(response.status).toBe(401);
  });
});
