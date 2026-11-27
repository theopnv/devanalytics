import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeRepo } from '../../core/backfill/test-repo.ts';
import type { FixtureRepo } from '../../core/backfill/test-repo.ts';
import { collector } from './collect.ts';
import { metric } from './metric.ts';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const LCOV = 'SF:src/a.ts\nDA:1,1\nDA:2,0\nend_of_record\n';
let repo: FixtureRepo | undefined;

afterEach(async () => {
  await repo?.remove();
  repo = undefined;
});

describe('collector', () => {
  it('declares the reports and the test-results inputs, and backfills commits', () => {
    // Assert
    expect(collector.inputs.map(({ name }) => name)).toEqual(['reports', 'test-results']);
    expect(collector.backfill).toBe('commits');
  });

  it('reads the reports of the fixtures, with a total suite and the test counts', async () => {
    // Arrange
    const inputs = { reports: 'unit=coverage/unit.info\ne2e=coverage/e2e.info', 'test-results': 'unit=coverage/unit.json' };

    // Act
    const snapshot = metric.parse(await collector.collect({ inputs, cwd: FIXTURES, env: {} }));

    // Assert
    expect(Object.keys(snapshot.suites).sort()).toEqual(['e2e', 'total', 'unit']);
    expect(snapshot.suites['total']?.map(({ file, lines, functions, branches }) => [file, lines, functions, branches])).toEqual([
      ['src/main/a.ts', [4, 4], [2, 2], [2, 2]],
      ['src/main/c.ts', [0, 1], [0, 1], [0, 0]],
      ['src/main/feed/b.ts', [2, 2], [1, 1], [0, 0]],
    ]);
    expect(snapshot.tests).toEqual({ unit: { files: 2, tests: 5, passed: 3, failed: 1, skipped: 1 } });
  });

  it('takes the sha and the date of the checked out commit', async () => {
    // Arrange
    repo = await makeRepo([{ date: '2026-03-01T12:00:00Z', files: { 'lcov.info': LCOV } }]);

    // Act
    const snapshot = await collector.collect({ inputs: { reports: 'unit=lcov.info' }, cwd: repo.path, env: {} });

    // Assert
    expect(metric.parse(snapshot)).toMatchObject({ sha: repo.shas[0], date: '2026-03-01T12:00:00.000Z' });
    expect(Object.keys(snapshot.suites)).toEqual(['total']);
    expect(snapshot).not.toHaveProperty('tests');
  });

  it('fails with a clear message when reports is empty', async () => {
    // Act
    const result = collector.collect({ inputs: {}, cwd: FIXTURES, env: {} });

    // Assert
    await expect(result).rejects.toThrow('reports: give at least one report');
  });
});
