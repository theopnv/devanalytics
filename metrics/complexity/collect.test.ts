import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeRepo } from '../../core/backfill/test-repo.ts';
import type { FixtureRepo } from '../../core/backfill/test-repo.ts';
import { collector, readLimit, readLines } from './collect.ts';
import { metric } from './metric.ts';

const SOURCE = 'export function a(x: number) { return x > 1 ? 1 : 2; }\n';
let repo: FixtureRepo | undefined;

afterEach(async () => {
  await repo?.remove();
  repo = undefined;
});

describe('readLines', () => {
  it('splits on new lines, trims, and drops empty lines', () => {
    // Act
    const result = readLines('  src/**/*.ts \n\n lib/**/*.{js,jsx}\n');

    // Assert
    expect(result).toEqual(['src/**/*.ts', 'lib/**/*.{js,jsx}']);
  });

  it('returns no line for a missing value', () => {
    // Act
    const result = readLines(undefined);

    // Assert
    expect(result).toEqual([]);
  });
});

describe('readLimit', () => {
  it.each(['-1', '1.5', 'ten', '', ' ', '1e3'])('refuses "%s"', (value) => {
    // Act
    const read = () => readLimit('cognitive-limit', value);

    // Assert
    expect(read).toThrow(/cognitive-limit/);
  });

  it('accepts 0', () => {
    // Act
    const result = readLimit('cognitive-limit', '0');

    // Assert
    expect(result).toBe(0);
  });
});

describe('collector', () => {
  it('declares the inputs of the plan, with their defaults', () => {
    // Act
    const defaults = Object.fromEntries(collector.inputs.map(({ name, default: value }) => [name, value]));

    // Assert
    expect(defaults).toEqual({
      include: 'src/**/*.{ts,tsx,js,jsx}',
      exclude: undefined,
      'test-pattern': '**/*.test.*',
      'cognitive-limit': '15',
      'cyclomatic-limit': '10',
    });
    expect(collector.backfill).toBe('commits');
  });

  it('collects the functions of the checked out commit with the limits of the inputs', async () => {
    // Arrange
    repo = await makeRepo([{ date: '2026-03-01T12:00:00Z', files: { 'src/a.ts': SOURCE, 'src/a.test.ts': SOURCE, 'lib/b.ts': SOURCE } }]);

    // Act
    const snapshot = await collector.collect({ inputs: { 'cognitive-limit': '3', 'cyclomatic-limit': '1' }, cwd: repo.path, env: {} });

    // Assert
    expect(metric.parse(snapshot)).toEqual({
      sha: repo.shas[0],
      date: '2026-03-01T12:00:00.000Z',
      cognitive_limit: 3,
      cyclomatic_limit: 1,
      functions: [
        { file: 'src/a.test.ts', qualified_name: 'a', line: 1, cyclomatic: 2, cognitive: 1, is_test: true },
        { file: 'src/a.ts', qualified_name: 'a', line: 1, cyclomatic: 2, cognitive: 1, is_test: false },
      ],
    });
  });

  it('uses the inputs to select the files', async () => {
    // Arrange
    repo = await makeRepo([{ date: '2026-03-01T12:00:00Z', files: { 'src/a.ts': SOURCE, 'lib/b.ts': SOURCE, 'lib/gen/c.ts': SOURCE, 'lib/d.spec.ts': SOURCE } }]);
    const inputs = { include: 'lib/**/*.ts', exclude: 'lib/gen/**', 'test-pattern': '**/*.spec.*' };

    // Act
    const snapshot = await collector.collect({ inputs, cwd: repo.path, env: {} });

    // Assert
    expect(snapshot.functions.map(({ file, is_test }) => [file, is_test])).toEqual([['lib/b.ts', false], ['lib/d.spec.ts', true]]);
  });

  it('measures the folder of the working directory', async () => {
    // Arrange
    repo = await makeRepo([{ date: '2026-03-01T12:00:00Z', files: { 'packages/app/src/a.ts': SOURCE, 'src/b.ts': SOURCE } }]);

    // Act
    const snapshot = await collector.collect({ inputs: {}, cwd: path.join(repo.path, 'packages', 'app'), env: {} });

    // Assert
    expect(snapshot.functions.map(({ file }) => file)).toEqual(['src/a.ts']);
  });

  it('fails before it measures when a limit is not a number', async () => {
    // Act
    const result = collector.collect({ inputs: { 'cyclomatic-limit': 'ten' }, cwd: path.join(import.meta.dirname, 'does-not-exist'), env: {} });

    // Assert
    await expect(result).rejects.toThrow(/cyclomatic-limit/);
  });
});
