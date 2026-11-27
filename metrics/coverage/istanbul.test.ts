import path from 'node:path';
import libCoverage from 'istanbul-lib-coverage';
import type { FileCoverageData } from 'istanbul-lib-coverage';
import { describe, expect, it } from 'vitest';
import { mergeMaps, parseIstanbul, rebase, summarizeMap } from './istanbul.ts';

const ROOT = path.join(path.sep, 'repo');

/** One statement for each entry of `hits`, on its own line, in a file at `file`. */
function fileCoverage(file: string, hits: number[], firstLine = 1): FileCoverageData {
  return {
    path: file,
    statementMap: Object.fromEntries(hits.map((_, index) => [String(index), { start: { line: firstLine + index, column: 0 }, end: { line: firstLine + index, column: 10 } }])),
    s: Object.fromEntries(hits.map((hit, index) => [String(index), hit])),
    fnMap: {},
    f: {},
    branchMap: {},
    b: {},
  };
}

function mapOf(...files: FileCoverageData[]) {
  return libCoverage.createCoverageMap(Object.fromEntries(files.map((data) => [data.path, data])));
}

const abs = (relative: string) => path.join(ROOT, relative);

describe('rebase', () => {
  it('re-keys by relative path, drops files outside the root, and drops the input source map', () => {
    // Arrange
    const map = mapOf(
      { ...fileCoverage(abs('src/a.ts'), [1]), inputSourceMap: { version: 3 } } as FileCoverageData,
      fileCoverage(abs('lib/b.ts'), [1]),
      fileCoverage(path.join(path.sep, 'elsewhere', 'c.ts'), [1]),
      fileCoverage(abs('node_modules/x/d.ts'), [1]),
    );

    // Act
    const result = rebase(map, ROOT);

    // Assert
    expect(result.files().sort()).toEqual(['lib/b.ts', 'src/a.ts']);
    expect(result.fileCoverageFor('src/a.ts').data).not.toHaveProperty('inputSourceMap');
  });

  it('gives a statement with an unmapped end column the same key whether it came from JSON or from memory', () => {
    // Arrange
    const unmapped = (column: number | null) => ({
      ...fileCoverage(abs('src/a.ts'), [1]),
      statementMap: { 0: { start: { line: 3, column: 2 }, end: { line: 3, column } } },
    }) as unknown as FileCoverageData;
    const fromJson = rebase(mapOf(unmapped(null)), ROOT);
    const fromMemory = rebase(mapOf(unmapped(Infinity)), ROOT);

    // Act
    const result = mergeMaps(fromJson, fromMemory);

    // Assert
    expect(Object.keys(result.fileCoverageFor('src/a.ts').statementMap)).toHaveLength(1);
    expect(result.fileCoverageFor('src/a.ts').getLineCoverage()).toEqual({ 3: 2 });
  });
});

describe('parseIstanbul', () => {
  it('reads a coverage-final.json and resolves relative keys against the root', () => {
    // Arrange
    const text = JSON.stringify({ 'src/a.ts': fileCoverage('src/a.ts', [1, 0]), [abs('src/b.ts')]: fileCoverage(abs('src/b.ts'), [1]) });

    // Act
    const result = parseIstanbul(text, ROOT);

    // Assert
    expect(result.files().sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('mergeMaps', () => {
  it('adds the hits of statements at the same location, even when the numbering differs', () => {
    // Arrange
    const first = mapOf(fileCoverage('src/a.ts', [1, 0]));
    const second = mapOf({
      ...fileCoverage('src/a.ts', [0, 3]),
      statementMap: { 7: { start: { line: 2, column: 0 }, end: { line: 2, column: 10 } }, 8: { start: { line: 9, column: 0 }, end: { line: 9, column: 10 } } },
      s: { 7: 3, 8: 1 },
    });

    // Act
    const result = mergeMaps(first, second);

    // Assert
    expect(result.fileCoverageFor('src/a.ts').getLineCoverage()).toEqual({ 1: 1, 2: 3, 9: 1 });
  });

  it('leaves the inputs unchanged', () => {
    // Arrange
    const first = mapOf(fileCoverage('src/a.ts', [1]));
    const second = mapOf(fileCoverage('src/a.ts', [2]));

    // Act
    mergeMaps(first, second);

    // Assert
    expect(first.fileCoverageFor('src/a.ts').s['0']).toBe(1);
  });
});

describe('summarizeMap', () => {
  it('gives sorted covered and total counts for each file', () => {
    // Arrange
    const map = mapOf(fileCoverage('src/b.ts', [1, 0]), fileCoverage('src/a.ts', [2]));

    // Act
    const result = summarizeMap(map);

    // Assert
    expect(result.map(({ file, lines, statements }) => [file, lines, statements])).toEqual([
      ['src/a.ts', [1, 1], [1, 1]],
      ['src/b.ts', [1, 2], [1, 2]],
    ]);
  });
});
