import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../core/contract.ts';
import { badgeColor, coverageBadge, readBadgeParams, store } from './store.ts';
import { metric } from './metric.ts';
import snapshot from './fixtures/snapshot.json' with { type: 'json' };

describe('badgeColor', () => {
  it.each([[100, 'brightgreen'], [80, 'brightgreen'], [79.9, 'orange'], [60, 'orange'], [59.9, 'red'], [0, 'red']])('gives the band of %s percent', (percent, color) => {
    // Act
    const result = badgeColor(percent);

    // Assert
    expect(result).toBe(color);
  });
});

describe('coverageBadge', () => {
  it('rounds to one decimal and picks the band', () => {
    // Act
    const result = coverageBadge({ lines_covered: 889, lines_total: 1000 });

    // Assert
    expect(result).toEqual({ schemaVersion: 1, label: 'coverage', message: '88.9%', color: 'brightgreen' });
  });

  it.each([['no row', null], ['no line', { lines_covered: 0, lines_total: 0 }]])('says unknown for %s', (_label, row) => {
    // Act
    const result = coverageBadge(row);

    // Assert
    expect(result).toEqual({ schemaVersion: 1, label: 'coverage', message: 'unknown', color: 'lightgrey' });
  });
});

describe('readBadgeParams', () => {
  it('defaults to the total suite and the root folder', () => {
    // Act
    const result = readBadgeParams(new URLSearchParams());

    // Assert
    expect(result).toEqual({ suite: 'total', folder: '.' });
  });

  it('reads the suite and the folder', () => {
    // Act
    const result = readBadgeParams(new URLSearchParams('suite=unit&folder=src/main'));

    // Assert
    expect(result).toEqual({ suite: 'unit', folder: 'src/main' });
  });

  it.each([
    ['a suite with a quote', 'suite=a%27b'],
    ['an empty suite', 'suite='],
    ['a suite of 65 characters', `suite=${'a'.repeat(65)}`],
    ['an empty folder', 'folder='],
    ['a folder with a control character', 'folder=src%0Amain'],
    ['a folder of 1001 characters', `folder=${'a'.repeat(1001)}`],
  ])('refuses %s', (_label, query) => {
    // Act
    const read = () => readBadgeParams(new URLSearchParams(query));

    // Assert
    expect(read).toThrow(ValidationError);
  });
});

describe('store', () => {
  it('starts each table name with the metric name, so that the query guard accepts it', () => {
    // Assert
    expect(store.tables.every((table) => table.startsWith('coverage_'))).toBe(true);
  });

  it('only returns rows for tables of the store', () => {
    // Act
    const tables = store.toRows(metric.parse(snapshot)).map(({ table }) => table);

    // Assert
    expect(tables).toEqual(store.tables);
  });
});
