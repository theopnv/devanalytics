import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../core/contract.ts';
import { metric } from './metric.ts';
import { store } from './store.ts';
import snapshot from './fixtures/snapshot.json' with { type: 'json' };

describe('tests metric', () => {
  it('parses the fixture snapshot', () => {
    // Act
    const result = metric.parse(snapshot);

    // Assert
    expect(result).toEqual(snapshot);
  });

  it('converts the date to UTC so that dates sort as text', () => {
    // Act
    const result = metric.parse({ ...snapshot, date: '2026-10-20T17:56:56+02:00' });

    // Assert
    expect(result.date).toBe('2026-10-20T15:56:56.000Z');
  });

  it.each([
    ['a body that is not an object', []],
    ['a run id that is not an integer', { ...snapshot, run_id: 1.5 }],
    ['a missing attempt', { ...snapshot, run_attempt: undefined }],
    ['a bad date', { ...snapshot, date: 'yesterday' }],
    ['suites that are not an array', { ...snapshot, suites: {} }],
    ['a suite without a runner', { ...snapshot, suites: [{ ...snapshot.suites[0], runner: '' }] }],
    ['a count that is not an integer', { ...snapshot, suites: [{ ...snapshot.suites[0], flaky: 0.5 }] }],
    ['an exception with an unknown status', { ...snapshot, exceptions: [{ ...snapshot.exceptions[0], status: 'skipped' }] }],
    ['more than 1000 exceptions', { ...snapshot, exceptions: Array.from({ length: 1001 }, () => snapshot.exceptions[0]) }],
  ])('refuses %s', (_label, body) => {
    // Act
    const parse = () => metric.parse(body);

    // Assert
    expect(parse).toThrow(ValidationError);
  });
});

describe('store', () => {
  it('gives one row for each suite and one row for each exception, with the position', () => {
    // Act
    const [suites, exceptions] = store.toRows(metric.parse(snapshot));

    // Assert
    expect(suites?.rows).toEqual([['unit', 'ubuntu-latest', 4, 2, 1, 1, 1], ['e2e', 'ubuntu-latest', 1, 1, 0, 0, 0]]);
    expect(exceptions?.rows.map((row) => row.slice(0, 3))).toEqual([['unit', 'ubuntu-latest', 0], ['unit', 'ubuntu-latest', 1]]);
    expect([suites?.table, exceptions?.table]).toEqual(store.tables);
  });

  it('starts each table name with the metric name', () => {
    // Assert
    expect(store.tables.every((table) => table.startsWith('tests_'))).toBe(true);
  });
});
