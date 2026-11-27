import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collector } from './collect.ts';
import { metric } from './metric.ts';
import { makeZip } from './zip-fixture.ts';
import fixtureInputs from './fixtures/inputs.json' with { type: 'json' };
import expected from './fixtures/snapshot.json' with { type: 'json' };

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const roots: string[] = [];

async function makeRoot(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devanalytics-collect-'));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  return root;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('collector', () => {
  it('declares its inputs and backfills runs', () => {
    // Assert
    expect(collector.inputs.map(({ name }) => name)).toEqual(['reports', 'run-id', 'run-attempt', 'run-started-at', 'github-token']);
    expect(collector.backfill).toBe('runs');
  });

  it('reads the fixture artifact folder into the fixture snapshot, and more rows for the second runner', async () => {
    // Act
    const snapshot = metric.parse(await collector.collect({ inputs: fixtureInputs, cwd: FIXTURES, env: {} }));

    // Assert
    expect(snapshot.suites.filter(({ runner }) => runner === 'ubuntu-latest')).toEqual(expected.suites);
    expect(snapshot.suites.filter(({ runner }) => runner === 'macos-latest')).toEqual([{ suite: 'unit', runner: 'macos-latest', tests: 2, passed: 1, failed: 1, skipped: 0, flaky: 0 }]);
    expect(snapshot).toMatchObject({ run_id: 1234567890, run_attempt: 1, date: '2026-01-15T10:00:00.000Z' });
    expect(snapshot.exceptions.filter(({ runner }) => runner === 'ubuntu-latest')).toEqual(expected.exceptions);
  });

  it('warns and sends no row when no report exists, as a run that skipped its tests', async () => {
    // Arrange
    const root = await makeRoot({ 'ubuntu-latest/readme.txt': 'x' });
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    // Act
    const snapshot = await collector.collect({ inputs: { ...fixtureInputs }, cwd: root, env: {} });

    // Assert
    expect(snapshot).toMatchObject({ suites: [], exceptions: [] });
    expect(write).toHaveBeenCalledWith(expect.stringContaining('No test report was found'));
  });

  it('downloads the artifacts of the run when the working directory has no runner folder and a token is set', async () => {
    // Arrange
    const root = await makeRoot();
    const unit = JSON.stringify({ tests: [{ file: 'a.test.ts', title: 't', state: 'passed', retries: 0, error: '' }] });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('/artifacts?')
      ? Response.json({ artifacts: [{ id: 5, name: 'ubuntu-latest', expired: false }] })
      : new Response(makeZip([{ name: 'unit.json', content: unit }])))));

    // Act
    const snapshot = await collector.collect({ inputs: { ...fixtureInputs, 'github-token': 'secret' }, cwd: root, env: { GITHUB_REPOSITORY: 'octo/repo' } });

    // Assert
    expect(snapshot.suites).toEqual([{ suite: 'unit', runner: 'ubuntu-latest', tests: 1, passed: 1, failed: 0, skipped: 0, flaky: 0 }]);
  });

  it('does not download when the runner folders exist', async () => {
    // Arrange
    const send = vi.fn();
    vi.stubGlobal('fetch', send);

    // Act
    await collector.collect({ inputs: { ...fixtureInputs, 'github-token': 'secret' }, cwd: FIXTURES, env: { GITHUB_REPOSITORY: 'octo/repo' } });

    // Assert
    expect(send).not.toHaveBeenCalled();
  });

  it('fails with a clear message when reports is empty', async () => {
    // Act
    const result = collector.collect({ inputs: {}, cwd: FIXTURES, env: {} });

    // Assert
    await expect(result).rejects.toThrow('reports: give at least one report');
  });
});
