import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mergeLcov, parseLcov, summarizeLcov } from './lcov.ts';

const ROOT = path.join(path.sep, 'repo');

const REPORT = `TN:
SF:src/a.ts
FN:1,load
FN:9,save
FNDA:4,load
FNDA:0,save
DA:1,4
DA:2,4,abc
DA:9,0
BRDA:2,0,0,3
BRDA:2,0,1,-
LF:99
LH:99
end_of_record
`;

describe('parseLcov', () => {
  it('counts lines, functions and branches from the detail records and ignores the summary records', () => {
    // Act
    const [file] = summarizeLcov(parseLcov(REPORT, ROOT));

    // Assert
    expect(file).toEqual({ file: 'src/a.ts', lines: [2, 3], statements: [2, 3], functions: [1, 2], branches: [1, 2] });
  });

  it('reads the lcov 2 function record with an end line', () => {
    // Arrange
    const text = 'SF:src/a.ts\nFN:1,5,load\nFNDA:2,load\nend_of_record\n';

    // Act
    const [file] = summarizeLcov(parseLcov(text, ROOT));

    // Assert
    expect(file?.functions).toEqual([1, 1]);
  });

  it('counts a function without an FNDA record as not hit', () => {
    // Act
    const [file] = summarizeLcov(parseLcov('SF:src/a.ts\nFN:1,load\nend_of_record\n', ROOT));

    // Assert
    expect(file?.functions).toEqual([0, 1]);
  });

  it('turns an absolute path into a path relative to the root, and drops files outside it', () => {
    // Arrange
    const text = `SF:${path.join(ROOT, 'src', 'a.ts')}\nDA:1,1\nend_of_record\nSF:${path.join(path.sep, 'other', 'b.ts')}\nDA:1,1\nend_of_record\nSF:node_modules/x/c.js\nDA:1,1\nend_of_record\n`;

    // Act
    const result = summarizeLcov(parseLcov(text, ROOT));

    // Assert
    expect(result.map(({ file }) => file)).toEqual(['src/a.ts']);
  });

  it('adds two records of the same file in one report', () => {
    // Act
    const [file] = summarizeLcov(parseLcov('SF:src/a.ts\nDA:1,0\nend_of_record\nSF:src/a.ts\nDA:1,2\nDA:2,0\nend_of_record\n', ROOT));

    // Assert
    expect(file?.lines).toEqual([1, 2]);
  });

  it('reads Windows line endings', () => {
    // Act
    const result = summarizeLcov(parseLcov('SF:src/a.ts\r\nDA:1,1\r\nend_of_record\r\n', ROOT));

    // Assert
    expect(result).toHaveLength(1);
  });
});

describe('mergeLcov', () => {
  it('counts a line as covered when one report covers it, line by line', () => {
    // Arrange
    const unit = parseLcov('SF:src/a.ts\nDA:1,1\nDA:2,0\nBRDA:1,0,0,0\nBRDA:1,0,1,1\nend_of_record\n', ROOT);
    const e2e = parseLcov('SF:src/a.ts\nDA:2,5\nDA:3,0\nBRDA:1,0,0,2\nBRDA:1,0,1,0\nSF:src/b.ts\nDA:1,0\nend_of_record\n', ROOT);

    // Act
    const result = summarizeLcov(mergeLcov(unit, e2e));

    // Assert
    expect(result).toEqual([
      { file: 'src/a.ts', lines: [2, 3], statements: [2, 3], functions: [0, 0], branches: [2, 2] },
      { file: 'src/b.ts', lines: [0, 1], statements: [0, 1], functions: [0, 0], branches: [0, 0] },
    ]);
  });

  it('leaves the inputs unchanged', () => {
    // Arrange
    const unit = parseLcov('SF:src/a.ts\nDA:1,1\nend_of_record\n', ROOT);

    // Act
    mergeLcov(unit, parseLcov('SF:src/a.ts\nDA:1,1\nend_of_record\n', ROOT));

    // Assert
    expect(unit.get('src/a.ts')?.lines.get(1)).toBe(1);
  });
});
