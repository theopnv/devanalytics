import { describe, expect, it } from 'vitest';
import type { FunctionRow } from './metric.ts';
import { summarize } from './summary.ts';

const LIMITS = { cognitive: 15, cyclomatic: 10 };

function fn(file: string, cognitive: number, cyclomatic: number, is_test = false): FunctionRow {
  return { file, qualified_name: `f${cognitive}`, line: 1, cognitive, cyclomatic, is_test };
}

describe('summarize', () => {
  it('counts a function in each folder above it, and keeps test files apart', () => {
    // Arrange
    const functions = [fn('src/main/a.ts', 20, 3), fn('src/main/feed/b.ts', 2, 12), fn('src/main/a.test.ts', 30, 30, true)];

    // Act
    const result = summarize(functions, LIMITS);

    // Assert
    const src = result.find((s) => s.folder === 'src' && !s.is_test);
    expect(src).toMatchObject({
      function_count: 2, cognitive_sum: 22, cyclomatic_sum: 15, cognitive_max: 20, cyclomatic_max: 12,
      cognitive_above: 1, cyclomatic_above: 1, above_limits: 2,
    });
    expect(result.find((s) => s.folder === 'src/main/feed')).toMatchObject({ function_count: 1, above_limits: 1 });
    expect(result.find((s) => s.folder === 'src' && s.is_test)).toMatchObject({ function_count: 1, cognitive_sum: 30 });
    expect(result).toHaveLength(7);
  });

  it('adds a summary for the repository root', () => {
    // Arrange
    const functions = [fn('index.ts', 1, 1), fn('src/a.ts', 1, 1)];

    // Act
    const result = summarize(functions, LIMITS);

    // Assert
    expect(result.find((s) => s.folder === '.')).toMatchObject({ function_count: 2 });
  });

  it('keeps a score that is equal to the limit inside it, and counts a function above both limits once in above_limits', () => {
    // Arrange
    const functions = [fn('src/a.ts', 15, 10), fn('src/b.ts', 16, 11)];

    // Act
    const result = summarize(functions, LIMITS);

    // Assert
    expect(result.find((s) => s.folder === 'src')).toMatchObject({ cognitive_above: 1, cyclomatic_above: 1, above_limits: 1 });
  });

  it('uses the limits of the snapshot', () => {
    // Arrange
    const functions = [fn('src/a.ts', 5, 5)];

    // Act
    const result = summarize(functions, { cognitive: 4, cyclomatic: 20 });

    // Assert
    expect(result.find((s) => s.folder === 'src')).toMatchObject({ cognitive_above: 1, cyclomatic_above: 0, above_limits: 1 });
  });
});
