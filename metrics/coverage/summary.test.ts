import { describe, expect, it } from 'vitest';
import type { CoverageSnapshot, FileCoverage } from './metric.ts';
import { summarizeCoverage, testRows } from './summary.ts';

const SHA = 'a'.repeat(40);

function file(name: string, covered: number, total: number): FileCoverage {
  return { file: name, lines: [covered, total], statements: [covered, total], functions: [covered, total], branches: [0, 0] };
}

function snapshot(suites: CoverageSnapshot['suites'], tests?: CoverageSnapshot['tests']): CoverageSnapshot {
  return { sha: SHA, date: '2026-10-21T00:00:00.000Z', suites, ...(tests && { tests }) };
}

describe('summarizeCoverage', () => {
  it('adds each file to every folder above it and to the root, for each suite', () => {
    // Arrange
    const files = [file('src/main/a.ts', 1, 2), file('src/main/feed/b.ts', 3, 4), file('src/renderer/c.ts', 5, 6)];

    // Act
    const result = summarizeCoverage(snapshot({ total: files, unit: files.slice(0, 1) }));

    // Assert
    expect(result.find((s) => s.suite === 'total' && s.folder === 'src/main')).toMatchObject({ file_count: 2, sums: [4, 6, 4, 6, 4, 6, 0, 0] });
    expect(result.find((s) => s.suite === 'total' && s.folder === '.')).toMatchObject({ file_count: 3 });
    expect(result.find((s) => s.suite === 'unit' && s.folder === 'src')).toMatchObject({ file_count: 1 });
    expect(result).toHaveLength(5 + 3);
  });
});

describe('testRows', () => {
  it('gives one row for each test suite, and none without test counts', () => {
    // Arrange
    const counts = { files: 2, tests: 5, passed: 3, failed: 1, skipped: 1 };

    // Act
    const withTests = testRows(snapshot({ total: [] }, { unit: counts }));
    const withoutTests = testRows(snapshot({ total: [] }));

    // Assert
    expect(withTests).toEqual([['unit', 2, 5, 3, 1, 1]]);
    expect(withoutTests).toEqual([]);
  });
});
