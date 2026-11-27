import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { CHUNK_SIZE } from '../../core/worker/chunks.ts';
import type { FileCoverage } from './metric.ts';

const SHA = 'a'.repeat(40);
const INGEST = 'test-ingest-token';
const QUERY = 'test-query-token';
const TESTS = { unit: { files: 2, tests: 122, passed: 120, failed: 0, skipped: 2 }, e2e: { files: 1, tests: 16, passed: 15, failed: 0, skipped: 1 } };

function files(count: number): FileCoverage[] {
  return Array.from({ length: count }, (_, index) => ({
    file: `src/dir${index % 4}/file${index}.ts`,
    lines: [index % 5, 5],
    statements: [index % 6, 6],
    functions: [index % 2, 2],
    branches: [0, 0],
  }));
}

function snapshot(rows: FileCoverage[], overrides: Record<string, unknown> = {}) {
  return { sha: SHA, date: '2026-10-20T17:56:56+02:00', suites: { total: rows, unit: rows.slice(0, 3) }, ...overrides };
}

function post(path: string, token: string | null, body: unknown): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return exports.default.fetch(new Request(`https://worker.test${path}`, { method: 'POST', headers, body: JSON.stringify(body) }));
}

function get(path: string): Promise<Response> {
  return exports.default.fetch(new Request(`https://worker.test${path}`));
}

async function count(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM coverage_files'),
    env.DB.prepare('DELETE FROM coverage_folder_summary'),
    env.DB.prepare('DELETE FROM coverage_tests'),
    env.DB.prepare('DELETE FROM usage'),
  ]);
});

describe('POST /v1/coverage/ingest', () => {
  it('stores the files in more than one chunk, with one summary row for each folder and suite', async () => {
    // Arrange
    const body = snapshot(files(CHUNK_SIZE + 20));

    // Act
    const response = await post('/v1/coverage/ingest', INGEST, body);

    // Assert
    expect(response.status).toBe(200);
    expect(await count('coverage_files')).toBe(CHUNK_SIZE + 20 + 3);
    // total: the root, src and 4 dirN folders. unit: the root, src and 3 dirN folders.
    expect(await count('coverage_folder_summary')).toBe(6 + 5);
    const src = await env.DB.prepare("SELECT file_count, date FROM coverage_folder_summary WHERE folder = 'src' AND suite = 'unit'").first();
    expect(src).toEqual({ file_count: 3, date: '2026-10-20T15:56:56.000Z' });
  });

  it('replaces the rows of a sha that it already has, in every table', async () => {
    // Arrange
    await post('/v1/coverage/ingest', INGEST, snapshot(files(40), { tests: TESTS }));

    // Act
    const response = await post('/v1/coverage/ingest', INGEST, snapshot(files(10)));

    // Assert
    expect(response.status).toBe(200);
    expect(await count('coverage_files')).toBe(10 + 3);
    expect(await count('coverage_tests')).toBe(0);
  });

  it('keeps the rows of the other shas', async () => {
    // Arrange
    await post('/v1/coverage/ingest', INGEST, snapshot(files(5), { sha: 'b'.repeat(40) }));

    // Act
    await post('/v1/coverage/ingest', INGEST, snapshot(files(5)));

    // Assert
    expect(await count('coverage_files')).toBe(2 * (5 + 3));
  });

  it('stores the test counts of each suite', async () => {
    // Act
    const response = await post('/v1/coverage/ingest', INGEST, snapshot(files(5), { tests: TESTS }));

    // Assert
    expect(response.status).toBe(200);
    const rows = await env.DB.prepare('SELECT suite, files, tests, passed, failed, skipped, date FROM coverage_tests ORDER BY suite').all();
    expect(rows.results).toEqual([
      { suite: 'e2e', files: 1, tests: 16, passed: 15, failed: 0, skipped: 1, date: '2026-10-20T15:56:56.000Z' },
      { suite: 'unit', files: 2, tests: 122, passed: 120, failed: 0, skipped: 2, date: '2026-10-20T15:56:56.000Z' },
    ]);
  });

  it('keeps the old rows when the last chunk fails', async () => {
    // Arrange
    await post('/v1/coverage/ingest', INGEST, snapshot(files(5)));
    const broken = files(CHUNK_SIZE + 1);
    broken[broken.length - 1] = { ...broken[0] as FileCoverage, lines: [9, 3] };

    // Act
    const response = await post('/v1/coverage/ingest', INGEST, snapshot(broken));

    // Assert
    expect(response.status).toBe(422);
    expect(await count('coverage_files')).toBe(5 + 3);
  });

  it('lets a test count that does not add up fail the whole batch', async () => {
    // Arrange
    const tests = { unit: { files: 1, tests: 10, passed: 3, failed: 0, skipped: 0 } };

    // Act
    const response = await post('/v1/coverage/ingest', INGEST, snapshot(files(2), { tests }));

    // Assert
    expect(response.status).toBe(422);
    expect(await count('coverage_files')).toBe(0);
  });

  it.each([
    ['no token', null],
    ['the query token', QUERY],
  ])('refuses %s', async (_label, token) => {
    // Act
    const response = await post('/v1/coverage/ingest', token, snapshot(files(1)));

    // Assert
    expect(response.status).toBe(401);
    expect(await count('coverage_files')).toBe(0);
  });

  it('refuses a snapshot without the total suite', async () => {
    // Act
    const response = await post('/v1/coverage/ingest', INGEST, { sha: SHA, date: '2026-10-21', suites: { unit: [] } });

    // Assert
    expect(response.status).toBe(400);
  });
});

describe('POST /v1/coverage/query', () => {
  beforeEach(async () => {
    await post('/v1/coverage/ingest', INGEST, snapshot(files(20), { tests: TESTS }));
  });

  it('runs a SELECT on the coverage tables', async () => {
    // Act
    const response = await post('/v1/coverage/query', QUERY, {
      sql: "SELECT lines_total, file_count FROM coverage_folder_summary WHERE folder = ?1 AND suite = 'total'",
      params: ['.'],
    });

    // Assert
    expect(response.status).toBe(200);
    expect((await response.json<{ rows: unknown[] }>()).rows).toEqual([{ lines_total: 100, file_count: 20 }]);
  });

  it('reads the test counts', async () => {
    // Act
    const response = await post('/v1/coverage/query', QUERY, { sql: 'SELECT sum(tests) AS tests FROM coverage_tests WHERE sha = ?1', params: [SHA] });

    // Assert
    expect((await response.json<{ rows: unknown[] }>()).rows).toEqual([{ tests: 138 }]);
  });

  it.each([
    ['a table of another metric', 'SELECT * FROM complexity_functions'],
    ['the usage table', 'SELECT * FROM usage'],
    ['a DELETE', 'DELETE FROM coverage_files'],
  ])('refuses %s', async (_label, sql) => {
    // Act
    const response = await post('/v1/coverage/query', QUERY, { sql });

    // Assert
    expect(response.status).toBe(400);
  });
});

describe('GET /v1/coverage/badge', () => {
  const lines = (covered: number, total: number): FileCoverage[] => [{ file: 'src/a.ts', lines: [covered, total], statements: [0, 0], functions: [0, 0], branches: [0, 0] }];

  it('gives the total line coverage of the newest snapshot, without a token', async () => {
    // Arrange
    await post('/v1/coverage/ingest', INGEST, snapshot(lines(889, 1000), { date: '2026-10-21T00:00:00Z' }));
    await post('/v1/coverage/ingest', INGEST, snapshot(lines(50, 100), { sha: 'b'.repeat(40), date: '2026-10-19T00:00:00Z' }));

    // Act
    const response = await get('/v1/coverage/badge');

    // Assert
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ schemaVersion: 1, label: 'coverage', message: '88.9%', color: 'brightgreen', cacheSeconds: 3600 });
  });

  it('reads the suite and the folder from the query', async () => {
    // Arrange
    await post('/v1/coverage/ingest', INGEST, snapshot(lines(50, 100), { suites: { total: lines(50, 100), unit: lines(30, 100) } }));

    // Act
    const unit = await get('/v1/coverage/badge?suite=unit&folder=src');
    const missing = await get('/v1/coverage/badge?folder=docs');

    // Assert
    expect((await unit.json<{ message: string }>()).message).toBe('30.0%');
    expect((await missing.json<{ message: string }>()).message).toBe('unknown');
  });

  it('says unknown when no coverage is stored', async () => {
    // Act
    const response = await get('/v1/coverage/badge');

    // Assert
    expect(await response.json()).toEqual({ schemaVersion: 1, label: 'coverage', message: 'unknown', color: 'lightgrey', cacheSeconds: 3600 });
  });

  it('refuses a suite that is not a suite name', async () => {
    // Act
    const response = await get("/v1/coverage/badge?suite=a'b");

    // Assert
    expect(response.status).toBe(400);
  });

  it('does not run an injected folder as SQL', async () => {
    // Arrange
    await post('/v1/coverage/ingest', INGEST, snapshot(files(3)));

    // Act
    const response = await get(`/v1/coverage/badge?folder=${encodeURIComponent("' OR 1=1; DROP TABLE coverage_files; --")}`);

    // Assert
    expect(response.status).toBe(200);
    expect((await response.json<{ message: string }>()).message).toBe('unknown');
    expect(await count('coverage_files')).toBe(6);
  });
});
