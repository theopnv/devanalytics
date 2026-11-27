import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { parseBackfillArgs } from '../core/backfill/args.ts';
import { runBackfill } from '../core/backfill/run.ts';
import type { BackfillDeps } from '../core/backfill/run.ts';
import { makeRepo } from '../core/backfill/test-repo.ts';
import type { FixtureRepo } from '../core/backfill/test-repo.ts';
import { startDevWorker } from './dev-worker.mts';
import type { DevWorker } from './dev-worker.mts';
import { loadRegistries } from './registries.mts';
import type { Registries } from './registries.mts';

const root = path.resolve(import.meta.dirname, '..');
// The Worker applies 95% of 50 to a normal ingest and 70% to a backfill ingest, which is 35 rows.
const DAILY_WRITE_LIMIT = '50';

const itemsFile = (count: number): string => JSON.stringify({ items: Array.from({ length: count }, (_, index) => ({ name: `item${index}`, value: index })) });

let worker: DevWorker;
let registries: Registries;
let cache: string;
let repos: FixtureRepo[];
let lines: string[];

beforeAll(async () => {
  registries = await loadRegistries(root);
  worker = await startDevWorker({ root, vars: { DAILY_WRITE_LIMIT } });
}, 120_000);

afterAll(async () => {
  await worker.stop();
});

beforeEach(async () => {
  cache = await mkdtemp(path.join(os.tmpdir(), 'devanalytics-backfill-'));
  repos = [];
  lines = [];
});

afterEach(async () => {
  await worker.execute('DELETE FROM example_items; DELETE FROM usage;');
  await rm(cache, { recursive: true, force: true });
  await Promise.all(repos.map((repo) => repo.remove()));
});

async function tagged(itemCounts: number[]): Promise<FixtureRepo> {
  const repo = await makeRepo(itemCounts.map((count, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
    tags: [`v${index + 1}`],
    files: { 'example.json': itemsFile(count) },
  })));
  repos.push(repo);
  return repo;
}

/** `clientLimit` is the DAILY_WRITE_LIMIT of the client. `null` leaves it unset, so the client assumes the default of 100000. */
function backfill(repo: FixtureRepo, clientLimit: string | null = DAILY_WRITE_LIMIT) {
  const deps: BackfillDeps = {
    ...registries,
    env: { DEVANALYTICS_URL: worker.url, DEVANALYTICS_INGEST_TOKEN: worker.ingestToken, ...(clientLimit === null ? {} : { DAILY_WRITE_LIMIT: clientLimit }) },
    log: (line) => lines.push(line),
  };
  return runBackfill(parseBackfillArgs(['--metric', 'example', '--repo', repo.path, '--tags', '--dir', cache]), deps);
}

async function query<T>(sql: string, token = worker.queryToken, route = 'example/query'): Promise<T[]> {
  const response = await fetch(`${worker.url}/v1/${route}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  return ((await response.json()) as { rows: T[] }).rows;
}

const count = async (): Promise<number> => (await query<{ n: number }>('SELECT count(*) AS n FROM example_items'))[0]?.n ?? 0;

async function rowsWrittenToday(): Promise<number> {
  const response = await fetch(`${worker.url}/v1/usage`, { headers: { Authorization: `Bearer ${worker.queryToken}` } });
  return ((await response.json()) as { rowsWritten: number }).rowsWritten;
}

const readState = async (): Promise<{ uploaded: string[] }> => JSON.parse(await readFile(path.join(cache, 'example', 'state.json'), 'utf8')) as { uploaded: string[] };

describe('backfill against a local Worker with DAILY_WRITE_LIMIT=50', () => {
  // A snapshot of 4 items costs 5 rows, so 7 fit in the 35 rows of one day, and the 8th does not.
  test('stops at the budget, writes state.json, and resumes on the next day with the same rows as one large run', async () => {
    const repo = await tagged(Array.from({ length: 10 }, () => 4));

    const first = await backfill(repo);

    expect(first).toMatchObject({ status: 'stopped', uploaded: 7, total: 10, exitCode: 0 });
    expect(await count()).toBe(28);
    expect(await rowsWrittenToday()).toBe(35);
    expect((await readState()).uploaded).toEqual(repo.shas.slice(0, 7));
    const stop = lines.at(-1) ?? '';
    expect(stop).toMatch(/^Stopped by the write budget: 7 of 10 targets are uploaded\. Run the same command again after 00:00 UTC \(in \d+ seconds\)\. About 1 more day are needed at 35 rows for each day\.$/);

    await worker.execute('DELETE FROM usage;');
    lines.length = 0;
    const second = await backfill(repo);

    expect(second).toMatchObject({ status: 'done', uploaded: 10, total: 10, exitCode: 0 });
    expect(lines.some((line) => line.startsWith('Collect '))).toBe(false);
    expect(lines.at(-1)).toBe('Done: 10 of 10 targets are uploaded, 15 rows written in this run.');
    expect((await readState()).uploaded).toEqual(repo.shas);
    expect(await count()).toBe(40);
    expect(await query<{ n: number }>('SELECT count(DISTINCT sha) AS n FROM example_items')).toEqual([{ n: 10 }]);
  }, 120_000);

  test('does not upload again on the same day after it stopped', async () => {
    const repo = await tagged(Array.from({ length: 10 }, () => 4));
    await backfill(repo);
    lines.length = 0;

    const again = await backfill(repo);

    expect(again).toMatchObject({ status: 'stopped', uploaded: 7 });
    expect(await count()).toBe(28);
    expect(await rowsWrittenToday()).toBe(35);
  }, 120_000);

  test('refuses before the first upload a snapshot that is larger than the backfill limit', async () => {
    const repo = await tagged([4, 40, 4]);

    const result = await backfill(repo);

    expect(result).toMatchObject({ status: 'too-large', uploaded: 0, exitCode: 1 });
    expect(await count()).toBe(0);
    expect(await rowsWrittenToday()).toBe(0);
    expect(lines.at(-1)).toContain('needs 41 rows, and the backfill limit for one day is 35 rows');
    expect(lines.at(-1)).toContain('Use --every <n>');
  }, 120_000);

  test('reads a snapshot that is too large from the answer of the Worker when the client does not know the limit', async () => {
    const repo = await tagged([4, 40, 4]);

    const result = await backfill(repo, null);

    expect(result).toMatchObject({ status: 'too-large', uploaded: 1, exitCode: 1 });
    expect(await count()).toBe(4);
    expect(lines.at(-1)).toContain('needs 41 rows, and the backfill limit for one day is 35 rows');
    expect(lines.some((line) => line.includes('Stopped by the write budget'))).toBe(false);
  }, 120_000);
});
