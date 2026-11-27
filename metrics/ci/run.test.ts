import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveRunIds } from './run.ts';

const directories: string[] = [];

async function eventFile(run: Record<string, unknown>): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devanalytics-event-'));
  directories.push(directory);
  const file = path.join(directory, 'event.json');
  await writeFile(file, JSON.stringify({ workflow_run: run }));
  return file;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('resolveRunIds', () => {
  it('reads the run and the attempt from a workflow_run event', async () => {
    // Arrange
    const env = { GITHUB_EVENT_NAME: 'workflow_run', GITHUB_EVENT_PATH: await eventFile({ id: 42, run_attempt: 2 }), GITHUB_RUN_ID: '99', GITHUB_RUN_ATTEMPT: '1' };

    // Act
    const result = await resolveRunIds({}, env);

    // Assert
    expect(result).toEqual({ id: 42, attempt: 2 });
  });

  it('reads the current run for any other event', async () => {
    // Act
    const result = await resolveRunIds({}, { GITHUB_EVENT_NAME: 'push', GITHUB_RUN_ID: '99', GITHUB_RUN_ATTEMPT: '3' });

    // Assert
    expect(result).toEqual({ id: 99, attempt: 3 });
  });

  it('lets the inputs win', async () => {
    // Act
    const result = await resolveRunIds({ 'run-id': '7', 'run-attempt': '4' }, { GITHUB_RUN_ID: '99', GITHUB_RUN_ATTEMPT: '3' });

    // Assert
    expect(result).toEqual({ id: 7, attempt: 4 });
  });

  it('does not take the attempt of the environment for another run', async () => {
    // Act
    const result = resolveRunIds({ 'run-id': '7' }, { GITHUB_RUN_ID: '99', GITHUB_RUN_ATTEMPT: '3' });

    // Assert
    await expect(result).rejects.toThrow('run-attempt must be a positive whole number');
  });

  it.each([['0'], ['-1'], ['1.5'], ['abc']])('refuses the run id "%s"', async (value) => {
    // Act
    const result = resolveRunIds({ 'run-id': value, 'run-attempt': '1' }, {});

    // Assert
    await expect(result).rejects.toThrow('run-id must be a positive whole number');
  });
});
