import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CiJob } from './metric.ts';
import snapshot from './fixtures/snapshot.json' with { type: 'json' };

const INGEST = 'test-ingest-token';
const QUERY = 'test-query-token';

function jobs(count: number): CiJob[] {
  return Array.from({ length: count }, (_, index) => ({
    id: 1000 + index,
    name: `job ${index}`,
    runner: 'ubuntu-latest',
    os: 'linux',
    conclusion: 'success',
    queue_seconds: 2,
    duration_seconds: 60,
    steps: [{ number: 1, name: 'Set up job', conclusion: 'success', duration_seconds: 1 }, { number: 2, name: 'Run tests', conclusion: 'success', duration_seconds: 30 }],
    groups: [{ name: 'Run npm ci', duration_ms: 5000 }],
  }));
}

function body(overrides: Record<string, unknown> = {}) {
  return { ...snapshot, date: '2026-10-20T17:56:56+02:00', ...overrides };
}

function post(path: string, token: string | null, payload: unknown): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return exports.default.fetch(new Request(`https://worker.test${path}`, { method: 'POST', headers, body: JSON.stringify(payload) }));
}

async function count(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

beforeEach(async () => {
  await env.DB.batch(['ci_runs', 'ci_jobs', 'ci_steps', 'ci_step_groups', 'usage'].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
});

describe('POST /v1/ci/ingest', () => {
  it('stores the run, its jobs, steps and log groups, with the date in UTC', async () => {
    // Act
    const response = await post('/v1/ci/ingest', INGEST, body({ jobs: jobs(3) }));

    // Assert
    expect(response.status).toBe(200);
    expect(await count('ci_runs')).toBe(1);
    expect(await count('ci_jobs')).toBe(3);
    expect(await count('ci_steps')).toBe(6);
    expect(await count('ci_step_groups')).toBe(3);
    const run = await env.DB.prepare('SELECT date, workflow, labels FROM ci_runs').first();
    expect(run).toEqual({ date: '2026-10-20T15:56:56.000Z', workflow: 'Test', labels: '{"team":"web"}' });
  });

  it('stores a job that never started, with null times and an empty runner', async () => {
    // Act
    const response = await post('/v1/ci/ingest', INGEST, body());

    // Assert
    expect(response.status).toBe(200);
    const job = await env.DB.prepare('SELECT runner, queue_seconds, duration_seconds FROM ci_jobs WHERE job_id = 2').first();
    expect(job).toEqual({ runner: '', queue_seconds: null, duration_seconds: null });
  });

  it('stores NULL labels when the snapshot has none, and lets SQL read the labels as JSON', async () => {
    // Arrange
    await post('/v1/ci/ingest', INGEST, body({ run_id: 1, labels: undefined }));
    await post('/v1/ci/ingest', INGEST, body({ run_id: 2 }));

    // Act
    const rows = await env.DB.prepare("SELECT run_id, labels ->> 'team' AS team FROM ci_runs ORDER BY run_id").all();

    // Assert
    expect(rows.results).toEqual([{ run_id: 1, team: null }, { run_id: 2, team: 'web' }]);
  });

  it('replaces the rows of the same attempt, and keeps the other attempts and runs', async () => {
    // Arrange
    await post('/v1/ci/ingest', INGEST, body({ run_attempt: 1, jobs: jobs(2) }));
    await post('/v1/ci/ingest', INGEST, body({ run_id: 78, jobs: jobs(2) }));
    await post('/v1/ci/ingest', INGEST, body({ jobs: jobs(5) }));

    // Act
    const response = await post('/v1/ci/ingest', INGEST, body({ jobs: jobs(1) }));

    // Assert
    expect(response.status).toBe(200);
    expect(await count('ci_runs')).toBe(3);
    expect(await count('ci_jobs')).toBe(2 + 2 + 1);
  });

  it('keeps the old rows when a row breaks a table constraint', async () => {
    // Arrange
    await post('/v1/ci/ingest', INGEST, body({ jobs: jobs(2) }));
    const broken = jobs(2);
    broken[1] = { ...(broken[1] as CiJob), id: 0 };

    // Act
    const response = await post('/v1/ci/ingest', INGEST, body({ jobs: broken }));

    // Assert
    expect(response.status).toBe(422);
    expect(await count('ci_jobs')).toBe(2);
  });

  it('lets a table constraint refuse a run id of 0', async () => {
    // Act
    const response = await post('/v1/ci/ingest', INGEST, body({ run_id: 0 }));

    // Assert
    expect(response.status).toBe(422);
    expect(await count('ci_runs')).toBe(0);
  });

  it.each([
    ['no token', null],
    ['the query token', QUERY],
  ])('refuses %s', async (_label, token) => {
    // Act
    const response = await post('/v1/ci/ingest', token, body());

    // Assert
    expect(response.status).toBe(401);
    expect(await count('ci_runs')).toBe(0);
  });

  it('refuses a body with a bad shape', async () => {
    // Act
    const response = await post('/v1/ci/ingest', INGEST, { run_id: 'x' });

    // Assert
    expect(response.status).toBe(400);
  });
});

describe('POST /v1/ci/query', () => {
  it('reads the stored runs with the query token, and refuses the tables of other metrics', async () => {
    // Arrange
    await post('/v1/ci/ingest', INGEST, body());

    // Act
    const ok = await post('/v1/ci/query', QUERY, { sql: 'SELECT count(*) AS n FROM ci_jobs WHERE run_id = ?1', params: [77] });
    const other = await post('/v1/ci/query', QUERY, { sql: 'SELECT * FROM tests_suites' });

    // Assert
    expect((await ok.json<{ rows: unknown[] }>()).rows).toEqual([{ n: 2 }]);
    expect(other.status).toBe(400);
  });
});
