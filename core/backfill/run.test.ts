import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { collectorRegistry } from '../../action/src/generated/collector-registry.ts';
import { workerRegistry } from '../../src/generated/worker-registry.ts';
import type { CollectorEntry, RunSnapshot, WorkerEntry } from '../contract.ts';
import { parseBackfillArgs, UsageError } from './args.ts';
import { runBackfill } from './run.ts';
import type { BackfillDeps } from './run.ts';
import { makeRepo } from './test-repo.ts';
import type { FixtureRepo } from './test-repo.ts';

const itemsFile = (count: number): string => JSON.stringify({ items: Array.from({ length: count }, (_, index) => ({ name: `item${index}`, value: index })) });
const WORKER = 'https://worker.example';
const env = { DEVANALYTICS_URL: WORKER, DEVANALYTICS_INGEST_TOKEN: 'secret', DAILY_WRITE_LIMIT: '50' };

let repo: FixtureRepo;
let dir: string;
let lines: string[];
let sent: { url: string; body: { sha: string }; backfill: boolean }[];

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'devanalytics-run-test-'));
  lines = [];
  sent = [];
  repo = await makeRepo([
    { date: '2026-01-01T00:00:00Z', tags: ['v1'], files: { 'example.json': itemsFile(2) } },
    { date: '2026-01-02T00:00:00Z', tags: ['v2'], files: { 'example.json': itemsFile(3) } },
  ]);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await repo.remove();
});

function deps(overrides: Partial<BackfillDeps> = {}): BackfillDeps {
  const worker = vi.fn<typeof fetch>(async (url, init) => {
    const body = JSON.parse(init?.body as string) as { sha: string; items: unknown[] };
    sent.push({ url: String(url), body, backfill: (init?.headers as Record<string, string>)['X-Devanalytics-Mode'] === 'backfill' });
    return Response.json({ rowsWritten: body.items.length + 1 });
  });
  return { workers: workerRegistry, collectors: collectorRegistry, env, log: (line) => lines.push(line), uploadOptions: { fetch: worker, retryDelays: [] }, ...overrides };
}

const options = (...args: string[]) => parseBackfillArgs(['--metric', 'example', '--repo', repo.path, '--dir', dir, ...args]);

describe('runBackfill of commits', () => {
  test('uploads the tags oldest first with the backfill header and records them in state.json', async () => {
    const result = await runBackfill(options('--tags'), deps());

    expect(result).toEqual({ status: 'done', uploaded: 2, total: 2, skipped: 0, exitCode: 0 });
    expect(sent.map((item) => item.body.sha)).toEqual(repo.shas);
    expect(sent.every((item) => item.backfill && item.url === `${WORKER}/v1/example/ingest`)).toBe(true);
    expect(JSON.parse(await readFile(path.join(dir, 'example', 'state.json'), 'utf8'))).toEqual({ workerUrl: WORKER, uploaded: repo.shas });
    expect(await readdir(path.join(dir, 'example'))).toEqual([...repo.shas.map((sha) => `${sha}.json`), 'state.json'].sort());
    expect(lines.at(-1)).toBe('Done: 2 of 2 targets are uploaded, 7 rows written in this run.');
  });

  test('collects each commit in its own checkout', async () => {
    await runBackfill(options('--tags'), deps());

    expect(sent.map((item) => (item.body as unknown as { items: unknown[] }).items.length)).toEqual([2, 3]);
  });

  test('on a dry run, collects into the cache, uploads nothing, and asks for no credential', async () => {
    const result = await runBackfill(options('--tags', '--dry-run'), deps({ env: { DAILY_WRITE_LIMIT: '50' } }));

    expect(result.status).toBe('dry-run');
    expect(sent).toEqual([]);
    expect(await readdir(path.join(dir, 'example'))).toEqual(repo.shas.map((sha) => `${sha}.json`).sort());
    expect(lines.slice(-3)).toEqual([
      '2026-01-01  v1 ' + repo.shas[0]?.slice(0, 7) + '  3 rows',
      '2026-01-02  v2 ' + repo.shas[1]?.slice(0, 7) + '  4 rows',
      '2 targets to upload, 7 rows. At 35 rows for each day, this needs about 1 day.',
    ]);
  });

  test('a run after a dry run uploads from the cache without a new collection', async () => {
    await runBackfill(options('--tags', '--dry-run'), deps());
    lines.length = 0;

    await runBackfill(options('--tags'), deps());

    expect(lines.some((line) => line.startsWith('Collect '))).toBe(false);
    expect(sent).toHaveLength(2);
  });

  test('does not upload or collect a target that state.json has', async () => {
    await runBackfill(options('--tags'), deps());
    sent.length = 0;
    lines.length = 0;

    const result = await runBackfill(options('--tags'), deps());

    expect(result).toMatchObject({ status: 'done', uploaded: 2 });
    expect(sent).toEqual([]);
    expect(lines[0]).toBe('2 targets found, 2 already uploaded.');
  });

  test('runs --run in the checkout before it collects', async () => {
    const result = await runBackfill(options('--tags', '--run', 'echo \'{"items":[{"name":"made","value":1}]}\' > example.json'), deps());

    expect(result.status).toBe('done');
    expect(sent.map((item) => (item.body as unknown as { items: unknown[] }).items.length)).toEqual([1, 1]);
  });

  test('skips a target whose command fails, uploads the others, and tries it again on the next run', async () => {
    const command = 'test "$(git rev-parse HEAD)" != ' + (repo.shas[0] ?? '');

    const first = await runBackfill(options('--tags', '--run', command), deps());

    expect(first).toMatchObject({ status: 'done', uploaded: 1, skipped: 1, exitCode: 0 });
    expect(sent.map((item) => item.body.sha)).toEqual([repo.shas[1]]);
    expect(lines.some((line) => line.startsWith('Skipped v1 ') && line.includes('ended with code 1'))).toBe(true);
    expect(lines.at(-1)).toContain('1 target were skipped and are tried again');

    const second = await runBackfill(options('--tags'), deps());

    expect(second).toMatchObject({ status: 'done', uploaded: 2, skipped: 0 });
    expect(sent.map((item) => item.body.sha)).toEqual([repo.shas[1], repo.shas[0]]);
  });

  test('fails with exit code 1 when every target is skipped', async () => {
    const result = await runBackfill(options('--tags', '--run', 'exit 3'), deps());

    expect(result).toMatchObject({ status: 'failed', skipped: 2, exitCode: 1 });
    expect(sent).toEqual([]);
  });

  test('refuses a snapshot that is not the one of its commit', async () => {
    const wrong = { ...collectorRegistry[0] as CollectorEntry, collector: { ...(collectorRegistry[0] as CollectorEntry).collector, collect: async () => ({ sha: 'f'.repeat(40), date: '2026-01-01T00:00:00Z', items: [] }) } };

    const result = await runBackfill(options('--tags'), deps({ collectors: [wrong] }));

    expect(result.status).toBe('failed');
    expect(lines.some((line) => line.includes(`the target is ${repo.shas[0]}`))).toBe(true);
  });

  test('refuses before the first upload a snapshot that needs more rows than the backfill limit', async () => {
    const big = await makeRepo([{ date: '2026-01-01T00:00:00Z', tags: ['v1'], files: { 'example.json': itemsFile(40) } }]);
    try {
      const result = await runBackfill(parseBackfillArgs(['--metric', 'example', '--repo', big.path, '--dir', dir, '--tags']), deps());

      expect(result).toMatchObject({ status: 'too-large', exitCode: 1 });
      expect(sent).toEqual([]);
      expect(lines.at(-1)).toContain('needs 41 rows, and the backfill limit for one day is 35 rows');
      expect(lines.at(-1)).toContain('--every <n>');
    } finally {
      await big.remove();
    }
  });

  test.each([
    ['an unknown metric', ['--metric', 'nope', '--repo', '.', '--tags'], 'Unknown metric "nope". The metrics in this version are: example.'],
    ['a missing repo', ['--metric', 'example', '--tags'], 'Set --repo to the path'],
    ['a missing selection', ['--metric', 'example', '--repo', '.'], 'Choose the commits with one of'],
    ['an input that the metric does not have', ['--metric', 'example', '--repo', '.', '--tags', '--input', 'nope=1'], 'has no input named nope. Its inputs are: file.'],
  ])('refuses %s', async (_label, argv, message) => {
    const run = runBackfill(parseBackfillArgs(argv), deps());

    await expect(run).rejects.toThrow(UsageError);
    await expect(run).rejects.toThrow(message);
  });

  test('refuses an upload without the Worker URL or the token', async () => {
    await expect(runBackfill(options('--tags'), deps({ env: { DEVANALYTICS_URL: WORKER } }))).rejects.toThrow('Set the DEVANALYTICS_URL and DEVANALYTICS_INGEST_TOKEN variables');
  });

  test('refuses a metric that has no backfill', async () => {
    const plain = { ...(collectorRegistry[0] as CollectorEntry), collector: { inputs: [], collect: async () => { throw new Error('unused'); } } };

    await expect(runBackfill(options('--tags'), deps({ collectors: [plain] }))).rejects.toThrow('does not support backfill');
  });

  test('says so when there is no target', async () => {
    const empty = await makeRepo([{ date: '2026-01-01T00:00:00Z' }]);
    try {
      const result = await runBackfill(parseBackfillArgs(['--metric', 'example', '--repo', empty.path, '--dir', dir, '--tags']), deps());

      expect(result).toMatchObject({ status: 'no-targets', exitCode: 1 });
      expect(lines).toEqual(['No target found.']);
    } finally {
      await empty.remove();
    }
  });
});

describe('runBackfill of runs', () => {
  const runMetric = { name: 'runs', key: 'run' as const, parse: (body: unknown) => body as RunSnapshot };
  const worker: WorkerEntry = {
    metric: runMetric,
    store: { tables: ['runs_rows'], toRows: () => [{ table: 'runs_rows', insert: '', rows: [['a'], ['b']] }] },
  };
  const collect = vi.fn(async ({ inputs, env: collectEnv }: { inputs: Readonly<Record<string, string>>; env: Readonly<Record<string, string | undefined>> }): Promise<RunSnapshot> => {
    expect(collectEnv['GITHUB_REPOSITORY']).toBe('owner/app');
    return { run_id: Number(inputs['run-id']), run_attempt: Number(inputs['run-attempt']), date: '2026-02-01T00:00:00Z' };
  });
  const collector: CollectorEntry = {
    metric: runMetric,
    collector: {
      inputs: [{ name: 'run-id', description: '' }, { name: 'run-attempt', description: '' }, { name: 'github-token', description: '' }],
      collect,
      backfill: 'runs',
    },
  };

  function runDeps(): BackfillDeps {
    const send = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).startsWith('https://api.github.com/')) {
        return Response.json({ workflow_runs: [{ id: 22, run_attempt: 1, run_started_at: '2026-02-02T00:00:00Z', created_at: '2026-02-02T00:00:00Z' }, { id: 11, run_attempt: 2, run_started_at: '2026-02-01T00:00:00Z', created_at: '2026-02-01T00:00:00Z' }] });
      }
      sent.push({ url: String(url), body: JSON.parse(init?.body as string) as { sha: string }, backfill: true });
      return Response.json({ rowsWritten: 3 });
    });
    return deps({ workers: [worker], collectors: [collector], env: { ...env, GITHUB_TOKEN: 'gh-token' }, fetch: send, uploadOptions: { fetch: send, retryDelays: [] }, now: () => new Date('2026-03-01T00:00:00Z') });
  }

  const runOptions = (...args: string[]) => parseBackfillArgs(['--metric', 'runs', '--repo', 'owner/app', '--dir', dir, ...args]);

  test('lists the runs, collects each with its run id, and uploads them oldest first', async () => {
    const result = await runBackfill(runOptions('--since', '2026-01-15'), runDeps());

    expect(result).toMatchObject({ status: 'done', uploaded: 2, total: 2 });
    expect(collect.mock.calls.map(([context]) => [context.inputs['run-id'], context.inputs['run-attempt'], context.inputs['github-token']])).toEqual([
      ['11', '2', 'gh-token'],
      ['22', '1', 'gh-token'],
    ]);
    expect(sent.map((item) => item.url)).toEqual([`${WORKER}/v1/runs/ingest`, `${WORKER}/v1/runs/ingest`]);
    expect(await readdir(path.join(dir, 'runs'))).toEqual(['11-2.json', '22-1.json', 'state.json']);
  });

  test('says that the list starts 90 days ago when --since is older', async () => {
    await runBackfill(runOptions('--since', '2025-01-01', '--dry-run'), runDeps());

    expect(lines[0]).toBe('GitHub keeps the logs and the artifacts of a run for 90 days, so the list starts 90 days ago.');
  });

  test.each([
    ['--tags', 'are for a metric of commits'],
    ['--run', 'are for a metric of commits'],
  ])('refuses %s', async (flag, message) => {
    await expect(runBackfill(runOptions(flag, ...(flag === '--run' ? ['true'] : [])), runDeps())).rejects.toThrow(message);
  });

  test('refuses a repo that is not owner/name', async () => {
    await expect(runBackfill(parseBackfillArgs(['--metric', 'runs', '--repo', '../app', '--dir', dir]), runDeps())).rejects.toThrow('must look like owner/name');
  });

  test('needs the GitHub token', async () => {
    await expect(runBackfill(runOptions(), { ...runDeps(), env })).rejects.toThrow('Set the GITHUB_TOKEN variable');
  });

  test('refuses a collector without the run inputs', async () => {
    const bare: CollectorEntry = { ...collector, collector: { ...collector.collector, inputs: [] } };

    await expect(runBackfill(runOptions(), { ...runDeps(), collectors: [bare] })).rejects.toThrow('must have the inputs run-id and run-attempt');
  });
});
