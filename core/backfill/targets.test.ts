import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeRepo } from './test-repo.ts';
import type { FixtureRepo } from './test-repo.ts';
import { listCommitTargets, listRunTargets } from './targets.ts';

let repo: FixtureRepo;

beforeEach(async () => {
  repo = await makeRepo([
    { date: '2026-01-01T00:00:00Z', tags: ['v0.1.0'] },
    { date: '2026-01-02T00:00:00Z' },
    { date: '2026-01-03T00:00:00Z', tags: ['v0.2.0', 'latest'] },
    { date: '2026-01-04T00:00:00Z' },
    { date: '2026-01-05T00:00:00Z' },
  ]);
});

afterEach(async () => {
  await repo.remove();
});

const labels = (targets: { label: string }[]): string[] => targets.map(({ label }) => label.split(' ')[0] ?? '');

describe('listCommitTargets', () => {
  test('lists the tags oldest first, and names a commit with two tags by the first one', () => {
    const targets = listCommitTargets({ repo: repo.path, selection: { kind: 'tags' } });

    expect(targets.map(({ key }) => key)).toEqual([repo.shas[0], repo.shas[2]]);
    expect(labels(targets)).toEqual(['v0.1.0', 'latest']);
    expect(targets[0]).toMatchObject({ date: '2026-01-01T00:00:00Z', sha: repo.shas[0], inputs: {} });
  });

  test('takes every n-th commit of the default branch, from the newest', () => {
    const targets = listCommitTargets({ repo: repo.path, selection: { kind: 'every', step: 2 } });

    expect(targets.map(({ key }) => key)).toEqual([repo.shas[0], repo.shas[2], repo.shas[4]]);
    expect(targets[2]?.label).toBe(repo.shas[4]?.slice(0, 7));
  });

  test('takes the commits that the refs name', () => {
    const targets = listCommitTargets({ repo: repo.path, selection: { kind: 'refs', refs: ['v0.2.0', repo.shas[1] ?? ''] } });

    expect(targets.map(({ key }) => key)).toEqual([repo.shas[1], repo.shas[2]]);
  });

  test('keeps only the commits from the since date', () => {
    const targets = listCommitTargets({ repo: repo.path, selection: { kind: 'every', step: 1 }, since: new Date('2026-01-03T00:00:00Z') });

    expect(targets.map(({ key }) => key)).toEqual([repo.shas[2], repo.shas[3], repo.shas[4]]);
  });

  test('walks the branch that is named', () => {
    const targets = listCommitTargets({ repo: repo.path, selection: { kind: 'every', step: 4 }, branch: 'main' });

    expect(targets.map(({ key }) => key)).toEqual([repo.shas[0], repo.shas[4]]);
  });

  test('refuses a ref that is not a commit', () => {
    expect(() => listCommitTargets({ repo: repo.path, selection: { kind: 'refs', refs: ['nope'] } })).toThrow('The ref "nope" is not a commit');
  });
});

describe('listRunTargets', () => {
  const now = new Date('2026-03-01T12:00:00Z');
  const run = (id: number, startedAt: string | null, attempt = 1) => ({ id, run_attempt: attempt, run_started_at: startedAt, created_at: '2026-02-20T00:00:00Z' });
  const page = (runs: unknown[]) => Response.json({ workflow_runs: runs });

  test('lists the runs oldest first with the run id and the attempt as inputs', async () => {
    const send = vi.fn<typeof fetch>(async () => page([run(2, '2026-02-25T00:00:00Z', 2), run(1, null)]));

    const targets = await listRunTargets({ repo: 'o/r', since: new Date('2026-02-01'), token: 't', fetch: send, now: () => now });

    expect(targets).toEqual([
      { key: '1-1', label: 'run 1 attempt 1', date: '2026-02-20T00:00:00Z', inputs: { 'run-id': '1', 'run-attempt': '1' } },
      { key: '2-2', label: 'run 2 attempt 2', date: '2026-02-25T00:00:00Z', inputs: { 'run-id': '2', 'run-attempt': '2' } },
    ]);
    const [url, init] = send.mock.calls[0] ?? [];
    expect(String(url)).toContain('https://api.github.com/repos/o/r/actions/runs?status=completed&created=%3E%3D2026-02-01&per_page=100&page=1');
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer t');
  });

  test('reads the next page while a page is full', async () => {
    const full = Array.from({ length: 100 }, (_, index) => run(index + 1, '2026-02-25T00:00:00Z'));
    const send = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(page(full))
      .mockResolvedValueOnce(page([run(101, '2026-02-26T00:00:00Z')]));

    const targets = await listRunTargets({ repo: 'o/r', since: new Date('2026-02-01'), token: 't', fetch: send, now: () => now });

    expect(targets).toHaveLength(101);
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('moves a since date older than 90 days up to the 90-day start', async () => {
    const send = vi.fn<typeof fetch>(async () => page([run(1, '2025-12-01T00:00:00Z'), run(2, '2026-01-15T00:00:00Z')]));

    const targets = await listRunTargets({ repo: 'o/r', since: new Date('2025-01-01'), token: 't', fetch: send, now: () => now });

    expect(String(send.mock.calls[0]?.[0])).toContain('created=%3E%3D2025-12-01');
    expect(targets.map(({ key }) => key)).toEqual(['2-1']);
  });

  test('fails with the answer of GitHub', async () => {
    const send = vi.fn<typeof fetch>(async () => new Response('Bad credentials', { status: 401 }));

    await expect(listRunTargets({ repo: 'o/r', since: now, token: 't', fetch: send, now: () => now })).rejects.toThrow('with 401: Bad credentials');
  });
});
