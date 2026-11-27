import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJobLog, fetchJobs, fetchRun, githubTarget } from './github.ts';
import type { GithubTarget } from './github.ts';

const TARGET: GithubTarget = { apiUrl: 'https://api.test', repository: 'octo/repo', token: 'secret' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('githubTarget', () => {
  it('reads the repository and the API address, and removes trailing slashes', () => {
    // Act
    const target = githubTarget({ GITHUB_REPOSITORY: 'octo/repo', GITHUB_API_URL: 'https://ghe.example/api/v3//' }, 'secret');

    // Assert
    expect(target).toEqual({ apiUrl: 'https://ghe.example/api/v3', repository: 'octo/repo', token: 'secret' });
  });

  it('uses api.github.com by default', () => {
    // Act
    const target = githubTarget({ GITHUB_REPOSITORY: 'octo/repo' }, 'secret');

    // Assert
    expect(target.apiUrl).toBe('https://api.github.com');
  });

  it('needs the repository', () => {
    // Act
    const read = () => githubTarget({}, 'secret');

    // Assert
    expect(read).toThrow('GITHUB_REPOSITORY');
  });
});

describe('fetchRun', () => {
  it('reads the attempt of the run with the token', async () => {
    // Arrange
    const send = vi.fn(async () => Response.json({ id: 5 }));
    vi.stubGlobal('fetch', send);

    // Act
    const run = await fetchRun(TARGET, 5, 2);

    // Assert
    expect(run).toEqual({ id: 5 });
    expect(send).toHaveBeenCalledWith('https://api.test/repos/octo/repo/actions/runs/5/attempts/2', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secret' }) }));
  });

  it('names the route and the status when GitHub refuses', async () => {
    // Arrange
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not Found', { status: 404 })));

    // Act
    const run = fetchRun(TARGET, 5, 2);

    // Assert
    await expect(run).rejects.toThrow('GitHub answered 404 for /actions/runs/5/attempts/2: Not Found');
  });
});

describe('fetchJobs', () => {
  it('reads every page until a short page', async () => {
    // Arrange
    const page = (count: number, first: number) => Response.json({ jobs: Array.from({ length: count }, (_, i) => ({ id: first + i })) });
    const send = vi.fn(async (url: string) => (url.endsWith('page=1') ? page(100, 1) : page(3, 101)));
    vi.stubGlobal('fetch', send);

    // Act
    const jobs = await fetchJobs(TARGET, 5, 1);

    // Assert
    expect(jobs).toHaveLength(103);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('fetchJobLog', () => {
  it('reads the text of the log', async () => {
    // Arrange
    vi.stubGlobal('fetch', vi.fn(async () => new Response('log text')));

    // Act
    const log = await fetchJobLog(TARGET, 9);

    // Assert
    expect(log).toBe('log text');
  });

  it('names the job when GitHub refuses', async () => {
    // Arrange
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 410 })));

    // Act
    const log = fetchJobLog(TARGET, 9);

    // Assert
    await expect(log).rejects.toThrow('GitHub answered 410 for the log of job 9.');
  });
});
