import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadReports, parseNamedPaths } from './reports.ts';

const roots: string[] = [];

async function makeRoot(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devanalytics-tests-'));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  return root;
}

const vitest = (...states: string[]) => JSON.stringify({ tests: states.map((state, index) => ({ file: 'a.test.ts', title: `t${index}`, state, retries: 0, error: 'bad' })) });

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('parseNamedPaths', () => {
  it('reads one suite=path pair on each line', () => {
    // Act
    const result = parseNamedPaths(' unit = unit.json \n\ne2e=reports/e2e.xml\n');

    // Assert
    expect(result).toEqual([{ name: 'unit', file: 'unit.json' }, { name: 'e2e', file: 'reports/e2e.xml' }]);
  });

  it.each([
    ['a line without a name', 'unit.json'],
    ['a line without a path', 'unit='],
    ['a suite that two lines name', 'unit=a.json\nunit=b.json'],
  ])('refuses %s', (_label, value) => {
    // Act
    const parse = () => parseNamedPaths(value);

    // Assert
    expect(parse).toThrow();
  });
});

describe('loadReports', () => {
  it('reads each suite in each runner folder, and tags the rows with both', async () => {
    // Arrange
    const root = await makeRoot({
      'ubuntu-latest/unit.json': vitest('passed', 'failed'),
      'ubuntu-latest/e2e.json': vitest('passed'),
      'macos-latest/unit.json': vitest('passed'),
    });
    const entries = [{ name: 'unit', file: 'unit.json' }, { name: 'e2e', file: 'e2e.json' }];

    // Act
    const { suites, exceptions } = await loadReports(root, entries, () => undefined);

    // Assert
    expect(suites.map(({ suite, runner, tests, failed }) => [suite, runner, tests, failed])).toEqual([
      ['unit', 'macos-latest', 1, 0],
      ['unit', 'ubuntu-latest', 2, 1],
      ['e2e', 'ubuntu-latest', 1, 0],
    ]);
    expect(exceptions).toEqual([{ suite: 'unit', runner: 'ubuntu-latest', file: 'a.test.ts', title: 't1', status: 'failed', retries: 0, error: 'bad' }]);
  });

  it('skips a runner that has no file for a suite, without a warning', async () => {
    // Arrange
    const root = await makeRoot({ 'ubuntu-latest/unit.json': vitest('passed'), 'macos-latest/other.txt': 'x' });
    const warnings: string[] = [];

    // Act
    const { suites } = await loadReports(root, [{ name: 'unit', file: 'unit.json' }], (message) => warnings.push(message));

    // Assert
    expect(suites.map(({ runner }) => runner)).toEqual(['ubuntu-latest']);
    expect(warnings).toEqual([]);
  });

  it('warns about a report that cannot be read, and keeps the others', async () => {
    // Arrange
    const root = await makeRoot({ 'ubuntu-latest/unit.json': '{ nope', 'macos-latest/unit.json': vitest('passed') });
    const warnings: string[] = [];

    // Act
    const { suites } = await loadReports(root, [{ name: 'unit', file: 'unit.json' }], (message) => warnings.push(message));

    // Assert
    expect(suites.map(({ runner }) => runner)).toEqual(['macos-latest']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^Skipped the unit report of ubuntu-latest: /);
  });

  it('ignores a file at the top of the artifact folder', async () => {
    // Arrange
    const root = await makeRoot({ 'unit.json': vitest('passed') });

    // Act
    const { suites } = await loadReports(root, [{ name: 'unit', file: 'unit.json' }], () => undefined);

    // Assert
    expect(suites).toEqual([]);
  });
});
