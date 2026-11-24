import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { ValidationError } from '../../core/contract.ts';
import { collector } from './collect.ts';
import { metric } from './metric.ts';
import { store } from './store.ts';
import snapshot from './fixtures/snapshot.json' with { type: 'json' };

describe('example metric', () => {
  test('parses the fixture snapshot', () => {
    expect(metric.parse(snapshot)).toEqual(snapshot);
  });

  test.each([
    ['a body that is not an object', []],
    ['a short sha', { ...snapshot, sha: 'abc' }],
    ['a bad date', { ...snapshot, date: 'yesterday' }],
    ['items that are not an array', { ...snapshot, items: {} }],
    ['an item without a name', { ...snapshot, items: [{ value: 1 }] }],
    ['an item with a fractional value', { ...snapshot, items: [{ name: 'a', value: 1.5 }] }],
  ])('refuses %s', (_label, body) => {
    expect(() => metric.parse(body)).toThrow(ValidationError);
  });

  test('turns the items into rows of the allowed table', () => {
    const [rows, ...rest] = store.toRows(metric.parse(snapshot));

    expect(rest).toEqual([]);
    expect(store.tables).toContain(rows?.table);
    expect(rows?.rows).toEqual([['alpha', 3], ['beta', 5]]);
  });

  test('collects a snapshot from a JSON file', async () => {
    const collected = await collector.collect({
      inputs: { file: 'snapshot.json' },
      cwd: path.join(import.meta.dirname, 'fixtures'),
      env: {},
    });

    expect(collected).toEqual(snapshot);
  });
});
