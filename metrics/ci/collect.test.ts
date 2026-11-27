import { afterEach, describe, expect, it, vi } from 'vitest';
import { collector } from './collect.ts';
import { metric } from './metric.ts';

const ENV = { GITHUB_REPOSITORY: 'octo/repo', GITHUB_API_URL: 'https://api.test' };

const RUN = {
  id: 77,
  run_attempt: 2,
  name: 'Test',
  event: 'pull_request',
  head_sha: 'c'.repeat(40),
  head_branch: 'feature',
  conclusion: 'success',
  created_at: '2026-11-20T09:00:00Z',
  run_started_at: '2026-11-20T09:00:10Z',
  updated_at: '2026-11-20T09:05:10Z',
};

const JOB = {
  id: 1,
  name: 'unit',
  conclusion: 'success',
  created_at: '2026-11-20T09:00:10Z',
  started_at: '2026-11-20T09:00:15Z',
  completed_at: '2026-11-20T09:02:15Z',
  labels: ['ubuntu-latest'],
  steps: [{ name: 'Run tests', number: 1, conclusion: 'success', started_at: '2026-11-20T09:00:20Z', completed_at: '2026-11-20T09:00:34Z' }],
};

const LOG = [
  '2026-11-20T09:00:15.0000000Z ##[group]Run npm ci',
  '2026-11-20T09:00:18.0000000Z added packages',
  '2026-11-20T09:00:20.0000000Z ##[group]Run npm test',
  '2026-11-20T09:00:21.0000000Z done',
].join('\n');

/** A fake GitHub API. A route that is not here answers 404. */
function fakeGithub(overrides: Record<string, Response> = {}) {
  const routes: Record<string, Response> = {
    '/repos/octo/repo/actions/runs/77/attempts/2': Response.json(RUN),
    '/repos/octo/repo/actions/runs/77/attempts/2/jobs?per_page=100&page=1': Response.json({ jobs: [JOB] }),
    '/repos/octo/repo/actions/jobs/1/logs': new Response(LOG),
    ...overrides,
  };
  return vi.fn(async (url: string) => (routes[url.replace('https://api.test', '')] ?? new Response('Not Found', { status: 404 })).clone());
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('collector', () => {
  it('declares its inputs and backfills runs', () => {
    // Assert
    expect(collector.inputs.map(({ name }) => name)).toEqual(['run-id', 'run-attempt', 'github-token', 'labels']);
    expect(collector.backfill).toBe('runs');
  });

  it('builds the snapshot of a run from the run, its jobs, their logs and the labels', async () => {
    // Arrange
    vi.stubGlobal('fetch', fakeGithub());
    const inputs = { 'run-id': '77', 'run-attempt': '2', 'github-token': 'secret', labels: 'team=web' };

    // Act
    const snapshot = metric.parse(await collector.collect({ inputs, cwd: '.', env: ENV }));

    // Assert
    expect(snapshot).toMatchObject({ run_id: 77, run_attempt: 2, date: '2026-11-20T09:00:10.000Z', workflow: 'Test', wall_seconds: 300, labels: { team: 'web' } });
    expect(snapshot.jobs).toHaveLength(1);
    expect(snapshot.jobs[0]).toMatchObject({ runner: 'ubuntu-latest', os: 'linux', queue_seconds: 5, duration_seconds: 120 });
    expect(snapshot.jobs[0]?.groups).toEqual([{ name: 'Run npm ci', duration_ms: 5000 }, { name: 'Run npm test', duration_ms: 1000 }]);
  });

  it('takes the run from the current run when no input names it', async () => {
    // Arrange
    vi.stubGlobal('fetch', fakeGithub());

    // Act
    const snapshot = await collector.collect({ inputs: { 'github-token': 'secret' }, cwd: '.', env: { ...ENV, GITHUB_RUN_ID: '77', GITHUB_RUN_ATTEMPT: '2' } });

    // Assert
    expect(snapshot.run_id).toBe(77);
  });

  it('warns about a log that cannot be read, and still collects the run', async () => {
    // Arrange
    vi.stubGlobal('fetch', fakeGithub({ '/repos/octo/repo/actions/jobs/1/logs': new Response('', { status: 404 }) }));
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    // Act
    const snapshot = await collector.collect({ inputs: { 'run-id': '77', 'run-attempt': '2', 'github-token': 'secret' }, cwd: '.', env: ENV });

    // Assert
    expect(snapshot.jobs[0]?.groups).toEqual([]);
    expect(write).toHaveBeenCalledWith(expect.stringContaining('Skipped the log of job unit'));
  });

  it('fails before any request when the token is empty', async () => {
    // Arrange
    const send = fakeGithub();
    vi.stubGlobal('fetch', send);

    // Act
    const result = collector.collect({ inputs: { 'run-id': '77', 'run-attempt': '2' }, cwd: '.', env: ENV });

    // Assert
    await expect(result).rejects.toThrow('Set the github-token input');
    expect(send).not.toHaveBeenCalled();
  });

  it('fails before any request when a label is not valid', async () => {
    // Arrange
    const send = fakeGithub();
    vi.stubGlobal('fetch', send);

    // Act
    const result = collector.collect({ inputs: { 'run-id': '77', 'run-attempt': '2', 'github-token': 'secret', labels: 'no equals sign' }, cwd: '.', env: ENV });

    // Assert
    await expect(result).rejects.toThrow('labels:');
    expect(send).not.toHaveBeenCalled();
  });

  it('fails with the status when GitHub does not know the run', async () => {
    // Arrange
    vi.stubGlobal('fetch', fakeGithub({ '/repos/octo/repo/actions/runs/77/attempts/2': new Response('Not Found', { status: 404 }) }));

    // Act
    const result = collector.collect({ inputs: { 'run-id': '77', 'run-attempt': '2', 'github-token': 'secret' }, cwd: '.', env: ENV });

    // Assert
    await expect(result).rejects.toThrow('GitHub answered 404');
  });
});
