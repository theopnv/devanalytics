import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ExceptionRow, SuiteRow } from './metric.ts';

const INGEST = 'test-ingest-token';
const QUERY = 'test-query-token';

const suite = (overrides: Partial<SuiteRow> = {}): SuiteRow => ({ suite: 'unit', runner: 'ubuntu-latest', tests: 10, passed: 8, failed: 1, skipped: 1, flaky: 2, ...overrides });
const exception = (overrides: Partial<ExceptionRow> = {}): ExceptionRow => ({ suite: 'unit', runner: 'ubuntu-latest', file: 'src/a.test.ts', title: 'a > breaks', status: 'failed', retries: 0, error: 'bad', ...overrides });

function snapshot(overrides: Record<string, unknown> = {}) {
  return { run_id: 100, run_attempt: 1, date: '2026-10-20T17:56:56+02:00', suites: [suite(), suite({ suite: 'e2e', runner: 'macos-latest' })], exceptions: [exception(), exception({ title: 'a > flakes', status: 'flaky', retries: 1 })], ...overrides };
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
  await env.DB.batch([env.DB.prepare('DELETE FROM tests_suites'), env.DB.prepare('DELETE FROM tests_exceptions'), env.DB.prepare('DELETE FROM usage')]);
});

describe('POST /v1/tests/ingest', () => {
  it('stores the suites and the exceptions of a run, with the date in UTC', async () => {
    // Act
    const response = await post('/v1/tests/ingest', INGEST, snapshot());

    // Assert
    expect(response.status).toBe(200);
    expect(await count('tests_suites')).toBe(2);
    expect(await count('tests_exceptions')).toBe(2);
    const row = await env.DB.prepare("SELECT flaky, date FROM tests_suites WHERE suite = 'unit'").first();
    expect(row).toEqual({ flaky: 2, date: '2026-10-20T15:56:56.000Z' });
  });

  it('replaces the rows of the same attempt, and keeps the rows of another attempt and another run', async () => {
    // Arrange
    await post('/v1/tests/ingest', INGEST, snapshot({ run_attempt: 2 }));
    await post('/v1/tests/ingest', INGEST, snapshot({ run_id: 200 }));
    await post('/v1/tests/ingest', INGEST, snapshot());

    // Act
    const response = await post('/v1/tests/ingest', INGEST, snapshot({ suites: [suite()], exceptions: [] }));

    // Assert
    expect(response.status).toBe(200);
    expect(await count('tests_suites')).toBe(1 + 2 + 2);
    expect(await count('tests_exceptions')).toBe(2 + 2);
  });

  it('writes a run with no exception and no row in tests_exceptions', async () => {
    // Act
    const response = await post('/v1/tests/ingest', INGEST, snapshot({ exceptions: [] }));

    // Assert
    expect(response.status).toBe(200);
    expect(await count('tests_exceptions')).toBe(0);
  });

  it('accepts a run that has no rows at all', async () => {
    // Act
    const response = await post('/v1/tests/ingest', INGEST, snapshot({ suites: [], exceptions: [] }));

    // Assert
    expect(response.status).toBe(200);
  });

  it.each([
    ['a count that does not add up', { suites: [suite({ tests: 99 })], exceptions: [] }],
    ['more flaky tests than passed tests', { suites: [suite({ flaky: 9 })], exceptions: [] }],
    ['a run id of 0', { run_id: 0 }],
  ])('lets a table constraint refuse %s', async (_label, overrides) => {
    // Act
    const response = await post('/v1/tests/ingest', INGEST, snapshot(overrides));

    // Assert
    expect(response.status).toBe(422);
    expect(await count('tests_suites')).toBe(0);
  });

  it('keeps the old rows when the new ingest fails', async () => {
    // Arrange
    await post('/v1/tests/ingest', INGEST, snapshot());

    // Act
    const response = await post('/v1/tests/ingest', INGEST, snapshot({ suites: [suite({ tests: 99 })] }));

    // Assert
    expect(response.status).toBe(422);
    expect(await count('tests_suites')).toBe(2);
  });

  it.each([
    ['no token', null],
    ['the query token', QUERY],
  ])('refuses %s', async (_label, token) => {
    // Act
    const response = await post('/v1/tests/ingest', token, snapshot());

    // Assert
    expect(response.status).toBe(401);
    expect(await count('tests_suites')).toBe(0);
  });

  it('refuses a body with a bad shape', async () => {
    // Act
    const response = await post('/v1/tests/ingest', INGEST, { run_id: 'x' });

    // Assert
    expect(response.status).toBe(400);
  });
});

describe('POST /v1/tests/query', () => {
  it('reads the stored suites with the query token, and refuses the tables of other metrics', async () => {
    // Arrange
    await post('/v1/tests/ingest', INGEST, snapshot());

    // Act
    const ok = await post('/v1/tests/query', QUERY, { sql: 'SELECT sum(tests) AS tests FROM tests_suites WHERE run_id = ?1', params: [100] });
    const other = await post('/v1/tests/query', QUERY, { sql: 'SELECT * FROM coverage_tests' });

    // Assert
    expect((await ok.json<{ rows: unknown[] }>()).rows).toEqual([{ tests: 20 }]);
    expect(other.status).toBe(400);
  });
});
