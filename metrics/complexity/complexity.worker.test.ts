import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { CHUNK_SIZE } from '../../core/worker/chunks.ts';
import type { FunctionRow } from './metric.ts';

const SHA = 'a'.repeat(40);
const INGEST = 'test-ingest-token';
const QUERY = 'test-query-token';

function fn(index: number): FunctionRow {
  return {
    file: `src/main/dir${index % 7}/file${index % 13}.ts`,
    qualified_name: `fn${index}`,
    line: index + 1,
    cyclomatic: 1 + (index % 12),
    cognitive: index % 20,
    is_test: index % 5 === 0,
  };
}

function functions(count: number): FunctionRow[] {
  return Array.from({ length: count }, (_, index) => fn(index));
}

function snapshot(rows: FunctionRow[], overrides: Record<string, unknown> = {}) {
  return { sha: SHA, date: '2026-10-20T17:56:56+02:00', cognitive_limit: 15, cyclomatic_limit: 10, functions: rows, ...overrides };
}

function post(path: string, token: string | null, body: unknown): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return exports.default.fetch(new Request(`https://worker.test${path}`, { method: 'POST', headers, body: JSON.stringify(body) }));
}

async function count(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM complexity_functions'),
    env.DB.prepare('DELETE FROM complexity_folder_summary'),
    env.DB.prepare('DELETE FROM usage'),
  ]);
});

describe('POST /v1/complexity/ingest', () => {
  it('stores the snapshot in more than one chunk, with one summary row for each folder', async () => {
    // Arrange
    const body = snapshot(functions(CHUNK_SIZE * 2 + 7));

    // Act
    const response = await post('/v1/complexity/ingest', INGEST, body);

    // Assert
    expect(response.status).toBe(200);
    expect(await count('complexity_functions')).toBe(CHUNK_SIZE * 2 + 7);
    // The root, src, src/main and 7 dirN folders, each for test and non-test functions.
    expect(await count('complexity_folder_summary')).toBe(20);
    const src = await env.DB.prepare("SELECT function_count, date FROM complexity_folder_summary WHERE folder = 'src' AND is_test = 0").first();
    expect(src).toEqual({ function_count: body.functions.filter((fn) => !fn.is_test).length, date: '2026-10-20T15:56:56.000Z' });
  });

  it('counts the functions above the limits of the snapshot', async () => {
    // Arrange
    const rows = [
      { file: 'src/a.ts', qualified_name: 'a', line: 1, cyclomatic: 5, cognitive: 5, is_test: false },
      { file: 'src/b.ts', qualified_name: 'b', line: 1, cyclomatic: 2, cognitive: 2, is_test: false },
    ];

    // Act
    await post('/v1/complexity/ingest', INGEST, snapshot(rows, { cognitive_limit: 3, cyclomatic_limit: 20 }));

    // Assert
    const root = await env.DB.prepare("SELECT cognitive_above, cyclomatic_above, above_limits FROM complexity_folder_summary WHERE folder = '.'").first();
    expect(root).toEqual({ cognitive_above: 1, cyclomatic_above: 0, above_limits: 1 });
  });

  it('replaces the rows of a sha that it already has', async () => {
    // Arrange
    await post('/v1/complexity/ingest', INGEST, snapshot(functions(40)));

    // Act
    const response = await post('/v1/complexity/ingest', INGEST, snapshot(functions(10)));

    // Assert
    expect(response.status).toBe(200);
    expect(await count('complexity_functions')).toBe(10);
  });

  it('keeps the old rows when the last chunk fails', async () => {
    // Arrange
    await post('/v1/complexity/ingest', INGEST, snapshot(functions(10), { date: '2026-10-20T00:00:00Z' }));
    const rows = functions(CHUNK_SIZE * 2 + 1);
    rows[rows.length - 1] = { ...fn(0), line: 9999 };

    // Act
    const response = await post('/v1/complexity/ingest', INGEST, snapshot(rows, { date: '2026-10-21T00:00:00Z' }));

    // Assert
    expect(response.status).toBe(422);
    expect(await count('complexity_functions')).toBe(10);
    expect(await count("complexity_folder_summary WHERE date = '2026-10-20T00:00:00.000Z'")).toBe(await count('complexity_folder_summary'));
  });

  it('lets a table constraint fail the whole batch', async () => {
    // Arrange
    const rows = functions(CHUNK_SIZE + 1);
    rows[rows.length - 1] = { ...fn(rows.length - 1), cyclomatic: 0 };

    // Act
    const response = await post('/v1/complexity/ingest', INGEST, snapshot(rows));

    // Assert
    expect(response.status).toBe(422);
    expect(await count('complexity_functions')).toBe(0);
  });

  it.each([
    ['no token', null],
    ['the query token', QUERY],
    ['a wrong token', 'nope'],
  ])('refuses %s', async (_label, token) => {
    // Act
    const response = await post('/v1/complexity/ingest', token, snapshot(functions(1)));

    // Assert
    expect(response.status).toBe(401);
    expect(await count('complexity_functions')).toBe(0);
  });

  it('refuses a snapshot with a bad shape', async () => {
    // Act
    const response = await post('/v1/complexity/ingest', INGEST, { sha: 'main', functions: [] });

    // Assert
    expect(response.status).toBe(400);
  });
});

describe('POST /v1/complexity/query', () => {
  beforeEach(async () => {
    await post('/v1/complexity/ingest', INGEST, snapshot(functions(30)));
  });

  it('answers a SELECT on the tables of the metric', async () => {
    // Act
    const response = await post('/v1/complexity/query', QUERY, {
      sql: 'SELECT folder, function_count FROM complexity_folder_summary WHERE folder = ?1 AND is_test = 0;',
      params: ['src'],
    });

    // Assert
    expect(response.status).toBe(200);
    expect((await response.json<{ rows: unknown[] }>()).rows).toEqual([{ folder: 'src', function_count: 24 }]);
  });

  it.each([
    ['a DELETE', 'DELETE FROM complexity_functions'],
    ['a second statement', 'SELECT 1; DELETE FROM complexity_functions'],
    ['a table of another metric', 'SELECT * FROM example_items'],
    ['the usage table', 'SELECT * FROM usage'],
  ])('refuses %s', async (_label, sql) => {
    // Act
    const response = await post('/v1/complexity/query', QUERY, { sql });

    // Assert
    expect(response.status).toBe(400);
    expect(await count('complexity_functions')).toBe(30);
  });
});
