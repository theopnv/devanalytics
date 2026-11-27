import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveRun } from './run.ts';

const directories: string[] = [];

async function eventFile(run: Record<string, unknown>): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devanalytics-event-'));
  directories.push(directory);
  const file = path.join(directory, 'event.json');
  await writeFile(file, JSON.stringify({ workflow_run: run }));
  return file;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('resolveRun', () => {
  it('reads the run, the attempt and the start from a workflow_run event', async () => {
    // Arrange
    const env = { GITHUB_EVENT_NAME: 'workflow_run', GITHUB_EVENT_PATH: await eventFile({ id: 42, run_attempt: 2, run_started_at: '2026-02-01T08:00:00Z' }), GITHUB_RUN_ID: '99', GITHUB_RUN_ATTEMPT: '1' };

    // Act
    const run = await resolveRun({}, env);

    // Assert
    expect(run).toEqual({ id: 42, attempt: 2, startedAt: '2026-02-01T08:00:00Z' });
  });

  it('falls back to the creation date when the event has no start', async () => {
    // Arrange
    const env = { GITHUB_EVENT_NAME: 'workflow_run', GITHUB_EVENT_PATH: await eventFile({ id: 42, run_attempt: 1, run_started_at: null, created_at: '2026-02-01T07:00:00Z' }) };

    // Act
    const run = await resolveRun({}, env);

    // Assert
    expect(run.startedAt).toBe('2026-02-01T07:00:00Z');
  });

  it('lets the inputs win over the event', async () => {
    // Arrange
    const env = { GITHUB_EVENT_NAME: 'workflow_run', GITHUB_EVENT_PATH: await eventFile({ id: 42, run_attempt: 2, run_started_at: '2026-02-01T08:00:00Z' }) };

    // Act
    const run = await resolveRun({ 'run-id': '7', 'run-attempt': '3', 'run-started-at': '2026-03-03T03:00:00Z' }, env);

    // Assert
    expect(run).toEqual({ id: 7, attempt: 3, startedAt: '2026-03-03T03:00:00Z' });
  });

  it('does not take the attempt of the event for another run', async () => {
    // Arrange
    const env = { GITHUB_EVENT_NAME: 'workflow_run', GITHUB_EVENT_PATH: await eventFile({ id: 42, run_attempt: 2, run_started_at: '2026-02-01T08:00:00Z' }) };

    // Act
    const run = resolveRun({ 'run-id': '7' }, env);

    // Assert
    await expect(run).rejects.toThrow('run-attempt must be a positive whole number');
  });

  it('reads the start from the GitHub API when no other source has it', async () => {
    // Arrange
    const send = vi.fn(async () => Response.json({ run_started_at: '2026-04-04T04:00:00Z' }));
    vi.stubGlobal('fetch', send);
    const env = { GITHUB_RUN_ID: '55', GITHUB_RUN_ATTEMPT: '1', GITHUB_REPOSITORY: 'octo/repo', GITHUB_API_URL: 'https://github.example/api/v3/' };

    // Act
    const run = await resolveRun({ 'github-token': 'secret' }, env);

    // Assert
    expect(run).toEqual({ id: 55, attempt: 1, startedAt: '2026-04-04T04:00:00Z' });
    expect(send).toHaveBeenCalledWith('https://github.example/api/v3/repos/octo/repo/actions/runs/55/attempts/1', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secret' }) }));
  });

  it('names the status when GitHub refuses the request', async () => {
    // Arrange
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not Found', { status: 404 })));

    // Act
    const run = resolveRun({ 'run-id': '1', 'run-attempt': '1', 'github-token': 'secret' }, { GITHUB_REPOSITORY: 'octo/repo' });

    // Assert
    await expect(run).rejects.toThrow('GitHub answered 404');
  });

  it('says how to give the start when no source has it', async () => {
    // Act
    const run = resolveRun({ 'run-id': '1', 'run-attempt': '1' }, {});

    // Assert
    await expect(run).rejects.toThrow('Set run-started-at, or set github-token');
  });

  it.each([['0'], ['-1'], ['1.5'], ['abc'], ['']])('refuses the run id "%s"', async (value) => {
    // Act
    const run = resolveRun({ 'run-id': value, 'run-attempt': '1', 'run-started-at': '2026-01-01T00:00:00Z' }, {});

    // Assert
    await expect(run).rejects.toThrow('run-id must be a positive whole number');
  });

  it('refuses a start that is not a date', async () => {
    // Act
    const run = resolveRun({ 'run-id': '1', 'run-attempt': '1', 'run-started-at': 'yesterday' }, {});

    // Assert
    await expect(run).rejects.toThrow('start time of the run is not known');
  });
});
